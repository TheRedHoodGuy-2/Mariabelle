import 'dotenv/config';
// ============================================================
// apps/discord-bot/src/discord-router.ts
// FIXED:
// 1. Now logs ALL players' bets, not just self
// 2. Bold unicode decoded before pattern matching
// 3. Raw debug log so we can see everything arriving
// ============================================================

import { Client as SelfClient } from 'discord.js-selfbot-v13';
import { Client } from 'discord.js';
import { supabase, log } from './index';
import {
  handleDiscordDailyReply,
  handleDiscordFishReply,
  handleDiscordDigReply,
} from './self-bot';
import { handleDiscordGambling } from './discord-gambling';
import { handleDiscordCardSpawn } from './discord-cards';

// ─── BOLD UNICODE DECODER (Tensura bot sends bold text) ──────
const BOLD_MAP: Record<string, string> = {
  '𝗔':'A','𝗕':'B','𝗖':'C','𝗗':'D','𝗘':'E','𝗙':'F','𝗚':'G','𝗛':'H',
  '𝗜':'I','𝗝':'J','𝗞':'K','𝗟':'L','𝗠':'M','𝗡':'N','𝗢':'O','𝗣':'P',
  '𝗤':'Q','𝗥':'R','𝗦':'S','𝗧':'T','𝗨':'U','𝗩':'V','𝗪':'W','𝗫':'X',
  '𝗬':'Y','𝗭':'Z',
  '𝟬':'0','𝟭':'1','𝟮':'2','𝟯':'3','𝟰':'4',
  '𝟱':'5','𝟲':'6','𝟳':'7','𝟴':'8','𝟵':'9',
};
function decodeBold(str: string): string {
  return str.split('').map(c => BOLD_MAP[c] || c).join('');
}

// ─── KNOWN BOT IDs ───────────────────────────────────────────
const knownBotIds = new Set<string>();

export async function loadDiscordBots(): Promise<void> {
  const { data } = await supabase
    .from('known_bots').select('identifier')
    .eq('platform', 'discord').eq('active', true);
  for (const row of data ?? []) knownBotIds.add(row.identifier);
  log.info('Loaded ' + knownBotIds.size + ' known Discord bots');
}

// ─── MAIN ROUTER ─────────────────────────────────────────────
export async function routeDiscordMessage(
  selfBot:     SelfClient,
  observerBot: Client,
  message:     any,
  source:      'selfbot' | 'observer'
): Promise<void> {
  const channelId = message.channelId ?? message.channel?.id;
  if (!channelId) return;

  const rawText  = message.content ?? '';
  const text     = decodeBold(rawText);
  const authorId = message.author?.id ?? 'unknown';
  const isBot    = message.author?.bot === true;

  // RAW LOG — see every message arriving
  log.debug(`[DISCORD-RAW] ch:${channelId.slice(-6)} bot:${isBot} src:${source} | "${rawText.slice(0, 80)}"`);

  // Auto-register new game bots by content
  if (isBot && !knownBotIds.has(authorId) && looksLikeGameBot(text)) {
    await registerDiscordBot(authorId, message.author?.username ?? 'unknown');
  }

  const isFromGameBot = isBot && (knownBotIds.has(authorId) || looksLikeGameBot(text));

  await updateHealth(channelId, isFromGameBot, message.createdAt ?? new Date());

  if (isFromGameBot) {
    await routeGameBotReply(selfBot, message, channelId, text);
    return;
  }

  // ANY non-bot user placing a bet (self OR other players)
  if (!isBot) {
    const isBet = /^\.(casino|cf|slots|dice|db|roulette|horse|dp)\s/i.test(rawText);
    if (isBet) {
      log.debug(`[DISCORD] Bet detected from ${authorId}: ${rawText.slice(0, 50)}`);
      await handleDiscordGambling(message, channelId, false);
    }
  }
}

