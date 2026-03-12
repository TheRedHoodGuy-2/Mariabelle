import 'dotenv/config';
// ============================================================
// apps/whatsapp-bot/src/index.ts
// ============================================================

import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  isJidBroadcast,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import * as fs from 'fs';
import * as path from 'path';
import pino from 'pino';
import { createClient } from '@supabase/supabase-js';
import qrcode from 'qrcode-terminal';

const SESSION_DIR = path.resolve(__dirname, '../auth_info_baileys');
const RECONNECT_MS = 5_000;
const MAX_RECONNECT = 10;

const logger = pino({ level: 'silent' });

export const log = {
  info: (msg: string, ...args: unknown[]) => console.log(`[INFO]  ${msg}`, ...args),
  warn: (msg: string, ...args: unknown[]) => console.warn(`[WARN]  ${msg}`, ...args),
  error: (msg: string, ...args: unknown[]) => console.error(`[ERROR] ${msg}`, ...args),
  debug: (msg: string, ...args: unknown[]) => console.log(`[DEBUG] ${msg}`, ...args),
};

export const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

let reconnectCount = 0;
let isShuttingDown = false;

export async function connectToWhatsApp(): Promise<ReturnType<typeof makeWASocket>> {
  const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
  const { version, isLatest } = await fetchLatestBaileysVersion();
  log.info(`Baileys v${version.join('.')} ${isLatest ? '(latest)' : '(update available)'}`);

  const sock = makeWASocket({
    version, logger,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    printQRInTerminal: false,
    generateHighQualityLinkPreview: false,
    shouldIgnoreJid: jid => isJidBroadcast(jid),
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('\n');
      qrcode.generate(qr, { small: true });
      console.log('\n[INFO]  Scan the QR above with your BOT WhatsApp number\n');
    }

    if (connection === 'open') {
      reconnectCount = 0;
      log.info('WhatsApp connected!');
      log.info(`Bot number: ${sock.user?.id}`);
      await onConnected(sock);
    }

    if (connection === 'close') {
      const reason = (lastDisconnect?.error as Boom)?.output?.statusCode;
      log.warn(`Connection closed. Reason: ${reason}`);
      const shouldReconnect = reason !== DisconnectReason.loggedOut;
      if (shouldReconnect && !isShuttingDown) {
        reconnectCount++;
        if (reconnectCount > MAX_RECONNECT) { log.error('Max reconnects reached.'); return; }
        setTimeout(() => connectToWhatsApp(), RECONNECT_MS);
      } else if (reason === DisconnectReason.loggedOut) {
        clearSession();
        setTimeout(() => connectToWhatsApp(), RECONNECT_MS);
      }
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    const { routeMessage } = await import('./message-router');

    for (const msg of messages) {
      if (!msg.message) continue;

      const jid = msg.key.remoteJid ?? '';
      const sender = msg.key.participant ?? jid;
      const fromMe = msg.key.fromMe ?? false;

      const text =
        msg.message?.conversation ??
        msg.message?.extendedTextMessage?.text ??
        msg.message?.imageMessage?.caption ??
        msg.message?.videoMessage?.caption ?? '';

      // RAW LOG — see every single message arriving
      log.debug(`[RAW] ${jid.slice(0, 25)} | ${sender.slice(0, 20)} | fromMe:${fromMe} | "${text.slice(0, 80)}"`);

      if (fromMe) continue;
      if (!jid.endsWith('@g.us')) continue;

      await routeMessage(sock, msg);
    }
  });

  return sock;
}

async function onConnected(sock: ReturnType<typeof makeWASocket>): Promise<void> {
  const { loadKnownBots } = await import('./bot-detector');
  const { runHealthChecks } = await import('./health-monitor');
  const { initScheduler } = await import('./scheduler');
  const { initGamblingBrain } = await import('./gambling-brain');

  await loadKnownBots();

  const groups = await sock.groupFetchAllParticipating();
  const groupIds = Object.keys(groups);
  log.info(`Found ${groupIds.length} groups`);

  for (const groupId of groupIds) {
    await supabase.from('bot_health').upsert(
      { group_id: groupId, platform: 'whatsapp', status: 'online', updated_at: new Date().toISOString() },
      { onConflict: 'group_id,platform' }
    );
  }

  await initScheduler(sock, groupIds);
  await initGamblingBrain(sock);
  setInterval(() => runHealthChecks(sock), 60_000);
  log.info('All systems online — watching for messages...');
}

export async function sendMessage(
  sock: ReturnType<typeof makeWASocket>,
  groupId: string,
  text: string
): Promise<string | null> {
  try {
    const result = await sock.sendMessage(groupId, { text });
    return result?.key?.id ?? null;
  } catch (err) {
    log.error(`Failed to send to ${groupId}`, err);
    return null;
  }
}

function clearSession(): void {
  if (fs.existsSync(SESSION_DIR)) {
    fs.rmSync(SESSION_DIR, { recursive: true, force: true });
    log.info('Session cleared');
  }
}

export function getSessionExists(): boolean {
  return fs.existsSync(SESSION_DIR) && fs.readdirSync(SESSION_DIR).length > 0;
}

process.on('SIGINT', () => { log.info('Shutting down'); isShuttingDown = true; process.exit(0); });
process.on('SIGTERM', () => { log.info('Shutting down'); isShuttingDown = true; process.exit(0); });

function validateEnv(): void {
  const required = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'OPENROUTER_API_KEY'];
  const missing = required.filter(k => !process.env[k]);
  if (missing.length) { console.error(`Missing env vars: ${missing.join(', ')}`); process.exit(1); }
}

async function main(): Promise<void> {
  validateEnv();
  log.info('=== TENSURA DOMINATION BOT — WhatsApp ===');
  if (!getSessionExists()) { log.info('No session — QR will appear below'); }
  else { log.info('Session found — connecting...'); }
  await connectToWhatsApp();
}

main().catch(err => { log.error('Fatal:', err); process.exit(1); });