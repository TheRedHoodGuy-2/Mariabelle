// ============================================================
// apps/discord-bot/src/discord-send-queue.ts
// Global send queue for Discord — respects 5msg/5s rate limit
// ============================================================

import { Client as SelfClient } from 'discord.js-selfbot-v13';
import { log } from './index';

const MIN_GAP_MS    = 1_200; // 1.2s gap (well within Discord's 5/5s limit)
const MAX_QUEUE     = 50;

interface QueueItem {
  selfBot:   SelfClient;
  channelId: string;
  text:      string;
  resolve:   (id: string | null) => void;
}

const queue: QueueItem[] = [];
let   processing = false;
let   lastSentAt = 0;

export function sendQueued(
  selfBot:   SelfClient,
  channelId: string,
  text:      string
): Promise<string | null> {
  if (queue.length >= MAX_QUEUE) {
    log.warn('Discord send queue full — dropping: ' + text);
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    queue.push({ selfBot, channelId, text, resolve });
    if (!processing) processQueue();
  });
}

async function processQueue(): Promise<void> {
  if (processing || !queue.length) return;
  processing = true;

  while (queue.length) {
    const item    = queue.shift()!;
    const elapsed = Date.now() - lastSentAt;
    if (elapsed < MIN_GAP_MS) await sleep(MIN_GAP_MS - elapsed);

    try {
      const channel = item.selfBot.channels.cache.get(item.channelId) as any;
      if (!channel) { item.resolve(null); continue; }

      const msg  = await channel.send(item.text);
      lastSentAt = Date.now();
      log.debug('[DISCORD SEND] ' + item.channelId + ': ' + item.text);
      item.resolve(msg?.id ?? null);
    } catch (err) {
      log.error('[DISCORD SEND] Failed: ' + item.text, err);
      item.resolve(null);
    }
  }

  processing = false;
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

// ============================================================
// apps/discord-bot/src/discord-health.ts
// Health tracking for Discord channels
// ============================================================

// Note: This is in the same file to keep output count manageable
// In production, split into discord-health.ts

import { supabase } from './index';

const lastBotMsg  = new Map<string, Date>();
const lastCmdSeen = new Map<string, Date>();

export async function updateDiscordHealth(
  channelId:    string,
  isFromBot:    boolean,
  timestamp:    Date
): Promise<void> {
  if (isFromBot) {
    lastBotMsg.set(channelId, timestamp);
  } else {
    lastCmdSeen.set(channelId, timestamp);
  }

  await supabase.from('bot_health').upsert(
    {
      group_id:      channelId,
      platform:      'discord',
      status:        'online',
      last_bot_msg:  lastBotMsg.get(channelId)?.toISOString()  ?? null,
      last_cmd_seen: lastCmdSeen.get(channelId)?.toISOString() ?? null,
      updated_at:    new Date().toISOString(),
    },
    { onConflict: 'group_id,platform' }
  );
}
