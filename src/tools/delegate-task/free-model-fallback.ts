import type { FallbackEntry } from "../../shared/model-requirements"

const FREE_ONLY_PROVIDER_IDS = new Set(["opencode"])
const KNOWN_FREE_MODEL_IDS = new Set([
  "big-pickle",
  "gpt-5-nano",
  "hy3-preview-free",
  "minimax-m2.5-free",
  "nemotron-3-super-free",
])

export const FREE_ONLY_FALLBACK_CHAIN: FallbackEntry[] = [
  { providers: ["opencode"], model: "big-pickle" },
  { providers: ["opencode"], model: "minimax-m2.5-free" },
  { providers: ["opencode"], model: "hy3-preview-free" },
  { providers: ["opencode"], model: "nemotron-3-super-free" },
  { providers: ["opencode"], model: "gpt-5-nano" },
]

function getModelId(model: string): string {
  return model.includes("/") ? model.split("/").slice(1).join("/") : model
}

export function isKnownFreeModel(model: string): boolean {
  return KNOWN_FREE_MODEL_IDS.has(getModelId(model))
}

export function isFreeOnlyProviderConfiguration(connectedProviders: string[] | null): boolean {
  return connectedProviders !== null
    && connectedProviders.length > 0
    && connectedProviders.every((provider) => FREE_ONLY_PROVIDER_IDS.has(provider))
}

export function appendFreeModelFallbacks(
  fallbackChain: FallbackEntry[] | undefined,
): FallbackEntry[] {
  if (!fallbackChain || fallbackChain.length === 0) {
    return FREE_ONLY_FALLBACK_CHAIN
  }

  // Ordering matters: original chain first, then free models in FREE_ONLY_FALLBACK_CHAIN priority order.
  const existingModels = new Set(fallbackChain.map((entry) => entry.model))
  const newEntries = FREE_ONLY_FALLBACK_CHAIN.filter((entry) => !existingModels.has(entry.model))
  return [...fallbackChain, ...newEntries]
}
