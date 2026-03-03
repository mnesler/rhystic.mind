export interface VectorMatch {
    oracle_id: string;
    score: number;
}
/**
 * Load all embeddings for a given model into memory.
 * Call this at server startup to avoid cold-start latency on first query.
 */
export declare function warmCache(model?: string): Promise<void>;
/**
 * Search for the top-k most similar cards to a query vector.
 * The query vector must be from the same model as the cached embeddings.
 */
export declare function search(queryVec: number[], topK?: number, model?: string): Promise<VectorMatch[]>;
/**
 * Embed a query string via OpenRouter and search the cache.
 * Convenience wrapper used by the retrieval layer.
 */
export declare function searchByText(text: string, topK?: number, model?: string): Promise<VectorMatch[]>;
/**
 * Embed a single string via OpenRouter embeddings API.
 */
export declare function embedText(text: string, model?: string): Promise<number[]>;
/** Clear the in-memory cache (useful for testing). */
export declare function clearCache(): void;
//# sourceMappingURL=vector.d.ts.map