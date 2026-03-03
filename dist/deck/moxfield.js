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
// ── Constants ─────────────────────────────────────────────────────────────────
const MOXFIELD_API = "https://api.moxfield.com/v2/decks/all";
const USER_AGENT = "MaxtoryMTG/1.0 (https://github.com/maxtory/mtg)";
// ── URL parsing ───────────────────────────────────────────────────────────────
const MOXFIELD_DECK_RE = /moxfield\.com\/decks\/([A-Za-z0-9_-]+)/;
export function parseMoxfieldUrl(url) {
    const match = MOXFIELD_DECK_RE.exec(url);
    return match ? (match[1] ?? null) : null;
}
// ── Converter ─────────────────────────────────────────────────────────────────
function convertSection(entries, section) {
    return Object.values(entries).map((entry) => ({
        name: entry.card.name,
        quantity: entry.quantity,
        section,
    }));
}
// ── Main export ───────────────────────────────────────────────────────────────
export class MoxfieldError extends Error {
    statusCode;
    constructor(message, statusCode) {
        super(message);
        this.statusCode = statusCode;
        this.name = "MoxfieldError";
    }
}
export async function fetchMoxfieldDeck(url) {
    const deckId = parseMoxfieldUrl(url);
    if (!deckId) {
        throw new MoxfieldError(`Invalid Moxfield URL. Expected format: https://moxfield.com/decks/{deckId}`);
    }
    const apiUrl = `${MOXFIELD_API}/${deckId}`;
    let res;
    try {
        res = await fetch(apiUrl, {
            headers: {
                "User-Agent": USER_AGENT,
                Accept: "application/json",
            },
        });
    }
    catch (err) {
        throw new MoxfieldError(`Network error fetching Moxfield deck: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (res.status === 404) {
        throw new MoxfieldError(`Deck not found. Make sure the deck is public and the URL is correct.`, 404);
    }
    if (res.status === 403) {
        throw new MoxfieldError(`Access denied. Only public Moxfield decks are supported.`, 403);
    }
    if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new MoxfieldError(`Moxfield API returned ${res.status}: ${body.slice(0, 200)}`, res.status);
    }
    let data;
    try {
        data = (await res.json());
    }
    catch {
        throw new MoxfieldError("Failed to parse Moxfield API response as JSON.");
    }
    // Build card list from all sections
    const cards = [
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
//# sourceMappingURL=moxfield.js.map