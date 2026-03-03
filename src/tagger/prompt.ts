// Tag vocabulary and prompt construction for the LLM tagging pipeline.
//
// The LLM must return a JSON array of tags chosen exclusively from TAG_VOCABULARY.
// Tags outside the vocabulary are discarded silently.
// Cards that produce zero valid tags receive the sentinel tag "needs-review".

// ── Vocabulary ────────────────────────────────────────────────────────────────

export const TAG_VOCABULARY: ReadonlySet<string> = new Set([
  // Role — what the card does for your deck
  "ramp",
  "draw",
  "removal",
  "counter",
  "tutor",
  "reanimation",
  "wipe",
  "protection",
  "token-gen",
  "combo-piece",
  "win-condition",
  "disruption",
  "recursion",
  "cost-reduction",
  "life-gain",
  "life-drain",
  "mill",
  "flicker",
  "copy",
  "pump",
  "stax",
  "land-destruction",
  "land-fetch",
  "graveyard-hate",
  "hand-disruption",
  "extra-turn",
  "anthem",

  // Resource — what kind of resource this card is
  "mana-rock",
  "mana-dork",
  "mana-sink",
  "free-spell",
  "cantrip",
  "land",

  // Trigger / mechanic — when or how it works
  "etb-trigger",
  "ltb-trigger",
  "death-trigger",
  "attack-trigger",
  "upkeep-trigger",
  "draw-trigger",
  "activated-ability",
  "tap-ability",
  "static-ability",
  "replacement-effect",

  // Quantity qualifiers
  "draw-1",
  "draw-2",
  "draw-3",
  "draw-x",
  "damage-1",
  "damage-2",
  "damage-3",
  "damage-x",

  // Sentinel — assigned when no valid tag could be determined
  "needs-review",
]);

export const SORTED_VOCAB: string[] = [...TAG_VOCABULARY]
  .filter((t) => t !== "needs-review")
  .sort();

// ── Card data shape passed to prompt builder ──────────────────────────────────

export interface CardForTagging {
  oracle_id: string;
  name: string;
  type_line: string;
  mana_cost: string | null;
  cmc: number;
  oracle_text: string | null;
  keywords: string; // stored as JSON array string
}

// ── Prompt builder ────────────────────────────────────────────────────────────

export function buildSystemPrompt(): string {
  return [
    "You are a Magic: The Gathering card database tagger.",
    "You will be given a card and must return ONLY a valid JSON array of tags.",
    "Choose tags exclusively from the allowed vocabulary list provided.",
    "Do not explain your choices. Do not include any text outside the JSON array.",
    "Maximum 12 tags per card. Minimum 1.",
  ].join("\n");
}

export function buildUserPrompt(card: CardForTagging): string {
  let keywords: string[] = [];
  try {
    keywords = JSON.parse(card.keywords ?? "[]");
  } catch {
    keywords = [];
  }

  const lines: string[] = [
    `Card: ${card.name}`,
    `Type: ${card.type_line}`,
    `Mana cost: ${card.mana_cost ?? "(none)"} (CMC: ${card.cmc})`,
    `Oracle text: ${card.oracle_text?.trim() || "(none)"}`,
    `Keywords: ${keywords.length > 0 ? keywords.join(", ") : "(none)"}`,
    "",
    `Allowed tags: ${SORTED_VOCAB.join(", ")}`,
    "",
    "Return a JSON array of tags from the allowed list that describe what this card does.",
    "Only use tags from the allowed list. Maximum 12 tags.",
  ];

  return lines.join("\n");
}

// ── Response parser ───────────────────────────────────────────────────────────

/**
 * Parse the LLM response into a validated list of tags.
 * - Extracts the first JSON array found in the response text.
 * - Filters to only known vocabulary tags.
 * - Returns ["needs-review"] if nothing valid is found.
 */
export function parseTagsFromResponse(responseText: string): string[] {
  // Try to extract a JSON array from anywhere in the response
  const match = responseText.match(/\[[\s\S]*?\]/);
  if (!match) return ["needs-review"];

  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return ["needs-review"];
  }

  if (!Array.isArray(parsed)) return ["needs-review"];

  const valid = parsed
    .filter((t): t is string => typeof t === "string")
    .map((t) => t.toLowerCase().trim())
    .filter((t) => TAG_VOCABULARY.has(t));

  return valid.length > 0 ? valid : ["needs-review"];
}
