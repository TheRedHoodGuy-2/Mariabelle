// ============================================================
// apps/whatsapp-bot/src/health-monitor.ts
// Phase 2, Step 4 — Bot health monitor (5-state machine)
// States: online → suspicious → offline → recovering → online
// ============================================================

import makeWASocket from '@whiskeysockets/baileys';
import { supabase, log, sendMessage } from './index';
import { ParsedMessage, BotStatus } from './types';

// ─── IN-MEMORY STATE ─────────────────────────────────────────
interface GroupState {
  groupId:        string;
  status:         BotStatus;
  lastBotMsg:     Date | null;
  lastCmdSeen:    Date | null;
  pingCheckSent:  Date | null;
  offlineSince:   Date | null;
  failingCmds:    Set<string>;
  avgPingMs:      number;
  pingHistory:    number[];
}

const groupStates = new Map<string, GroupState>();

// ─── THRESHOLDS ──────────────────────────────────────────────
const HIGH_ACTIVITY_TIMEOUT_MS = 3  * 60 * 1000;  // 3 min
const LOW_ACTIVITY_TIMEOUT_MS  = 10 * 60 * 1000;  // 10 min
const PING_WAIT_MS             = 10 * 60 * 1000;  // 10 min wait for .test reply
const RECOVER_CONFIRM_MS       = 60 * 1000;       // 60s stability before ONLINE
const PARTIAL_OUTAGE_MS        = 30 * 60 * 1000;  // 30 min with no reply on a cmd type

// ─── MAIN UPDATE ─────────────────────────────────────────────
export async function handleHealthUpdate(parsed: ParsedMessage): Promise<void> {
  const { groupId, isFromBot, text, timestamp } = parsed;

  let state = groupStates.get(groupId);
  if (!state) {
    state = initGroupState(groupId);
    groupStates.set(groupId, state);
  }

  // Track last bot message time
  if (isFromBot) {
    state.lastBotMsg = timestamp;

    // If we were suspicious/offline — transition to recovering
    if (state.status === 'suspicious' || state.status === 'offline') {
      await transitionTo(state, 'recovering');
    }

    // If recovering and stable for 60s → go online
    if (state.status === 'recovering') {
      const recoverTime = state.lastBotMsg?.getTime() ?? 0;
      if (Date.now() - recoverTime >= RECOVER_CONFIRM_MS) {
        await transitionTo(state, 'online');
      }
    }

    // Track ping response
    if (/mata mata/i.test(text) && state.pingCheckSent) {
      const pingMs = Date.now() - state.pingCheckSent.getTime();
      updatePing(state, pingMs);
      state.pingCheckSent = null;
      log.debug(`Ping for ${groupId}: ${pingMs}ms`);
    }
  } else {
    // User command — track last activity
    state.lastCmdSeen = timestamp;
  }

  await persistState(state);
}

// ─── PERIODIC CHECK ──────────────────────────────────────────
// Called by a setInterval every 60 seconds
export async function runHealthChecks(
  sock: ReturnType<typeof makeWASocket>
): Promise<void> {
  for (const [groupId, state] of groupStates) {
    await checkGroupHealth(sock, state);
  }
}

async function checkGroupHealth(
  sock: ReturnType<typeof makeWASocket>,
  state: GroupState
): Promise<void> {
  const now = Date.now();

  if (state.status === 'online' || state.status === 'partial_outage') {
    const lastBotAge  = state.lastBotMsg  ? now - state.lastBotMsg.getTime()  : Infinity;
    const lastCmdAge  = state.lastCmdSeen ? now - state.lastCmdSeen.getTime() : Infinity;
    const groupActive = lastCmdAge < HIGH_ACTIVITY_TIMEOUT_MS;

    // Only go suspicious if group is active (other users sending commands)
    if (!groupActive) return;

    const timeout = groupActive ? HIGH_ACTIVITY_TIMEOUT_MS : LOW_ACTIVITY_TIMEOUT_MS;

    if (lastBotAge > timeout) {
      log.warn(`Group ${state.groupId} bot silent for ${Math.round(lastBotAge/1000)}s — going SUSPICIOUS`);
      await transitionTo(state, 'suspicious');
      state.pingCheckSent = new Date();
      await sendMessage(sock, state.groupId, '.test');
    }
  }

  if (state.status === 'suspicious') {
    const waitedMs = state.pingCheckSent
      ? now - state.pingCheckSent.getTime()
      : Infinity;

    if (waitedMs > PING_WAIT_MS) {
      log.warn(`Group ${state.groupId} no ping reply after ${PING_WAIT_MS/1000}s — going OFFLINE`);
      await transitionTo(state, 'offline');
    }
  }
}

// ─── STATE TRANSITIONS ───────────────────────────────────────
async function transitionTo(state: GroupState, newStatus: BotStatus): Promise<void> {
  const old = state.status;
  state.status = newStatus;

  if (newStatus === 'offline' && !state.offlineSince) {
    state.offlineSince = new Date();
  }
  if (newStatus === 'online') {
    state.offlineSince = null;
    state.failingCmds.clear();
  }

  log.info(`Group ${state.groupId}: ${old} → ${newStatus}`);
  await persistState(state);
}

// ─── HELPERS ─────────────────────────────────────────────────
function initGroupState(groupId: string): GroupState {
  return {
    groupId,
    status:       'online',
    lastBotMsg:   null,
    lastCmdSeen:  null,
    pingCheckSent: null,
    offlineSince: null,
    failingCmds:  new Set(),
    avgPingMs:    0,
    pingHistory:  [],
  };
}

function updatePing(state: GroupState, pingMs: number): void {
  state.pingHistory.push(pingMs);
  if (state.pingHistory.length > 10) state.pingHistory.shift();
  state.avgPingMs = Math.round(
    state.pingHistory.reduce((a, b) => a + b, 0) / state.pingHistory.length
  );
}

async function persistState(state: GroupState): Promise<void> {
  await supabase.from('bot_health').upsert(
    {
      group_id:        state.groupId,
      platform:        'whatsapp',
      status:          state.status,
      last_bot_msg:    state.lastBotMsg?.toISOString()    ?? null,
      last_cmd_seen:   state.lastCmdSeen?.toISOString()   ?? null,
      ping_check_sent: state.pingCheckSent?.toISOString() ?? null,
      avg_ping_ms:     state.avgPingMs,
      offline_since:   state.offlineSince?.toISOString()  ?? null,
      failing_cmds:    [...state.failingCmds],
      updated_at:      new Date().toISOString(),
    },
    { onConflict: 'group_id,platform' }
  );
}

// ─── EXPORTS FOR OTHER MODULES ───────────────────────────────
export function isGroupOnline(groupId: string): boolean {
  const s = groupStates.get(groupId);
  return s ? s.status === 'online' || s.status === 'partial_outage' : true;
}

export function getGroupStatus(groupId: string): BotStatus {
  return groupStates.get(groupId)?.status ?? 'online';
}
