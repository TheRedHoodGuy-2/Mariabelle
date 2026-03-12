// ============================================================
// apps/whatsapp-bot/src/group-stats.ts
// In-memory group performance stats, synced to Supabase
// ============================================================

import { supabase } from './index';
import { GroupStats } from './types';

const statsCache = new Map<string, GroupStats>();

export function getGroupStats(groupId: string): GroupStats {
  return statsCache.get(groupId) ?? {
    group_id:          groupId,
    platform:          'whatsapp',
    cards_per_hour:    0,
    our_claim_rate:    0,
    avg_competitor_ms: 0,
    group_score:       0,
    suspected_bot:     false,
    updated_at:        new Date().toISOString(),
  };
}

export async function updateGroupStats(groupId: string, patch: Partial<GroupStats>): Promise<void> {
  const current = getGroupStats(groupId);
  const updated = { ...current, ...patch, updated_at: new Date().toISOString() };
  statsCache.set(groupId, updated);

  await supabase.from('group_stats').upsert(
    { ...updated },
    { onConflict: 'group_id,platform' }
  );
}
