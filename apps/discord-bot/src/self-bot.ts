import 'dotenv/config';
// ============================================================
// apps/discord-bot/src/self-bot.ts
// Phase 3 — Self-bot init + scheduler
// ============================================================

import { Client as SelfClient } from 'discord.js-selfbot-v13';
import { supabase, log } from './index';
import { sendQueued } from './discord-send-queue';

interface DiscordChannels {
  gambling:  string[];
  cards:     string[];
  fishing:   string;
  general:   string;
}

let channels: DiscordChannels | null = null;

export async function initSelfBot(selfBot: SelfClient): Promise<void> {
  channels = await detectChannels(selfBot);
  log.info('Gambling channels: ' + channels.gambling.length);
  log.info('Fishing channel: ' + (channels.fishing || 'not found'));

  await initSchedules(selfBot, channels);

  for (const channelId of [...channels.gambling, ...channels.cards, channels.fishing].filter(Boolean)) {
    await supabase.from('bot_health').upsert(
      { group_id: channelId, platform: 'discord', status: 'online', updated_at: new Date().toISOString() },
      { onConflict: 'group_id,platform' }
    );
  }

  log.info('✅ Self-bot scheduler started');
}

async function detectChannels(selfBot: SelfClient): Promise<DiscordChannels> {
  const guild = selfBot.guilds.cache.get(process.env.DISCORD_GUILD_ID!);
  if (!guild) throw new Error('Guild not found — check DISCORD_GUILD_ID in .env');

  const gambling: string[] = [];
  const cards:    string[] = [];
  let   fishing  = '';
  let   general  = '';

  // Use forEach instead of filter to avoid type issues
  guild.channels.cache.forEach((channel: any) => {
    const name = (channel.name ?? '').toLowerCase();
    if (!name) return;

    if (name.includes('gambling') || name.includes('casino')) gambling.push(channel.id);
    if (name.includes('tempest-domain') || name.includes('rem-haven') || name.includes('card')) cards.push(channel.id);
    if (name.includes('fisher') || name.includes('miner')) fishing = channel.id;
    if (name.includes('tempest-domain') && !general) general = channel.id;
  });

  if (!fishing && general) fishing = general;

  log.info('Detected channels — gambling: ' + JSON.stringify(gambling) + ' fishing: ' + fishing);
  return { gambling, cards, fishing, general };
}

interface ChannelSchedule {
  nextDaily: Date | null;
  nextFish:  Date | null;
  nextDig:   Date | null;
}

const schedules = new Map<string, ChannelSchedule>();

async function initSchedules(selfBot: SelfClient, ch: DiscordChannels): Promise<void> {
  const dailyChannel = ch.gambling[0] ?? ch.general;
  if (!dailyChannel) {
    log.warn('No daily channel found yet — will retry when channels are detected');
    return;
  }

  const { data: lastDaily } = await supabase
    .from('daily_claims')
    .select('timestamp')
    .eq('platform', 'discord')
    .order('timestamp', { ascending: false })
    .limit(1)
    .single();

  const lastDailyAt = lastDaily ? new Date(lastDaily.timestamp) : null;
  const nextDaily   = lastDailyAt
    ? new Date(lastDailyAt.getTime() + 24 * 60 * 60 * 1000)
    : new Date();

  schedules.set(dailyChannel, {
    nextDaily,
    nextFish: ch.fishing ? new Date(Date.now() + randFishInterval()) : null,
    nextDig:  ch.fishing ? new Date(Date.now() + randFishInterval() * 1.5) : null,
  });

  setInterval(() => schedulerTick(selfBot, ch), 30_000);
  log.info('Scheduler tick started');
}

async function schedulerTick(selfBot: SelfClient, ch: DiscordChannels): Promise<void> {
  const now = new Date();
  for (const [channelId, sched] of schedules) {
    if (sched.nextDaily && now >= sched.nextDaily) {
      await sendQueued(selfBot, channelId, '.daily');
      sched.nextDaily = null;
      log.info('Sent .daily (Discord)');
    }
    if (sched.nextFish && now >= sched.nextFish && ch.fishing) {
      await sendQueued(selfBot, ch.fishing, '.fish');
      sched.nextFish = null;
    }
    if (sched.nextDig && now >= sched.nextDig && ch.fishing) {
      await sendQueued(selfBot, ch.fishing, '.dig');
      sched.nextDig = null;
    }
  }
}

export function handleDiscordDailyReply(channelId: string, text: string, timestamp: Date): void {
  const amountMatch = text.match(/reward of \$?([\d,]+)/i);
  const bonusMatch  = text.match(/\$?([\d,]+)\s*streak bonus/i);
  const streakMatch = text.match(/streak:\s*(\d+)/i);

  supabase.from('daily_claims').insert({
    group_id:     channelId,
    platform:     'discord',
    amount:       amountMatch ? parseInt(amountMatch[1].replace(/,/g, '')) : null,
    streak_bonus: bonusMatch  ? parseInt(bonusMatch[1].replace(/,/g, ''))  : 0,
    streak_count: streakMatch ? parseInt(streakMatch[1]) : null,
    timestamp:    timestamp.toISOString(),
  });

  const sched = schedules.get(channelId) ?? [...schedules.values()][0];
  if (sched) sched.nextDaily = new Date(timestamp.getTime() + 24 * 60 * 60 * 1000);
}

export async function handleDiscordFishReply(
  selfBot:   SelfClient,
  channelId: string,
  text:      string,
  timestamp: Date
): Promise<void> {
  const sched = [...schedules.values()][0];
  if (/cooldown|wait/i.test(text)) {
    const ms = parseCooldown(text);
    if (sched) sched.nextFish = new Date(Date.now() + ms - 5_000);
    return;
  }
  if (/caught|reeling/i.test(text)) await sendQueued(selfBot, channelId, '.sell fish');
  await supabase.from('fishing_events').insert({
    group_id: channelId, platform: 'discord',
    catch_type: /caught|reeling/i.test(text) ? 'fish' : 'nothing',
    coins_earned: null, raw_response: text, timestamp: timestamp.toISOString(),
  });
  if (sched) sched.nextFish = new Date(Date.now() + randFishInterval());
}

export function handleDiscordDigReply(channelId: string, text: string, timestamp: Date): void {
  const sched      = [...schedules.values()][0];
  const valueMatch = text.match(/\$?([\d,]+)\s*coins?/i);
  supabase.from('dig_events').insert({
    group_id: channelId, platform: 'discord',
    result_type: valueMatch ? 'coins' : 'nothing',
    value: valueMatch ? parseInt(valueMatch[1].replace(/,/g, '')) : null,
    raw_response: text, timestamp: timestamp.toISOString(),
  });
  if (sched) sched.nextDig = new Date(Date.now() + randFishInterval() * 2);
}

export function getChannels(): DiscordChannels | null { return channels; }

function randFishInterval(): number {
  const roll = Math.random() * 100;
  const mins = roll < 20 ? randBetween(3,5) : roll < 70 ? randBetween(5,7) : roll < 95 ? randBetween(7,10) : randBetween(10,12);
  return mins * 60 * 1000;
}
function randBetween(min: number, max: number): number { return Math.random() * (max - min) + min; }
function parseCooldown(text: string): number {
  const match = text.match(/(\d+)\s*(second|minute|hour)/i);
  if (!match) return 5 * 60 * 1000;
  const n = parseInt(match[1]);
  if (match[2].startsWith('s')) return n * 1000;
  if (match[2].startsWith('m')) return n * 60 * 1000;
  return n * 60 * 60 * 1000;
}