// ─── GAME BOT REPLY ROUTER ───────────────────────────────────
async function routeGameBotReply(
  selfBot:   SelfClient,
  message:   any,
  channelId: string,
  text:      string   // already decoded
): Promise<void> {
  const embeds    = message.embeds ?? [];
  const timestamp = message.createdAt ?? new Date();

  // Card spawn — check embeds
  for (const embed of embeds) {
    const title = decodeBold(embed.title ?? embed.data?.title ?? '');
    const desc  = decodeBold(embed.description ?? embed.data?.description ?? '');
    if (/wild card has appeared/i.test(title) || /wild card has appeared/i.test(desc)) {
      log.info(`[DISCORD] Card spawn detected in ${channelId}`);
      await handleDiscordCardSpawn(selfBot, embed, channelId, timestamp);
      return;
    }
  }

  if (!text) return;

  // Gambling outcome — win/loss keywords (decoded bold works now)
  if (isGamblingOutcome(text)) {
    log.debug(`[DISCORD] Gambling outcome: "${text.slice(0, 60)}"`);
    // Pass original message but attach decoded text for matching
    await handleDiscordGambling({ ...message, content: text }, channelId, true);
    return;
  }

  if (/daily reward|streak/i.test(text)) {
    handleDiscordDailyReply(channelId, text, timestamp);
    return;
  }
  if (/caught|reeling|fish/i.test(text)) {
    await handleDiscordFishReply(selfBot, channelId, text, timestamp);
    return;
  }
  if (/used your shovel|dug up/i.test(text)) {
    handleDiscordDigReply(channelId, text, timestamp);
    return;
  }
  if (/stranger flicked|quest giver|tipped/i.test(text)) {
    const m = text.match(/\$?([\d,]+)\s*coins?/i);
    await supabase.from('passive_income_events').insert({
      group_id: channelId, platform: 'discord',
      source: /stranger/i.test(text) ? 'stranger' : 'quest_giver',
      amount: m ? parseInt(m[1].replace(/,/g, '')) : null,
      timestamp: timestamp.toISOString(),
    });
    return;
  }

  // Unknown bot message — store raw for analysis
  if (text.trim().length > 5) {
    await supabase.from('unprompted_events').insert({
      group_id: channelId, platform: 'discord',
      raw_text: message.content, event_type: null,
      timestamp: timestamp.toISOString(),
    }).then(() => {
      log.debug(`[DISCORD] Unrecognised bot message stored`);
    });
  }
}

// ─── WIN/LOSS DETECTION — covers Tensura bold unicode variants ─
function isGamblingOutcome(text: string): boolean {
  return (
    /\b(won|win|wins)\b/i.test(text)          ||
    /\b(lost|lose|loss)\b/i.test(text)         ||
    /guessed (it )?right/i.test(text)          ||
    /better luck/i.test(text)                  ||
    /you win!/i.test(text)                     ||
    /you lost/i.test(text)                     ||
    /\btie\b/i.test(text)                      ||
    /refunded/i.test(text)
  );
}

function looksLikeGameBot(text: string): boolean {
  return /wild card|you win|you lost|won.*coins|lost.*coins|daily reward|dug up|mata mata|\bbet\b/i.test(text);
}

// ─── HEALTH UPDATE ───────────────────────────────────────────
async function updateHealth(channelId: string, isBot: boolean, timestamp: Date): Promise<void> {
  const payload: any = {
    group_id:   channelId,
    platform:   'discord',
    status:     'online',
    updated_at: new Date().toISOString(),
  };
  if (isBot)  payload.last_bot_msg  = timestamp.toISOString();
  if (!isBot) payload.last_cmd_seen = timestamp.toISOString();

  await supabase.from('bot_health').upsert(payload, { onConflict: 'group_id,platform' });
}

async function registerDiscordBot(botId: string, botName: string): Promise<void> {
  await supabase.from('known_bots').upsert(
    { bot_name: botName, identifier: botId, platform: 'discord', active: true, last_seen: new Date().toISOString() },
    { onConflict: 'identifier' }
  );
  knownBotIds.add(botId);
  log.info('Registered Discord bot: ' + botName + ' (' + botId + ')');
}
