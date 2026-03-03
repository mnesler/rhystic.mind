// Retrieval layer — combines SQL queries and vector search.
//
// Given a structured Intent, retrieves the most relevant cards and combos
// from SQLite. All retrieved data is returned in a canonical shape that the
// context builder can format into a prompt.

import { getDb } from "../db/client.js";
import { searchByText, search, embedText } from "./vector.js";
import type { Intent } from "./intent.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RetrievedCard {
  oracle_id: string;
  name: string;
  mana_cost: string | null;
  cmc: number;
  type_line: string;
  oracle_text: string | null;
  color_identity: string; // JSON array string
  colors: string;
  edhrec_rank: number | null;
  rarity: string | null;
  power: string | null;
  toughness: string | null;
  loyalty: string | null;
  tags: string[];
  vectorScore?: number;
}

export interface RetrievedCombo {
  id: string;
  card_names: string[];
  produces: string[];
  description: string | null;
  mana_needed: string | null;
  color_identity: string[];
  popularity: number;
}

export interface RetrievalResult {
  cards: RetrievedCard[];
  combos: RetrievedCombo[];
  hasEmbeddings: boolean; // false if card_embeddings table is empty
}

// ── Helpers ───────────────────────────────────────────────────────────────────

interface RawCard {
  oracle_id: string;
  name: string;
  mana_cost: string | null;
  cmc: number;
  type_line: string;
  oracle_text: string | null;
  color_identity: string;
  colors: string;
  edhrec_rank: number | null;
  rarity: string | null;
  power: string | null;
  toughness: string | null;
  loyalty: string | null;
}

interface RawCombo {
  id: string;
  card_names: string;
  produces: string;
  description: string | null;
  mana_needed: string | null;
  color_identity: string;
  popularity: number;
}

interface TagRow {
  oracle_id: string;
  tag: string;
}

function jsonArr(s: string): string[] {
  try { return JSON.parse(s); } catch { return []; }
}

function colorFilter(colors: string[]): string {
  if (colors.length === 0) return "";
  // Match cards whose color_identity is a subset of the requested colors
  // We do this by checking JSON-stored array contains only allowed colors.
  // SQLite doesn't have JSON_EACH on all versions, so we use a LIKE approach.
  // For each required color we check color_identity contains it.
  // This is intentionally permissive — post-filter in JS if needed.
  return "";
}

function attachTags(cards: RawCard[]): RetrievedCard[] {
  if (cards.length === 0) return [];
  const db = getDb();
  const ids = cards.map((c) => `'${c.oracle_id.replace(/'/g, "''")}'`).join(",");
  const tagRows = db
    .prepare(`SELECT oracle_id, tag FROM card_tags WHERE oracle_id IN (${ids})`)
    .all() as unknown as TagRow[];

  const tagMap = new Map<string, string[]>();
  for (const row of tagRows) {
    const existing = tagMap.get(row.oracle_id) ?? [];
    existing.push(row.tag);
    tagMap.set(row.oracle_id, existing);
  }

  return cards.map((c) => ({
    ...c,
    tags: tagMap.get(c.oracle_id) ?? [],
  }));
}

function hasEmbeddings(): boolean {
  const db = getDb();
  const row = db
    .prepare("SELECT COUNT(*) as n FROM card_embeddings")
    .get() as { n: number };
  return row.n > 0;
}

// Deduplicate cards by oracle_id, keeping the one with the highest vectorScore
function dedupeCards(cards: RetrievedCard[]): RetrievedCard[] {
  const seen = new Map<string, RetrievedCard>();
  for (const card of cards) {
    const existing = seen.get(card.oracle_id);
    if (!existing || (card.vectorScore ?? 0) > (existing.vectorScore ?? 0)) {
      seen.set(card.oracle_id, card);
    }
  }
  return [...seen.values()];
}

// ── Intent-specific retrieval strategies ──────────────────────────────────────

async function retrieveCardLookup(intent: Intent): Promise<RetrievedCard[]> {
  const db = getDb();
  const results: RawCard[] = [];

  for (const name of intent.cardNames) {
    // Exact match first
    const exact = db
      .prepare("SELECT * FROM cards WHERE name = ? LIMIT 1")
      .get(name) as RawCard | undefined;
    if (exact) { results.push(exact); continue; }

    // Fuzzy LIKE fallback
    const fuzzy = db
      .prepare("SELECT * FROM cards WHERE name LIKE ? ORDER BY edhrec_rank ASC NULLS LAST LIMIT 3")
      .all(`%${name}%`) as unknown as RawCard[];
    results.push(...fuzzy);
  }

  // If no explicit names, fall back to semantic search
  if (results.length === 0 && hasEmbeddings()) {
    return retrieveByVector(intent.searchQuery, 10);
  }

  return attachTags(results);
}

