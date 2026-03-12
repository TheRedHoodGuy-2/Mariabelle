// ============================================================
// apps/whatsapp-bot/src/bot-detector.ts
// FIXED: handleBotDetection now returns boolean
// looksLikeBotMessage uses bold-unicode-aware patterns
// ============================================================

import { supabase, log } from './index';
import { ParsedMessage } from './types';
import { decodeBold } from './gambling-collector';

const knownBotIds = new Set<string>();
let loaded = false;

export async function loadKnownBots(): Promise<void> {
  try {
    const { data } = await supabase
      .from('known_bots').select('identifier')
      .eq('platform', 'whatsapp').eq('active', true);
    knownBotIds.clear();
    for (const row of data ?? []) knownBotIds.add(row.identifier);
    loaded = true;
    log.info(`Loaded ${knownBotIds.size} known bots from DB`);
  } catch (err) {
    log.error('Failed to load known bots', err);
  }
}

// Returns true if message is from a known/detected bot
export async function handleBotDetection(parsed: ParsedMessage): Promise<boolean> {
  const { senderId, text, groupId } = parsed;

  // Already known
  if (knownBotIds.has(senderId)) {
    await supabase.from('known_bots')
      .update({ last_seen: new Date().toISOString() })
      .eq('identifier', senderId).eq('platform', 'whatsapp');
    return true;
  }

  // Looks like a bot message → auto-register
  if (looksLikeBotMessage(text)) {
    const botName = detectBotName(text);
    await registerBot(senderId, botName, groupId);
    return true;
  }

  // Parse .bots reply to register bots by name
  if (isBotsCommandReply(decodeBold(text))) {
    await parseBotsReply(parsed);
    return true;
  }

  return false;
}

async function parseBotsReply(parsed: ParsedMessage): Promise<void> {
  // Register the sender of the .bots reply
  await registerBot(parsed.senderId, detectBotName(parsed.text), parsed.groupId);
}

async function registerBot(identifier: string, botName: string, groupId: string): Promise<void> {
  if (knownBotIds.has(identifier)) return;
  try {
    await supabase.from('known_bots').upsert(
      { bot_name: botName, identifier, platform: 'whatsapp', active: true, last_seen: new Date().toISOString() },
      { onConflict: 'identifier' }
    );
    knownBotIds.add(identifier);
    log.info(`Registered bot: ${botName} (${identifier})`);

    await supabase.from('bot_health')
      .update({ bot_name: botName })
      .eq('group_id', groupId).eq('platform', 'whatsapp');
  } catch (err) {
    log.error(`Failed to register bot ${botName}`, err);
  }
}

// ─── CONTENT-BASED BOT DETECTION ─────────────────────────────
// These patterns identify bot messages even before known_bots is populated
export function looksLikeBotMessage(text: string): boolean {
  const decoded = decodeBold(text);
  return (
    /wild card has appeared/i.test(decoded)      ||
    /\b(won|win|lost|lose)\b.*coins?/i.test(decoded) ||
    /daily reward|streak/i.test(decoded)         ||
    /used your shovel|dug up/i.test(decoded)     ||
    /caught a|reeling in/i.test(decoded)         ||
    /mata mata/i.test(decoded)                   ||
    /\.claim\s+[a-zA-Z0-9]+/.test(decoded) === false && // not a user claim
    /TENSURA|BOTS/i.test(decodeBold(text))
  );
}

const BOT_NAMES = ['ALYA','AQUA','ASUNA','ELAINA','FRIEREN','KURUMI','MAI','MARIN',
  'MEGUMIN','MITA','MIYABI','MODEUS','NAZUNA','REM','RIMURU','RIN','YUKI'];

function detectBotName(text: string): string {
  const upper = decodeBold(text).toUpperCase();
  return BOT_NAMES.find(n => upper.includes(n)) ?? 'UNKNOWN';
}

function isBotsCommandReply(text: string): boolean {
  return /TENSURA/i.test(text) && /BOTS/i.test(text);
}
