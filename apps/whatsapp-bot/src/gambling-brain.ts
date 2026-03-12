// ============================================================
// apps/whatsapp-bot/src/gambling-brain.ts
// Phase 2, Step 11 — Autonomous gambling
// 10 bets/day max. 20% of balance per bet. AI decides.
// All limits adjustable from dashboard via gambling_config table.
// ============================================================

import makeWASocket from '@whiskeysockets/baileys';
import { supabase, log } from './index';
import { GamblingConfig, Platform } from './types';
import { sendQueued } from './send-queue';
import { isGroupOnline } from './health-monitor';
import { isGamblingGroup } from './group-classifier';
import { getGamblingRecommendation } from './ai-brain';

// ─── STATE ───────────────────────────────────────────────────
let config: GamblingConfig | null = null;
let betsToday = 0;
let lastResetDate = new Date().toDateString();

// ─── INIT ────────────────────────────────────────────────────
export async function initGamblingBrain(
  sock: ReturnType<typeof makeWASocket>
): Promise<void> {
  await loadConfig();

  // Subscribe to config changes from dashboard in real-time
  supabase
    .channel('gambling_config_changes')
    .on('postgres_changes', {
      event:  '*',
      schema: 'public',
      table:  'gambling_config',
    }, (payload) => {
      config = payload.new as GamblingConfig;
      log.info(`Gambling config updated: ${config.max_bets_per_day} bets/day, ${config.bet_percentage * 100}% balance`);
    })
    .subscribe();

  // Run gambling loop every 15 minutes
  setInterval(() => gamblingLoop(sock), 15 * 60 * 1000);
  log.info('Gambling brain initialised');
}

// ─── CONFIG LOADER ───────────────────────────────────────────
async function loadConfig(): Promise<void> {
  const { data } = await supabase
    .from('gambling_config')
    .select('*')
    .limit(1)
    .single();

  if (data) {
    config = data as GamblingConfig;
    log.info(`Config loaded: ${config.max_bets_per_day} bets/day, ${config.bet_percentage * 100}% balance, min confidence: ${config.min_confidence}`);
  }
}

// ─── DAILY RESET ─────────────────────────────────────────────
function checkDailyReset(): void {
  const today = new Date().toDateString();
  if (today !== lastResetDate) {
    betsToday    = 0;
    lastResetDate = today;
    log.info('Daily bet counter reset');
  }
}

// ─── MAIN GAMBLING LOOP ──────────────────────────────────────
async function gamblingLoop(sock: ReturnType<typeof makeWASocket>): Promise<void> {
  if (!config?.gambling_enabled) return;

  checkDailyReset();

  if (betsToday >= (config?.max_bets_per_day ?? 10)) {
    log.debug(`Daily bet limit reached (${betsToday}/${config?.max_bets_per_day}). Skipping.`);
    return;
  }

  // Find the best gambling group to bet in
  const gamblingGroups = await getGamblingGroups();
  if (gamblingGroups.length === 0) {
    log.debug('No gambling groups identified yet');
    return;
  }

  // Pick the first online gambling group
  const groupId = gamblingGroups.find(g => isGroupOnline(g));
  if (!groupId) return;

  await placeBet(sock, groupId);
}