async function retrieveDeckBuild(intent: Intent): Promise<{ cards: RetrievedCard[]; combos: RetrievedCombo[] }> {
  const db = getDb();
  let sqlCards: RawCard[] = [];
  let combos: RetrievedCombo[] = [];

  // 1. Look up the commander card
  if (intent.commander) {
    const cmd = db
      .prepare("SELECT * FROM cards WHERE name = ? LIMIT 1")
      .get(intent.commander) as RawCard | undefined;
    if (cmd) {
      sqlCards.push(cmd);
      // Get combos containing the commander
      const cmdCombos = db.prepare(`
        SELECT DISTINCT co.id, co.card_names, co.produces, co.description,
               co.mana_needed, co.color_identity, co.popularity
        FROM combos co
        JOIN combo_cards cc ON cc.combo_id = co.id
        WHERE cc.oracle_id = ?
        ORDER BY co.popularity DESC
        LIMIT 10
      `).all(cmd.oracle_id) as unknown as RawCombo[];
      combos = cmdCombos.map((r) => ({
        id: r.id,
        card_names: jsonArr(r.card_names),
        produces: jsonArr(r.produces),
        description: r.description,
        mana_needed: r.mana_needed,
        color_identity: jsonArr(r.color_identity),
        popularity: r.popularity,
      }));
    }
  }

  // 2. SQL: cards matching requested tags
  if (intent.tags.length > 0) {
    const tagPlaceholders = intent.tags.map(() => "?").join(",");
    const tagCards = db.prepare(`
      SELECT DISTINCT c.* FROM cards c
      JOIN card_tags ct ON ct.oracle_id = c.oracle_id
      WHERE ct.tag IN (${tagPlaceholders})
      ORDER BY c.edhrec_rank ASC NULLS LAST
      LIMIT 40
    `).all(...intent.tags) as unknown as RawCard[];
    sqlCards.push(...tagCards);
  }

  // 3. Vector search for thematic similarity
  let vectorCards: RetrievedCard[] = [];
  if (hasEmbeddings()) {
    const query = [
      intent.commander ? `Cards that synergize with ${intent.commander}` : "",
      ...intent.themes,
      intent.searchQuery,
    ].filter(Boolean).join(". ");
    vectorCards = await retrieveByVector(query, 30);
  }

  const sqlWithTags = attachTags(sqlCards);
  const merged = dedupeCards([...sqlWithTags, ...vectorCards]);

  // Sort: vector score > edhrec_rank
  merged.sort((a, b) => {
    const scoreDiff = (b.vectorScore ?? 0) - (a.vectorScore ?? 0);
    if (Math.abs(scoreDiff) > 0.02) return scoreDiff;
    return (a.edhrec_rank ?? 999999) - (b.edhrec_rank ?? 999999);
  });

  return { cards: merged.slice(0, 50), combos };
}

async function retrieveComboFind(intent: Intent): Promise<{ cards: RetrievedCard[]; combos: RetrievedCombo[] }> {
  const db = getDb();
  const combos: RetrievedCombo[] = [];
  const relatedCards: RawCard[] = [];

  for (const name of intent.cardNames) {
    const card = db
      .prepare("SELECT oracle_id FROM cards WHERE name = ? LIMIT 1")
      .get(name) as { oracle_id: string } | undefined;

    if (card) {
      relatedCards.push(
        db.prepare("SELECT * FROM cards WHERE oracle_id = ?").get(card.oracle_id) as unknown as RawCard
      );

      const cardCombos = db.prepare(`
        SELECT DISTINCT co.id, co.card_names, co.produces, co.description,
               co.mana_needed, co.color_identity, co.popularity
        FROM combos co
        JOIN combo_cards cc ON cc.combo_id = co.id
        WHERE cc.oracle_id = ?
        ORDER BY co.popularity DESC
        LIMIT 15
      `).all(card.oracle_id) as unknown as RawCombo[];

      combos.push(...cardCombos.map((r) => ({
        id: r.id,
        card_names: jsonArr(r.card_names),
        produces: jsonArr(r.produces),
        description: r.description,
        mana_needed: r.mana_needed,
        color_identity: jsonArr(r.color_identity),
        popularity: r.popularity,
      })));
    }
  }

  // Also do semantic search for relevant combo pieces
  let vectorCards: RetrievedCard[] = [];
  if (hasEmbeddings()) {
    vectorCards = await retrieveByVector(intent.searchQuery, 15);
  }

  const merged = dedupeCards([...attachTags(relatedCards), ...vectorCards]);
  return { cards: merged, combos };
}

