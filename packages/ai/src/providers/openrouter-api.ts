import type { ModelCost } from "../types.ts";

/** OpenRouter's per-token prices, as decimal strings. */
export interface OpenRouterPricing {
	prompt?: string;
	completion?: string;
	input_cache_read?: string;
	input_cache_write?: string;
}

/** The fields pi reads from a model in OpenRouter's `GET /models` and `GET /models/user`. */
export interface OpenRouterModel {
	id: string;
	context_length?: number | null;
	top_provider?: { context_length?: number | null; max_completion_tokens?: number | null };
	pricing?: OpenRouterPricing;
}

/**
 * Convert OpenRouter's $/token prices to pi's $/1M tokens. Missing or invalid prices are 0.
 * Negative prices are 0 too: OpenRouter reports -1 for router models such as `openrouter/auto`,
 * whose price depends on the model they pick.
 */
export function openRouterCost(pricing: OpenRouterPricing | undefined): ModelCost {
	const perMillion = (value: string | undefined): number => {
		const perToken = Number.parseFloat(value || "0");
		return perToken > 0 ? Number((perToken * 1_000_000).toFixed(6)) : 0;
	};
	return {
		input: perMillion(pricing?.prompt),
		output: perMillion(pricing?.completion),
		cacheRead: perMillion(pricing?.input_cache_read),
		cacheWrite: perMillion(pricing?.input_cache_write),
	};
}
