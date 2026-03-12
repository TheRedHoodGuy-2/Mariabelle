// ============================================================
// apps/whatsapp-bot/src/group-classifier.ts
// Phase 2, Step 2 — Auto group classification (Option B)
// Tags groups by what activity happens in them
// ============================================================

import { supabase, log } from './index';

// In-memory cache so we don't hit Supabase on every message
const groupTags = new Map<string, Set<string>>();
const commandCounts = new Map<string, number>();

const TAG_THRESHOLD = 3; // how many commands before we tag a group

export async function classifyGroup(
  groupId: string,
  tag: 'gambling' | 'cards' | 'fishing' | 'active'
): Promise<void> {
  // Init tracking for new group
  if (!groupTags.has(groupId)) {
    groupTags.set(groupId, new Set());
    commandCounts.set(groupId, 0);
  }

  const key = `${groupId}:${tag}`;
  const count = (commandCounts.get(key) ?? 0) + 1;
  commandCounts.set(key, count);

  // Already tagged — nothing to do
  if (groupTags.get(groupId)!.has(tag)) return;

  // Not enough evidence yet
  if (count < TAG_THRESHOLD) return;

  // Threshold reached — tag the group
  groupTags.get(groupId)!.add(tag);
  log.info(`Group ${groupId} tagged as: ${tag}`);

  // Persist to Supabase group_stats
  await supabase.from('group_stats').upsert(
    {
      group_id:   groupId,
      platform:   'whatsapp',
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'group_id,platform' }
  );
}

export function getGroupTags(groupId: string): Set<string> {
  return groupTags.get(groupId) ?? new Set();
}

export function isGamblingGroup(groupId: string): boolean {
  return groupTags.get(groupId)?.has('gambling') ?? false;
}

export function isCardGroup(groupId: string): boolean {
  return groupTags.get(groupId)?.has('cards') ?? false;
}

export function isFishingGroup(groupId: string): boolean {
  return groupTags.get(groupId)?.has('fishing') ?? false;
}
