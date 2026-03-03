import { describe, it, expect } from "vitest";
import { buildContext, buildSystemPrompt } from "./context.js";
import type { RetrievalResult, RetrievedCard, RetrievedCombo } from "./retrieve.js";
import type { Intent } from "./intent.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeCard(overrides: Partial<RetrievedCard> = {}): RetrievedCard {
  return {
    oracle_id: "abc-123",
    name: "Sol Ring",
    mana_cost: "{1}",
    cmc: 1,
    type_line: "Artifact",
    oracle_text: "{T}: Add {C}{C}.",
    color_identity: "[]",
    colors: "[]",
    edhrec_rank: 1,
    rarity: "uncommon",
    power: null,
    toughness: null,
    loyalty: null,
    tags: [],
    ...overrides,
  };
}

function makeCombo(overrides: Partial<RetrievedCombo> = {}): RetrievedCombo {
  return {
    id: "combo-1",
    card_names: ["Thassa's Oracle", "Demonic Consultation"],
    produces: ["Win the game"],
    description: "Cast Consultation naming a card not in your library, then Oracle ETB triggers.",
    mana_needed: "{U}{U}{B}",
    color_identity: ["U", "B"],
    popularity: 999,
    ...overrides,
  };
}

function makeIntent(overrides: Partial<Intent> = {}): Intent {
  return {
    type: "card-lookup",
    cardNames: [],
    commander: null,
    colors: [],
    tags: [],
    themes: [],
    budget: false,
    searchQuery: "test query",
    ...overrides,
  };
}

function makeResult(overrides: Partial<RetrievalResult> = {}): RetrievalResult {
  return {
    cards: [],
    combos: [],
    hasEmbeddings: false,
    ...overrides,
  };
}

// ── buildContext ──────────────────────────────────────────────────────────────

describe("buildContext", () => {
  it("returns a header even with no cards or combos", () => {
    const result = buildContext(makeResult(), makeIntent());
    expect(result.text).toContain("retrieved from your MTG card database");
    expect(result.cardCount).toBe(0);
    expect(result.comboCount).toBe(0);
    expect(result.truncated).toBe(false);
  });

  it("includes a no-results notice when both arrays are empty", () => {
    const result = buildContext(makeResult(), makeIntent());
    expect(result.text).toContain("No relevant cards or combos found");
  });

  it("formats a card's name, mana cost, and CMC", () => {
    const result = buildContext(makeResult({ cards: [makeCard()] }), makeIntent());
    expect(result.text).toContain("### Sol Ring");
    expect(result.text).toContain("{1}");
    expect(result.text).toContain("CMC 1");
    expect(result.cardCount).toBe(1);
  });

  it("formats a card's type line and oracle text", () => {
    const result = buildContext(makeResult({ cards: [makeCard()] }), makeIntent());
    expect(result.text).toContain("Type: Artifact");
    expect(result.text).toContain("Text: {T}: Add {C}{C}.");
  });

  it("includes EDHREC rank when present", () => {
    const result = buildContext(makeResult({ cards: [makeCard({ edhrec_rank: 42 })] }), makeIntent());
    expect(result.text).toContain("EDHREC rank: #42");
  });

  it("includes tags when present on a card", () => {
    const card = makeCard({ tags: ["mana-rock", "ramp"] });
    const result = buildContext(makeResult({ cards: [card] }), makeIntent());
    expect(result.text).toContain("Tags: mana-rock, ramp");
  });

  it("omits color identity line when color_identity is empty array", () => {
    const result = buildContext(makeResult({ cards: [makeCard({ color_identity: "[]" })] }), makeIntent());
    expect(result.text).not.toContain("Color Identity:");
  });

  it("includes color identity when present", () => {
    const card = makeCard({ color_identity: '["W","U"]' });
    const result = buildContext(makeResult({ cards: [card] }), makeIntent());
    expect(result.text).toContain("Color Identity: WU");
  });

  it("includes vector score for deck-build intent", () => {
    const card = makeCard({ vectorScore: 0.876 });
    const result = buildContext(
      makeResult({ cards: [card] }),
      makeIntent({ type: "deck-build" })
    );
    expect(result.text).toContain("Relevance: 87.6%");
  });

  it("does not include vector score for card-lookup intent", () => {
    const card = makeCard({ vectorScore: 0.876 });
    const result = buildContext(
      makeResult({ cards: [card] }),
      makeIntent({ type: "card-lookup" })
    );
    expect(result.text).not.toContain("Relevance:");
  });

  it("formats a combo with card names, produces, mana, and steps", () => {
    const result = buildContext(makeResult({ combos: [makeCombo()] }), makeIntent());
    expect(result.text).toContain("### Combo: Thassa's Oracle + Demonic Consultation");
    expect(result.text).toContain("Produces: Win the game");
    expect(result.text).toContain("Mana needed: {U}{U}{B}");
    expect(result.text).toContain("Steps:");
    expect(result.comboCount).toBe(1);
  });

  it("omits combo mana line when mana_needed is null", () => {
    const combo = makeCombo({ mana_needed: null });
    const result = buildContext(makeResult({ combos: [combo] }), makeIntent());
    expect(result.text).not.toContain("Mana needed:");
  });

  it("omits combo steps line when description is null", () => {
    const combo = makeCombo({ description: null });
    const result = buildContext(makeResult({ combos: [combo] }), makeIntent());
    expect(result.text).not.toContain("Steps:");
  });

  it("places combos before cards in output", () => {
    const result = buildContext(
      makeResult({ cards: [makeCard()], combos: [makeCombo()] }),
      makeIntent()
    );
    const comboPos = result.text.indexOf("## Combos");
    const cardPos = result.text.indexOf("## Cards");
    expect(comboPos).toBeLessThan(cardPos);
  });

  it("truncates and sets truncated=true when budget is exceeded", () => {
    // Create enough cards to blow past the 14,000 char budget
    const bigOracleText = "x".repeat(2000);
    const cards = Array.from({ length: 10 }, (_, i) =>
      makeCard({ oracle_id: `id-${i}`, name: `Card ${i}`, oracle_text: bigOracleText })
    );
    const result = buildContext(makeResult({ cards }), makeIntent());
    expect(result.truncated).toBe(true);
    expect(result.cardCount).toBeLessThan(10);
    expect(result.text).toContain("omitted to stay within context limits");
  });

  it("does not truncate when content fits within budget", () => {
    const cards = Array.from({ length: 3 }, (_, i) =>
      makeCard({ oracle_id: `id-${i}`, name: `Card ${i}` })
    );
    const result = buildContext(makeResult({ cards }), makeIntent());
    expect(result.truncated).toBe(false);
    expect(result.cardCount).toBe(3);
  });

  it("counts multiple cards correctly", () => {
    const cards = [
      makeCard({ oracle_id: "1", name: "Card A" }),
      makeCard({ oracle_id: "2", name: "Card B" }),
      makeCard({ oracle_id: "3", name: "Card C" }),
    ];
    const result = buildContext(makeResult({ cards }), makeIntent());
    expect(result.cardCount).toBe(3);
    expect(result.text).toContain("## Cards (3)");
  });

  it("counts multiple combos correctly", () => {
    const combos = [
      makeCombo({ id: "c1", card_names: ["A", "B"] }),
      makeCombo({ id: "c2", card_names: ["C", "D"] }),
    ];
    const result = buildContext(makeResult({ combos }), makeIntent());
    expect(result.comboCount).toBe(2);
    expect(result.text).toContain("## Combos (2)");
  });
});

