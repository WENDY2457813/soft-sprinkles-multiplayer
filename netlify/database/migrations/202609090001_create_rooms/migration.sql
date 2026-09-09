CREATE TABLE IF NOT EXISTS game_rooms (
  code VARCHAR(4) PRIMARY KEY,
  state JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS game_rooms_updated_at_idx
  ON game_rooms(updated_at);
