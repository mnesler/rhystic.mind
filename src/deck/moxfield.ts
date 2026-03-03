// Moxfield deck fetcher — loads a public deck from the Moxfield API.
//
// Moxfield API (unofficial but stable):
//   GET https://api.moxfield.com/v2/decks/all/{deckId}
//
// Only public decks are supported. Private decks require an auth token
// which this implementation does not support.
//
// URL formats accepted:
//   https://www.moxfield.com/decks/abc123XYZ
//   https://moxfield.com/decks/abc123XYZ
//   moxfield.com/decks/abc123XYZ

import fetch from "node-fetch";
import type { LoadedDeck, DeckCard, CardSection } from "./types.js";

// ── Constants ─────────────────────────────────────────────────────────────────

const MOXFIELD_API = "https://api.moxfield.com/v2/decks/all";
const USER_AGENT = "MaxtoryMTG/1.0 (https://github.com/maxtory/mtg)";

// ── Types (Moxfield API shape — abbreviated to what we need) ──────────────────

interface MoxfieldCard {
  card: {
    name: string;
  };
  quantity: number;
}

interface MoxfieldDeck {
  name: string;
  publicUrl: string;
  commanders: Record<string, MoxfieldCard>;
  companions: Record<string, MoxfieldCard>;
  mainboard: Record<string, MoxfieldCard>;
  sideboard: Record<string, MoxfieldCard>;
  maybeboard: Record<string, MoxfieldCard>;
}

// ── URL parsing ───────────────────────────────────────────────────────────────

const MOXFIELD_DECK_RE = /moxfield\.com\/decks\/([A-Za-z0-9_-]+)/;

export function parseMoxfieldUrl(url: string): string | null {
  const match = MOXFIELD_DECK_RE.exec(url);
  return match ? (match[1] ?? null) : null;
}

// ── Converter ─────────────────────────────────────────────────────────────────

function convertSection(
  entries: Record<string, MoxfieldCard>,
  section: CardSection
): DeckCard[] {
  return Object.values(entries).map((entry) => ({
    name: entry.card.name,
    quantity: entry.quantity,
    section,
  }));
}

// ── Main export ───────────────────────────────────────────────────────────────

export class MoxfieldError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number
  ) {
    super(message);
    this.name = "MoxfieldError";
  }
}

export async function fetchMoxfieldDeck(url: string): Promise<LoadedDeck> {
  const deckId = parseMoxfieldUrl(url);
  if (!deckId) {
    throw new MoxfieldError(
      `Invalid Moxfield URL. Expected format: https://moxfield.com/decks/{deckId}`
    );
  }

  const apiUrl = `${MOXFIELD_API}/${deckId}`;

  let res: Awaited<ReturnType<typeof fetch>>;
  try {
    res = await fetch(apiUrl, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json",
      },
    });
  } catch (err) {
    throw new MoxfieldError(
      `Network error fetching Moxfield deck: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  if (res.status === 404) {
    throw new MoxfieldError(
      `Deck not found. Make sure the deck is public and the URL is correct.`,
      404
    );
  }

  if (res.status === 403) {
    throw new MoxfieldError(
      `Access denied. Only public Moxfield decks are supported.`,
      403
    );
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new MoxfieldError(
      `Moxfield API returned ${res.status}: ${body.slice(0, 200)}`,
      res.status
    );
  }

  let data: MoxfieldDeck;
  try {
    data = (await res.json()) as MoxfieldDeck;
  } catch {
    throw new MoxfieldError("Failed to parse Moxfield API response as JSON.");
  }

  // Build card list from all sections
  const cards: DeckCard[] = [
    ...convertSection(data.commanders ?? {}, "commander"),
    ...convertSection(data.companions ?? {}, "companion"),
    ...convertSection(data.mainboard ?? {}, "mainboard"),
    ...convertSection(data.sideboard ?? {}, "sideboard"),
    ...convertSection(data.maybeboard ?? {}, "maybeboard"),
  ];

  const commanders = cards
    .filter((c) => c.section === "commander")
    .map((c) => c.name);

  const cardCount = cards
    .filter((c) => c.section !== "commander" && c.section !== "companion")
    .reduce((sum, c) => sum + c.quantity, 0);

  return {
    source: "moxfield",
    moxfieldUrl: url,
    name: data.name,
    commanders,
    cards,
    cardCount,
  };
}
