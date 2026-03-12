import 'dotenv/config';
// ============================================================
// apps/discord-bot/src/discord-gambling.ts
// Phase 3 — Discord gambling collector + brain
// ============================================================

import { Client as SelfClient } from 'discord.js-selfbot-v13';
import { supabase, log } from './index';
import { sendQueued } from './discord-send-queue';

// Inlined types (avoids @tensura/shared-types resolution issue)
type GameType = string;
type GamblingOutcome = 'win'|'loss'|'draw'|'unresolved';

interface PendingBet {
  messageId:  string;
  playerId:   string;
  game:       GameType;
  betAmount:  number;
  guess:      string | null;
  channelId:  string;
  detectedAt: Date;
}

const pendingQueue = new Map<string, PendingBet[]>();
const PENDING_TTL  = 10 * 60 * 1000;

// ─── MAIN HANDLER ────────────────────────────────────────────
export async function handleDiscordGambling(
  message:    any,
  channelId:  string,
  isBotReply: boolean
): Promise<void> {
  if (!isBotReply) {
    await onBetPlaced(message, channelId);
  } else {
    await onBotReply(message, channelId);
  }
}

async function onBetPlaced(message: any, channelId: string): Promise<void> {
  const text      = message.content ?? '';
  const gameMatch = text.match(/^\.(casino|cf|slots|dice|db|roulette|horse|dp)\s*/i);
  if (!gameMatch) return;

  const game      = gameMatch[1].toLowerCase() as GameType;
  const parts     = text.trim().split(/\s+/);
  const betAmount = parseInt(parts[parts.length - 1]?.replace(/[$,]/g, ''));
  if (isNaN(betAmount)) return;

  const guess =
    game === 'cf'               ? text.match(/\.(cf)\s+(heads?|tails?)/i)?.[2]?.toLowerCase() ?? null :
    game === 'dice' || game === 'db' ? text.match(/\.(dice|db)\s+([1-6])/i)?.[2] ?? null : null;

  const bet: PendingBet = {
    messageId: message.id, playerId: message.author?.id ?? 'unknown',
    game, betAmount, guess, channelId, detectedAt: message.createdAt ?? new Date(),
  };

  const key = channelId + ':' + bet.playerId + ':' + game + ':' + betAmount;
  const q   = pendingQueue.get(key) ?? [];
  q.push(bet);
  pendingQueue.set(key, q);

  await supabase.from('pending_bets').insert({
    message_id: message.id, player_id: bet.playerId,
    game, bet_amount: betAmount, guess,
    group_id: channelId, platform: 'discord', status: 'pending',
  });

  setTimeout(() => expireBet(key, message.id), PENDING_TTL);
}

async function onBotReply(message: any, channelId: string): Promise<void> {
  const text = message.content ?? '';
  if (!isGamblingOutcome(text)) return;

  const outcome = parseOutcome(text);
  const payout  = parsePayout(text, outcome);

  // Try quoted match first
  const refId = message.reference?.messageId;
  if (refId) {
    const resolved = await resolveByMessageId(refId, outcome, payout, message.createdAt ?? new Date());
    if (resolved) return;
  }

  // FIFO queue fallback
  for (const [key, q] of pendingQueue.entries()) {
    if (!key.startsWith(channelId) || !q.length) continue;
    const bet    = q.shift()!;
    if (!q.length) pendingQueue.delete(key);
    const delay  = (message.createdAt?.getTime() ?? Date.now()) - bet.detectedAt.getTime();
    await logEvent(bet, outcome, payout, delay, 'mention', message.createdAt ?? new Date());
    break;
  }
}

async function resolveByMessageId(
  messageId: string, outcome: GamblingOutcome,
  payout: number, timestamp: Date
): Promise<boolean> {
  const { data } = await supabase
    .from('pending_bets').select('*')
    .eq('message_id', messageId).eq('status', 'pending').single();
  if (!data) return false;

  const delay = timestamp.getTime() - new Date(data.created_at).getTime();
  await supabase.from('pending_bets').update({ status: 'resolved' }).eq('message_id', messageId);
  await supabase.from('gambling_events').insert({
    player_id: data.player_id, platform: 'discord', group_id: data.group_id,
    game: data.game, bet_amount: data.bet_amount, outcome, payout,
    multiplier: data.bet_amount ? Math.abs(payout) / data.bet_amount : 0,
    guess: data.guess, reply_delay_ms: delay, match_method: 'quoted',
    timestamp: timestamp.toISOString(), resolved_at: new Date().toISOString(),
  });
  return true;
}

