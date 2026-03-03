// Bulk embedding script — run once to embed all cards in the DB.
//
// Usage:
//   node --experimental-sqlite dist/assistant/embed.js
//   node --experimental-sqlite dist/assistant/embed.js --model=openai/text-embedding-3-small
//   node --experimental-sqlite dist/assistant/embed.js --batch=50 --concurrency=3
//
// Resumable: skips cards that already have an embedding for the chosen model.
// Stores Float32 vectors as BLOBs in card_embeddings table.

import fetch from "node-fetch";
import { getDb } from "../db/client.js";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/embeddings";
const DEFAULT_MODEL = "openai/text-embedding-3-small";
const DEFAULT_BATCH = 100;
const RETRY_LIMIT = 3;
const RETRY_DELAY_MS = 1000;

// ── Types ─────────────────────────────────────────────────────────────────────

interface CardRow {
  oracle_id: string;
  name: string;
  type_line: string;
  oracle_text: string | null;
  keywords: string;
}

interface EmbeddingResponse {
  data: Array<{ embedding: number[]; index: number }>;
  model: string;
  usage: { prompt_tokens: number; total_tokens: number };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseArgs(): { model: string; batchSize: number } {
  const modelArg = process.argv.find((a) => a.startsWith("--model="));
  const batchArg = process.argv.find((a) => a.startsWith("--batch="));
  return {
    model: modelArg ? modelArg.split("=")[1] : DEFAULT_MODEL,
    batchSize: batchArg ? parseInt(batchArg.split("=")[1]) : DEFAULT_BATCH,
  };
}

function apiKey(): string {
  const key =
    process.env.OPEN_ROUTER_KEY ??
    process.env.open_router_key ??
    process.env.OPENROUTER_API_KEY ??
    "";
  if (!key) throw new Error("No OpenRouter API key found. Set OPEN_ROUTER_KEY.");
  return key;
}

// Build the text to embed for a card — name + type + oracle text + keywords
function cardToText(card: CardRow): string {
  let keywords: string[] = [];
  try { keywords = JSON.parse(card.keywords ?? "[]"); } catch { /* ignore */ }

  const parts = [
    card.name,
    card.type_line,
    card.oracle_text?.trim() ?? "",
    keywords.length > 0 ? `Keywords: ${keywords.join(", ")}` : "",
  ].filter(Boolean);

  return parts.join(". ");
}

// Serialise a number[] to a Buffer of Float32 values
function toBlob(embedding: number[]): Buffer {
  const buf = Buffer.allocUnsafe(embedding.length * 4);
  for (let i = 0; i < embedding.length; i++) {
    buf.writeFloatLE(embedding[i], i * 4);
  }
  return buf;
}

async function embedBatch(
  texts: string[],
  model: string,
  key: string,
  attempt = 1
): Promise<number[][]> {
  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://github.com/maxtory/mtg",
      "X-Title": "MaxtoryMTG",
    },
    body: JSON.stringify({ model, input: texts }),
  });

  if (!res.ok) {
    const body = await res.text();
    if (attempt < RETRY_LIMIT && (res.status === 429 || res.status >= 500)) {
      const delay = RETRY_DELAY_MS * attempt;
      process.stderr.write(`  [retry ${attempt}/${RETRY_LIMIT}] status=${res.status}, waiting ${delay}ms\n`);
      await new Promise((r) => setTimeout(r, delay));
      return embedBatch(texts, model, key, attempt + 1);
    }
    throw new Error(`Embedding API error ${res.status}: ${body}`);
  }

  const data = (await res.json()) as EmbeddingResponse;
  // Sort by index to ensure correct order
  return data.data
    .sort((a, b) => a.index - b.index)
    .map((d) => d.embedding);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { model, batchSize } = parseArgs();
  const key = apiKey();
  const db = getDb();

  // Count total cards and already-embedded cards
  const total = (db.prepare("SELECT COUNT(*) as n FROM cards").get() as { n: number }).n;
  const done = (
    db.prepare("SELECT COUNT(*) as n FROM card_embeddings WHERE model = ?").get(model) as { n: number }
  ).n;

  console.log(`Cards total: ${total.toLocaleString()}`);
  console.log(`Already embedded (${model}): ${done.toLocaleString()}`);
  console.log(`To embed: ${(total - done).toLocaleString()}`);
  console.log(`Batch size: ${batchSize}`);
  console.log();

  if (done === total) {
    console.log("All cards already embedded. Nothing to do.");
    return;
  }

  const upsert = db.prepare(`
    INSERT INTO card_embeddings (oracle_id, model, embedding, dims)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(oracle_id) DO UPDATE SET
      model     = excluded.model,
      embedding = excluded.embedding,
      dims      = excluded.dims,
      created_at = datetime('now')
  `);

  let offset = 0;
  let totalEmbedded = 0;
  const startTime = Date.now();

  while (true) {
    // Fetch a batch of unembedded cards
    const cards = db.prepare(`
      SELECT oracle_id, name, type_line, oracle_text, keywords
      FROM cards
      WHERE oracle_id NOT IN (
        SELECT oracle_id FROM card_embeddings WHERE model = ?
      )
      ORDER BY edhrec_rank ASC NULLS LAST, name ASC
      LIMIT ?
    `).all(model, batchSize) as unknown as CardRow[];

    if (cards.length === 0) break;

    const texts = cards.map(cardToText);

    try {
      const embeddings = await embedBatch(texts, model, key);

      db.exec("BEGIN");
      try {
        for (let i = 0; i < cards.length; i++) {
          const blob = toBlob(embeddings[i]);
          upsert.run(cards[i].oracle_id, model, blob, embeddings[i].length);
        }
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }

      totalEmbedded += cards.length;
      offset += cards.length;

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const pct = (((done + totalEmbedded) / total) * 100).toFixed(1);
      process.stdout.write(
        `\r  Embedded ${(done + totalEmbedded).toLocaleString()} / ${total.toLocaleString()} (${pct}%) — ${elapsed}s elapsed`
      );
    } catch (err) {
      console.error(`\n  Error embedding batch at offset ${offset}:`, err);
      console.error("  Skipping batch and continuing...");
      offset += cards.length;
    }

    // Small delay to be polite to the API
    await new Promise((r) => setTimeout(r, 50));
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n\nDone. Embedded ${totalEmbedded.toLocaleString()} cards in ${elapsed}s.`);
}

main().catch((err) => {
  console.error("Embedding failed:", err);
  process.exit(1);
});
