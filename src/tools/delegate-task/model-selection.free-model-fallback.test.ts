/// <reference types="bun-types" />

import { beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import { resolveModelForDelegateTask } from "./model-selection"
import * as connectedProvidersCache from "../../shared/connected-providers-cache"
import { FREE_ONLY_FALLBACK_CHAIN } from "./free-model-fallback"
import { CATEGORY_MODEL_REQUIREMENTS } from "../../shared/model-requirements"

const ultrabrainChain = CATEGORY_MODEL_REQUIREMENTS.ultrabrain.fallbackChain
const firstUltrabrainEntry = ultrabrainChain[0]
const firstFreeEntry = FREE_ONLY_FALLBACK_CHAIN[0]
const secondFreeEntry = FREE_ONLY_FALLBACK_CHAIN[1]

function qualifiedModel(entry: { providers: string[]; model: string }, provider = "opencode"): string {
  return `${provider}/${entry.model}`
}

describe("resolveModelForDelegateTask free-only fallback", () => {
  beforeEach(() => {
    mock.restore()
    spyOn(connectedProvidersCache, "hasConnectedProvidersCache").mockReturnValue(true)
    spyOn(connectedProvidersCache, "hasProviderModelsCache").mockReturnValue(true)
    spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue(["opencode"])
  })

  test("uses a free opencode fallback instead of a paid category default when only free providers are configured", () => {
    const result = resolveModelForDelegateTask({
      categoryDefaultModel: qualifiedModel(firstUltrabrainEntry),
      fallbackChain: ultrabrainChain,
      availableModels: new Set([
        qualifiedModel(firstUltrabrainEntry),
        qualifiedModel(firstFreeEntry),
        qualifiedModel(secondFreeEntry),
      ]),
    })

    expect(result).toEqual({
      model: qualifiedModel(firstFreeEntry),
      fallbackEntry: firstFreeEntry,
      matchedFallback: true,
    })
  })

  test("falls back to a free global opencode model when the hardcoded chain only contains paid models", () => {
    const result = resolveModelForDelegateTask({
      fallbackChain: ultrabrainChain,
      availableModels: new Set(),
    })

    expect(result).toEqual({
      model: qualifiedModel(firstFreeEntry),
      fallbackEntry: firstFreeEntry,
      matchedFallback: true,
    })
  })

  test("keeps an explicit user-configured category model even in free-only mode", () => {
    const result = resolveModelForDelegateTask({
      categoryDefaultModel: qualifiedModel(firstUltrabrainEntry),
      isUserConfiguredCategoryModel: true,
      availableModels: new Set([qualifiedModel(firstUltrabrainEntry), qualifiedModel(firstFreeEntry)]),
    })

    expect(result).toEqual({ model: qualifiedModel(firstUltrabrainEntry) })
  })

  test("does not downgrade a paid Zen subscriber whose availableModels contains paid models", () => {
    const result = resolveModelForDelegateTask({
      categoryDefaultModel: qualifiedModel(firstUltrabrainEntry),
      fallbackChain: ultrabrainChain,
      availableModels: new Set([
        qualifiedModel(firstUltrabrainEntry),
        qualifiedModel(firstFreeEntry),
        qualifiedModel(secondFreeEntry),
      ]),
    })

    expect(result).toEqual({ model: qualifiedModel(firstUltrabrainEntry) })
  })

  test("does not rewrite a paid Zen subscriber's fallback chain to the free-only chain", () => {
    const result = resolveModelForDelegateTask({
      fallbackChain: ultrabrainChain,
      availableModels: new Set([
        qualifiedModel(firstUltrabrainEntry),
        qualifiedModel(firstFreeEntry),
      ]),
    })

    expect(result).toEqual({
      model: qualifiedModel(firstUltrabrainEntry),
      variant: firstUltrabrainEntry.variant,
      fallbackEntry: firstUltrabrainEntry,
      matchedFallback: true,
    })
  })

  test("does not silently drop a paid category default when connectedProviders is opencode-only", () => {
    const result = resolveModelForDelegateTask({
      categoryDefaultModel: qualifiedModel(firstUltrabrainEntry),
      availableModels: new Set([qualifiedModel(firstUltrabrainEntry)]),
    })

    expect(result).toEqual({ model: qualifiedModel(firstUltrabrainEntry) })
  })
})
