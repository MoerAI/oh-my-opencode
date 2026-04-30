/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import {
  FREE_ONLY_FALLBACK_CHAIN,
  getFallbackChainForFreeOnlyProviders,
  getFreeOnlyCategoryDefaultModel,
  isFreeOnlyProviderConfiguration,
  isKnownFreeModel,
} from "./free-model-fallback"
import { CATEGORY_MODEL_REQUIREMENTS } from "../../shared/model-requirements"

const ultrabrainChain = CATEGORY_MODEL_REQUIREMENTS.ultrabrain.fallbackChain
const paidModelFromChain = `opencode/${ultrabrainChain[0].model}`
const firstFreeModel = `opencode/${FREE_ONLY_FALLBACK_CHAIN[0].model}`

describe("FREE_ONLY_FALLBACK_CHAIN", () => {
  // Deprecated by opencode (https://opencode.ai/zen/v1/models, models.dev catalog).
  const deprecatedFreeModelIds = ["kimi-k2.5-free", "kimi-k2-free", "kimi-k2-thinking-free"]

  test("does not contain models that opencode has marked deprecated", () => {
    for (const entry of FREE_ONLY_FALLBACK_CHAIN) {
      expect(deprecatedFreeModelIds).not.toContain(entry.model)
    }
  })

  test("only contains entries that isKnownFreeModel recognizes", () => {
    for (const entry of FREE_ONLY_FALLBACK_CHAIN) {
      expect(isKnownFreeModel(entry.model)).toBe(true)
    }
  })

  test("every provider in the chain is recognized as a free-only provider", () => {
    for (const entry of FREE_ONLY_FALLBACK_CHAIN) {
      for (const provider of entry.providers) {
        expect(isFreeOnlyProviderConfiguration([provider])).toBe(true)
      }
    }
  })
})

describe("isFreeOnlyProviderConfiguration", () => {
  test("returns true when all providers are in FREE_ONLY_PROVIDER_IDS", () => {
    expect(isFreeOnlyProviderConfiguration(["opencode"])).toBe(true)
  })

  test("returns false when any provider is not in FREE_ONLY_PROVIDER_IDS", () => {
    expect(isFreeOnlyProviderConfiguration(["opencode", "anthropic"])).toBe(false)
  })

  test("returns false for null", () => {
    expect(isFreeOnlyProviderConfiguration(null)).toBe(false)
  })

  test("returns false for empty array", () => {
    expect(isFreeOnlyProviderConfiguration([])).toBe(false)
  })
})

describe("getFreeOnlyCategoryDefaultModel", () => {
  test("passes through category default when not in free-only mode", () => {
    const result = getFreeOnlyCategoryDefaultModel({
      categoryDefaultModel: paidModelFromChain,
      freeOnlyProviderConfiguration: false,
    })
    expect(result).toBe(paidModelFromChain)
  })

  test("passes through user-configured category model even in free-only mode", () => {
    const result = getFreeOnlyCategoryDefaultModel({
      categoryDefaultModel: paidModelFromChain,
      isUserConfiguredCategoryModel: true,
      freeOnlyProviderConfiguration: true,
    })
    expect(result).toBe(paidModelFromChain)
  })

  test("drops non-free category default in free-only mode", () => {
    const result = getFreeOnlyCategoryDefaultModel({
      categoryDefaultModel: paidModelFromChain,
      freeOnlyProviderConfiguration: true,
    })
    expect(result).toBeUndefined()
  })

  test("keeps free category default in free-only mode", () => {
    const result = getFreeOnlyCategoryDefaultModel({
      categoryDefaultModel: firstFreeModel,
      freeOnlyProviderConfiguration: true,
    })
    expect(result).toBe(firstFreeModel)
  })
})

describe("getFallbackChainForFreeOnlyProviders", () => {
  test("returns original chain when not in free-only mode", () => {
    const result = getFallbackChainForFreeOnlyProviders(ultrabrainChain, false)
    expect(result).toBe(ultrabrainChain)
  })

  test("returns FREE_ONLY_FALLBACK_CHAIN when original chain has zero free entries", () => {
    const result = getFallbackChainForFreeOnlyProviders(ultrabrainChain, true)
    expect(result).toEqual(FREE_ONLY_FALLBACK_CHAIN)
  })

  test("uses full FREE_ONLY_FALLBACK_CHAIN instead of a degraded single-entry filtered chain", () => {
    const lastFreeModel = FREE_ONLY_FALLBACK_CHAIN[FREE_ONLY_FALLBACK_CHAIN.length - 1].model
    const chainWithOneFreeEntry = [
      ...ultrabrainChain,
      { providers: ["opencode"], model: lastFreeModel },
    ]
    const result = getFallbackChainForFreeOnlyProviders(chainWithOneFreeEntry, true)

    expect(result).toEqual(FREE_ONLY_FALLBACK_CHAIN)
  })
})
