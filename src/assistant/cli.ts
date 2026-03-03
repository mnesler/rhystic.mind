// CLI wrapper for the MTG Commander Assistant.
//
// Connects directly to the assistant logic (no HTTP hop needed) for
// interactive terminal use. Supports multi-turn conversation.
//
// Usage:
//   node --experimental-sqlite dist/assistant/cli.js
//   node --experimental-sqlite dist/assistant/cli.js "Build me a Kinnan combo deck"
//
// Press Ctrl+C or type "exit" / "quit" to end the session.

import "dotenv/config";
import * as readline from "readline";
import { warmCache } from "./vector.js";
import { classifyIntent } from "./intent.js";
import { retrieve } from "./retrieve.js";
import { buildContext, buildSystemPrompt } from "./context.js";
import { streamAnswer } from "./answer.js";
import {
  createSession,
  addUserMessage,
  addAssistantMessage,
} from "./conversation.js";

// ── ANSI colours ──────────────────────────────────────────────────────────────

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";

function dim(s: string) { return `${DIM}${s}${RESET}`; }
function bold(s: string) { return `${BOLD}${s}${RESET}`; }
function cyan(s: string) { return `${CYAN}${s}${RESET}`; }
function green(s: string) { return `${GREEN}${s}${RESET}`; }
function yellow(s: string) { return `${YELLOW}${s}${RESET}`; }
function red(s: string) { return `${RED}${s}${RESET}`; }

// ── Main ──────────────────────────────────────────────────────────────────────

async function runTurn(
  message: string,
  session: ReturnType<typeof createSession>
): Promise<void> {
  addUserMessage(session, message);

  // Step 1: classify intent
  process.stdout.write(dim("  Classifying intent..."));
  let intent;
  try {
    intent = await classifyIntent(message, session.history.slice(0, -1));
    process.stdout.write(`\r  ${dim("Intent:")} ${cyan(intent.type)}`);
    if (intent.commander) process.stdout.write(` ${dim("| Commander:")} ${cyan(intent.commander)}`);
    if (intent.tags.length > 0) process.stdout.write(` ${dim("| Tags:")} ${cyan(intent.tags.join(", "))}`);
    process.stdout.write("\n");
  } catch (err) {
    process.stdout.write(`\r  ${red("Intent classification failed:")} ${err}\n`);
    return;
  }

  // Step 2: retrieve
  process.stdout.write(dim("  Retrieving cards & combos..."));
  let result;
  try {
    result = await retrieve(intent);
    process.stdout.write(
      `\r  ${dim("Retrieved:")} ${cyan(String(result.cards.length))} cards, ${cyan(String(result.combos.length))} combos\n`
    );
    if (!result.hasEmbeddings) {
      process.stdout.write(
        yellow("  [no embeddings] Semantic search unavailable. Run `npm run embed:cards` for better results.\n")
      );
    }
  } catch (err) {
    process.stdout.write(`\r  ${red("Retrieval failed:")} ${err}\n`);
    return;
  }

  // Step 3: build context
  const context = buildContext(result, intent);
  const systemPrompt = buildSystemPrompt(intent);

  if (context.truncated) {
    process.stdout.write(dim("  [context truncated to fit token budget]\n"));
  }

  // Step 4: stream answer
  process.stdout.write(`\n${bold(green("Assistant"))}:\n`);

  let fullText = "";
  await streamAnswer(
    systemPrompt,
    context,
    session.history.slice(0, -1),
    message,
    {
      onToken: (token) => {
        process.stdout.write(token);
      },
      onDone: (text) => {
        fullText = text;
      },
      onError: (err) => {
        process.stdout.write(`\n${red("Stream error:")} ${err.message}\n`);
      },
    }
  );

  process.stdout.write("\n\n");
  addAssistantMessage(session, fullText);
}

async function main(): Promise<void> {
  console.log(`\n${bold("MTG Commander Assistant")}`);
  console.log(dim("Powered by your card database + OpenRouter"));
  console.log(dim('Type "exit" or press Ctrl+C to quit.\n'));

  // Warm vector cache in background
  setTimeout(() => {
    try {
      warmCache();
    } catch {
      // No embeddings — will warn per-query
    }
  }, 100);

  const session = createSession();

  // If a message was passed as a CLI argument, run it and exit
  const argMessage = process.argv.slice(2).join(" ").trim();
  if (argMessage && argMessage !== "") {
    await runTurn(argMessage, session);
    process.exit(0);
  }

  // Interactive REPL
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `${bold(cyan("You"))}: `,
  });

  rl.prompt();

  rl.on("line", async (line) => {
    const message = line.trim();
    if (!message) { rl.prompt(); return; }
    if (message === "exit" || message === "quit") {
      console.log(dim("Goodbye."));
      process.exit(0);
    }

    // Pause prompt while we're generating
    rl.pause();
    try {
      await runTurn(message, session);
    } catch (err) {
      console.error(red(`Error: ${err}`));
    }
    rl.resume();
    rl.prompt();
  });

  rl.on("close", () => {
    console.log(dim("\nGoodbye."));
    process.exit(0);
  });
}

main().catch((err) => {
  console.error(red(`Fatal: ${err}`));
  process.exit(1);
});
