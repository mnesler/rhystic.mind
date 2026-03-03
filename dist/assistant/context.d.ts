import type { RetrievalResult } from "./retrieve.js";
import type { Intent } from "./intent.js";
import type { LoadedDeck } from "../deck/types.js";
export interface BuiltContext {
    text: string;
    cardCount: number;
    comboCount: number;
    truncated: boolean;
}
export declare function buildContext(result: RetrievalResult, intent: Intent): BuiltContext;
/**
 * Formats the loaded deck into a system prompt block that the LLM can see.
 * This lets the LLM know exactly what is already in the deck so it can make
 * targeted suggestions (add cards, remove cards, identify gaps, etc.).
 */
export declare function buildDeckSystemBlock(deck: LoadedDeck): string;
export type ResponseMode = "succinct" | "verbose" | "gooper";
export declare function buildSystemPrompt(intent: Intent, mode?: ResponseMode): string;
//# sourceMappingURL=context.d.ts.map