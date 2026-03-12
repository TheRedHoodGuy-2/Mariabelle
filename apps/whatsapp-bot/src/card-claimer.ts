// ============================================================
// apps/whatsapp-bot/src/card-claimer.ts
// Phase 2, Step 6 — Card claimer
// Humanised delay, offline recovery, miss tracking
// ============================================================

import makeWASocket from '@whiskeysockets/baileys';
import { supabase, log } from './index';
import { ParsedMessage, DetectedSpawn, Platform } from './types';
import { sendQueued } from './send-queue';
import { isGroupOnline } from './health-monitor';
import { getGroupStats } from './group-stats';

// ─── SPAWN DETECTION ─────────────────────────────────────────
const SPAWN_REGEX  = /a wild card has appeared/i;
const CLAIM_ID     = /\.claim\s+([a-zA-Z0-9]+)/i;
const NAME_REGEX   = /name:\s*(.+)/i;
const TIER_REGEX   = /tier:\s*(\d+|s)/i;
const PRICE_REGEX  = /price:\s*\$?([\d,]+)/i;
const ISSUE_REGEX  = /issue:\s*#?(\d+)/i;

// Track active spawns to prevent double-claiming
const activeSpawns = new Map<string, DetectedSpawn>();

// ─── MAIN HANDLER ────────────────────────────────────────────
export async function handleCardSpawn(
  sock: ReturnType<typeof makeWASocket>,
  parsed: ParsedMessage
): Promise<void> {
  const content = parsed.mediaCaption ?? parsed.text;

  // Is this a spawn notification?
  if (SPAWN_REGEX.test(content)) {
    await processSpawn(sock, parsed, content);
    return;
  }

  // Is this a claim reply? (bot confirming who claimed it)
  if (isClaimReply(content)) {
    await processClaimReply(parsed, content);
    return;
  }
}

// ─── PROCESS SPAWN ───────────────────────────────────────────
async function processSpawn(
  sock: ReturnType<typeof makeWASocket>,
  parsed: ParsedMessage,
  content: string
): Promise<void> {
  const spawnId = parseSpawnId(content);
  if (!spawnId) {
    log.warn(`Card spawn detected but no spawn ID found in: ${content.slice(0, 100)}`);
    return;
  }

  // Already processing this spawn?
  if (activeSpawns.has(spawnId)) return;

  const spawn: DetectedSpawn = {
    spawnId,
    cardName: parseName(content),
    tier:     parseTier(content),
    price:    parsePrice(content),
    issue:    parseIssue(content),
    groupId:  parsed.groupId,
    platform: parsed.platform,
    spawnTime: parsed.timestamp,
    rawMessage: parsed,
  };

  activeSpawns.set(spawnId, spawn);
  log.info(`Card spawned: ${spawn.cardName} (Tier ${spawn.tier}) in ${spawn.groupId} — ID: ${spawnId}`);

  // Log spawn to DB immediately
  await supabase.from('card_events').insert({
    spawn_id:   spawnId,
    card_name:  spawn.cardName,
    tier:       spawn.tier,
    price:      spawn.price,
    issue:      spawn.issue,
    group_id:   spawn.groupId,
    platform:   spawn.platform as Platform,
    spawn_time: spawn.spawnTime.toISOString(),
    outcome:    null, // pending
  });

  // Schedule claim with humanised delay
  const delayMs = calcClaimDelay(spawn.groupId);
  log.debug(`Claiming ${spawnId} in ${delayMs}ms`);

  setTimeout(async () => {
    await attemptClaim(sock, spawn, delayMs);
  }, delayMs);
}

// ─── ATTEMPT CLAIM ───────────────────────────────────────────
async function attemptClaim(
  sock: ReturnType<typeof makeWASocket>,
  spawn: DetectedSpawn,
  delayMs: number
): Promise<void> {
  if (!isGroupOnline(spawn.groupId)) {
    // Bot offline — run recovery cascade
    await offlineRecoveryCascade(sock, spawn, delayMs);
    return;
  }

  const claimTime = new Date();
  await sendQueued(sock, spawn.groupId, `.claim ${spawn.spawnId}`);

  // Update claim attempt time
  await supabase.from('card_events')
    .update({
      our_claim_time: claimTime.toISOString(),
      delay_ms:       delayMs,
    })
    .eq('spawn_id', spawn.spawnId)
    .eq('group_id', spawn.groupId);
}

