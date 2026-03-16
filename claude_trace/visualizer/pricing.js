/**
 * pricing.js — Claude model pricing table & cost calculator.
 * Based on: https://github.com/jack21/ClaudeCodeUsage/blob/main/src/pricing.ts
 * Uses 5-minute KV Cache pricing (default in Claude Code).
 */
const PRICING = (() => {
    const M = 1e6;

    // Official pricing (per token, not per MTok)
    // Source: https://docs.anthropic.com/en/docs/about-claude/models
    const MODEL_PRICING = {
        // Claude Sonnet 4
        'claude-sonnet-4-20250514': { i: 3 / M, o: 15 / M, cw: 3.75 / M, cr: 0.30 / M, label: 'Sonnet 4' },
        'claude-sonnet-4': { i: 3 / M, o: 15 / M, cw: 3.75 / M, cr: 0.30 / M, label: 'Sonnet 4' },
        // Claude Opus 4
        'claude-opus-4-20250514': { i: 15 / M, o: 75 / M, cw: 18.75 / M, cr: 1.50 / M, label: 'Opus 4' },
        'claude-opus-4': { i: 15 / M, o: 75 / M, cw: 18.75 / M, cr: 1.50 / M, label: 'Opus 4' },
        // Claude Opus 4.1
        'claude-opus-4-1-20250805': { i: 15 / M, o: 75 / M, cw: 18.75 / M, cr: 1.50 / M, label: 'Opus 4.1' },
        'claude-opus-4-1': { i: 15 / M, o: 75 / M, cw: 18.75 / M, cr: 1.50 / M, label: 'Opus 4.1' },
        // Claude Opus 4.5
        'claude-opus-4-5-20251101': { i: 5 / M, o: 25 / M, cw: 6 / M, cr: 0.50 / M, label: 'Opus 4.5' },
        'claude-opus-4-5': { i: 5 / M, o: 25 / M, cw: 6 / M, cr: 0.50 / M, label: 'Opus 4.5' },
        // Claude Opus 4.6 — same as Opus 4.5 pricing
        'claude-opus-4-6': { i: 5 / M, o: 25 / M, cw: 6 / M, cr: 0.50 / M, label: 'Opus 4.6' },
        // Claude Sonnet 3.5
        'claude-3-5-sonnet-20241022': { i: 3 / M, o: 15 / M, cw: 3.75 / M, cr: 0.30 / M, label: 'Sonnet 3.5' },
        'claude-3-5-sonnet': { i: 3 / M, o: 15 / M, cw: 3.75 / M, cr: 0.30 / M, label: 'Sonnet 3.5' },
        // Claude Haiku 3.5
        'claude-3-5-haiku-20241022': { i: 0.80 / M, o: 4 / M, cw: 1.60 / M, cr: 0.08 / M, label: 'Haiku 3.5' },
        'claude-3-5-haiku': { i: 0.80 / M, o: 4 / M, cw: 1.60 / M, cr: 0.08 / M, label: 'Haiku 3.5' },
        // Claude Haiku 4.5
        'claude-haiku-4-5-20251001': { i: 1 / M, o: 5 / M, cw: 1.25 / M, cr: 0.10 / M, label: 'Haiku 4.5' },
        'claude-haiku-4-5': { i: 1 / M, o: 5 / M, cw: 1.25 / M, cr: 0.10 / M, label: 'Haiku 4.5' },
    };

    // Default fallback: Sonnet 4
    const FALLBACK = MODEL_PRICING['claude-sonnet-4-20250514'];

    /**
     * Resolve model name to pricing. Tries exact match first, then prefix matching.
     */
    function resolve(modelName) {
        if (!modelName) return null;
        const m = modelName.toLowerCase().trim();

        // Exact match
        if (MODEL_PRICING[m]) return MODEL_PRICING[m];

        // Try prefix match (longest key first)
        const keys = Object.keys(MODEL_PRICING).sort((a, b) => b.length - a.length);
        for (const k of keys) {
            if (m.startsWith(k)) return MODEL_PRICING[k];
        }

        // Fuzzy: extract model family and version
        if (m.includes('haiku') && m.includes('4-5')) return MODEL_PRICING['claude-haiku-4-5'];
        if (m.includes('haiku') && m.includes('3-5')) return MODEL_PRICING['claude-3-5-haiku'];
        if (m.includes('opus') && m.includes('4-6')) return MODEL_PRICING['claude-opus-4-6'];
        if (m.includes('opus') && m.includes('4-5')) return MODEL_PRICING['claude-opus-4-5'];
        if (m.includes('opus') && m.includes('4-1')) return MODEL_PRICING['claude-opus-4-1'];
        if (m.includes('opus') && m.includes('4')) return MODEL_PRICING['claude-opus-4'];
        if (m.includes('sonnet') && m.includes('4')) return MODEL_PRICING['claude-sonnet-4'];
        if (m.includes('sonnet') && m.includes('3-5')) return MODEL_PRICING['claude-3-5-sonnet'];
        if (m.includes('haiku')) return MODEL_PRICING['claude-haiku-4-5'];

        // Unknown model — use Sonnet 4 fallback (same as ClaudeCodeUsage)
        return FALLBACK;
    }

    /**
     * Calculate cost for a single request.
     * Per ClaudeCodeUsage: all fields are ADDITIVE (no subtraction needed).
     *   cost = input_tokens × input_price
     *        + output_tokens × output_price
     *        + cache_creation_input_tokens × cache_write_price
     *        + cache_read_input_tokens × cache_read_price
     */
    function calcCost(usage, modelName) {
        const p = resolve(modelName);
        if (!p || !usage) return null;

        const totalPrompt = usage.input_tokens || 0;  // In our trace: TOTAL prompt (includes cache)
        const outputTok = usage.output_tokens || 0;
        const cacheWriteTok = usage.cache_creation_input_tokens || 0;
        const cacheReadTok = usage.cache_read_input_tokens || 0;

        // Our trace uses OpenAI format: input_tokens = total prompt (includes cache_read + cache_creation).
        // Non-cached input = total - cache_read - cache_creation
        const nonCachedInput = Math.max(0, totalPrompt - cacheReadTok - cacheWriteTok);

        // With cache: non-cached at input rate, cache_write at write rate, cache_read at read rate
        const withCache = (
            nonCachedInput * p.i +
            outputTok * p.o +
            cacheWriteTok * p.cw +
            cacheReadTok * p.cr
        );

        // Without cache: all prompt tokens at base input rate (as if no caching)
        const withoutCache = (
            totalPrompt * p.i +
            outputTok * p.o
        );

        return { withCache, withoutCache, model: p.label };
    }

    /**
     * Calculate aggregate cost across all nodes.
     */
    function calcTotal(nodes) {
        let withCache = 0;
        let withoutCache = 0;
        let totalInput = 0;
        let totalOutput = 0;
        let totalCacheWrite = 0;
        let totalCacheRead = 0;
        const models = {};
        let hasData = false;

        for (const n of nodes) {
            const usage = n.usage || {};
            const model = n.model || '';
            if (!model) continue;

            // Prefer usage fields from API response; fall back to node-level tokens
            const hasUsageData = !!(usage.input_tokens || usage.output_tokens ||
                usage.cache_read_input_tokens || usage.cache_creation_input_tokens);
            const inputTok = usage.input_tokens || (hasUsageData ? 0 : (n.inputTokens || 0));
            const outputTok = usage.output_tokens || (hasUsageData ? 0 : (n.outputTokens || 0));
            const cacheWriteTok = usage.cache_creation_input_tokens || 0;
            const cacheReadTok = usage.cache_read_input_tokens || 0;

            // Skip if all zeros
            if (inputTok + outputTok + cacheWriteTok + cacheReadTok === 0) continue;

            const r = calcCost({
                input_tokens: inputTok,
                output_tokens: outputTok,
                cache_creation_input_tokens: cacheWriteTok,
                cache_read_input_tokens: cacheReadTok,
            }, model);

            if (r) {
                hasData = true;
                withCache += r.withCache;
                withoutCache += r.withoutCache;
                totalInput += inputTok;
                totalOutput += outputTok;
                totalCacheWrite += cacheWriteTok;
                totalCacheRead += cacheReadTok;
                models[r.model] = (models[r.model] || 0) + 1;
            }
        }

        if (!hasData) return null;

        return {
            withCache,
            withoutCache,
            saved: withoutCache - withCache,
            savedPct: withoutCache > 0 ? ((withoutCache - withCache) / withoutCache * 100) : 0,
            totalInput,
            totalOutput,
            totalCacheWrite,
            totalCacheRead,
            models,
        };
    }

    function fmt(amount) {
        if (amount < 0.01) return `$${amount.toFixed(4)}`;
        if (amount < 1) return `$${amount.toFixed(3)}`;
        return `$${amount.toFixed(2)}`;
    }

    return { resolve, calcCost, calcTotal, fmt, MODEL_PRICING };
})();
