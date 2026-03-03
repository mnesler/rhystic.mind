// Scryfall bulk-data ingest
//
// Downloads the oracle-cards bulk JSON from Scryfall, filters to
// commander-legal cards only, and upserts them into the local SQLite DB.
//
// Usage:
//   node dist/ingest/scryfall.js              # ingest all commander-legal cards
//   node dist/ingest/scryfall.js --set=dsk    # ingest only cards from set 'dsk'
//
// Scryfall rate-limit policy:
//   - The /bulk-data discovery endpoint counts as one API call.
//   - The actual bulk download comes from *.scryfall.io and has no rate limit.

import fetch from "node-fetch";
import { getDb } from "../db/client.js";

// ── Types (subset of Scryfall card object we care about) ──────────────────────

interface ScryfallCard {
  oracle_id: string;
  name: string;
  mana_cost?: string;
  cmc: number;
  type_line: string;
  oracle_text?: string;
  colors?: string[];
  color_identity: string[];
  keywords: string[];
  power?: string;
  toughness?: string;
  loyalty?: string;
  produced_mana?: string[];
  edhrec_rank?: number;
  rarity: string;
  set: string;
  legalities: Record<string, string>;
  // multi-face cards
  card_faces?: Array<{
    oracle_text?: string;
    mana_cost?: string;
    colors?: string[];
    power?: string;
    toughness?: string;
    loyalty?: string;
  }>;
}

interface BulkDataEntry {
  type: string;
  download_uri: string;
  updated_at: string;
}

interface BulkDataResponse {
  data: BulkDataEntry[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseArgs(): { setCode?: string } {
  const setArg = process.argv.find((a) => a.startsWith("--set="));
  return { setCode: setArg ? setArg.split("=")[1].toLowerCase() : undefined };
}

function j(value: unknown): string {
  return JSON.stringify(value ?? []);
}

// For double-faced cards, merge oracle text from all faces.
function resolveOracleText(card: ScryfallCard): string {
  if (card.oracle_text) return card.oracle_text;
  if (card.card_faces) {
    return card.card_faces
      .map((f) => f.oracle_text ?? "")
      .filter(Boolean)
      .join("\n//\n");
  }
  return "";
}

// For double-faced cards, colors live on faces not the root object.
function resolveColors(card: ScryfallCard): string[] {
  if (card.colors) return card.colors;
  if (card.card_faces) {
    const seen = new Set<string>();
    for (const face of card.card_faces) {
      for (const c of face.colors ?? []) seen.add(c);
    }
    return [...seen];
  }
  return [];
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { setCode } = parseArgs();
  const db = getDb();

  console.log("Fetching Scryfall bulk-data index...");
  const indexRes = await fetch("https://api.scryfall.com/bulk-data", {
    headers: {
      "User-Agent": "MaxtoryMTG/1.0",
      Accept: "application/json",
    },
  });

  if (!indexRes.ok) {
    throw new Error(`Scryfall bulk-data index failed: ${indexRes.status}`);
  }

  const index = (await indexRes.json()) as BulkDataResponse;
  const entry = index.data.find((d) => d.type === "oracle_cards");
  if (!entry) throw new Error("oracle_cards bulk entry not found in Scryfall response");

  console.log(`Downloading oracle_cards bulk file (updated ${entry.updated_at})...`);
  const bulkRes = await fetch(entry.download_uri, {
    headers: { "User-Agent": "MaxtoryMTG/1.0", Accept: "*/*" },
  });

  if (!bulkRes.ok || !bulkRes.body) {
    throw new Error(`Bulk download failed: ${bulkRes.status}`);
  }

  // Stream and accumulate the JSON text, then parse.
  // The file is ~162MB uncompressed; acceptable to buffer for a batch ingest.
  console.log("Streaming bulk data...");
  const chunks: Buffer[] = [];
  for await (const chunk of bulkRes.body) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
  }
  const raw = Buffer.concat(chunks).toString("utf-8");

  console.log("Parsing JSON...");
  const cards: ScryfallCard[] = JSON.parse(raw);
  console.log(`Total cards in bulk file: ${cards.length.toLocaleString()}`);

  // ── Filter ────────────────────────────────────────────────────────────────
  const filtered = cards.filter((c) => {
    if (c.legalities?.commander !== "legal") return false;
    if (setCode && c.set.toLowerCase() !== setCode) return false;
    return true;
  });

  console.log(
    `Commander-legal cards${setCode ? ` in set '${setCode}'` : ""}: ${filtered.length.toLocaleString()}`
  );

  // ── Upsert ────────────────────────────────────────────────────────────────
  const upsert = db.prepare(`
    INSERT INTO cards (
      oracle_id, name, mana_cost, cmc, type_line, oracle_text,
      colors, color_identity, keywords, power, toughness, loyalty,
      produced_mana, edhrec_rank, rarity, set_code, updated_at
    ) VALUES (
      @oracle_id, @name, @mana_cost, @cmc, @type_line, @oracle_text,
      @colors, @color_identity, @keywords, @power, @toughness, @loyalty,
      @produced_mana, @edhrec_rank, @rarity, @set_code, datetime('now')
    )
    ON CONFLICT(oracle_id) DO UPDATE SET
      name           = excluded.name,
      mana_cost      = excluded.mana_cost,
      cmc            = excluded.cmc,
      type_line      = excluded.type_line,
      oracle_text    = excluded.oracle_text,
      colors         = excluded.colors,
      color_identity = excluded.color_identity,
      keywords       = excluded.keywords,
      power          = excluded.power,
      toughness      = excluded.toughness,
      loyalty        = excluded.loyalty,
      produced_mana  = excluded.produced_mana,
      edhrec_rank    = excluded.edhrec_rank,
      rarity         = excluded.rarity,
      set_code       = excluded.set_code,
      updated_at     = datetime('now')
  `);

  console.log("Upserting into database...");
  db.exec("BEGIN");
  let upserted = 0;
  try {
    for (const card of filtered) {
      upsert.run({
        oracle_id:      card.oracle_id,
        name:           card.name,
        mana_cost:      card.mana_cost ?? null,
        cmc:            card.cmc,
        type_line:      card.type_line,
        oracle_text:    resolveOracleText(card),
        colors:         j(resolveColors(card)),
        color_identity: j(card.color_identity),
        keywords:       j(card.keywords),
        power:          card.power ?? null,
        toughness:      card.toughness ?? null,
        loyalty:        card.loyalty ?? null,
        produced_mana:  j(card.produced_mana),
        edhrec_rank:    card.edhrec_rank ?? null,
        rarity:         card.rarity,
        set_code:       card.set,
      });
      upserted++;
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  console.log(`Done. ${upserted.toLocaleString()} cards upserted.`);
}

main().catch((err) => {
  console.error("Ingest failed:", err);
  process.exit(1);
});
