export async function applySchema(pool) {
    await pool.query(`
    -- Cards table
    CREATE TABLE IF NOT EXISTS cards (
      oracle_id      TEXT PRIMARY KEY,
      name           TEXT NOT NULL,
      mana_cost      TEXT,
      cmc            REAL NOT NULL DEFAULT 0,
      type_line      TEXT NOT NULL,
      oracle_text    TEXT,
      colors         TEXT NOT NULL DEFAULT '[]',
      color_identity TEXT NOT NULL DEFAULT '[]',
      keywords       TEXT NOT NULL DEFAULT '[]',
      power          TEXT,
      toughness      TEXT,
      loyalty        TEXT,
      produced_mana  TEXT,
      edhrec_rank    INTEGER,
      rarity         TEXT,
      set_code       TEXT,
      ingested_at    TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at     TIMESTAMP NOT NULL DEFAULT NOW()
    );

    -- Card Tags table
    CREATE TABLE IF NOT EXISTS card_tags (
      id         SERIAL PRIMARY KEY,
      oracle_id  TEXT NOT NULL REFERENCES cards(oracle_id) ON DELETE CASCADE,
      tag        TEXT NOT NULL,
      source     TEXT NOT NULL DEFAULT 'llm',
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      UNIQUE(oracle_id, tag)
    );
    CREATE INDEX IF NOT EXISTS idx_card_tags_oracle ON card_tags(oracle_id);
    CREATE INDEX IF NOT EXISTS idx_card_tags_tag ON card_tags(tag);

    -- Combos table
    CREATE TABLE IF NOT EXISTS combos (
      id             TEXT PRIMARY KEY,
      card_names     TEXT NOT NULL,
      produces       TEXT NOT NULL,
      description    TEXT,
      mana_needed    TEXT,
      color_identity TEXT NOT NULL DEFAULT '[]',
      popularity     INTEGER DEFAULT 0,
      bracket_tag    TEXT,
      ingested_at    TIMESTAMP NOT NULL DEFAULT NOW()
    );

    -- Combo Cards table
    CREATE TABLE IF NOT EXISTS combo_cards (
      combo_id   TEXT NOT NULL REFERENCES combos(id) ON DELETE CASCADE,
      card_name  TEXT NOT NULL,
      oracle_id  TEXT REFERENCES cards(oracle_id),
      PRIMARY KEY (combo_id, card_name)
    );
    CREATE INDEX IF NOT EXISTS idx_combo_cards_oracle ON combo_cards(oracle_id);
    CREATE INDEX IF NOT EXISTS idx_combo_cards_name ON combo_cards(card_name);

    -- Tagging Runs table
    CREATE TABLE IF NOT EXISTS tagging_runs (
      id           TEXT PRIMARY KEY,
      set_code     TEXT NOT NULL,
      started_at   TIMESTAMP NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMP,
      cards_tagged INTEGER DEFAULT 0,
      status       TEXT NOT NULL DEFAULT 'running'
    );

    -- Card Embeddings table
    CREATE TABLE IF NOT EXISTS card_embeddings (
      oracle_id   TEXT PRIMARY KEY REFERENCES cards(oracle_id) ON DELETE CASCADE,
      model       TEXT NOT NULL,
      embedding   BYTEA NOT NULL,
      dims        INTEGER NOT NULL,
      created_at  TIMESTAMP NOT NULL DEFAULT NOW()
    );

    -- Enable UUID extension if not exists
    CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
  `);
}
//# sourceMappingURL=schema.js.map