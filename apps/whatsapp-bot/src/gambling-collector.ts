// ============================================================
// apps/whatsapp-bot/src/gambling-collector.ts
// Phase 2, Step 5 — Gambling data collector
// Informed by old bot: uses @lid IDs, bold unicode, quoted msg matching
// ============================================================

import makeWASocket from '@whiskeysockets/baileys';
import { supabase, log } from './index';
import { ParsedMessage, DetectedBet, GamblingOutcome, MatchMethod } from './types';

// ─── IN-MEMORY PENDING QUEUE ─────────────────────────────────
const pendingQueue = new Map<string, DetectedBet[]>();
const PENDING_TTL  = 10 * 60 * 1000;

// ─── GAME PATTERNS (from old bot — these work) ───────────────
const GAME_PATTERNS = [
  { game: 'casino',     regex: /^\.casino\s+([\d,]+)/i,                         amountIdx: 1 },
  { game: 'coinflip',   regex: /^\.cf\s+(heads?|tails?)\s+([\d,]+)/i,           amountIdx: 2, guessIdx: 1 },
  { game: 'slots',      regex: /^\.slots\s+([\d,]+)/i,                          amountIdx: 1 },
  { game: 'dice',       regex: /^\.dice\s+([1-6])\s+([\d,]+)/i,                 amountIdx: 2, guessIdx: 1 },
  { game: 'db',         regex: /^\.db\s+([\d,]+)/i,                             amountIdx: 1 },
  { game: 'roulette',   regex: /^\.roulette\s+\S+(?:\s+\S+)?\s+([\d,]+)/i,     amountIdx: 1 },
  { game: 'horse',      regex: /^\.horse\s+\S+\s+([\d,]+)/i,                    amountIdx: 1 },
];

// ─── BOLD UNICODE DECODER (from old bot) ─────────────────────
const BOLD_MAP: Record<string, string> = {
  '𝗔':'A','𝗕':'B','𝗖':'C','𝗗':'D','𝗘':'E','𝗙':'F','𝗚':'G','𝗛':'H',
  '𝗜':'I','𝗝':'J','𝗞':'K','𝗟':'L','𝗠':'M','𝗡':'N','𝗢':'O','𝗣':'P',
  '𝗤':'Q','𝗥':'R','𝗦':'S','𝗧':'T','𝗨':'U','𝗩':'V','𝗪':'W','𝗫':'X',
  '𝗬':'Y','𝗭':'Z'
};

export function decodeBold(str: string): string {
  return str.split('').map(c => BOLD_MAP[c] || c).join('');
}

// ─── DETECT GAME FROM MESSAGE ────────────────────────────────
export function detectGame(text: string): { game: string; betAmount: number; guess: string | null } | null {
  for (const p of GAME_PATTERNS) {
    const m = text.trim().match(p.regex);
    if (!m) continue;
    const betAmount = parseInt(m[p.amountIdx].replace(/,/g, ''));
    const guess = (p as any).guessIdx ? m[(p as any).guessIdx].toLowerCase() : null;
    return { game: p.game, betAmount, guess };
  }
  return null;
}

// ─── PARSE WIN/LOSS FROM BOT REPLY ───────────────────────────
export function parseResult(text: string): { isWin: boolean; isLoss: boolean; resultAmount: number | null } {
  const decoded = decodeBold(text);
  const lower   = decoded.toLowerCase();
  const isWin   = /\b(won|win)\b/.test(lower);
  const isLoss  = /\b(lost|lose|loss)\b/.test(lower);
  const coinMatch = decoded.match(/([\d,]+)\s*coins?/i);
  const resultAmount = coinMatch ? parseInt(coinMatch[1].replace(/,/g, '')) : null;
  return { isWin, isLoss, resultAmount };
}

// ─── MAIN HANDLER ────────────────────────────────────────────
export async function handleGamblingMessage(
  parsed: ParsedMessage,
  sock:   ReturnType<typeof makeWASocket>
): Promise<void> {
  if (!parsed.isFromBot) {
    await onBetPlaced(parsed);
  } else {
    await onBotReply(parsed);
  }
}

