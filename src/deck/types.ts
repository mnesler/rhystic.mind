// Shared types for deck loading and representation.
//
// A LoadedDeck is a normalised in-memory representation of a commander deck,
// regardless of whether it came from a Moxfield URL or a raw paste.

// ── Core types ────────────────────────────────────────────────────────────────

export interface DeckCard {
  name: string;
  quantity: number;
  section: CardSection;
  /** MTG color identity symbols e.g. ["W","U","B"] — populated from DB at load time. */
  colorIdentity?: string[];
}

export type CardSection =
  | "commander"
  | "companion"
  | "mainboard"
  | "sideboard"
  | "maybeboard";

export interface LoadedDeck {
  /** Where the deck came from — useful for display. */
  source: "moxfield" | "paste";
  /** Original Moxfield URL, if applicable. */
  moxfieldUrl?: string;
  /** Moxfield deck name, if available. */
  name?: string;
  /** The commander card name(s). Up to 2 for partner commanders. */
  commanders: string[];
  /** All other cards, including their section and quantity. */
  cards: DeckCard[];
  /** Total card count (excluding commanders). */
  cardCount: number;
}
