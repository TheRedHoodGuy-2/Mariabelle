// ============================================================
// apps/whatsapp-bot/src/scheduler.ts
// Phase 2, Steps 7+8 — Daily, fishing, digging automation
// Independent per-group schedules. Weighted random intervals.
// ============================================================

import makeWASocket from '@whiskeysockets/baileys';
import { supabase, log } from './index';
import { ParsedMessage, Platform } from './types';
import { sendQueued } from './send-queue';
import { isGroupOnline } from './health-monitor';
import { isGamblingGroup, isFishingGroup } from './group-classifier';

// ─── PER-GROUP TASK STATE ────────────────────────────────────
interface GroupSchedule {
  groupId:      string;
  nextDaily:    Date | null;
  nextFish:     Date | null;
  nextDig:      Date | null;
  dailyMisses:  number;
  fishCooldown: number | null; // learned from bot response (ms)
  digCooldown:  number | null;
}

const schedules = new Map<string, GroupSchedule>();
let   sock_ref:   ReturnType<typeof makeWASocket> | null = null;

// ─── INIT ────────────────────────────────────────────────────
export async function initScheduler(
  sock: ReturnType<typeof makeWASocket>,
  groupIds: string[]
): Promise<void> {
  sock_ref = sock;

  for (const groupId of groupIds) {
    await initGroupSchedule(groupId);
  }

  // Master tick — runs every 30 seconds and dispatches due tasks
  setInterval(() => runSchedulerTick(), 30_000);
  log.info(`Scheduler started for ${groupIds.length} groups`);
}

async function initGroupSchedule(groupId: string): Promise<void> {
  // Check last daily from Supabase
  const { data: lastDaily } = await supabase
    .from('daily_claims')
    .select('timestamp')
    .eq('group_id', groupId)
    .eq('platform', 'whatsapp')
    .order('timestamp', { ascending: false })
    .limit(1)
    .single();

  const lastDailyAt = lastDaily ? new Date(lastDaily.timestamp) : null;
  const nextDaily   = lastDailyAt
    ? new Date(lastDailyAt.getTime() + 24 * 60 * 60 * 1000)
    : new Date(); // never claimed — do it now

  schedules.set(groupId, {
    groupId,
    nextDaily,
    nextFish:     new Date(Date.now() + randFishInterval()),
    nextDig:      new Date(Date.now() + randFishInterval() * 1.5), // offset from fish
    dailyMisses:  0,
    fishCooldown: null,
    digCooldown:  null,
  });
}

// ─── MASTER TICK ─────────────────────────────────────────────
async function runSchedulerTick(): Promise<void> {
  if (!sock_ref) return;
  const now = new Date();

  for (const [groupId, sched] of schedules) {
    if (!isGroupOnline(groupId)) continue;

    // DAILY
    if (sched.nextDaily && now >= sched.nextDaily) {
      await runDaily(sock_ref, groupId, sched);
    }

    // FISH — only in fishing-tagged or card groups
    if (sched.nextFish && now >= sched.nextFish) {
      await runFish(sock_ref, groupId, sched);
    }

    // DIG
    if (sched.nextDig && now >= sched.nextDig) {
      await runDig(sock_ref, groupId, sched);
    }
  }
}

// ─── DAILY ───────────────────────────────────────────────────
async function runDaily(
  sock: ReturnType<typeof makeWASocket>,
  groupId: string,
  sched: GroupSchedule
): Promise<void> {
  await sendQueued(sock, groupId, '.daily');
  sched.nextDaily = null; // wait for reply to set next time
  log.info(`Sent .daily to ${groupId}`);
}

export async function handleDailyReply(parsed: ParsedMessage): Promise<void> {
  const { text, groupId, timestamp } = parsed;

  // Parse: "You claimed your daily reward of $1000 coins + $200 streak bonus (streak: 5)"
  const amountMatch = text.match(/reward of \$?([\d,]+)/i);
  const bonusMatch  = text.match(/\$?([\d,]+)\s*streak bonus/i);
  const streakMatch = text.match(/streak:\s*(\d+)/i);

  const amount      = amountMatch ? parseInt(amountMatch[1].replace(/,/g, '')) : null;
  const streakBonus = bonusMatch  ? parseInt(bonusMatch[1].replace(/,/g, ''))  : 0;
  const streak      = streakMatch ? parseInt(streakMatch[1])                   : null;

  await supabase.from('daily_claims').insert({
    group_id:     groupId,
    platform:     'whatsapp' as Platform,
    amount,
    streak_bonus: streakBonus,
    streak_count: streak,
    timestamp:    timestamp.toISOString(),
  });

  // Schedule next daily in exactly 24 hours
  const sched = schedules.get(groupId);
  if (sched) {
    sched.nextDaily  = new Date(timestamp.getTime() + 24 * 60 * 60 * 1000);
    sched.dailyMisses = 0;
  }

  log.info(`Daily claimed in ${groupId}: $${amount} + $${streakBonus} bonus (streak: ${streak})`);
}

