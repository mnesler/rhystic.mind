import type { LoadedDeck } from "./types.js";
export interface ParseResult {
    deck: LoadedDeck;
    warnings: string[];
}
export declare function parseDecklist(text: string): ParseResult;
//# sourceMappingURL=parser.d.ts.map