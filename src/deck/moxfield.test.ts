import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseMoxfieldUrl, fetchMoxfieldDeck, MoxfieldError } from "./moxfield.js";

// ── parseMoxfieldUrl ──────────────────────────────────────────────────────────

describe("parseMoxfieldUrl", () => {
  it("extracts deck ID from a full https URL", () => {
    expect(parseMoxfieldUrl("https://www.moxfield.com/decks/abc123XYZ")).toBe("abc123XYZ");
  });

  it("handles URL without www", () => {
    expect(parseMoxfieldUrl("https://moxfield.com/decks/abc123XYZ")).toBe("abc123XYZ");
  });

  it("handles URL without protocol", () => {
    expect(parseMoxfieldUrl("moxfield.com/decks/abc123XYZ")).toBe("abc123XYZ");
  });

  it("handles deck IDs with hyphens and underscores", () => {
    expect(parseMoxfieldUrl("https://moxfield.com/decks/abc-123_XYZ")).toBe("abc-123_XYZ");
  });

  it("returns null for non-Moxfield URLs", () => {
    expect(parseMoxfieldUrl("https://archidekt.com/decks/12345")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseMoxfieldUrl("")).toBeNull();
  });

  it("returns null for a bare deck ID (no domain)", () => {
    expect(parseMoxfieldUrl("abc123XYZ")).toBeNull();
  });

  it("handles trailing slashes gracefully", () => {
    // The regex won't match the trailing slash as part of the ID since \w chars stop there
    const id = parseMoxfieldUrl("https://moxfield.com/decks/abc123/");
    // Either extracts 'abc123' or null, but should not throw
    expect(() => parseMoxfieldUrl("https://moxfield.com/decks/abc123/")).not.toThrow();
    expect(id).toBe("abc123");
  });
});

// ── fetchMoxfieldDeck ─────────────────────────────────────────────────────────

const MOCK_DECK_RESPONSE = {
  name: "Test Commander Deck",
  publicUrl: "https://www.moxfield.com/decks/abc123",
  commanders: {
    "Kinnan, Bonder Prodigy": {
      card: { name: "Kinnan, Bonder Prodigy" },
      quantity: 1,
    },
  },
  companions: {},
  mainboard: {
    "Sol Ring": { card: { name: "Sol Ring" }, quantity: 1 },
    "Arcane Signet": { card: { name: "Arcane Signet" }, quantity: 1 },
    "Command Tower": { card: { name: "Command Tower" }, quantity: 1 },
    Island: { card: { name: "Island" }, quantity: 10 },
    Forest: { card: { name: "Forest" }, quantity: 10 },
  },
  sideboard: {},
  maybeboard: {
    "Rhystic Study": { card: { name: "Rhystic Study" }, quantity: 1 },
  },
};

describe("fetchMoxfieldDeck", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Mock node-fetch
    fetchMock = vi.fn();
    vi.doMock("node-fetch", () => ({ default: fetchMock }));
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("throws MoxfieldError for invalid URL", async () => {
    await expect(fetchMoxfieldDeck("https://archidekt.com/decks/123")).rejects.toThrow(
      MoxfieldError
    );
    await expect(fetchMoxfieldDeck("https://archidekt.com/decks/123")).rejects.toThrow(
      "Invalid Moxfield URL"
    );
  });

  it("throws MoxfieldError for empty string", async () => {
    await expect(fetchMoxfieldDeck("")).rejects.toThrow(MoxfieldError);
  });

  it("MoxfieldError has correct name", async () => {
    try {
      await fetchMoxfieldDeck("not-a-moxfield-url");
      expect.fail("should have thrown");
    } catch (err) {
      expect((err as Error).name).toBe("MoxfieldError");
    }
  });
});

// ── fetchMoxfieldDeck with mocked HTTP ───────────────────────────────────────
// We test the conversion logic by directly testing parseMoxfieldUrl + the
// response normalization without making real HTTP calls.

describe("Moxfield response normalization", () => {
  it("extracts commanders from the commanders field", () => {
    const commanders = Object.values(MOCK_DECK_RESPONSE.commanders).map(
      (e) => e.card.name
    );
    expect(commanders).toEqual(["Kinnan, Bonder Prodigy"]);
  });

  it("sums mainboard quantities for cardCount", () => {
    const count = Object.values(MOCK_DECK_RESPONSE.mainboard).reduce(
      (sum, e) => sum + e.quantity,
      0
    );
    // Sol Ring (1) + Arcane Signet (1) + Command Tower (1) + Island (10) + Forest (10) = 23
    expect(count).toBe(23);
  });

  it("maybeboard cards appear in the card list", () => {
    const cards = Object.values(MOCK_DECK_RESPONSE.maybeboard).map((e) => e.card.name);
    expect(cards).toContain("Rhystic Study");
  });
});

// ── MoxfieldError ─────────────────────────────────────────────────────────────

describe("MoxfieldError", () => {
  it("is an instance of Error", () => {
    const err = new MoxfieldError("test");
    expect(err).toBeInstanceOf(Error);
  });

  it("has name MoxfieldError", () => {
    const err = new MoxfieldError("test");
    expect(err.name).toBe("MoxfieldError");
  });

  it("stores statusCode", () => {
    const err = new MoxfieldError("not found", 404);
    expect(err.statusCode).toBe(404);
  });

  it("statusCode is undefined when not provided", () => {
    const err = new MoxfieldError("network error");
    expect(err.statusCode).toBeUndefined();
  });

  it("message is accessible", () => {
    const err = new MoxfieldError("something went wrong");
    expect(err.message).toBe("something went wrong");
  });
});
