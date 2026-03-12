// ============================================================
// TENSURA DOMINATION PROJECT — SHARED TYPES
// packages/shared-types/index.ts
// Imported by: whatsapp-bot, discord-bot, dashboard
// Never import platform-specific code here — pure types only
// ============================================================


// ─── ENUMS ───────────────────────────────────────────────────

export type Platform = 'whatsapp' | 'discord';

export type GameType =
  | 'casino'
  | 'slots'
  | 'coinflip'
  | 'dice'
  | 'db'
  | 'roulette'
  | 'horse'
  | 'dp';

export type GamblingOutcome = 'win' | 'loss' | 'draw' | 'unresolved';

export type MatchMethod = 'quoted' | 'mention' | 'orphan';

export type CardOutcome =
  | 'claimed'
  | 'missed'
  | 'unresolved_offline'
  | 'expired';

export type CatchType = 'fish' | 'item' | 'card' | 'nothing';

export type DigResultType = 'coins' | 'item' | 'card' | 'nothing';

export type BotStatus =
  | 'online'
  | 'suspicious'
  | 'offline'
  | 'recovering'
  | 'partial_outage';

export type PendingBetStatus = 'pending' | 'resolved' | 'expired';

export type PassiveIncomeSource =
  | 'stranger'
  | 'quest_giver'
  | 'tip'
  | 'unknown';


// ─── DATABASE ROW TYPES ──────────────────────────────────────
// These mirror the Supabase table columns exactly.
// Use these when reading FROM the database.

export interface KnownBot {
  id: string;
  bot_name: string;
  identifier: string;           // phone number (WA) or Discord user ID
  platform: Platform;
  active: boolean;
  first_seen: string;           // ISO timestamptz
  last_seen: string | null;
  updated_at: string;
}

export interface PendingBet {
  id: string;
  message_id: string | null;    // WA/Discord message ID for quoted-reply matching
  player_id: string;
  game: GameType;
  bet_amount: number;
  guess: string | null;         // heads/tails for cf, 1-6 for dice/db
  group_id: string;
  platform: Platform;
  status: PendingBetStatus;
  created_at: string;
}

export interface GamblingEvent {
  id: string;
  player_id: string;
  player_name: string | null;
  platform: Platform;
  group_id: string;
  game: GameType;
  bet_amount: number;
  outcome: GamblingOutcome | null;
  payout: number | null;        // positive = won, negative = lost, 0 = draw
  multiplier: number | null;
  guess: string | null;
  reply_delay_ms: number | null;
  match_method: MatchMethod | null;
  timestamp: string;
  resolved_at: string | null;
  created_at: string;
}

export interface CardEvent {
  id: string;
  spawn_id: string;             // alphanumeric WA (561ca) | numeric Discord (94650)
  card_name: string | null;
  tier: number | null;          // 1-6 for normal, 99 for Tier S
  price: number | null;
  issue: number | null;
  group_id: string;
  platform: Platform;
  spawn_time: string | null;
  our_claim_time: string | null;
  delay_ms: number | null;
  outcome: CardOutcome | null;
  claimed_by: string | null;    // player_id of winner if missed
  winner_delay_ms: number | null;
  created_at: string;
}

export interface DailyClaim {
  id: string;
  group_id: string;
  platform: Platform;
  amount: number | null;
  streak_bonus: number | null;
  streak_count: number | null;
  timestamp: string;
  created_at: string;
}

export interface FishingEvent {
  id: string;
  group_id: string;
  platform: Platform;
  catch_type: CatchType | null;
  coins_earned: number | null;
  raw_response: string | null;
  timestamp: string;
  created_at: string;
}

export interface DigEvent {
  id: string;
  group_id: string;
  platform: Platform;
  result_type: DigResultType | null;
  value: number | null;
  raw_response: string | null;
  timestamp: string;
  created_at: string;
}

export interface PassiveIncomeEvent {
  id: string;
  group_id: string;
  platform: Platform;
  source: PassiveIncomeSource | null;
  amount: number | null;
  timestamp: string;
  created_at: string;
}

export interface BotHealth {
  group_id: string;
  platform: Platform;
  bot_name: string | null;
  status: BotStatus;
  last_bot_msg: string | null;
  last_cmd_seen: string | null;
  ping_check_sent: string | null;
  avg_ping_ms: number | null;
  offline_since: string | null;
  failing_cmds: string[] | null;
  updated_at: string;
}

