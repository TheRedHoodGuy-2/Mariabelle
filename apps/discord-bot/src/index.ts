import 'dotenv/config';
// ============================================================
// apps/discord-bot/src/index.ts
// Phase 3 — Discord self-bot + observer bot
// ============================================================

import { Client as SelfClient } from 'discord.js-selfbot-v13';
import { Client, GatewayIntentBits, Partials } from 'discord.js';
import { createClient } from '@supabase/supabase-js';

export const log = {
  info:  (msg: string, ...args: unknown[]) => console.log (`[INFO]  ${msg}`, ...args),
  warn:  (msg: string, ...args: unknown[]) => console.warn(`[WARN]  ${msg}`, ...args),
  error: (msg: string, ...args: unknown[]) => console.error(`[ERROR] ${msg}`, ...args),
  debug: (msg: string, ...args: unknown[]) => {
    if (process.env.DEBUG === 'true') console.log(`[DEBUG] ${msg}`, ...args);
  },
};

export const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function validateEnv(): void {
  const required = [
    'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY',
    'DISCORD_USER_TOKEN', 'DISCORD_BOT_TOKEN',
    'DISCORD_GUILD_ID', 'OPENROUTER_API_KEY',
  ];
  const missing = required.filter(k => !process.env[k]);
  if (missing.length) {
    console.error('Missing env vars: ' + missing.join(', '));
    process.exit(1);
  }
}

// ── SELF-BOT (your real account) ─────────────────────────────
export const selfBot = new SelfClient({ checkUpdate: false } as any);

selfBot.on('ready', async () => {
  log.info('Self-bot ready as: ' + selfBot.user?.tag);
  const { initSelfBot } = await import('./self-bot');
  await initSelfBot(selfBot);
});

selfBot.on('messageCreate', async (message: any) => {
  const { routeDiscordMessage } = await import('./discord-router');
  await routeDiscordMessage(selfBot, observerBot, message, 'selfbot');
});

selfBot.on('error', (err: any) => log.error('Self-bot error:', err));

// ── OBSERVER BOT (app token, silent) ─────────────────────────
export const observerBot = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    // GatewayIntentBits.MessageContent, // Enable in Discord Dev Portal first
  ],
  partials: [Partials.Message, Partials.Channel],
});

observerBot.on('ready', () => {
  log.info('Observer bot ready as: ' + observerBot.user?.tag);
});

observerBot.on('messageCreate', async (message: any) => {
  if (message.author.bot) {
    const { routeDiscordMessage } = await import('./discord-router');
    await routeDiscordMessage(selfBot, observerBot, message, 'observer');
  }
});

observerBot.on('error', (err: any) => log.error('Observer bot error:', err));

// ── SHUTDOWN ──────────────────────────────────────────────────
process.on('SIGINT',  async () => { selfBot.destroy(); observerBot.destroy(); process.exit(0); });
process.on('SIGTERM', async () => { selfBot.destroy(); observerBot.destroy(); process.exit(0); });

async function main(): Promise<void> {
  validateEnv();
  log.info('=== TENSURA DOMINATION BOT — Discord ===');
  await Promise.all([
    selfBot.login(process.env.DISCORD_USER_TOKEN!),
    observerBot.login(process.env.DISCORD_BOT_TOKEN!),
  ]);
}

main().catch(err => { log.error('Fatal:', err); process.exit(1); });