// ─── OFFLINE RECOVERY CASCADE ────────────────────────────────
// From the bible: T+0 → T+5 → T+20 → T+50 → T+60 → T+70 give up
async function offlineRecoveryCascade(
  sock: ReturnType<typeof makeWASocket>,
  spawn: DetectedSpawn,
  originalDelay: number
): Promise<void> {
  log.warn(`Bot offline for group ${spawn.groupId} — running claim recovery cascade`);

  const { spawnId, groupId } = spawn;

  // T+0: already missed first attempt. Try again.
  await sendQueued(sock, groupId, `.claim ${spawnId}`);

  // T+5s
  setTimeout(async () => {
    await sendQueued(sock, groupId, `.claim ${spawnId}`);
  }, 5_000);

  // T+20s: send .test
  setTimeout(async () => {
    await sendQueued(sock, groupId, '.test');
  }, 20_000);

  // T+50s: send .bots
  setTimeout(async () => {
    await sendQueued(sock, groupId, '.bots');
  }, 50_000);

  // T+60s: final claim attempt
  setTimeout(async () => {
    await sendQueued(sock, groupId, `.claim ${spawnId}`);
  }, 60_000);

  // T+70s: give up
  setTimeout(async () => {
    activeSpawns.delete(spawnId);
    await supabase.from('card_events')
      .update({ outcome: 'unresolved_offline' })
      .eq('spawn_id', spawnId)
      .eq('group_id', groupId)
      .is('outcome', null);
    log.warn(`Gave up on claim ${spawnId} after offline recovery cascade`);
  }, 70_000);
}

// ─── PROCESS CLAIM REPLY ─────────────────────────────────────
async function processClaimReply(
  parsed: ParsedMessage,
  content: string
): Promise<void> {
  // Bot confirms claim — figure out who got it
  const weGotIt = /you (got|claimed|received)/i.test(content);
  const theyGotIt = /already claimed|someone else/i.test(content);

  // Find the most recent active spawn in this group
  for (const [spawnId, spawn] of activeSpawns.entries()) {
    if (spawn.groupId !== parsed.groupId) continue;

    if (weGotIt) {
      await supabase.from('card_events')
        .update({ outcome: 'claimed' })
        .eq('spawn_id', spawnId)
        .eq('group_id', spawn.groupId);
      log.info(`✅ Claimed: ${spawn.cardName} (Tier ${spawn.tier})`);
    } else if (theyGotIt) {
      await supabase.from('card_events')
        .update({ outcome: 'missed', claimed_by: parsed.senderId })
        .eq('spawn_id', spawnId)
        .eq('group_id', spawn.groupId);
      log.warn(`Missed: ${spawn.cardName} — claimed by ${parsed.senderName}`);
    }

    activeSpawns.delete(spawnId);
    break;
  }
}

// ─── HUMANISED DELAY ─────────────────────────────────────────
// Weighted distribution from the bible:
// 1500-2500ms: 20% | 2500-4000ms: 50% | 4000-6000ms: 25% | 6000-9000ms: 5%
function calcClaimDelay(groupId: string): number {
  const stats = getGroupStats(groupId);
  const adjustment = stats.suspected_bot ? 0 : -500; // faster in low-competition groups

  const roll = Math.random() * 100;
  let base: number;

  if (roll < 20) {
    base = randBetween(1500, 2500);
  } else if (roll < 70) {
    base = randBetween(2500, 4000);
  } else if (roll < 95) {
    base = randBetween(4000, 6000);
  } else {
    base = randBetween(6000, 9000);
  }

  return Math.max(1000, base + adjustment);
}

function randBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min)) + min;
}

// ─── PARSERS ─────────────────────────────────────────────────
function parseSpawnId(content: string): string | null {
  return content.match(CLAIM_ID)?.[1] ?? null;
}

function parseName(content: string): string {
  return content.match(NAME_REGEX)?.[1]?.trim() ?? 'Unknown';
}

function parseTier(content: string): number {
  const t = content.match(TIER_REGEX)?.[1];
  if (!t) return 0;
  return t.toLowerCase() === 's' ? 99 : parseInt(t);
}

function parsePrice(content: string): number {
  const p = content.match(PRICE_REGEX)?.[1]?.replace(/,/g, '');
  return p ? parseInt(p) : 0;
}

function parseIssue(content: string): number | null {
  const i = content.match(ISSUE_REGEX)?.[1];
  return i ? parseInt(i) : null;
}

function isClaimReply(content: string): boolean {
  return (
    /you (got|claimed|received)/i.test(content) ||
    /already claimed|someone else/i.test(content)
  );
}