// ─── PLACE BET ───────────────────────────────────────────────
async function placeBet(
  sock: ReturnType<typeof makeWASocket>,
  groupId: string
): Promise<void> {
  if (!config) return;

  // 1. Check balance via .bal first
  const balance = await fetchBalance(sock, groupId);
  if (!balance || balance < 500) {
    log.warn(`Balance too low to bet: $${balance}`);
    return;
  }

  // 2. Get recent outcomes for AI context
  const { data: recent } = await supabase
    .from('gambling_events')
    .select('game, outcome, payout')
    .order('timestamp', { ascending: false })
    .limit(20);

  // 3. Ask AI for recommendation
  const rec = await getGamblingRecommendation(
    groupId,
    balance,
    {
      max_bets_per_day: config.max_bets_per_day,
      bet_percentage:   config.bet_percentage,
      min_confidence:   config.min_confidence,
    },
    recent ?? []
  );

  if (!rec) {
    log.debug('No AI recommendation — skipping bet');
    return;
  }

  if (!rec.shouldBet || rec.confidence < config.min_confidence) {
    log.debug(`AI says skip: confidence ${rec.confidence} < ${config.min_confidence}. Reason: ${rec.reasoning}`);
    // Update ai_decisions: executed=false, skip_reason
    await supabase.from('ai_decisions')
      .update({ executed: false, skip_reason: `confidence ${rec.confidence} < threshold ${config.min_confidence}` })
      .eq('decision_type', 'gambling')
      .order('created_at', { ascending: false })
      .limit(1);
    return;
  }

  // 4. Build command
  const command = buildCommand(rec.game, rec.betAmount, rec.guess);
  if (!command) return;

  // 5. Send
  log.info(`Betting: ${command} in ${groupId} (AI confidence: ${rec.confidence}, reason: ${rec.reasoning})`);
  await sendQueued(sock, groupId, command);
  betsToday++;

  // 6. Mark AI decision as executed
  await supabase.from('ai_decisions')
    .update({ executed: true })
    .eq('decision_type', 'gambling')
    .order('created_at', { ascending: false })
    .limit(1);

  log.info(`Bets today: ${betsToday}/${config.max_bets_per_day}`);
}

// ─── FETCH BALANCE ───────────────────────────────────────────
async function fetchBalance(
  sock: ReturnType<typeof makeWASocket>,
  groupId: string
): Promise<number | null> {
  // Send .bal and wait for reply
  await sendQueued(sock, groupId, '.bal');

  // Wait up to 10 seconds for the reply to arrive
  // The actual parsing happens in message-router → handleBalanceReply
  // We check the cached balance after waiting
  await sleep(10_000);
  return getCachedBalance();
}

// ─── BALANCE CACHE ───────────────────────────────────────────
// Updated by handleBalanceReply when the bot receives a .bal response
let cachedBalance: number | null = null;
let balanceCachedAt: Date | null = null;

export function updateBalance(balance: number): void {
  cachedBalance   = balance;
  balanceCachedAt = new Date();
}

function getCachedBalance(): number | null {
  if (!cachedBalance || !balanceCachedAt) return null;
  // Only use cache if it's less than 30 seconds old
  if (Date.now() - balanceCachedAt.getTime() > 30_000) return null;
  return cachedBalance;
}

// ─── COMMAND BUILDER ─────────────────────────────────────────
function buildCommand(game: string, amount: number, guess: string | null): string | null {
  switch (game) {
    case 'casino':  return `.casino ${amount}`;
    case 'slots':   return `.slots ${amount}`;
    case 'coinflip':
    case 'cf':      return guess ? `.cf ${guess} ${amount}` : `.cf heads ${amount}`;
    case 'dice':    return guess ? `.dice ${guess} ${amount}` : `.dice ${randDice()} ${amount}`;
    case 'db':      return `.db ${amount}`;
    case 'roulette': return `.roulette red ${amount}`; // default to red until we learn bet types
    default:        return `.casino ${amount}`;
  }
}

function randDice(): number {
  return Math.floor(Math.random() * 6) + 1;
}

// ─── HELPERS ─────────────────────────────────────────────────
async function getGamblingGroups(): Promise<string[]> {
  const { data } = await supabase
    .from('group_stats')
    .select('group_id')
    .eq('platform', 'whatsapp');

  // Also check in-memory classifier
  const { isGamblingGroup } = await import('./group-classifier');
  return (data ?? [])
    .map(r => r.group_id)
    .filter(id => isGamblingGroup(id));
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

// ─── BALANCE REPLY PARSER ────────────────────────────────────
// Called from message-router when bot replies to .bal
export function handleBalanceReply(text: string): void {
  // Format: "Wallet: $1,234 | Bank: $45,678 | Total: $46,912"
  const walletMatch = text.match(/wallet[:\s]+\$?([\d,]+)/i);
  const totalMatch  = text.match(/total[:\s]+\$?([\d,]+)/i);

  const balance = totalMatch
    ? parseInt(totalMatch[1].replace(/,/g, ''))
    : walletMatch
    ? parseInt(walletMatch[1].replace(/,/g, ''))
    : null;

  if (balance) {
    updateBalance(balance);
    log.debug(`Balance updated: $${balance}`);
  }
}
