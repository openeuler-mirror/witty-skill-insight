export interface ModelPricing {
  inputTokenPrice: number;   // $ per million tokens
  outputTokenPrice: number;  // $ per million tokens
}

// Pricing per million tokens (as of 2025)
// Keys are used as prefixes for matching versioned model names
const DEFAULT_MODEL_PRICING: Record<string, ModelPricing> = {
  // Claude
  'claude-opus-4':                   { inputTokenPrice: 15, outputTokenPrice: 75 },
  'claude-sonnet-4':                 { inputTokenPrice: 3, outputTokenPrice: 15 },
  'claude-haiku-4':                  { inputTokenPrice: 1, outputTokenPrice: 5 },
  // DeepSeek
  'deepseek-chat':                   { inputTokenPrice: 0.27, outputTokenPrice: 1.10 },
  'deepseek-reasoner':               { inputTokenPrice: 0.55, outputTokenPrice: 2.19 },
  // MiniMax
  'minimax-m2.5-free':               { inputTokenPrice: 0, outputTokenPrice: 0 },
};

export function getModelPricing(modelName: string): ModelPricing | null {
  if (DEFAULT_MODEL_PRICING[modelName]) return DEFAULT_MODEL_PRICING[modelName];
  // Try prefix match for versioned model names (e.g. "claude-sonnet-4-20250514" matches "claude-sonnet-4")
  // Sort by key length descending so the most specific (longest) prefix wins
  const sorted = Object.entries(DEFAULT_MODEL_PRICING).sort((a, b) => b[0].length - a[0].length);
  for (const [key, value] of sorted) {
    if (modelName.startsWith(key)) return value;
  }
  return null;
}

export function calculateCost(inputTokens: number, outputTokens: number, pricing: ModelPricing): number {
  return (inputTokens * pricing.inputTokenPrice + outputTokens * pricing.outputTokenPrice) / 1_000_000;
}