// Map well-known tag names to oracle_text keywords for the text-based fallback.
// This lets us do reasonable searches even when card_tags is empty.
const TAG_KEYWORDS: Record<string, string[]> = {
  removal:         ["destroy target", "exile target", "return target", "-1/-1", "damage to target creature"],
  wipe:            ["destroy all", "exile all", "deals damage to all", "each creature gets -"],
  ramp:            ["search your library for a", "land card", "add {", "mana to your"],
  draw:            ["draw a card", "draw cards", "draw two", "draw three"],
  counter:         ["counter target", "counter that", "countered"],
  tutor:           ["search your library for a card", "search your library for any card"],
  reanimation:     ["return target creature card from your graveyard", "from your graveyard to the battlefield"],
  protection:      ["hexproof", "shroud", "indestructible", "protection from"],
  "token-gen":     ["create a", "token", "put a", "token onto the battlefield"],
  "combo-piece":   ["infinite", "untap all", "untap target", "each time"],
  "win-condition": ["win the game", "loses the game", "damage equal to"],
  stax:           ["each player can't", "can't cast", "players can't", "your opponents can't"],
  mill:            ["put the top", "cards of your library into your graveyard", "mill"],
  flicker:         ["exile target", "return it to the battlefield", "blink"],
  "mana-rock":     ["add {", "{t}:", "artifact"],
  "mana-dork":     ["{t}: add {", "creature"],
  recursion:       ["return target", "from your graveyard"],
  "land-fetch":    ["search your library for a", "land", "put it onto the battlefield"],
  "extra-turn":    ["take an extra turn", "takes an extra turn"],
  anthem:          ["other creatures you control get +", "creatures you control get +"],
  cantrip:         ["draw a card"],
};

// Build a simple oracle_text LIKE filter from tags and themes.
// Returns rows ordered by edhrec_rank with optional color filter applied in JS.
async function retrieveTagSearchTextFallback(intent: Intent): Promise<RetrievedCard[]> {
  const db = getDb();

  // Collect all keyword phrases to search for
  const keywordPhrases: string[] = [];
  for (const tag of intent.tags) {
    const kws = TAG_KEYWORDS[tag] ?? [tag];
    keywordPhrases.push(...kws);
  }
  // Also include themes as free-form keywords
  for (const theme of intent.themes) {
    keywordPhrases.push(theme);
  }

  if (keywordPhrases.length === 0) {
    // Absolutely nothing to go on — vector search or empty
    return hasEmbeddings() ? retrieveByVector(intent.searchQuery, 20) : [];
  }

  // Build OR conditions for each keyword phrase
  const conditions = keywordPhrases.map(() => "lower(c.oracle_text) LIKE ?").join(" OR ");
  const params: string[] = keywordPhrases.map((kw) => `%${kw.toLowerCase()}%`);

  // Optional CMC filter if the user mentioned budget/cheap
  let cmcClause = "";
  if (intent.budget) cmcClause = " AND c.cmc <= 3";

  const sql = `
    SELECT c.* FROM cards c
    WHERE (${conditions})${cmcClause}
    ORDER BY c.edhrec_rank ASC NULLS LAST
    LIMIT 80
  `;

  const rows = db.prepare(sql).all(...params) as unknown as RawCard[];

  // Post-filter by color identity
  let filtered = rows;
  if (intent.colors.length > 0) {
    const allowed = new Set(intent.colors);
    filtered = rows.filter((c) => {
      const ci = jsonArr(c.color_identity);
      // A colorless card (empty ci) is always allowed
      if (ci.length === 0) return true;
      return ci.every((color) => allowed.has(color));
    });
  }

  const result = attachTags(filtered.slice(0, 30));

  // If we got very few results, also blend in vector search
  if (result.length < 10 && hasEmbeddings()) {
    const vectorCards = await retrieveByVector(intent.searchQuery, 20);
    return dedupeCards([...result, ...vectorCards]).slice(0, 30);
  }

  return result;
}

function isTagTableEmpty(): boolean {
  const db = getDb();
  const row = db.prepare("SELECT COUNT(*) as n FROM card_tags").get() as { n: number };
  return row.n === 0;
}

