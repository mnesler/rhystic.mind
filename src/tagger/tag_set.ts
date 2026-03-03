// LLM tagging CLI — called as a tool node by the attractor pipeline engine.
//
// Fetches one batch of untagged cards for a given set, calls the LLM for each,
// validates the tags against the fixed vocabulary, and writes them to the DB.
//
// Usage (called by the pipeline's tool node):
//   node dist/tagger/tag_set.js --set=dsk [--batch=20] [--run-id=<id>]
//
// Stdout (read by the pipeline engine via context.tool.output):
//   {"outcome":"more","tagged":20}   — more untagged cards remain
//   {"outcome":"done","tagged":5}    — set is fully tagged
//
// Exit code 0 on success, 1 on fatal error.

import fetch from "node-fetch";
import { getDb } from "../db/client.js";
import {
  buildSystemPrompt,
  buildUserPrompt,
  parseTagsFromResponse,
  type CardForTagging,
} from "./prompt.js";

// ── Config ────────────────────────────────────────────────────────────────────

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = process.env.DEFAULT_MODEL ?? "moonshotai/kimi-k2";
const DEFAULT_BATCH = 20;
// Delay between LLM calls — avoid hammering the API
const CALL_DELAY_MS = 150;

// ── Arg parsing ───────────────────────────────────────────────────────────────

function parseArgs(): { setCode: string; batchSize: number; runId: string | null } {
  const args = process.argv.slice(2);

  const setArg = args.find((a) => a.startsWith("--set="));
  const batchArg = args.find((a) => a.startsWith("--batch="));
  const runIdArg = args.find((a) => a.startsWith("--run-id="));

  if (!setArg) {
    console.error("Missing required argument: --set=<set_code>");
    process.exit(1);
  }

  return {
    setCode: setArg.split("=")[1].toLowerCase(),
    batchSize: batchArg ? parseInt(batchArg.split("=")[1]) : DEFAULT_BATCH,
    runId: runIdArg ? runIdArg.split("=")[1] : null,
  };
}

// ── LLM call ──────────────────────────────────────────────────────────────────

async function callLLM(card: CardForTagging): Promise<string> {
  const apiKey =
    process.env.OPEN_ROUTER_KEY ??
    process.env.open_router_key ??
    process.env.OPENROUTER_API_KEY ??
    "";

  if (!apiKey) {
    throw new Error(
      "No OpenRouter API key found. Set OPEN_ROUTER_KEY environment variable."
    );
  }

  const body = {
    model: DEFAULT_MODEL,
    messages: [
      { role: "system", content: buildSystemPrompt() },
      { role: "user", content: buildUserPrompt(card) },
    ],
    temperature: 0.1, // Low temperature for consistent, deterministic tag selection
    max_tokens: 200,  // Tags are short; a long response means something went wrong
  };

  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://github.com/maxtory/mtg",
      "X-Title": "MaxtoryMTG",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenRouter API error ${res.status}: ${text}`);
  }

  const data = (await res.json()) as {
    choices: Array<{ message: { content: string } }>;
  };

  return data.choices?.[0]?.message?.content ?? "";
}

// ── Delay helper ──────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { setCode, batchSize, runId } = parseArgs();
  const db = getDb();

  // Fetch a batch of untagged cards for this set
  const cards = db
    .prepare(
      `
      SELECT oracle_id, name, type_line, mana_cost, cmc, oracle_text, keywords
      FROM cards
      WHERE set_code = ?
        AND oracle_id NOT IN (SELECT DISTINCT oracle_id FROM card_tags)
      ORDER BY edhrec_rank ASC NULLS LAST, name ASC
      LIMIT ?
    `
    )
    .all(setCode, batchSize) as unknown as CardForTagging[];

  if (cards.length === 0) {
    // All cards in this set are tagged
    if (runId) {
      db.prepare(
        `UPDATE tagging_runs SET status = 'completed', completed_at = datetime('now') WHERE id = ?`
      ).run(runId);
    }
    process.stdout.write(JSON.stringify({ outcome: "done", tagged: 0 }));
    return;
  }

  // Ensure a tagging_runs row exists for this run
  if (runId) {
    db.prepare(
      `INSERT OR IGNORE INTO tagging_runs (id, set_code) VALUES (?, ?)`
    ).run(runId, setCode);
  }

  const insertTag = db.prepare(
    `INSERT OR IGNORE INTO card_tags (oracle_id, tag, source) VALUES (?, ?, 'llm')`
  );
  function insertTags(oracleId: string, tags: string[]): void {
    db.exec("BEGIN");
    try {
      for (const tag of tags) insertTag.run(oracleId, tag);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }

  let tagged = 0;

  for (const card of cards) {
    try {
      const responseText = await callLLM(card);
      const tags = parseTagsFromResponse(responseText);
      insertTags(card.oracle_id, tags);
      tagged++;

      // Log progress to stderr (not stdout — stdout is reserved for the pipeline)
      process.stderr.write(
        `  [${tagged}/${cards.length}] ${card.name}: ${tags.join(", ")}\n`
      );
    } catch (err) {
      // On LLM error: write needs-review and continue — don't fail the whole batch
      process.stderr.write(
        `  ERROR tagging ${card.name}: ${err}\n`
      );
      insertTags(card.oracle_id, ["needs-review"]);
      tagged++;
    }

    // Respect rate limits between calls
    if (tagged < cards.length) await sleep(CALL_DELAY_MS);
  }

  // Update run stats
  if (runId) {
    db.prepare(
      `UPDATE tagging_runs SET cards_tagged = cards_tagged + ? WHERE id = ?`
    ).run(tagged, runId);
  }

  // Check if the set is now fully tagged
  const remaining = (
    db
      .prepare(
        `
        SELECT COUNT(*) as n FROM cards
        WHERE set_code = ?
          AND oracle_id NOT IN (SELECT DISTINCT oracle_id FROM card_tags)
      `
      )
      .get(setCode) as { n: number }
  ).n;

  const outcome = remaining === 0 ? "done" : "more";

  if (outcome === "done" && runId) {
    db.prepare(
      `UPDATE tagging_runs SET status = 'completed', completed_at = datetime('now') WHERE id = ?`
    ).run(runId);
  }

  // Write result to stdout for the pipeline engine to read
  process.stdout.write(JSON.stringify({ outcome, tagged, remaining }));
}

main().catch((err) => {
  console.error("Tagging failed:", err);
  // Write a failure signal the pipeline can detect
  process.stdout.write(JSON.stringify({ outcome: "error", error: String(err) }));
  process.exit(1);
});
