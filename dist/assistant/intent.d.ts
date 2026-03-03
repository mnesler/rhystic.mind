export type IntentType = "card-lookup" | "deck-build" | "combo-find" | "tag-search" | "power-assess" | "general";
export interface Intent {
    type: IntentType;
    cardNames: string[];
    commander: string | null;
    colors: string[];
    tags: string[];
    themes: string[];
    budget: boolean;
    searchQuery: string;
}
export interface ChatMessage {
    role: "user" | "assistant" | "system";
    content: string;
}
export declare function classifyIntent(userMessage: string, history?: ChatMessage[]): Promise<Intent>;
//# sourceMappingURL=intent.d.ts.map