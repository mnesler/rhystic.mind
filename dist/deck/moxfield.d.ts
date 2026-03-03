import type { LoadedDeck } from "./types.js";
export declare function parseMoxfieldUrl(url: string): string | null;
export declare class MoxfieldError extends Error {
    readonly statusCode?: number | undefined;
    constructor(message: string, statusCode?: number | undefined);
}
export declare function fetchMoxfieldDeck(url: string): Promise<LoadedDeck>;
//# sourceMappingURL=moxfield.d.ts.map