// ─── BET PLACED ──────────────────────────────────────────────
async function onBetPlaced(parsed: ParsedMessage): Promise<void> {
  const detected = detectGame(parsed.text);
  if (!detected) return;

  const { game, betAmount, guess } = detected;
  if (!betAmount) return;

  const bet: DetectedBet = {
    messageId:  parsed.messageId,
    playerId:   parsed.senderId,
    playerName: parsed.senderName,
    platform:   parsed.platform,
    groupId:    parsed.groupId,
    game, betAmount, guess,
    detectedAt: parsed.timestamp,
  };

  const key = `${parsed.groupId}:${parsed.senderId}:${game}:${betAmount}`;
  const q   = pendingQueue.get(key) ?? [];
  q.push(bet);
  pendingQueue.set(key, q);

  await supabase.from('pending_bets').insert({
    message_id: parsed.messageId,
    player_id:  parsed.senderId,
    game, bet_amount: betAmount, guess,
    group_id:   parsed.groupId,
    platform:   parsed.platform,
    status:     'pending',
  });

  setTimeout(() => expireBet(key, parsed.messageId), PENDING_TTL);
  log.debug(`Bet: ${parsed.senderName} .${game} $${betAmount}`);
}

// ─── BOT REPLY ───────────────────────────────────────────────
async function onBotReply(parsed: ParsedMessage): Promise<void> {
  const { text, groupId, quotedMessageId, timestamp } = parsed;
  const { isWin, isLoss, resultAmount } = parseResult(text);
  if (!isWin && !isLoss) return;

  const outcome: GamblingOutcome = isWin ? 'win' : 'loss';

  // PRIORITY 1: quoted message ID (most reliable — from old bot logic)
  if (quotedMessageId) {
    const resolved = await resolveByMessageId(quotedMessageId, outcome, resultAmount, timestamp);
    if (resolved) return;
  }

  // PRIORITY 2: FIFO queue in this group
  for (const [key, q] of pendingQueue.entries()) {
    if (!key.startsWith(groupId) || !q.length) continue;
    const bet     = q.shift()!;
    if (!q.length) pendingQueue.delete(key);
    const delayMs = timestamp.getTime() - bet.detectedAt.getTime();
    await resolveAndLog(bet, outcome, resultAmount, delayMs, 'mention', timestamp);
    break;
  }
}

// ─── RESOLVE BY MESSAGE ID ───────────────────────────────────
async function resolveByMessageId(
  messageId:    string,
  outcome:      GamblingOutcome,
  resultAmount: number | null,
  timestamp:    Date
): Promise<boolean> {
  const { data } = await supabase
    .from('pending_bets').select('*')
    .eq('message_id', messageId).eq('status', 'pending').single();
  if (!data) return false;

  const payout  = calcPayout(outcome, data.bet_amount, resultAmount);
  const delayMs = timestamp.getTime() - new Date(data.created_at).getTime();

  await supabase.from('pending_bets').update({ status: 'resolved' }).eq('message_id', messageId);
  await supabase.from('gambling_events').insert({
    player_id: data.player_id, platform: data.platform, group_id: data.group_id,
    game: data.game, bet_amount: data.bet_amount, outcome, payout,
    multiplier: data.bet_amount ? Math.abs(payout) / data.bet_amount : 0,
    guess: data.guess, reply_delay_ms: delayMs, match_method: 'quoted',
    timestamp: timestamp.toISOString(), resolved_at: new Date().toISOString(),
  });
  log.debug(`Resolved (quoted): ${outcome} $${payout}`);
  return true;
}

async function resolveAndLog(
  bet: DetectedBet, outcome: GamblingOutcome,
  resultAmount: number | null, delayMs: number,
  method: MatchMethod, timestamp: Date
): Promise<void> {
  const payout = calcPayout(outcome, bet.betAmount, resultAmount);
  await supabase.from('pending_bets').update({ status: 'resolved' }).eq('message_id', bet.messageId);
  await supabase.from('gambling_events').insert({
    player_id: bet.playerId, player_name: bet.playerName,
    platform: bet.platform, group_id: bet.groupId,
    game: bet.game, bet_amount: bet.betAmount, outcome, payout,
    multiplier: bet.betAmount ? Math.abs(payout) / bet.betAmount : 0,
    guess: bet.guess, reply_delay_ms: delayMs, match_method: method,
    timestamp: timestamp.toISOString(), resolved_at: new Date().toISOString(),
  });
  log.info(`Gambling resolved: ${bet.playerName} ${outcome} $${payout}`);
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

// ─── HELPERS ─────────────────────────────────────────────────
function calcPayout(outcome: GamblingOutcome, betAmount: number, resultAmount: number | null): number {
  if (outcome === 'draw') return 0;
  // Use actual result amount if available (more accurate)
  if (resultAmount) {
    return outcome === 'win' ? resultAmount : -betAmount;
  }
  return outcome === 'win' ? betAmount : -betAmount;
}