async function retrieveTagSearch(intent: Intent): Promise<RetrievedCard[]> {
  const db = getDb();

  if (intent.tags.length === 0 && intent.themes.length === 0) {
    // No tags, no themes — semantic fallback only
    return hasEmbeddings() ? retrieveByVector(intent.searchQuery, 20) : [];
  }

  // If card_tags is empty, use the text-based keyword fallback
  if (isTagTableEmpty()) {
    return retrieveTagSearchTextFallback(intent);
  }

  // Normal path: card_tags is populated
  // Build color identity filter if colors provided
  // We load a broader set and post-filter in JS for correctness
  const tagPlaceholders = intent.tags.map(() => "?").join(",");
  const query = `
    SELECT DISTINCT c.* FROM cards c
    JOIN card_tags ct ON ct.oracle_id = c.oracle_id
    WHERE ct.tag IN (${tagPlaceholders})
  `;

  const rows = db.prepare(query + " ORDER BY c.edhrec_rank ASC NULLS LAST LIMIT 60")
    .all(...intent.tags) as unknown as RawCard[];

  // Post-filter by color identity if requested
  let filtered = rows;
  if (intent.colors.length > 0) {
    const allowed = new Set(intent.colors);
    filtered = rows.filter((c) => {
      const ci = jsonArr(c.color_identity);
      return ci.every((color) => allowed.has(color));
    });
  }

  const result = attachTags(filtered.slice(0, 30));

  // Blend in vector search if available and we have room
  if (result.length < 20 && hasEmbeddings()) {
    const vectorCards = await retrieveByVector(intent.searchQuery, 20);
    return dedupeCards([...result, ...vectorCards]).slice(0, 30);
  }

  return result;
}

async function retrieveByVector(query: string, topK: number): Promise<RetrievedCard[]> {
  const db = getDb();
  const matches = await searchByText(query, topK);

  if (matches.length === 0) return [];

  const ids = matches.map((m) => `'${m.oracle_id.replace(/'/g, "''")}'`).join(",");
  const cards = db
    .prepare(`SELECT * FROM cards WHERE oracle_id IN (${ids})`)
    .all() as unknown as RawCard[];

  const withTags = attachTags(cards);

  // Attach vector scores
  const scoreMap = new Map(matches.map((m) => [m.oracle_id, m.score]));
  for (const card of withTags) {
    card.vectorScore = scoreMap.get(card.oracle_id);
  }

  withTags.sort((a, b) => (b.vectorScore ?? 0) - (a.vectorScore ?? 0));
  return withTags;
}

// ── Public entry point ────────────────────────────────────────────────────────

export async function retrieve(intent: Intent): Promise<RetrievalResult> {
  const embeds = hasEmbeddings();

  switch (intent.type) {
    case "card-lookup": {
      const cards = await retrieveCardLookup(intent);
      return { cards, combos: [], hasEmbeddings: embeds };
    }

    case "deck-build": {
      const { cards, combos } = await retrieveDeckBuild(intent);
      return { cards, combos, hasEmbeddings: embeds };
    }

    case "combo-find": {
      const { cards, combos } = await retrieveComboFind(intent);
      return { cards, combos, hasEmbeddings: embeds };
    }

    case "tag-search": {
      const cards = await retrieveTagSearch(intent);
      return { cards, combos: [], hasEmbeddings: embeds };
    }

    case "power-assess": {
      // For power assessment, retrieve the mentioned cards + their combos
      const cards = await retrieveCardLookup(intent);
      const db = getDb();
      const combos: RetrievedCombo[] = [];
      for (const card of cards) {
        const cardCombos = db.prepare(`
          SELECT DISTINCT co.id, co.card_names, co.produces, co.description,
                 co.mana_needed, co.color_identity, co.popularity
          FROM combos co
          JOIN combo_cards cc ON cc.combo_id = co.id
          WHERE cc.oracle_id = ?
          ORDER BY co.popularity DESC LIMIT 5
        `).all(card.oracle_id) as unknown as RawCombo[];
        combos.push(...cardCombos.map((r) => ({
          id: r.id,
          card_names: jsonArr(r.card_names),
          produces: jsonArr(r.produces),
          description: r.description,
          mana_needed: r.mana_needed,
          color_identity: jsonArr(r.color_identity),
          popularity: r.popularity,
        })));
      }
      return { cards, combos, hasEmbeddings: embeds };
    }

    case "general":
    default: {
      // Semantic search only
      const cards = embeds
        ? await retrieveByVector(intent.searchQuery, 20)
        : [];
      return { cards, combos: [], hasEmbeddings: embeds };
    }
  }
}