// ── buildSystemPrompt ─────────────────────────────────────────────────────────

describe("buildSystemPrompt", () => {
  it("always includes the base role and guidelines", () => {
    const prompt = buildSystemPrompt(makeIntent());
    expect(prompt).toContain("expert Magic: The Gathering Commander assistant");
    expect(prompt).toContain("Guidelines:");
    expect(prompt).toContain("exact printed name");
  });

  it("instructs the model not to invent card text", () => {
    const prompt = buildSystemPrompt(makeIntent());
    expect(prompt).toContain("don't invent rules or card text");
  });

  it("appends deck-build instructions for deck-build intent", () => {
    const prompt = buildSystemPrompt(makeIntent({ type: "deck-build" }));
    expect(prompt).toContain("99 cards plus the commander");
    expect(prompt).toContain("organise cards by category");
  });

  it("appends combo instructions for combo-find intent", () => {
    const prompt = buildSystemPrompt(makeIntent({ type: "combo-find" }));
    expect(prompt).toContain("list each required piece");
    expect(prompt).toContain("how to win from that position");
  });

  it("appends power-level instructions for power-assess intent", () => {
    const prompt = buildSystemPrompt(makeIntent({ type: "power-assess" }));
    expect(prompt).toContain("Commander brackets");
    expect(prompt).toContain("mana efficiency");
  });

  it("appends tag-search presentation instructions for tag-search intent", () => {
    const prompt = buildSystemPrompt(makeIntent({ type: "tag-search" }));
    expect(prompt).toContain("clean list with brief explanations");
  });

  it("does not append any addendum for general intent", () => {
    const base = buildSystemPrompt(makeIntent({ type: "general" }));
    const withAddendum = buildSystemPrompt(makeIntent({ type: "deck-build" }));
    expect(base.length).toBeLessThan(withAddendum.length);
  });

  it("does not append any addendum for card-lookup intent", () => {
    const prompt = buildSystemPrompt(makeIntent({ type: "card-lookup" }));
    expect(prompt).not.toContain("99 cards");
    expect(prompt).not.toContain("list each required piece");
    expect(prompt).not.toContain("Commander brackets");
    expect(prompt).not.toContain("clean list");
  });

  it("returns a string for every intent type without throwing", () => {
    const types: Intent["type"][] = [
      "card-lookup", "deck-build", "combo-find", "tag-search", "power-assess", "general",
    ];
    for (const type of types) {
      expect(() => buildSystemPrompt(makeIntent({ type }))).not.toThrow();
      expect(typeof buildSystemPrompt(makeIntent({ type }))).toBe("string");
    }
  });
});
