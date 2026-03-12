// ============================================================
// apps/whatsapp-bot/src/send-queue.ts
// Phase 2, Step 9 — Global send queue
// Enforces 500ms minimum gap between ANY outgoing message
// across ALL groups to prevent WhatsApp rate limiting.
// ============================================================

import makeWASocket from '@whiskeysockets/baileys';
import { log } from './index';

const MIN_GAP_MS = 500; // minimum ms between any two sends

interface QueueItem {
  sock:    ReturnType<typeof makeWASocket>;
  groupId: string;
  text:    string;
  resolve: (id: string | null) => void;
}

const queue: QueueItem[] = [];
let   processing = false;
let   lastSentAt = 0;

// ─── ENQUEUE ─────────────────────────────────────────────────
export function sendQueued(
  sock: ReturnType<typeof makeWASocket>,
  groupId: string,
  text: string
): Promise<string | null> {
  return new Promise((resolve) => {
    queue.push({ sock, groupId, text, resolve });
    if (!processing) processQueue();
  });
}

// ─── PROCESSOR ───────────────────────────────────────────────
async function processQueue(): Promise<void> {
  if (processing || queue.length === 0) return;
  processing = true;

  while (queue.length > 0) {
    const item = queue.shift()!;

    // Enforce minimum gap
    const now     = Date.now();
    const elapsed = now - lastSentAt;
    if (elapsed < MIN_GAP_MS) {
      await sleep(MIN_GAP_MS - elapsed);
    }

    try {
      const result = await item.sock.sendMessage(item.groupId, { text: item.text });
      const msgId  = result?.key?.id ?? null;
      lastSentAt   = Date.now();
      log.debug(`[SEND] ${item.groupId}: ${item.text}`);
      item.resolve(msgId);
    } catch (err) {
      log.error(`[SEND] Failed to send to ${item.groupId}: ${item.text}`, err);
      item.resolve(null);
    }
  }

  processing = false;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function getQueueLength(): number {
  return queue.length;
}
