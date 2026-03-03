import { describe, it, expect } from "vitest";
import { parseDecklist } from "./parser.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const SIMPLE_LIST = `
// Commander
1 Atraxa, Praetors' Voice

// Mainboard
1 Sol Ring
1 Arcane Signet
3 Island
`;

const MOXFIELD_EXPORT = `
Commander (1)
1 Kenrith, the Returned King

Companion (1)
1 Lurrus of the Dream-Den

Deck (99)
1 Sol Ring
1 Arcane Signet
4 Plains
4 Island
4 Swamp
4 Mountain
4 Forest
1 Command Tower
`;

const INLINE_QUANTITY = `
// Commander
1x Thrasios, Triton Hero
1x Tymna the Weaver

// Mainboard
1x Sol Ring
4X Lightning Bolt
`;

const NO_COMMANDER = `
1 Sol Ring
1 Arcane Signet
1 Command Tower
`;

const WITH_SET_CODES = `
// Commander
1 Kinnan, Bonder Prodigy (IKO) 192

// Mainboard
1 Sol Ring (C21) 263
1 Basalt Monolith (C21) 290
`;

const SB_PREFIX = `
1 Sol Ring
SB: 1 Lightning Bolt
SB: 1 Counterspell
`;

// ── parseDecklist ─────────────────────────────────────────────────────────────

describe("parseDecklist", () => {
  it("parses a simple commander deck", () => {
    const { deck, warnings } = parseDecklist(SIMPLE_LIST);
    expect(deck.commanders).toEqual(["Atraxa, Praetors' Voice"]);
    expect(deck.cards.some((c) => c.name === "Sol Ring")).toBe(true);
    expect(deck.cards.some((c) => c.name === "Arcane Signet")).toBe(true);
    expect(warnings).toHaveLength(0);
  });

  it("assigns commander section correctly", () => {
    const { deck } = parseDecklist(SIMPLE_LIST);
    const cmd = deck.cards.find((c) => c.name === "Atraxa, Praetors' Voice");
    expect(cmd?.section).toBe("commander");
  });

  it("assigns mainboard section to non-commander cards", () => {
    const { deck } = parseDecklist(SIMPLE_LIST);
    const ring = deck.cards.find((c) => c.name === "Sol Ring");
    expect(ring?.section).toBe("mainboard");
  });

  it("handles 'Deck' section header as mainboard", () => {
    const { deck } = parseDecklist(MOXFIELD_EXPORT);
    const ring = deck.cards.find((c) => c.name === "Sol Ring");
    expect(ring?.section).toBe("mainboard");
  });

  it("handles 'Commander' section header", () => {
    const { deck } = parseDecklist(MOXFIELD_EXPORT);
    expect(deck.commanders).toEqual(["Kenrith, the Returned King"]);
  });

  it("handles 'Companion' section header", () => {
    const { deck } = parseDecklist(MOXFIELD_EXPORT);
    const comp = deck.cards.find((c) => c.name === "Lurrus of the Dream-Den");
    expect(comp?.section).toBe("companion");
  });

  it("parses quantities with 'x' suffix (1x, 4X)", () => {
    const { deck } = parseDecklist(INLINE_QUANTITY);
    const bolt = deck.cards.find((c) => c.name === "Lightning Bolt");
    expect(bolt?.quantity).toBe(4);
    const ring = deck.cards.find((c) => c.name === "Sol Ring");
    expect(ring?.quantity).toBe(1);
  });

  it("handles partner commanders (two commander cards)", () => {
    const { deck } = parseDecklist(INLINE_QUANTITY);
    expect(deck.commanders).toEqual(["Thrasios, Triton Hero", "Tymna the Weaver"]);
  });

  it("strips Scryfall set codes from card names", () => {
    const { deck } = parseDecklist(WITH_SET_CODES);
    expect(deck.commanders).toEqual(["Kinnan, Bonder Prodigy"]);
    const ring = deck.cards.find((c) => c.name === "Sol Ring");
    expect(ring).toBeDefined();
    expect(ring?.name).not.toContain("(C21)");
  });

  it("handles SB: inline prefix as sideboard", () => {
    const { deck } = parseDecklist(SB_PREFIX);
    const bolt = deck.cards.find((c) => c.name === "Lightning Bolt");
    expect(bolt?.section).toBe("sideboard");
    const counter = deck.cards.find((c) => c.name === "Counterspell");
    expect(counter?.section).toBe("sideboard");
    // Sol Ring should be mainboard
    const ring = deck.cards.find((c) => c.name === "Sol Ring");
    expect(ring?.section).toBe("mainboard");
  });

  it("warns when no commander section is present", () => {
    const { warnings } = parseDecklist(NO_COMMANDER);
    expect(warnings.some((w) => w.includes("commander"))).toBe(true);
  });

  it("warns on empty input", () => {
    const { warnings } = parseDecklist("");
    expect(warnings.some((w) => w.includes("No cards found"))).toBe(true);
  });

  it("calculates cardCount excluding commanders", () => {
    const { deck } = parseDecklist(SIMPLE_LIST);
    // Sol Ring (1) + Arcane Signet (1) + Island (3) = 5
    expect(deck.cardCount).toBe(5);
  });

  it("cardCount counts quantities correctly", () => {
    const { deck } = parseDecklist(MOXFIELD_EXPORT);
    // Plains(4) + Island(4) + Swamp(4) + Mountain(4) + Forest(4) + Sol Ring(1) + Arcane Signet(1) + Command Tower(1) = 23
    expect(deck.cardCount).toBe(23);
  });

  it("source is always 'paste'", () => {
    const { deck } = parseDecklist(SIMPLE_LIST);
    expect(deck.source).toBe("paste");
  });

  it("skips blank lines and comment dividers", () => {
    const text = `
// Commander
1 Kinnan, Bonder Prodigy

//
// -------

// Mainboard
1 Sol Ring
`;
    const { deck, warnings } = parseDecklist(text);
    expect(deck.cards).toHaveLength(2);
    expect(warnings).toHaveLength(0);
  });

  it("handles hash-style section headers", () => {
    const text = `
# Commander
1 Atraxa, Praetors' Voice

# Mainboard
1 Sol Ring
`;
    const { deck } = parseDecklist(text);
    expect(deck.commanders).toEqual(["Atraxa, Praetors' Voice"]);
  });

  it("handles sideboard section header", () => {
    const text = `
// Mainboard
1 Sol Ring

// Sideboard
1 Tormod's Crypt
`;
    const { deck } = parseDecklist(text);
    const sb = deck.cards.find((c) => c.name === "Tormod's Crypt");
    expect(sb?.section).toBe("sideboard");
  });

  it("handles maybeboard section header", () => {
    const text = `
// Mainboard
1 Sol Ring

// Maybeboard
1 Rhystic Study
`;
    const { deck } = parseDecklist(text);
    const maybe = deck.cards.find((c) => c.name === "Rhystic Study");
    expect(maybe?.section).toBe("maybeboard");
  });

  it("treats unknown lines starting with // as skipped without warning", () => {
    const text = `
// Commander
1 Atraxa, Praetors' Voice
// just a note
// Mainboard
1 Sol Ring
`;
    const { warnings } = parseDecklist(text);
    expect(warnings).toHaveLength(0);
  });

  it("does not throw on any realistic input", () => {
    const weird = `
garbage line here
1 Sol Ring
???? what is this
4 Island
`;
    expect(() => parseDecklist(weird)).not.toThrow();
  });
});
