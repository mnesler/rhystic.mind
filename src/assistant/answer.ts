// Streaming answer generator — LLM call #2.
//
// Takes the assembled context + conversation history, streams the LLM response
// token by token via Server-Sent Events or direct async iteration.
//
// Uses a more capable model than the intent classifier since this is where
// the actual reasoning and explanation happens.

import fetch from "node-fetch";
import type { ChatMessage } from "./intent.js";
import type { BuiltContext } from "./context.js";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const ANSWER_MODEL = process.env.ANSWER_MODEL ?? process.env.DEFAULT_MODEL ?? "moonshotai/kimi-k2";

// ── Types ─────────────────────────────────────────────────────────────────────

export type TokenCallback = (token: string) => void;
export type DoneCallback = (fullText: string) => void;

export interface StreamOptions {
  onToken: TokenCallback;
  onDone: DoneCallback;
  onError?: (err: Error) => void;
}

// ── API key ───────────────────────────────────────────────────────────────────

function apiKey(): string {
  const key =
    process.env.OPEN_ROUTER_KEY ??
    process.env.open_router_key ??
    process.env.OPENROUTER_API_KEY ??
    "";
  if (!key) throw new Error("No OpenRouter API key found. Set OPEN_ROUTER_KEY.");
  return key;
}

// ── Stream parser ─────────────────────────────────────────────────────────────
// OpenRouter streams SSE in OpenAI-compatible format:
// data: {"choices":[{"delta":{"content":"token"}}]}
// data: [DONE]

function parseSSEChunk(chunk: string): string[] {
  const tokens: string[] = [];
  const lines = chunk.split("\n");
  for (const line of lines) {
    if (!line.startsWith("data: ")) continue;
    const data = line.slice(6).trim();
    if (data === "[DONE]") continue;
    try {
      const parsed = JSON.parse(data) as {
        choices?: Array<{ delta?: { content?: string } }>;
      };
      const content = parsed.choices?.[0]?.delta?.content;
      if (content) tokens.push(content);
    } catch {
      // Ignore malformed chunks
    }
  }
  return tokens;
}

// ── Main streaming function ───────────────────────────────────────────────────

export async function streamAnswer(
  systemPrompt: string,
  context: BuiltContext,
  history: ChatMessage[],
  userMessage: string,
  opts: StreamOptions
): Promise<void> {
  const key = apiKey();

  // Build the messages array:
  // 1. System prompt (role + guidelines)
  // 2. Context block (injected as a system message so it doesn't muddy the conversation)
  // 3. Conversation history (up to last 10 turns to manage token cost)
  // 4. Current user message
  const messages: Array<{ role: string; content: string }> = [
    { role: "system", content: systemPrompt },
    { role: "system", content: context.text },
    ...history.slice(-10).map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: userMessage },
  ];

  let res: Awaited<ReturnType<typeof fetch>>;
  try {
    res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/maxtory/mtg",
        "X-Title": "MaxtoryMTG",
      },
      body: JSON.stringify({
        model: ANSWER_MODEL,
        messages,
        stream: true,
        temperature: 0.7,
        max_tokens: 2048,
      }),
    });
  } catch (err) {
    opts.onError?.(err instanceof Error ? err : new Error(String(err)));
    return;
  }

  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => "");
    opts.onError?.(new Error(`Answer API error ${res.status}: ${body}`));
    return;
  }

  let fullText = "";
  let buffer = "";

  try {
    for await (const chunk of res.body) {
      const text = Buffer.isBuffer(chunk)
        ? chunk.toString("utf-8")
        : String(chunk);
      buffer += text;

      // Process complete SSE lines
      const lastNewline = buffer.lastIndexOf("\n");
      if (lastNewline === -1) continue;

      const complete = buffer.slice(0, lastNewline + 1);
      buffer = buffer.slice(lastNewline + 1);

      const tokens = parseSSEChunk(complete);
      for (const token of tokens) {
        fullText += token;
        opts.onToken(token);
      }
    }

    // Process any remaining buffer
    if (buffer) {
      const tokens = parseSSEChunk(buffer);
      for (const token of tokens) {
        fullText += token;
        opts.onToken(token);
      }
    }

    opts.onDone(fullText);
  } catch (err) {
    opts.onError?.(err instanceof Error ? err : new Error(String(err)));
  }
}