export interface GroupStats {
  group_id: string;
  platform: Platform;
  cards_per_hour: number;
  our_claim_rate: number;       // 0.0 to 1.0
  avg_competitor_ms: number;
  group_score: number;
  suspected_bot: boolean;
  updated_at: string;
}

export interface UnpromptedEvent {
  id: string;
  group_id: string;
  platform: Platform;
  raw_text: string | null;
  event_type: string | null;
  timestamp: string;
  created_at: string;
}


// ─── INSERT TYPES ────────────────────────────────────────────
// Use these when writing TO the database.
// Omits auto-generated fields (id, created_at, updated_at).

export type InsertGamblingEvent = Omit<GamblingEvent,
  'id' | 'created_at'>;

export type InsertPendingBet = Omit<PendingBet,
  'id' | 'created_at'>;

export type InsertCardEvent = Omit<CardEvent,
  'id' | 'created_at'>;

export type InsertDailyClaim = Omit<DailyClaim,
  'id' | 'created_at'>;

export type InsertFishingEvent = Omit<FishingEvent,
  'id' | 'created_at'>;

export type InsertDigEvent = Omit<DigEvent,
  'id' | 'created_at'>;

export type InsertPassiveIncomeEvent = Omit<PassiveIncomeEvent,
  'id' | 'created_at'>;

export type InsertUnpromptedEvent = Omit<UnpromptedEvent,
  'id' | 'created_at'>;

export type InsertKnownBot = Omit<KnownBot,
  'id' | 'first_seen' | 'updated_at'>;

export type UpsertBotHealth = Omit<BotHealth, 'updated_at'>;

export type UpsertGroupStats = Omit<GroupStats, 'updated_at'>;


// ─── IN-MEMORY TYPES ─────────────────────────────────────────
// Used internally by the bots. NOT stored in Supabase directly.
// These are runtime objects that get transformed into DB inserts.

/** A raw parsed message from WhatsApp or Discord */
export interface ParsedMessage {
  messageId: string;
  platform: Platform;
  groupId: string;
  senderId: string;
  senderName: string;
  text: string;
  isFromBot: boolean;
  isMedia: boolean;             // image, video, sticker, document
  mediaCaption: string | null;  // caption text on a media message
  isReply: boolean;
  quotedMessageId: string | null;
  timestamp: Date;
  rawPayload: unknown;          // original Baileys/discord.js message object
}

/** A detected gambling command, before the bot reply arrives */
export interface DetectedBet {
  messageId: string;
  playerId: string;
  playerName: string;
  platform: Platform;
  groupId: string;
  game: GameType;
  betAmount: number;
  guess: string | null;
  detectedAt: Date;
}

/** A resolved gambling outcome, ready to insert into gambling_events */
export interface ResolvedBet extends DetectedBet {
  outcome: GamblingOutcome;
  payout: number;
  multiplier: number;
  replyDelayMs: number;
  matchMethod: MatchMethod;
  resolvedAt: Date;
}

/** A detected card spawn, before claim attempt */
export interface DetectedSpawn {
  spawnId: string;
  cardName: string;
  tier: number;
  price: number;
  issue: number | null;
  groupId: string;
  platform: Platform;
  spawnTime: Date;
  rawMessage: ParsedMessage;
}

/** Result of a claim attempt */
export interface ClaimResult {
  spawn: DetectedSpawn;
  outcome: CardOutcome;
  ourClaimTime: Date;
  delayMs: number;
  claimedBy: string | null;     // player_id of winner if missed
  winnerDelayMs: number | null;
}


// ─── BOT HEALTH STATE ────────────────────────────────────────
// In-memory state for the health monitor state machine.

export interface GroupHealthState {
  groupId: string;
  platform: Platform;
  botName: string | null;
  status: BotStatus;
  lastBotMsg: Date | null;
  lastCmdSeen: Date | null;
  pingCheckSent: Date | null;
  offlineSince: Date | null;
  failingCmds: Set<string>;
  avgPingMs: number;
}


// ─── SCHEDULER ───────────────────────────────────────────────
// Used by fishing and digging schedulers.

export interface ScheduledTask {
  groupId: string;
  platform: Platform;
  taskType: 'fish' | 'dig' | 'daily';
  nextRunAt: Date;
  lastRunAt: Date | null;
}


