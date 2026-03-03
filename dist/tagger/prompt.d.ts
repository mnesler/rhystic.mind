export declare const TAG_VOCABULARY: ReadonlySet<string>;
export declare const SORTED_VOCAB: string[];
export interface CardForTagging {
    oracle_id: string;
    name: string;
    type_line: string;
    mana_cost: string | null;
    cmc: number;
    oracle_text: string | null;
    keywords: string;
}
export declare function buildSystemPrompt(): string;
export declare function buildUserPrompt(card: CardForTagging): string;
/**
 * Parse the LLM response into a validated list of tags.
 * - Extracts the first JSON array found in the response text.
 * - Filters to only known vocabulary tags.
 * - Returns ["needs-review"] if nothing valid is found.
 */
export declare function parseTagsFromResponse(responseText: string): string[];
//# sourceMappingURL=prompt.d.ts.map