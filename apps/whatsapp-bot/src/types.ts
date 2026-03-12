// apps/whatsapp-bot/src/types.ts
// Inlined types — replaces @tensura/shared-types package import

export type Platform       = 'whatsapp' | 'discord';
export type BotStatus      = 'online' | 'suspicious' | 'offline' | 'recovering' | 'partial_outage';
export type GameType       = string;
export type GamblingOutcome = 'win' | 'loss' | 'draw' | 'unresolved';
export type MatchMethod    = 'quoted' | 'mention' | 'orphan';
export type OpenRouterModel = string;

export interface ParsedMessage {
  messageId:       string;
  platform:        Platform;
  groupId:         string;
  senderId:        string;
  senderName:      string;
  text:            string;
  isFromBot:       boolean;
  isMedia:         boolean;
  mediaCaption:    string | null;
  isReply:         boolean;
  quotedMessageId: string | null;
  timestamp:       Date;
  rawPayload:      any;
}

export interface DetectedBet {
  messageId:   string;
  playerId:    string;
  playerName:  string;
  platform:    Platform;
  groupId:     string;
  game:        GameType;
  betAmount:   number;
  guess:       string | null;
  detectedAt:  Date;
}

export interface DetectedSpawn {
  spawnId:    string;
  cardName:   string;
  tier:       number;
  price:      number;
  issue:      number | null;
  groupId:    string;
  platform:   Platform;
  spawnTime:  Date;
  rawMessage: ParsedMessage;
}

export interface GamblingConfig {
  id:               number;
  gambling_enabled: boolean;
  max_bets_per_day: number;
  bet_percentage:   number;
  min_confidence:   number;
}

export interface GroupStats {
  group_id:          string;
  platform:          Platform;
  cards_per_hour:    number;
  our_claim_rate:    number;
  avg_competitor_ms: number;
  group_score:       number;
  suspected_bot:     boolean;
  updated_at:        string;
}

export interface GamblingRecommendation {
  shouldBet:   boolean;
  game:        string;
  betAmount:   number;
  guess:       string | null;
  confidence:  number;
  reasoning:   string;
}

export interface CardRecommendation {
  action:         'sell' | 'hold' | 'auction' | 'trade';
  suggestedPrice: number | null;
  confidence:     number;
  reasoning:      string;
}

export interface EventParseResult {
  eventType:      string;
  coinsInvolved:  number | null;
  confidence:     number;
  reasoning:      string;
}