// ─── PENDING BETS QUEUE ──────────────────────────────────────
// In-memory queue keyed by group+player+game+amount.
// Mirrors pending_bets table but lives in RAM for speed.

export type PendingBetQueueKey = string; // `${groupId}:${playerId}:${game}:${betAmount}`

export interface PendingBetQueue {
  [key: PendingBetQueueKey]: DetectedBet[];  // FIFO array per key
}


// ─── DASHBOARD / API RESPONSE TYPES ──────────────────────────
// Used by Next.js API routes and dashboard components.

export interface WealthSummary {
  walletBalance: number;
  bankBalance: number;
  bankCapacity: number;
  totalBalance: number;
  lastUpdated: string;
}

export interface GamblingStats {
  totalPlays: number;
  totalWins: number;
  totalLosses: number;
  totalDraws: number;
  winRate: number;              // 0.0 to 1.0
  netPnL: number;               // total coins won minus lost
  biggestWin: number;
  biggestLoss: number;
  byGame: Record<GameType, {
    plays: number;
    wins: number;
    winRate: number;
    netPnL: number;
  }>;
}

export interface CardStats {
  totalCards: number;
  byTier: Record<number, number>; // tier → count
  estimatedValue: number;
  claimRate: number;            // 0.0 to 1.0
}

export interface LeaderboardEntry {
  rank: number;
  playerName: string;
  bankBalance: number;
  walletBalance: number;
  totalBalance: number;
}

export interface LiveEvent {
  id: string;
  type:
    | 'card_claimed'
    | 'card_missed'
    | 'card_spawned'
    | 'gambling_win'
    | 'gambling_loss'
    | 'gambling_draw'
    | 'daily_claimed'
    | 'fish_caught'
    | 'dig_result'
    | 'bot_online'
    | 'bot_offline'
    | 'bot_suspicious';
  groupId: string;
  platform: Platform;
  description: string;          // human-readable e.g. "Claimed Megumin (Tier S) in Tempest Gambling"
  amount: number | null;        // coins won/lost if applicable
  timestamp: string;
}


// ─── AI / OPENROUTER ─────────────────────────────────────────

export type AIDecisionType = 'gambling' | 'card' | 'event_parse';

export type OpenRouterModel =
  | 'liquid/lfm-2.5-1b-thinking'   // fast — real-time gambling decisions (0.44s)
  | 'openrouter/hunter-alpha'       // deep analysis — card value, pattern analysis (1M ctx)
  | 'venice-uncensored/dolphin-mistral-24b-venice-edition'; // event parser — flexible

export interface AIDecision {
  id: string;
  model_used: OpenRouterModel;
  decision_type: AIDecisionType;
  platform: Platform | null;
  group_id: string | null;
  input_summary: string | null;
  recommendation: GamblingRecommendation | CardRecommendation | EventParseResult | null;
  confidence: number | null;        // 0.0 to 1.0
  executed: boolean;
  skip_reason: string | null;
  actual_outcome: string | null;
  tokens_used: number | null;
  latency_ms: number | null;
  created_at: string;
}

export interface GamblingRecommendation {
  shouldBet: boolean;
  game: GameType;
  betAmount: number;                // absolute amount calculated from 20% of balance
  guess: string | null;             // heads/tails, 1-6 etc
  confidence: number;               // 0.0 to 1.0
  reasoning: string;                // short explanation
}

export interface CardRecommendation {
  action: 'sell' | 'hold' | 'auction' | 'trade';
  cardIndex: number;
  suggestedPrice: number | null;
  confidence: number;
  reasoning: string;
}

export interface EventParseResult {
  eventType: string;                // what the AI thinks this is
  coinsInvolved: number | null;
  confidence: number;
  reasoning: string;
}

// ─── GAMBLING CONFIG ─────────────────────────────────────────
// Mirrors gambling_config table. Single row, updated from dashboard.

export interface GamblingConfig {
  id: string;
  max_bets_per_day: number;         // default: 10
  bet_percentage: number;           // default: 0.20 (20%)
  min_confidence: number;           // default: 0.70 — AI must be >= this to execute
  gambling_enabled: boolean;
  updated_at: string;
}

export type UpdateGamblingConfig = Partial<Pick<GamblingConfig,
  'max_bets_per_day' | 'bet_percentage' | 'min_confidence' | 'gambling_enabled'>>;
