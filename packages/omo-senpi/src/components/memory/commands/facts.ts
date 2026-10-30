// /facts -- read-only view of the facts pipeline, plus the ONLY manual unpark path.
//
// `/facts retry` clears failure records and triggers one reconcile/launch attempt. It never
// changes either watermark. The store restores parked files to the hot queue under its
// lock before clearing their records. There is no automatic unparking.

import {
  FactsFailureStore,
  type FactsFailureFilter,
  type FactsFailureRecord,
} from "@oh-my-opencode/memory-core"

import { parseCommandArgs } from "./args"
import { classifyFactsFailure } from "./facts-failure-cause"
import { formatFactsStatus, readFactsOverview } from "./facts-status"
import { requireIdentity, respond, type MemoryCommandContext, type MemoryCommandDeps } from "./types"
import { LAZY_MEMORY_COMMANDS, type MemoryCommandPort } from "./metadata"

function conversationsIn(records: readonly { readonly conversationId: string }[]): string[] {
  return [...new Set(records.map((record) => record.conversationId))].sort()
}

/**
 * What the retry did to parked batches, read back from the ledger after the one launch
 * attempt: how many were unparked, plus any batch that parked again (a fresh failure id,
 * never a cleared one) with its cause. A ledger that cannot be re-read reports only the
 * unparked count; it never claims nothing re-parked.
 */
async function retryOutcomeNote(
  store: FactsFailureStore,
  beforeEntries: readonly FactsFailureRecord[],
  matching: readonly FactsFailureRecord[],
): Promise<string> {
  const unparked = matching.filter((record) => record.state === "parked").length
  if (unparked === 0) return ""
  const noun = unparked === 1 ? "batch" : "batches"
  const clearedIds = new Set(beforeEntries.map((record) => record.lastFailureId))
  const scope = new Set(matching.map((record) => record.conversationId))
  let after: Awaited<ReturnType<FactsFailureStore["readFailures"]>>
  try {
    after = await store.readFailures()
  } catch {
    return `; ${unparked} parked ${noun} unparked`
  }
  const reparking = after.entries.filter(
    (record) =>
      record.state === "parked" && scope.has(record.conversationId) && !clearedIds.has(record.lastFailureId),
  )
  if (reparking.length === 0) {
    return `; ${unparked} parked ${noun} unparked; none had parked again when the ledger was re-read`
  }
  const labels = [...new Set(reparking.map((record) => classifyFactsFailure(record).label ?? "cause unknown"))]
  return `; ${unparked} parked ${noun} unparked; ${reparking.length} parked again (${labels.join(", ")})`
}

async function runRetry(
  deps: MemoryCommandDeps,
  ctx: MemoryCommandContext,
  identityPaths: Parameters<typeof readFactsOverview>[0]["identityPaths"],
  conversationId: string | undefined,
): Promise<string> {
  const store = new FactsFailureStore({ identityPaths })
  let before
  try {
    before = await store.readFailures()
  } catch (error) {
    return respond(
      ctx,
      `cannot retry: the failure ledger is unreadable (${error instanceof Error ? error.message : String(error)}); repair or remove failures.json first`,
      "error",
    )
  }

  const matching = before.entries.filter(
    (record) => conversationId === undefined || record.conversationId === conversationId,
  )
  if (matching.length === 0) {
    const scope = conversationId === undefined ? "the facts ledger" : `conversation ${conversationId}`
    return respond(ctx, `no failure records to clear for ${scope}; nothing was retried`, "info")
  }

  const filter: FactsFailureFilter = conversationId === undefined ? {} : { conversationId }
  const removed = await store.clearForRetry(filter)
  // ONE attempt: the extractor owns its own re-entrancy latch, so the command never loops.
  await deps.factsSink?.reconcile()
  const names = conversationsIn(matching)
  const note = await retryOutcomeNote(store, before.entries, matching)
  return respond(
    ctx,
    `cleared ${removed} record${removed === 1 ? "" : "s"} for ${names.join(", ")}; one launch attempt was triggered${note}`,
  )
}

export function registerFactsCommand(pi: MemoryCommandPort, deps: MemoryCommandDeps): void {
  pi.registerCommand("facts", {
    ...LAZY_MEMORY_COMMANDS.facts,
    handler: async (args: string, ctx: MemoryCommandContext): Promise<string> => {
      const identity = requireIdentity(deps, ctx)
      if (typeof identity === "string") return respond(ctx, identity, "error")

      const parsed = parseCommandArgs(args)
      const conversationFlag = parsed.flags.get("conversation")
      const conversationId = typeof conversationFlag === "string" ? conversationFlag : undefined

      if (parsed.positionals[0] === "retry") {
        return runRetry(deps, ctx, identity.identityPaths, conversationId)
      }
      if (parsed.positionals.length > 0) {
        return respond(ctx, `unknown /facts subcommand "${parsed.positionals[0]}"; use /facts or /facts retry`, "error")
      }

      const overview = await readFactsOverview({
        identityPaths: identity.identityPaths,
        now: new Date(deps.now?.() ?? Date.now()),
      })
      return respond(ctx, formatFactsStatus(identity.identity, overview))
    },
  })
}