async function logEvent(
  bet: PendingBet, outcome: GamblingOutcome,
  payout: number, delay: number, method: string, timestamp: Date
): Promise<void> {
  await supabase.from('pending_bets').update({ status: 'resolved' }).eq('message_id', bet.messageId);
  await supabase.from('gambling_events').insert({
    player_id: bet.playerId, platform: 'discord', group_id: bet.channelId,
    game: bet.game, bet_amount: bet.betAmount, outcome, payout,
    multiplier: bet.betAmount ? Math.abs(payout) / bet.betAmount : 0,
    guess: bet.guess, reply_delay_ms: delay, match_method: method,
    timestamp: timestamp.toISOString(), resolved_at: new Date().toISOString(),
  });
}

async function expireBet(key: string, messageId: string): Promise<void> {
  const q = pendingQueue.get(key);
  if (!q) return;
  const idx = q.findIndex(b => b.messageId === messageId);
  if (idx !== -1) q.splice(idx, 1);
  if (!q.length) pendingQueue.delete(key);
  await supabase.from('pending_bets').update({ status: 'expired' })
    .eq('message_id', messageId).eq('status', 'pending');
}

// ─── GAMBLING BRAIN ──────────────────────────────────────────
let betsToday = 0;
let lastReset = new Date().toDateString();

export async function runDiscordGamblingLoop(
  selfBot: SelfClient, channelId: string
): Promise<void> {
  const today = new Date().toDateString();
  if (today !== lastReset) { betsToday = 0; lastReset = today; }

  const { data: config } = await supabase
    .from('gambling_config').select('*').limit(1).single();

  if (!config?.gambling_enabled || betsToday >= config.max_bets_per_day) return;

  await sendQueued(selfBot, channelId, '.bal');
  await sleep(10_000);

  const balance = getCachedBalance();
  if (!balance || balance < 500) return;

  const betAmount = Math.floor(balance * (config.bet_percentage ?? 0.2));

  // Simple fallback: casino if no AI
  const command = '.casino ' + betAmount;
  await sendQueued(selfBot, channelId, command);
  betsToday++;
  log.info('Discord bet: ' + command);
}

// ─── BALANCE CACHE ───────────────────────────────────────────
let cachedBalance: number | null = null;
let cachedAt: Date | null = null;

export function updateDiscordBalance(balance: number): void {
  cachedBalance = balance;
  cachedAt      = new Date();
}

function getCachedBalance(): number | null {
  if (!cachedBalance || !cachedAt) return null;
  if (Date.now() - cachedAt.getTime() > 30_000) return null;
  return cachedBalance;
}

// ─── HELPERS ─────────────────────────────────────────────────
// NOTE: text passed here is ALREADY bold-decoded by discord-router
function isGamblingOutcome(t: string): boolean {
  return (
    /\b(won|win|wins)\b/i.test(t)    ||
    /\b(lost|lose|loss)\b/i.test(t)  ||
    /guessed (it )?right/i.test(t)   ||
    /better luck/i.test(t)           ||
    /\btie\b/i.test(t)               ||
    /refunded/i.test(t)
  );
}
function parseOutcome(t: string): GamblingOutcome {
  if (/\b(won|win|wins)\b/i.test(t) || /guessed (it )?right/i.test(t)) return 'win';
  if (/\b(lost|lose|loss)\b/i.test(t) || /better luck/i.test(t))        return 'loss';
  if (/\btie\b|refunded/i.test(t))                                       return 'draw';
  return 'unresolved';
}
function parsePayout(t: string, o: GamblingOutcome): number {
  if (o === 'draw') return 0;
  const m = t.match(/\$?([\d,]+)\s*coins?/i);
  if (!m) return 0;
  const n = parseInt(m[1].replace(/,/g, ''));
  return o === 'win' ? n : -n;
}
function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }
