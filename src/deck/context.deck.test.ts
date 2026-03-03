// Tests for the deck-context additions to context.ts
import { describe, it, expect } from "vitest";
import { buildDeckSystemBlock } from "../assistant/context.js";
import type { LoadedDeck } from "./types.js";

function makeDeck(overrides: Partial<LoadedDeck> = {}): LoadedDeck {
  return {
    source: "paste",
    commanders: ["Kinnan, Bonder Prodigy"],
    cards: [
      { name: "Kinnan, Bonder Prodigy", quantity: 1, section: "commander" },
      { name: "Sol Ring", quantity: 1, section: "mainboard" },
      { name: "Arcane Signet", quantity: 1, section: "mainboard" },
      { name: "Island", quantity: 10, section: "mainboard" },
      { name: "Forest", quantity: 10, section: "mainboard" },
    ],
    cardCount: 22,
    ...overrides,
  };
}

describe("buildDeckSystemBlock", () => {
  it("includes the commander name", () => {
    const block = buildDeckSystemBlock(makeDeck());
    expect(block).toContain("Kinnan, Bonder Prodigy");
  });

  it("includes the card count", () => {
    const block = buildDeckSystemBlock(makeDeck());
    expect(block).toContain("22");
  });

  it("includes mainboard card names", () => {
    const block = buildDeckSystemBlock(makeDeck());
    expect(block).toContain("Sol Ring");
    expect(block).toContain("Arcane Signet");
  });

  it("excludes commander from mainboard section listing", () => {
    const block = buildDeckSystemBlock(makeDeck());
    // Commander should be in the header, not duplicated in a mainboard section
    // Count occurrences: should appear in the header line, not twice in mainboard
    const mainboardSection = block.split("### Mainboard")[1] ?? "";
    expect(mainboardSection).not.toContain("Kinnan, Bonder Prodigy");
  });

  it("includes the deck name when provided", () => {
    const block = buildDeckSystemBlock(makeDeck({ name: "My Kinnan Deck" }));
    expect(block).toContain("My Kinnan Deck");
  });

  it("uses 'the loaded deck' label when no name provided", () => {
    const block = buildDeckSystemBlock(makeDeck({ name: undefined }));
    expect(block).toContain("the loaded deck");
  });

  it("includes Moxfield source URL when present", () => {
    const block = buildDeckSystemBlock(
      makeDeck({
        source: "moxfield",
        moxfieldUrl: "https://moxfield.com/decks/abc123",
      })
    );
    expect(block).toContain("https://moxfield.com/decks/abc123");
  });

  it("does not include source URL for paste decks", () => {
    const block = buildDeckSystemBlock(makeDeck({ source: "paste" }));
    expect(block).not.toContain("moxfield.com");
  });

  it("includes guidance about suggesting additions and cuts", () => {
    const block = buildDeckSystemBlock(makeDeck());
    expect(block).toContain("Suggest additions");
    expect(block).toContain("gaps");
  });

  it("handles partner commanders (two commanders)", () => {
    const block = buildDeckSystemBlock(
      makeDeck({ commanders: ["Thrasios, Triton Hero", "Tymna the Weaver"] })
    );
    expect(block).toContain("Thrasios, Triton Hero");
    expect(block).toContain("Tymna the Weaver");
  });

  it("shows sideboard section when sideboard cards present", () => {
    const deck = makeDeck({
      cards: [
        ...makeDeck().cards,
        { name: "Tormod's Crypt", quantity: 1, section: "sideboard" },
      ],
    });
    const block = buildDeckSystemBlock(deck);
    expect(block).toContain("Sideboard");
    expect(block).toContain("Tormod's Crypt");
  });

  it("shows maybeboard section when maybeboard cards present", () => {
    const deck = makeDeck({
      cards: [
        ...makeDeck().cards,
        { name: "Rhystic Study", quantity: 1, section: "maybeboard" },
      ],
    });
    const block = buildDeckSystemBlock(deck);
    expect(block).toContain("Maybeboard");
    expect(block).toContain("Rhystic Study");
  });

  it("includes quantity prefix on card lines", () => {
    const block = buildDeckSystemBlock(makeDeck());
    expect(block).toMatch(/\d+x Sol Ring/);
  });

  it("returns a non-empty string", () => {
    const block = buildDeckSystemBlock(makeDeck());
    expect(block.trim().length).toBeGreaterThan(0);
  });
});
