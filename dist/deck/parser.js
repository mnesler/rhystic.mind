// Decklist parser — converts a raw pasted decklist into a LoadedDeck.
//
// Supports the common formats used by Moxfield, Archidekt, MTGO, and MTGA:
//
//   Standard:          1 Sol Ring
//   With "x" suffix:   1x Sol Ring
//   Section headers:   // Commander, // Mainboard, # Commander, SB: 1 Card
//   MTGA format:       Deck / Commander / Sideboard / Companion sections
//   Set codes ignored: 1 Sol Ring (C21) 1
//
// Section detection (case-insensitive):
//   "commander" / "cmdr"     → commander
//   "companion"              → companion
//   "sideboard" / "sb:"      → sideboard
//   "maybeboard" / "maybe"   → maybeboard
//   "deck" / "mainboard" / "main" or no header → mainboard
// ── Constants ─────────────────────────────────────────────────────────────────
// Matches "1 Sol Ring", "1x Sol Ring", "1X Sol Ring" — ignores trailing set codes like "(C21) 1"
const CARD_LINE_RE = /^(\d+)[xX]?\s+(.+?)(?:\s+\([A-Z0-9]+\)\s*\d*)?$/;
// Section header patterns
const SECTION_PATTERNS = [
    { re: /^(?:\/\/\s*|#+\s*)?commanders?(?:\s|$)/i, section: "commander" },
    { re: /^(?:\/\/\s*|#+\s*)?companions?(?:\s|$)/i, section: "companion" },
    // Note: "SB: 1 CardName" is an inline prefix (handled in parseLine), not a section header.
    // Only match "Sideboard" or bare "SB" / "SB:" when NOT followed by a digit (card quantity).
    { re: /^(?:\/\/\s*|#+\s*)?sideboard(?:\s|$)/i, section: "sideboard" },
    { re: /^(?:\/\/\s*|#+\s*)?sb:?(?:\s|$)(?!\d)/i, section: "sideboard" },
    { re: /^(?:\/\/\s*|#+\s*)?(?:maybeboard|maybe)(?:\s|$)/i, section: "maybeboard" },
    { re: /^(?:\/\/\s*|#+\s*)?(?:deck|mainboard|main)(?:\s|$)/i, section: "mainboard" },
];
// Lines to skip entirely
const SKIP_LINE_RE = /^\s*$|^\/\/$|^#+\s*$/;
// ── Helpers ───────────────────────────────────────────────────────────────────
function detectSection(line) {
    for (const { re, section } of SECTION_PATTERNS) {
        if (re.test(line.trim()))
            return section;
    }
    return null;
}
function parseLine(line, currentSection) {
    const trimmed = line.trim();
    if (!trimmed)
        return null;
    // Handle "SB: 1 Card Name" inline prefix (MTGO export format)
    let workLine = trimmed;
    let forcedSection;
    if (/^SB:\s*/i.test(workLine)) {
        workLine = workLine.replace(/^SB:\s*/i, "");
        forcedSection = "sideboard";
    }
    const match = CARD_LINE_RE.exec(workLine);
    if (!match)
        return null;
    const quantity = parseInt(match[1], 10);
    const name = match[2].trim();
    if (!name || quantity < 1)
        return null;
    return {
        name,
        quantity,
        section: forcedSection ?? currentSection,
    };
}
export function parseDecklist(text) {
    const warnings = [];
    const lines = text.split(/\r?\n/);
    let currentSection = "mainboard"; // default before any header
    const cards = [];
    for (const line of lines) {
        const trimmed = line.trim();
        // Skip blank lines and bare comment dividers
        if (SKIP_LINE_RE.test(trimmed))
            continue;
        // Check for section header
        const newSection = detectSection(trimmed);
        if (newSection !== null) {
            currentSection = newSection;
            continue;
        }
        // Try to parse as a card line
        const card = parseLine(trimmed, currentSection);
        if (card) {
            cards.push(card);
        }
        else {
            // Could be a comment or unrecognised line — warn but don't fail
            if (!trimmed.startsWith("//") && !trimmed.startsWith("#")) {
                warnings.push(`Could not parse line: "${trimmed}"`);
            }
        }
    }
    // Extract commanders
    const commanderCards = cards.filter((c) => c.section === "commander");
    const commanders = commanderCards.map((c) => c.name);
    // Mainboard = everything that isn't a commander or companion
    const mainCards = cards.filter((c) => c.section !== "commander" && c.section !== "companion");
    const cardCount = mainCards.reduce((sum, c) => sum + c.quantity, 0);
    if (commanders.length === 0) {
        warnings.push("No commander detected. Add a '// Commander' section header above your commander card(s).");
    }
    if (cards.length === 0) {
        warnings.push("No cards found in the decklist.");
    }
    const deck = {
        source: "paste",
        commanders,
        cards,
        cardCount,
    };
    return { deck, warnings };
}
//# sourceMappingURL=parser.js.map