// ─── FISHING ─────────────────────────────────────────────────
async function runFish(
  sock: ReturnType<typeof makeWASocket>,
  groupId: string,
  sched: GroupSchedule
): Promise<void> {
  await sendQueued(sock, groupId, '.fish');
  sched.nextFish = null; // wait for reply
}

export async function handleFishReply(
  sock: ReturnType<typeof makeWASocket>,
  parsed: ParsedMessage
): Promise<void> {
  const { text, groupId, timestamp } = parsed;
  const sched = schedules.get(groupId);

  // On cooldown — parse wait time and schedule precisely
  const cooldownMatch = text.match(/(\d+)\s*(second|minute|hour)/i);
  if (cooldownMatch) {
    const cooldownMs = parseCooldownToMs(text);
    if (sched) sched.nextFish = new Date(Date.now() + cooldownMs - 5_000); // -5s buffer
    return;
  }

  // Caught a fish → sell immediately
  if (/caught a/i.test(text) || /reeling in/i.test(text)) {
    const catchType = 'fish';
    const coinsMatch = text.match(/\$?([\d,]+)\s*coins?/i);
    const coins = coinsMatch ? parseInt(coinsMatch[1].replace(/,/g, '')) : null;

    await supabase.from('fishing_events').insert({
      group_id:    groupId,
      platform:    'whatsapp' as Platform,
      catch_type:  catchType,
      coins_earned: coins,
      raw_response: text,
      timestamp:   timestamp.toISOString(),
    });

    // Auto sell
    await sendQueued(sock, groupId, '.sell fish');
  }

  // Nothing caught
  if (/nothing|no luck/i.test(text)) {
    await supabase.from('fishing_events').insert({
      group_id:    groupId,
      platform:    'whatsapp' as Platform,
      catch_type:  'nothing',
      coins_earned: null,
      raw_response: text,
      timestamp:   timestamp.toISOString(),
    });
  }

  // Schedule next fish
  if (sched) sched.nextFish = new Date(Date.now() + randFishInterval());
}

// ─── DIGGING ─────────────────────────────────────────────────
async function runDig(
  sock: ReturnType<typeof makeWASocket>,
  groupId: string,
  sched: GroupSchedule
): Promise<void> {
  await sendQueued(sock, groupId, '.dig');
  sched.nextDig = null;
}

export async function handleDigReply(parsed: ParsedMessage): Promise<void> {
  const { text, mediaCaption, groupId, timestamp } = parsed;
  const content = mediaCaption ?? text;
  const sched   = schedules.get(groupId);

  // On cooldown
  if (/cooldown|wait/i.test(content)) {
    const cooldownMs = parseCooldownToMs(content);
    if (sched) sched.nextDig = new Date(Date.now() + cooldownMs - 5_000);
    return;
  }

  // Parse result: "You used your Shovel and dug up: $241 Coins"
  const valueMatch = content.match(/\$?([\d,]+)\s*coins?/i);
  const value      = valueMatch ? parseInt(valueMatch[1].replace(/,/g, '')) : null;
  const resultType = value ? 'coins' : 'nothing';

  await supabase.from('dig_events').insert({
    group_id:    groupId,
    platform:    'whatsapp' as Platform,
    result_type: resultType,
    value,
    raw_response: content,
    timestamp:   timestamp.toISOString(),
  });

  // Learn cooldown from first response if not known
  if (sched) {
    sched.nextDig = new Date(Date.now() + (sched.digCooldown ?? randFishInterval() * 2));
  }

  log.debug(`Dig result in ${groupId}: ${resultType} ${value ? '$' + value : ''}`);
}

// ─── HELPERS ─────────────────────────────────────────────────

// Weighted random interval for fishing:
// 3-5min: 20% | 5-7min: 50% | 7-10min: 25% | 10-12min: 5%
function randFishInterval(): number {
  const roll = Math.random() * 100;
  const mins =
    roll < 20 ? randBetween(3, 5)   :
    roll < 70 ? randBetween(5, 7)   :
    roll < 95 ? randBetween(7, 10)  :
                randBetween(10, 12);
  return mins * 60 * 1000;
}

function randBetween(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

function parseCooldownToMs(text: string): number {
  const match = text.match(/(\d+)\s*(second|minute|hour)/i);
  if (!match) return 5 * 60 * 1000; // default 5 min if can't parse
  const n    = parseInt(match[1]);
  const unit = match[2].toLowerCase();
  if (unit.startsWith('s')) return n * 1000;
  if (unit.startsWith('m')) return n * 60 * 1000;
  if (unit.startsWith('h')) return n * 60 * 60 * 1000;
  return 5 * 60 * 1000;
}

// Register a new group with the scheduler
export async function registerGroup(groupId: string): Promise<void> {
  if (!schedules.has(groupId)) {
    await initGroupSchedule(groupId);
    log.debug(`Scheduler registered group: ${groupId}`);
  }
}
