// Context builder — formats retrieved cards and combos into a prompt block.
//
// Stays within a token budget so we don't blow the LLM context window.
// Rough estimate: 1 token ≈ 4 chars. Budget: 4000 tokens ≈ 16,000 chars.
//
// Priority order:
//   1. Cards matching by name (exact lookup)
//   2. Combo entries
//   3. Vector-matched cards (trimmed if budget exceeded)

import type { RetrievalResult, RetrievedCard, RetrievedCombo } from "./retrieve.js";
import type { Intent } from "./intent.js";
import type { LoadedDeck } from "../deck/types.js";

const CHAR_BUDGET = 14_000; // ~3500 tokens, leaves room for system + user message

// ── Card formatter ────────────────────────────────────────────────────────────

function formatCard(card: RetrievedCard, includeVectorScore = false): string {
  const lines: string[] = [];

  const costStr = card.mana_cost ? ` ${card.mana_cost}` : "";
  const cmcStr = ` (CMC ${card.cmc})`;
  lines.push(`### ${card.name}${costStr}${cmcStr}`);
  lines.push(`Type: ${card.type_line}`);

  // Add power/toughness for creatures or loyalty for planeswalkers
  if (card.power !== null && card.toughness !== null) {
    lines.push(`Stats: ${card.power}/${card.toughness}`);
  }
  if (card.loyalty !== null) {
    lines.push(`Loyalty: ${card.loyalty}`);
  }

  if (card.oracle_text) {
    lines.push(`Text: ${card.oracle_text.trim()}`);
  }

  const ci = parseJson<string[]>(card.color_identity);
  if (ci.length > 0) lines.push(`Color Identity: ${ci.join("")}`);

  if (card.tags.length > 0) {
    lines.push(`Tags: ${card.tags.join(", ")}`);
  }

  if (card.edhrec_rank) lines.push(`EDHREC rank: #${card.edhrec_rank.toLocaleString()}`);

  if (includeVectorScore && card.vectorScore !== undefined) {
    lines.push(`Relevance: ${(card.vectorScore * 100).toFixed(1)}%`);
  }

  return lines.join("\n");
}

// ── Combo formatter ───────────────────────────────────────────────────────────

function formatCombo(combo: RetrievedCombo): string {
  const lines: string[] = [];
  lines.push(`### Combo: ${combo.card_names.join(" + ")}`);
  lines.push(`Produces: ${combo.produces.join("; ")}`);
  if (combo.mana_needed) lines.push(`Mana needed: ${combo.mana_needed}`);
  if (combo.description) lines.push(`Steps: ${combo.description.trim()}`);
  if (combo.color_identity.length > 0) {
    lines.push(`Color identity: ${combo.color_identity.join("")}`);
  }
  return lines.join("\n");
}

// ── JSON helper ───────────────────────────────────────────────────────────────

function parseJson<T>(s: string): T {
  try { return JSON.parse(s) as T; } catch { return [] as unknown as T; }
}

// ── Main export ───────────────────────────────────────────────────────────────

export interface BuiltContext {
  text: string;          // the full context block to inject into the prompt
  cardCount: number;
  comboCount: number;
  truncated: boolean;    // true if we hit the budget and trimmed some results
}

export function buildContext(result: RetrievalResult, intent: Intent): BuiltContext {
  const sections: string[] = [];
  let charCount = 0;
  let truncated = false;

  // ── Header ────────────────────────────────────────────────────────────────
  const header = [
    "The following data was retrieved from your MTG card database.",
    "Use it to inform your answer. Do not invent card names or rules text —",
    "if a card is not in the data below, say so.",
    "",
  ].join("\n");
  sections.push(header);
  charCount += header.length;

  // ── Combos first (they're concise and high-value) ─────────────────────────
  const formattedCombos: string[] = [];
  for (const combo of result.combos) {
    const text = formatCombo(combo);
    if (charCount + text.length > CHAR_BUDGET) { truncated = true; break; }
    formattedCombos.push(text);
    charCount += text.length + 2;
  }

  if (formattedCombos.length > 0) {
    sections.push(`## Combos (${formattedCombos.length})\n\n${formattedCombos.join("\n\n")}`);
  }

  // ── Cards ─────────────────────────────────────────────────────────────────
  const formattedCards: string[] = [];
  for (const card of result.cards) {
    const text = formatCard(card, intent.type === "deck-build" || intent.type === "general");
    if (charCount + text.length > CHAR_BUDGET) { truncated = true; break; }
    formattedCards.push(text);
    charCount += text.length + 2;
  }

  if (formattedCards.length > 0) {
    sections.push(`## Cards (${formattedCards.length})\n\n${formattedCards.join("\n\n")}`);
  }

  if (truncated) {
    sections.push("\n*[Some results were omitted to stay within context limits.]*");
  }

  if (result.cards.length === 0 && result.combos.length === 0) {
    sections.push("*No relevant cards or combos found in the database for this query.*");
  }

  return {
    text: sections.join("\n\n"),
    cardCount: formattedCards.length,
    comboCount: formattedCombos.length,
    truncated,
  };
}

