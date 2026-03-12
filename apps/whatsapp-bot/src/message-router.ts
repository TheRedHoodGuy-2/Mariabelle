// ============================================================
// apps/whatsapp-bot/src/message-router.ts
// FIXED: was silently dropping all bot messages because
// known_bots starts empty. Now routes ALL messages and
// detects bots by content patterns, not just DB lookup.
// ============================================================

import makeWASocket from '@whiskeysockets/baileys';
import { supabase, log } from './index';
import { ParsedMessage } from './types';
import { handleBotDetection, looksLikeBotMessage } from './bot-detector';
import { handleHealthUpdate } from './health-monitor';
import { handleGamblingMessage, detectGame, parseResult, decodeBold } from './gambling-collector';
import { handleCardSpawn } from './card-claimer';
import { handleDailyReply, handleFishReply, handleDigReply } from './scheduler';
import { classifyGroup } from './group-classifier';
import { handleBalanceReply } from './gambling-brain';

// ─── MAIN ROUTER ─────────────────────────────────────────────
export async function routeMessage(
  sock: ReturnType<typeof makeWASocket>,
  msg:  any
): Promise<void> {
  const parsed = parseMessage(msg);
  if (!parsed) return;

  // ── Determine if from bot by content, not just DB ──────────
  // This is the critical fix: looksLikeBotMessage() catches
  // bot replies even before they're in known_bots table
  const fromKnownBot = await handleBotDetection(parsed);
  parsed.isFromBot   = fromKnownBot || looksLikeBotMessage(parsed.text);

  log.debug(`[${parsed.groupId.slice(0,8)}] from:${parsed.senderId.slice(0,12)} bot:${parsed.isFromBot} | ${parsed.text.slice(0,60)}`);

  // ── Health monitor sees everything ─────────────────────────
  await handleHealthUpdate(parsed);

  if (parsed.isFromBot) {
    await routeBotMessage(sock, parsed);
  } else {
    await routeUserMessage(sock, parsed);
  }
}

// ─── BOT MESSAGE ROUTER ──────────────────────────────────────
async function routeBotMessage(
  sock:   ReturnType<typeof makeWASocket>,
  parsed: ParsedMessage
): Promise<void> {
  const text = decodeBold(parsed.text);  // decode bold unicode first

  // Card spawn (image + caption)
  if (/wild card has appeared/i.test(text) || /wild card has appeared/i.test(parsed.mediaCaption ?? '')) {
    await classifyGroup(parsed.groupId, 'cards');
    await handleCardSpawn(sock, parsed);
    return;
  }

  // Gambling outcome — uses win/won/lost/lose (works with bold unicode decoded)
  const { isWin, isLoss } = parseResult(text);
  if (isWin || isLoss) {
    await handleGamblingMessage({ ...parsed, text }, sock);
    return;
  }

  // Balance reply
  if (/wallet|balance|coins/i.test(text)) {
    handleBalanceReply(text);
    return;
  }

  // Daily reply
  if (/daily reward|streak/i.test(text)) {
    await handleDailyReply(parsed);
    return;
  }

  // Fish reply
  if (/caught|reeling|nothing on|fish/i.test(text)) {
    await handleFishReply(sock, parsed);
    return;
  }

  // Dig reply
  if (/used your shovel|dug up/i.test(text)) {
    await handleDigReply(parsed);
    return;
  }

  // Passive income
  if (/stranger flicked|quest giver|tipped/i.test(text)) {
    const m = text.match(/([\d,]+)\s*coins?/i);
    await supabase.from('passive_income_events').insert({
      group_id: parsed.groupId, platform: 'whatsapp',
      source: /stranger/i.test(text) ? 'stranger' : 'quest_giver',
      amount: m ? parseInt(m[1].replace(/,/g, '')) : null,
      timestamp: parsed.timestamp.toISOString(),
    });
    return;
  }

  // .bots reply — bot health check response
  if (/BOTS/i.test(decodeBold(parsed.text))) {
    log.debug('Received .bots reply — bot is online');
    return;
  }

  // Unknown — store raw for AI to classify later
  if (text.trim().length > 0) {
    await supabase.from('unprompted_events').insert({
      group_id: parsed.groupId, platform: 'whatsapp',
      raw_text: parsed.text, event_type: null,
      timestamp: parsed.timestamp.toISOString(),
    });
  }
}

// ─── USER MESSAGE ROUTER ─────────────────────────────────────
async function routeUserMessage(
  sock:   ReturnType<typeof makeWASocket>,
  parsed: ParsedMessage
): Promise<void> {
  const text = parsed.text.trim();

  // Gambling command — classify group + track bet
  const detected = detectGame(text);
  if (detected) {
    await classifyGroup(parsed.groupId, 'gambling');
    await handleGamblingMessage(parsed, sock);
    return;
  }

  if (/^\.fish$/i.test(text) || /^\.sell\s+fish$/i.test(text)) {
    await classifyGroup(parsed.groupId, 'fishing');
    return;
  }

  if (/^\.dig$/i.test(text)) {
    await classifyGroup(parsed.groupId, 'fishing');
    return;
  }

  if (/^\.claim\s+\S+/i.test(text)) {
    await classifyGroup(parsed.groupId, 'cards');
    return;
  }
}

// ─── MESSAGE PARSER ──────────────────────────────────────────
export function parseMessage(msg: any): ParsedMessage | null {
  try {
    const groupId  = msg.key.remoteJid!;
    const senderId = msg.key.participant ?? msg.key.remoteJid!;
    const text =
      msg.message?.conversation ??
      msg.message?.extendedTextMessage?.text ??
      '';
    const mediaCaption =
      msg.message?.imageMessage?.caption ??
      msg.message?.videoMessage?.caption ??
      null;
    const isMedia = !!(
      msg.message?.imageMessage ||
      msg.message?.videoMessage ||
      msg.message?.stickerMessage
    );
    const isReply = !!(msg.message?.extendedTextMessage?.contextInfo?.quotedMessage);
    const quotedMessageId = msg.message?.extendedTextMessage?.contextInfo?.stanzaId ?? null;

    return {
      messageId:       msg.key.id!,
      platform:        'whatsapp',
      groupId,
      senderId,
      senderName:      msg.pushName ?? senderId.split('@')[0] ?? 'Unknown',
      text,
      isFromBot:       false, // set after detection
      isMedia,
      mediaCaption,
      isReply,
      quotedMessageId,
      timestamp:       new Date((msg.messageTimestamp ?? Date.now() / 1000) * 1000),
      rawPayload:      msg,
    };
  } catch (err) {
    log.error('Failed to parse message', err);
    return null;
  }
}

// ─── CONTENT CLASSIFIERS (exported for other modules) ────────
export function isGamblingOutcome(text: string): boolean {
  const decoded = decodeBold(text);
  return /\b(won|win|lost|lose)\b/i.test(decoded);
}
export function isDailyReply(text: string): boolean {
  return /daily reward|streak/i.test(text);
}
export function isFishReply(text: string): boolean {
  return /caught|reeling|nothing on|fish/i.test(text);
}
export function isDigReply(text: string): boolean {
  return /used your shovel|dug up/i.test(text);
}
