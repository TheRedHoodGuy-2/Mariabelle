

-- ─── 12. AI DECISIONS ────────────────────────────────────────
-- Every AI recommendation made by the OpenRouter models.
-- Tracks decision quality over time — feeds back into model prompts.
CREATE TABLE IF NOT EXISTS ai_decisions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_used        TEXT NOT NULL,           -- e.g. 'liquid/lfm-2.5-1b-thinking'
  decision_type     TEXT NOT NULL            -- 'gambling' | 'card' | 'event_parse'
                    CHECK (decision_type IN ('gambling', 'card', 'event_parse')),
  platform          TEXT,
  group_id          TEXT,
  input_summary     TEXT,                    -- what was sent to the AI (last N outcomes etc)
  recommendation    JSONB,                   -- full AI response as JSON
  confidence        FLOAT,                   -- 0.0 to 1.0
  executed          BOOLEAN DEFAULT FALSE,   -- did we actually follow the recommendation?
  skip_reason       TEXT,                    -- why we didn't execute (confidence too low etc)
  actual_outcome    TEXT,                    -- what actually happened after execution
  tokens_used       INT,
  latency_ms        INT,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

ALTER PUBLICATION supabase_realtime ADD TABLE ai_decisions;
ALTER TABLE ai_decisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow read for anon" ON ai_decisions FOR SELECT USING (TRUE);

-- ─── 13. GAMBLING CONFIG ─────────────────────────────────────
-- Adjustable gambling limits. Single row — updated from dashboard.
CREATE TABLE IF NOT EXISTS gambling_config (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  max_bets_per_day  INT NOT NULL DEFAULT 10,
  bet_percentage    FLOAT NOT NULL DEFAULT 0.20,  -- 0.20 = 20% of balance
  min_confidence    FLOAT NOT NULL DEFAULT 0.70,  -- AI confidence threshold
  gambling_enabled  BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- Seed with defaults
INSERT INTO gambling_config (max_bets_per_day, bet_percentage, min_confidence, gambling_enabled)
VALUES (10, 0.20, 0.70, TRUE)
ON CONFLICT DO NOTHING;

ALTER TABLE gambling_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow read for anon" ON gambling_config FOR SELECT USING (TRUE);
