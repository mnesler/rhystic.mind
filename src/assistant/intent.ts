// Intent classifier — LLM call #1.
//
// Takes the raw user message (+ conversation history for context) and returns
// a structured Intent object that the retrieval layer can act on.
//
// Using a small, fast model for this call since it's just classification.
// The full reasoning happens in answer.ts.

import fetch from "node-fetch";

// ── Types ─────────────────────────────────────────────────────────────────────

export type IntentType =
  | "card-lookup"    // "What does Sol Ring do?"
  | "deck-build"     // "Build me a Kinnan deck"
  | "combo-find"     // "What combos exist with Thassa's Oracle?"
  | "tag-search"     // "Show me all green ramp cards under 2 mana"
  | "power-assess"   // "Is this deck too powerful for a casual table?"
  | "general";       // Anything else / unclear

export interface Intent {
  type: IntentType;
  // Card names explicitly mentioned (normalised, may be empty)
  cardNames: string[];
  // Commander name if deck-building
  commander: string | null;
  // MTG color identities mentioned e.g. ["G","U"]
  colors: string[];
  // Tags from our vocabulary that map to the request
  tags: string[];
  // Free-form semantic themes for vector search
  themes: string[];
  // Whether the user is asking about budget constraints
  budget: boolean;
  // Raw reformulation of the query for vector search
  searchQuery: string;
}

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

// ── Prompt ────────────────────────────────────────────────────────────────────

const INTENT_SYSTEM_PROMPT = `You are an intent classifier for a Magic: The Gathering Commander assistant.

Given the user's message, extract a structured JSON intent object. Respond ONLY with valid JSON — no explanation, no markdown fences.

Intent type rules:
- "card-lookup": user asks about a SPECIFIC named card (e.g. "what does Sol Ring do?", "tell me about Rhystic Study")
- "deck-build": user wants to build a deck, often mentions a commander (e.g. "build me a Kinnan deck")
- "combo-find": user asks about combos involving specific cards (e.g. "what combos does Thassa's Oracle go in?")
- "tag-search": user wants cards fitting a CATEGORY or ROLE without naming specific cards (e.g. "show me ramp spells", "best removal under 3 mana", "white board wipes", "draw engines in blue")
- "power-assess": user wants to evaluate power level of a deck or card list
- "general": anything else — rules questions, strategy advice, comparisons

JSON schema:
{
  "type": "card-lookup" | "deck-build" | "combo-find" | "tag-search" | "power-assess" | "general",
  "cardNames": string[],       // ONLY explicitly named cards — empty if user is asking for suggestions
  "commander": string | null,  // commander name if deck-building
  "colors": string[],          // MTG color letters: W U B R G C (infer from color words like "white"→W, "blue"→U, etc.)
  "tags": string[],            // from: ramp, draw, removal, counter, tutor, reanimation, wipe, protection, token-gen, combo-piece, win-condition, disruption, recursion, cost-reduction, life-gain, life-drain, mill, flicker, copy, pump, stax, land-destruction, land-fetch, graveyard-hate, hand-disruption, extra-turn, anthem, mana-rock, mana-dork, mana-sink, free-spell, cantrip, land, etb-trigger, ltb-trigger, death-trigger, attack-trigger, upkeep-trigger, draw-trigger, activated-ability, tap-ability, static-ability, replacement-effect
  "themes": string[],          // free-form themes for semantic search e.g. "infinite mana", "aristocrats", "storm"
  "budget": boolean,           // true if user mentions budget, cheap, affordable
  "searchQuery": string        // a clean 1-2 sentence reformulation for semantic vector search
}`;

// ── API call ──────────────────────────────────────────────────────────────────

function apiKey(): string {
  const key =
    process.env.OPEN_ROUTER_KEY ??
    process.env.open_router_key ??
    process.env.OPENROUTER_API_KEY ??
    "";
  if (!key) throw new Error("No OpenRouter API key found. Set OPEN_ROUTER_KEY.");
  return key;
}

// Use a fast cheap model for intent parsing — accuracy > reasoning here
const INTENT_MODEL =
  process.env.INTENT_MODEL ?? "openai/gpt-4o-mini";

export async function classifyIntent(
  userMessage: string,
  history: ChatMessage[] = []
): Promise<Intent> {
  const key = apiKey();

  // Build a condensed history summary (last 4 turns) to give context for
  // follow-up questions without blowing the context window
  const recentHistory = history.slice(-8);
  const historyText =
    recentHistory.length > 0
      ? recentHistory
          .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
          .join("\n")
      : "";

  const userContent = historyText
    ? `Conversation so far:\n${historyText}\n\nNew message: ${userMessage}`
    : userMessage;

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://github.com/maxtory/mtg",
      "X-Title": "MaxtoryMTG",
    },
    body: JSON.stringify({
      model: INTENT_MODEL,
      messages: [
        { role: "system", content: INTENT_SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
      temperature: 0,
      max_tokens: 400,
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Intent API error ${res.status}: ${body}`);
  }

  const data = (await res.json()) as {
    choices: Array<{ message: { content: string } }>;
  };

  const raw = data.choices?.[0]?.message?.content ?? "{}";

  try {
    const parsed = JSON.parse(raw) as Partial<Intent>;
    return {
      type: parsed.type ?? "general",
      cardNames: parsed.cardNames ?? [],
      commander: parsed.commander ?? null,
      colors: parsed.colors ?? [],
      tags: parsed.tags ?? [],
      themes: parsed.themes ?? [],
      budget: parsed.budget ?? false,
      searchQuery: parsed.searchQuery ?? userMessage,
    };
  } catch {
    // Fallback: treat as a general semantic search
    return {
      type: "general",
      cardNames: [],
      commander: null,
      colors: [],
      tags: [],
      themes: [],
      budget: false,
      searchQuery: userMessage,
    };
  }
}
