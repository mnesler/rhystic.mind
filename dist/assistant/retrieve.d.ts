import type { Intent } from "./intent.js";
export interface RetrievedCard {
    oracle_id: string;
    name: string;
    mana_cost: string | null;
    cmc: number;
    type_line: string;
    oracle_text: string | null;
    color_identity: string;
    colors: string;
    edhrec_rank: number | null;
    rarity: string | null;
    power: string | null;
    toughness: string | null;
    loyalty: string | null;
    tags: string[];
    vectorScore?: number;
}
export interface RetrievedCombo {
    id: string;
    card_names: string[];
    produces: string[];
    description: string | null;
    mana_needed: string | null;
    color_identity: string[];
    popularity: number;
}
export interface RetrievalResult {
    cards: RetrievedCard[];
    combos: RetrievedCombo[];
    hasEmbeddings: boolean;
}
export declare function retrieve(intent: Intent): Promise<RetrievalResult>;
//# sourceMappingURL=retrieve.d.ts.map