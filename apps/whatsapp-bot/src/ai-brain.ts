// ============================================================
// apps/whatsapp-bot/src/ai-brain.ts
// Phase 2, Step 10 — OpenRouter AI module
// Three models, three jobs. All free tier.
// ============================================================

import { supabase, log } from './index';
import {
  OpenRouterModel, GamblingRecommendation,
  CardRecommendation, EventParseResult, Platform
} from './types';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

// ─── MODEL ASSIGNMENTS (from the bible) ──────────────────────
const MODELS = {
  gambling:     'liquid/lfm-2.5-1b-thinking'  as OpenRouterModel, // fast 0.44s
  cardAdvisor:  'openrouter/hunter-alpha'      as OpenRouterModel, // 1M ctx deep analysis
  eventParser:  'venice-uncensored/dolphin-mistral-24b-venice-edition' as OpenRouterModel,
};

// ─── BASE API CALL ───────────────────────────────────────────
async function callOpenRouter(
  model: OpenRouterModel,
  systemPrompt: string,
  userPrompt: string,
): Promise<{ text: string; tokensUsed: number; latencyMs: number }> {
  const start = Date.now();

  const res = await fetch(OPENROUTER_URL, {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type':  'application/json',
      'HTTP-Referer':  'https://tensura-bot.local',
      'X-Title':       'Tensura Domination Bot',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userPrompt },
      ],
      temperature: 0.2, // low temp = consistent decisions
      max_tokens:  512,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenRouter error ${res.status}: ${err}`);
  }

  const data = await res.json() as any;
  const text = data.choices?.[0]?.message?.content ?? '';
  const tokensUsed = data.usage?.total_tokens ?? 0;
  const latencyMs  = Date.now() - start;

  return { text, tokensUsed, latencyMs };
}

// ─── PARSE JSON SAFELY ───────────────────────────────────────
function parseJSON<T>(text: string): T | null {
  try {
    const clean = text.replace(/```json|```/g, '').trim();
    return JSON.parse(clean) as T;
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// 1. GAMBLING BRAIN
// Decides whether to bet, what game, how much
// Called before every potential bet
// ═══════════════════════════════════════════════════════════════
export async function getGamblingRecommendation(
  groupId:     string,
  currentBalance: number,
  config: { max_bets_per_day: number; bet_percentage: number; min_confidence: number },
  recentOutcomes: Array<{ game: string; outcome: string; payout: number }>
): Promise<GamblingRecommendation | null> {
  // Calculate bet amount (20% of balance by default)
  const betAmount = Math.floor(currentBalance * config.bet_percentage);
  if (betAmount < 100) {
    log.debug('Balance too low for gambling');
    return null;
  }

  const systemPrompt = `You are a gambling advisor for a WhatsApp game bot. 
Analyze recent gambling outcomes and decide if the bot should place a bet.
You MUST respond with valid JSON only. No explanation, no markdown, just JSON.

Game types: casino (2x), slots (2x), coinflip/cf (2x), dice (3x, guess 1-6), db (dice battle, draw possible), roulette

Rules:
- Only recommend betting if confidence >= ${config.min_confidence}
- Bet amount is fixed at $${betAmount} (${config.bet_percentage * 100}% of balance $${currentBalance})
- For coinflip: pick heads or tails based on recent patterns
- For dice: pick 1-6 based on recent patterns
- Prefer casino/slots when patterns are unclear (simplest games)`;

  const userPrompt = `Recent outcomes (newest first):
${recentOutcomes.slice(0, 20).map(o =>
  `${o.game}: ${o.outcome} (${o.payout > 0 ? '+' : ''}${o.payout})`
).join('\n')}

Current balance: $${currentBalance}
Bet amount: $${betAmount}

Respond with JSON:
{
  "shouldBet": true/false,
  "game": "casino|slots|coinflip|dice|db|roulette",
  "betAmount": ${betAmount},
  "guess": null or "heads"/"tails" for cf, "1"-"6" for dice/db,
  "confidence": 0.0-1.0,
  "reasoning": "one sentence"
}`;

  try {
    const { text, tokensUsed, latencyMs } = await callOpenRouter(
      MODELS.gambling, systemPrompt, userPrompt
    );

    const rec = parseJSON<GamblingRecommendation>(text);
    if (!rec) {
      log.warn('AI returned invalid JSON for gambling recommendation');
      return null;
    }

    // Log the decision
    await logAIDecision({
      model_used:     MODELS.gambling,
      decision_type:  'gambling',
      group_id:       groupId,
      input_summary:  `balance:${currentBalance} recent:${recentOutcomes.length}`,
      recommendation: rec,
      confidence:     rec.confidence,
      executed:       false,
      tokens_used:    tokensUsed,
      latency_ms:     latencyMs,
    });

    return rec;
  } catch (err) {
    log.error('AI gambling recommendation failed', err);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// 2. CARD VALUE ADVISOR
// Decides whether to sell, hold, auction, or trade a card
// ═══════════════════════════════════════════════════════════════
export async function getCardRecommendation(
  cardName: string,
  tier:     number,
  price:    number,
  issueNum: number | null,
): Promise<CardRecommendation | null> {
  const systemPrompt = `You are a card trading advisor for a WhatsApp anime card game (Tensura).
Cards have tiers 1-6 and Tier S (99). Higher tier = higher value. Lower issue numbers = rarer.
You MUST respond with valid JSON only.`;

  const userPrompt = `Card details:
Name: ${cardName}
Tier: ${tier === 99 ? 'S' : tier}
Market price: $${price}
Issue #: ${issueNum ?? 'unknown'}

Should I sell now, hold, auction, or trade this card?

Respond with JSON:
{
  "action": "sell|hold|auction|trade",
  "suggestedPrice": null or number,
  "confidence": 0.0-1.0,
  "reasoning": "one sentence"
}`;

  try {
    const { text, tokensUsed, latencyMs } = await callOpenRouter(
      MODELS.cardAdvisor, systemPrompt, userPrompt
    );

    const rec = parseJSON<CardRecommendation>(text);
    if (!rec) return null;

    await logAIDecision({
      model_used:     MODELS.cardAdvisor,
      decision_type:  'card',
      input_summary:  `${cardName} T${tier} $${price}`,
      recommendation: rec,
      confidence:     rec.confidence,
      executed:       false,
      tokens_used:    tokensUsed,
      latency_ms:     latencyMs,
    });

    return rec;
  } catch (err) {
    log.error('AI card recommendation failed', err);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// 3. EVENT PARSER
// Figures out what an unknown bot message means
// ═══════════════════════════════════════════════════════════════
export async function parseUnknownEvent(
  rawText: string,
  groupId: string,
): Promise<EventParseResult | null> {
  const systemPrompt = `You are analyzing messages from a WhatsApp anime game bot called Tensura.
The game involves coins, cards, gambling, fishing, and digging.
Identify what type of event this message represents.
You MUST respond with valid JSON only.`;

  const userPrompt = `Unknown bot message:
"${rawText}"

What type of event is this? Possible types: coin_drop, lottery, event_announcement, 
card_auction, quest, bonus, cooldown_notice, error, unknown

Respond with JSON:
{
  "eventType": "string",
  "coinsInvolved": null or number,
  "confidence": 0.0-1.0,
  "reasoning": "one sentence"
}`;

  try {
    const { text, tokensUsed, latencyMs } = await callOpenRouter(
      MODELS.eventParser, systemPrompt, userPrompt
    );

    const result = parseJSON<EventParseResult>(text);
    if (!result) return null;

    // Update the unprompted_event with the parsed type
    await supabase.from('unprompted_events')
      .update({ event_type: result.eventType })
      .eq('raw_text', rawText)
      .eq('group_id', groupId)
      .is('event_type', null);

    await logAIDecision({
      model_used:     MODELS.eventParser,
      decision_type:  'event_parse',
      group_id:       groupId,
      input_summary:  rawText.slice(0, 100),
      recommendation: result,
      confidence:     result.confidence,
      executed:       true,
      tokens_used:    tokensUsed,
      latency_ms:     latencyMs,
    });

    return result;
  } catch (err) {
    log.error('AI event parse failed', err);
    return null;
  }
}

// ─── LOG AI DECISION TO SUPABASE ─────────────────────────────
async function logAIDecision(data: {
  model_used:     string;
  decision_type:  string;
  group_id?:      string;
  input_summary:  string;
  recommendation: object;
  confidence:     number;
  executed:       boolean;
  skip_reason?:   string;
  tokens_used:    number;
  latency_ms:     number;
}): Promise<void> {
  await supabase.from('ai_decisions').insert({
    ...data,
    platform:   'whatsapp',
    created_at: new Date().toISOString(),
  });
}
