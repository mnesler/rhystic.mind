// Vector similarity search over card embeddings stored in SQLite.
//
// Embeddings are stored as Float32 BLOBs. On first call, all embeddings are
// loaded into memory (~30k × 1536 floats ≈ 180 MB) and cached for the
// lifetime of the process. Subsequent searches are pure in-memory ops.
//
// Cosine similarity is used throughout — vectors don't need to be unit-normalised
// (we normalise on the fly), but pre-normalised vectors would be faster.
import { query } from "../db/client.js";
let _cache = null;
let _cacheModel = null;
// ── Helpers ───────────────────────────────────────────────────────────────────
function bufferToFloat32(buf) {
    // node:sqlite returns BLOBs as Uint8Array / Buffer
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    return new Float32Array(ab);
}
function l2norm(vec) {
    let sum = 0;
    for (let i = 0; i < vec.length; i++)
        sum += vec[i] * vec[i];
    return Math.sqrt(sum);
}
function cosineSimilarity(a, normA, b, normB) {
    if (normA === 0 || normB === 0)
        return 0;
    let dot = 0;
    for (let i = 0; i < a.length; i++)
        dot += a[i] * b[i];
    return dot / (normA * normB);
}
// ── Public API ────────────────────────────────────────────────────────────────
/**
 * Load all embeddings for a given model into memory.
 * Call this at server startup to avoid cold-start latency on first query.
 */
export async function warmCache(model = "openai/text-embedding-3-small") {
    if (_cache && _cacheModel === model)
        return;
    const result = await query("SELECT oracle_id, embedding, dims FROM card_embeddings WHERE model = $1", [model]);
    const rows = result.rows;
    _cache = rows.map((row) => {
        const vec = bufferToFloat32(row.embedding);
        return { oracle_id: row.oracle_id, vec, norm: l2norm(vec) };
    });
    _cacheModel = model;
    process.stderr.write(`[vector] Loaded ${_cache.length.toLocaleString()} embeddings into memory (model: ${model})\n`);
}
/**
 * Search for the top-k most similar cards to a query vector.
 * The query vector must be from the same model as the cached embeddings.
 */
export async function search(queryVec, topK = 20, model = "openai/text-embedding-3-small") {
    if (!_cache || _cacheModel !== model) {
        await warmCache(model);
    }
    const cache = _cache;
    const qvec = new Float32Array(queryVec);
    const qnorm = l2norm(qvec);
    // Score all cached vectors
    const scores = cache.map((entry) => ({
        oracle_id: entry.oracle_id,
        score: cosineSimilarity(qvec, qnorm, entry.vec, entry.norm),
    }));
    // Partial sort — find top-k without fully sorting 30k items
    scores.sort((a, b) => b.score - a.score);
    return scores.slice(0, topK);
}
/**
 * Embed a query string via OpenRouter and search the cache.
 * Convenience wrapper used by the retrieval layer.
 */
export async function searchByText(text, topK = 20, model = "openai/text-embedding-3-small") {
    const vec = await embedText(text, model);
    return search(vec, topK, model);
}
/**
 * Embed a single string via OpenRouter embeddings API.
 */
export async function embedText(text, model = "openai/text-embedding-3-small") {
    const fetch = (await import("node-fetch")).default;
    const key = process.env.OPEN_ROUTER_KEY ??
        process.env.open_router_key ??
        process.env.OPENROUTER_API_KEY ??
        "";
    if (!key)
        throw new Error("No OpenRouter API key found.");
    const res = await fetch("https://openrouter.ai/api/v1/embeddings", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "https://github.com/maxtory/mtg",
            "X-Title": "MaxtoryMTG",
        },
        body: JSON.stringify({ model, input: text }),
    });
    if (!res.ok) {
        const body = await res.text();
        throw new Error(`Embedding API error ${res.status}: ${body}`);
    }
    const data = (await res.json());
    return data.data[0].embedding;
}
/** Clear the in-memory cache (useful for testing). */
export function clearCache() {
    _cache = null;
    _cacheModel = null;
}
//# sourceMappingURL=vector.js.map