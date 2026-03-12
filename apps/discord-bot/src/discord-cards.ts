// ============================================================
// apps/discord-bot/src/discord-cards.ts
// Phase 3 — Discord card claimer
// Key difference from WA: spawns are EMBEDS not plain text
// Spawn IDs on Discord are NUMERIC (e.g. 94650)
// ============================================================

import { Client as SelfClient } from 'discord.js-selfbot-v13';
import { supabase, log } from './index';

import { sendQueued } from './discord-send-queue';

// ─── EMBED PARSER ────────────────────────────────────────────
interface SpawnData {
  spawnId:  string;
  cardName: string;
  tier:     number;
  price:    number;
  issue:    number | null;
}

export function parseCardEmbed(embed: any): SpawnData | null {
  // Embeds have fields array: [{ name: 'Name', value: 'Wilhelm' }, ...]
  const fields: Array<{ name: string; value: string }> =
    embed.fields ?? embed.data?.fields ?? [];

  const get = (key: string) =>
    fields.find(f => f.name.toLowerCase().includes(key.toLowerCase()))?.value ?? '';

  // Spawn ID is in description or footer: "Claim it with .claim 94650"
  const description = embed.description ?? embed.data?.description ?? '';
  const footer      = embed.footer?.text ?? embed.data?.footer?.text ?? '';
  const claimText   = description + ' ' + footer;

  const spawnMatch = claimText.match(/\.claim\s+([a-zA-Z0-9]+)/i);
  if (!spawnMatch) return null;

  const tierRaw = get('tier');
  const tier    = tierRaw.toLowerCase() === 's' ? 99 : parseInt(tierRaw) || 0;
  const priceRaw = get('price').replace(/[$,]/g, '');
  const issueRaw = get('issue').replace('#', '');

  return {
    spawnId:  spawnMatch[1],
    cardName: get('name') || (embed.title ?? ''),
    tier,
    price:    parseInt(priceRaw) || 0,
    issue:    issueRaw ? parseInt(issueRaw) : null,
  };
}

// ─── MAIN HANDLER ────────────────────────────────────────────
const activeSpawns = new Map<string, SpawnData & { channelId: string; spawnTime: Date }>();

export async function handleDiscordCardSpawn(
  selfBot:   SelfClient,
  embed:     any,
  channelId: string,
  timestamp: Date
): Promise<void> {
  const spawn = parseCardEmbed(embed);
  if (!spawn) {
    log.warn('Card spawn embed detected but could not parse');
    return;
  }

  if (activeSpawns.has(spawn.spawnId)) return;

  activeSpawns.set(spawn.spawnId, { ...spawn, channelId, spawnTime: timestamp });
  log.info('Discord card spawn: ' + spawn.cardName + ' T' + spawn.tier + ' ID:' + spawn.spawnId);

  // Log to DB
  await supabase.from('card_events').insert({
    spawn_id:   spawn.spawnId,
    card_name:  spawn.cardName,
    tier:       spawn.tier,
    price:      spawn.price,
    issue:      spawn.issue,
    group_id:   channelId,
    platform:   'discord',
    spawn_time: timestamp.toISOString(),
    outcome:    null,
  });

  // Humanised delay then claim
  const delayMs = calcClaimDelay();
  setTimeout(async () => {
    await sendQueued(selfBot, channelId, '.claim ' + spawn.spawnId);
    await supabase.from('card_events')
      .update({ our_claim_time: new Date().toISOString(), delay_ms: delayMs })
      .eq('spawn_id', spawn.spawnId)
      .eq('group_id', channelId);
  }, delayMs);
}

// ─── CLAIM RESULT ────────────────────────────────────────────
export async function handleDiscordClaimReply(
  text:      string,
  channelId: string
): Promise<void> {
  for (const [spawnId, spawn] of activeSpawns.entries()) {
    if (spawn.channelId !== channelId) continue;

    const weGotIt  = /you (got|claimed|received)/i.test(text);
    const theGotIt = /already claimed|someone else/i.test(text);

    await supabase.from('card_events')
      .update({ outcome: weGotIt ? 'claimed' : theGotIt ? 'missed' : null })
      .eq('spawn_id', spawnId)
      .eq('group_id', channelId);

    if (weGotIt) log.info('✅ Discord claimed: ' + spawn.cardName);
    if (theGotIt) log.warn('Discord missed: ' + spawn.cardName);

    activeSpawns.delete(spawnId);
    break;
  }
}

// ─── HUMANISED DELAY ─────────────────────────────────────────
function calcClaimDelay(): number {
  const roll = Math.random() * 100;
  const base =
    roll < 20 ? randBetween(1500, 2500) :
    roll < 70 ? randBetween(2500, 4000) :
    roll < 95 ? randBetween(4000, 6000) :
                randBetween(6000, 9000);
  return base;
}

function randBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min)) + min;
}