// ── System prompt for the answer LLM ─────────────────────────────────────────

// ── Deck system prompt block ──────────────────────────────────────────────────

/**
 * Formats the loaded deck into a system prompt block that the LLM can see.
 * This lets the LLM know exactly what is already in the deck so it can make
 * targeted suggestions (add cards, remove cards, identify gaps, etc.).
 */
export function buildDeckSystemBlock(deck: LoadedDeck): string {
  const lines: string[] = [];

  const deckLabel = deck.name ? `"${deck.name}"` : "the loaded deck";

  if (deck.commanders.length > 0) {
    lines.push(`Commander(s): ${deck.commanders.join(" / ")}`);
  }

  lines.push(`Total cards (excluding commander): ${deck.cardCount}`);
  if (deck.source === "moxfield" && deck.moxfieldUrl) {
    lines.push(`Source: ${deck.moxfieldUrl}`);
  }

  // Group cards by section and type for readability
  const sections = new Map<string, string[]>();
  for (const card of deck.cards) {
    if (card.section === "commander" || card.section === "companion") continue;
    const key = card.section === "mainboard" ? "Mainboard" : card.section.charAt(0).toUpperCase() + card.section.slice(1);
    if (!sections.has(key)) sections.set(key, []);
    sections.get(key)!.push(`${card.quantity}x ${card.name}`);
  }

  for (const [sectionName, cardLines] of sections) {
    lines.push(`\n### ${sectionName} (${cardLines.length} entries)`);
    lines.push(cardLines.join("\n"));
  }

  return [
    `The user has loaded ${deckLabel} for analysis.`,
    "You have full visibility of this deck. When answering:",
    "- Reference specific cards already in the deck by name.",
    "- Suggest additions that complement what is already there.",
    "- Identify gaps (e.g. missing ramp, removal, card draw) based on what is present.",
    "- If suggesting replacements, name both the card to add and the card to cut.",
    "",
    "## Current Deck",
    lines.join("\n"),
  ].join("\n");
}

export type ResponseMode = "succinct" | "verbose" | "gooper";

export function buildSystemPrompt(intent: Intent, mode: ResponseMode = "succinct"): string {
  // Gooper mode: LLM returns only card names, no prose.
  if (mode === "gooper") {
    return [
      "You are an expert Magic: The Gathering Commander assistant.",
      "",
      "IMPORTANT: Your response must be ONLY a plain comma-separated list of Magic card names",
      "that are relevant to the user's question. No prose, no explanations, no markdown,",
      "no bullet points, no numbers — just card names separated by commas.",
      "Example output: Sol Ring, Arcane Signet, Cultivate, Kodama's Reach",
      "If you reference a card, use its exact printed name.",
      "Return at least 4 and at most 20 card names.",
    ].join("\n");
  }

  const verbosityGuideline = mode === "verbose"
    ? "- Be thorough. Provide full explanations with clear reasoning for every recommendation."
    : "- Be as succinct as possible. Shortest accurate answer wins — no padding, no preamble, no restating the question.";

  const base = [
    "You are an expert Magic: The Gathering Commander assistant.",
    "You have deep knowledge of MTG rules, card interactions, deck archetypes,",
    "and competitive/casual Commander formats.",
    "",
    "Guidelines:",
    "- Base your answers on the card data provided in the context block.",
    "- If you reference a card, use its exact printed name.",
    "- For deck suggestions, explain WHY each card is recommended.",
    "- For combos, explain the combo pieces and how they interact step by step.",
    verbosityGuideline,
    "- Use markdown formatting for readability.",
    "- If you're unsure about something, say so — don't invent rules or card text.",
  ].join("\n");

  // Intent-specific addenda (not applied in gooper mode — already handled above)
  const addenda: Record<string, string> = {
    "deck-build": "\n\nWhen building a deck list, organise cards by category (ramp, draw, removal, combo, etc.) and aim for 99 cards plus the commander.",
    "combo-find": "\n\nWhen explaining combos, list each required piece, the steps to assemble it, what it produces, and how to win from that position.",
    "power-assess": "\n\nWhen assessing power level, consider: combo presence, interaction density, mana efficiency, consistency, and speed. Use Commander brackets (1–4) as a reference.",
    "tag-search": "\n\nPresent the cards in a clean list with brief explanations of why each fits the search criteria.",
  };

  return base + (addenda[intent.type] ?? "");
}
