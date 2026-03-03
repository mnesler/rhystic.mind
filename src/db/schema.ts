// Database schema definitions
// Run applySchema() once at startup to ensure all tables exist.

import type { DatabaseSync } from "node:sqlite";

export function applySchema(db: DatabaseSync): void {
  db.exec(`
    -- ── Cards ────────────────────────────────────────────────────────────────
    -- One row per oracle ID (unique card identity, not per printing).
    -- Only commander-legal cards are stored.
    CREATE TABLE IF NOT EXISTS cards (
      oracle_id      TEXT PRIMARY KEY,
      name           TEXT NOT NULL,
      mana_cost      TEXT,
      cmc            REAL NOT NULL DEFAULT 0,
      type_line      TEXT NOT NULL,
      oracle_text    TEXT,
      colors         TEXT NOT NULL DEFAULT '[]',   -- JSON: ["G","U"]
      color_identity TEXT NOT NULL DEFAULT '[]',   -- JSON: ["G","U","B"]
      keywords       TEXT NOT NULL DEFAULT '[]',   -- JSON: ["Flying","Trample"]
      power          TEXT,                          -- nullable, can be "*"
      toughness      TEXT,                          -- nullable, can be "*"
      loyalty        TEXT,                          -- planeswalkers only
      produced_mana  TEXT,                          -- JSON: ["G","C"]
      edhrec_rank    INTEGER,                       -- lower = more popular
      rarity         TEXT,                          -- common|uncommon|rare|mythic
      set_code       TEXT,                          -- most recognizable printing
      ingested_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ── Card Tags ─────────────────────────────────────────────────────────────
    -- One row per tag per card. Written by the LLM tagging pipeline.
    -- source = 'llm' | 'manual'
    CREATE TABLE IF NOT EXISTS card_tags (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      oracle_id  TEXT NOT NULL REFERENCES cards(oracle_id) ON DELETE CASCADE,
      tag        TEXT NOT NULL,
      source     TEXT NOT NULL DEFAULT 'llm',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(oracle_id, tag)
    );
    CREATE INDEX IF NOT EXISTS idx_card_tags_oracle ON card_tags(oracle_id);
    CREATE INDEX IF NOT EXISTS idx_card_tags_tag    ON card_tags(tag);

    -- ── Combos ───────────────────────────────────────────────────────────────
    -- One row per Commander Spellbook variant (combo).
    CREATE TABLE IF NOT EXISTS combos (
      id             TEXT PRIMARY KEY,             -- Spellbook variant ID
      card_names     TEXT NOT NULL,                -- JSON: ["Sol Ring","Hullbreaker Horror"]
      produces       TEXT NOT NULL,                -- JSON: ["Infinite colorless mana"]
      description    TEXT,                         -- step-by-step how-to
      mana_needed    TEXT,
      color_identity TEXT NOT NULL DEFAULT '[]',   -- JSON: ["U"]
      popularity     INTEGER DEFAULT 0,
      bracket_tag    TEXT,                         -- E|S|C power level indicator
      ingested_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ── Combo Cards ───────────────────────────────────────────────────────────
    -- Join table: which cards appear in which combos.
    -- oracle_id is resolved after card ingest via a reconciliation pass.
    CREATE TABLE IF NOT EXISTS combo_cards (
      combo_id   TEXT NOT NULL REFERENCES combos(id) ON DELETE CASCADE,
      card_name  TEXT NOT NULL,
      oracle_id  TEXT REFERENCES cards(oracle_id),
      PRIMARY KEY (combo_id, card_name)
    );
    CREATE INDEX IF NOT EXISTS idx_combo_cards_oracle ON combo_cards(oracle_id);
    CREATE INDEX IF NOT EXISTS idx_combo_cards_name   ON combo_cards(card_name);

    -- ── Tagging Runs ──────────────────────────────────────────────────────────
    -- Audit trail. One row per pipeline run; one run = one set.
    CREATE TABLE IF NOT EXISTS tagging_runs (
      id           TEXT PRIMARY KEY,               -- pipeline run ID from backend
      set_code     TEXT NOT NULL,
      started_at   TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT,
      cards_tagged INTEGER DEFAULT 0,
      status       TEXT NOT NULL DEFAULT 'running' -- running|completed|failed
    );

    -- ── Card Embeddings ───────────────────────────────────────────────────────
    -- One row per card. Stores the raw float32 embedding as a BLOB.
    -- model = the embedding model ID used (e.g. "openai/text-embedding-3-small")
    -- Re-run the embed script with a different model to update these rows.
    CREATE TABLE IF NOT EXISTS card_embeddings (
      oracle_id   TEXT PRIMARY KEY REFERENCES cards(oracle_id) ON DELETE CASCADE,
      model       TEXT NOT NULL,
      embedding   BLOB NOT NULL,                   -- Float32Array serialised to buffer
      dims        INTEGER NOT NULL,                -- vector dimensions (e.g. 1536)
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}
