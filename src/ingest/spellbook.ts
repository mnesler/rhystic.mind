// Commander Spellbook combo ingest
//
// Paginates the Commander Spellbook /variants API, filters to commander-legal
// combos, and upserts them into the local SQLite DB.
// After all pages are fetched, runs a reconciliation pass to resolve
// combo_cards.oracle_id from the cards table.
//
// Resumable: counts existing combos and skips that many rows via API offset.
// Retries: 403/429/5xx are retried up to MAX_RETRIES times with exponential backoff.
//
// Usage:
//   node dist/ingest/spellbook.js

import fetch from "node-fetch";
import { getDb } from "../db/client.js";

const BASE_URL = "https://backend.commanderspellbook.com/variants";
const PAGE_SIZE = 100;
// Polite delay between pages
const PAGE_DELAY_MS = 500;
// Retry config
const MAX_RETRIES = 5;
const RETRY_BASE_MS = 5_000;

// ── Types ─────────────────────────────────────────────────────────────────────

interface SpellbookCard {
  card: {
    name: string;
    oracleId: string;
  };
}

interface SpellbookFeature {
  feature: { name: string };
}

interface SpellbookVariant {
  id: string;
  uses: SpellbookCard[];
  produces: SpellbookFeature[];
  description: string;
  manaNeeded: string;
  identity: string;           // color identity string e.g. "URG"
  popularity: number;
  bracketTag: string;
  legalities: Record<string, boolean>;
}

interface SpellbookPage {
  count: number;
  next: string | null;
  results: SpellbookVariant[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function j(value: unknown): string {
  return JSON.stringify(value ?? []);
}

function identityToArray(identity: string): string[] {
  return identity.split("").filter((c) => "WUBRG".includes(c));
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// Fetch with retry on transient errors (403, 429, 5xx)
async function fetchWithRetry(url: string, attempt = 1): Promise<SpellbookPage> {
  const res = await fetch(url, {
    headers: { "User-Agent": "MaxtoryMTG/1.0", Accept: "application/json" },
  });

  if (res.ok) {
    return res.json() as Promise<SpellbookPage>;
  }

  const retryable = res.status === 403 || res.status === 429 || res.status >= 500;
  if (retryable && attempt <= MAX_RETRIES) {
    const delay = RETRY_BASE_MS * Math.pow(2, attempt - 1);
    process.stderr.write(
      `\n  HTTP ${res.status} — retry ${attempt}/${MAX_RETRIES} in ${delay / 1000}s...\n`
    );
    await sleep(delay);
    return fetchWithRetry(url, attempt + 1);
  }

  throw new Error(`Spellbook API error: ${res.status} after ${attempt - 1} retries`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const db = getDb();

  const upsertCombo = db.prepare(`
    INSERT INTO combos (
      id, card_names, produces, description,
      mana_needed, color_identity, popularity, bracket_tag
    ) VALUES (
      @id, @card_names, @produces, @description,
      @mana_needed, @color_identity, @popularity, @bracket_tag
    )
    ON CONFLICT(id) DO UPDATE SET
      card_names     = excluded.card_names,
      produces       = excluded.produces,
      description    = excluded.description,
      mana_needed    = excluded.mana_needed,
      color_identity = excluded.color_identity,
      popularity     = excluded.popularity,
      bracket_tag    = excluded.bracket_tag
  `);

  const upsertComboCard = db.prepare(`
    INSERT OR IGNORE INTO combo_cards (combo_id, card_name)
    VALUES (@combo_id, @card_name)
  `);

  // Resume: count existing combos and start from that offset
  const existing = (db.prepare("SELECT COUNT(*) as n FROM combos").get() as { n: number }).n;
  const startOffset = existing;

  let url: string | null =
    `${BASE_URL}?format=json&limit=${PAGE_SIZE}&offset=${startOffset}`;
  let totalVariants = existing;
  let page = 0;

  if (existing > 0) {
    console.log(`Resuming from offset ${startOffset} (${existing} combos already in DB)...`);
  } else {
    console.log("Fetching Commander Spellbook combos...");
  }

  while (url) {
    page++;
    const data = await fetchWithRetry(url);
    const variants = data.results.filter((v) => v.legalities?.commander === true);

    db.exec("BEGIN");
    let inserted = 0;
    try {
      for (const v of variants) {
        const cardNames = v.uses.map((u) => u.card.name);
        const produces = v.produces.map((p) => p.feature.name);

        upsertCombo.run({
          id:             v.id,
          card_names:     j(cardNames),
          produces:       j(produces),
          description:    v.description ?? null,
          mana_needed:    v.manaNeeded ?? null,
          color_identity: j(identityToArray(v.identity ?? "")),
          popularity:     v.popularity ?? 0,
          bracket_tag:    v.bracketTag ?? null,
        });

        for (const name of cardNames) {
          upsertComboCard.run({ combo_id: v.id, card_name: name });
        }
        inserted++;
      }
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }

    totalVariants += inserted;
    const total = data.count ?? "?";
    process.stdout.write(`\r  Page ${page}: ${totalVariants}/${total} combos upserted...`);

    url = data.next ?? null;
    if (url) await sleep(PAGE_DELAY_MS);
  }

  console.log(`\nAll pages fetched. Total: ${totalVariants} combos.`);

  // ── Reconciliation pass ───────────────────────────────────────────────────
  console.log("Resolving oracle_ids for combo_cards...");
  const reconcile = db.prepare(`
    UPDATE combo_cards
    SET oracle_id = (
      SELECT oracle_id FROM cards WHERE cards.name = combo_cards.card_name
    )
    WHERE oracle_id IS NULL
  `);
  const { changes } = reconcile.run();
  console.log(`Resolved ${changes} combo_cards rows.`);

  const unresolved = db
    .prepare("SELECT COUNT(*) as n FROM combo_cards WHERE oracle_id IS NULL")
    .get() as { n: number };

  if (unresolved.n > 0) {
    console.log(
      `Note: ${unresolved.n} combo_cards rows still have no oracle_id ` +
        "(tokens/templates not in Scryfall oracle cards)."
    );
  }

  console.log("Done.");
}

main().catch((err) => {
  console.error("Spellbook ingest failed:", err);
  process.exit(1);
});
