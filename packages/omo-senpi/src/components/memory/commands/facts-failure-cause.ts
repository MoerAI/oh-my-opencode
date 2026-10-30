// Plain-words classification of facts failures for the /doctor and /facts surfaces.
//
// The ledger stores a machine reason; the reader needs the one action to take. A transient
// cause (a timeout, a busy write lock) means the remedy is /facts retry itself. A cause
// only the user can fix (no model for the extractor, secret-like content) must name what
// to fix instead of telling her to "fix the cause".

import type { FactsFailureRecord, FactsFailureReason } from "@oh-my-opencode/memory-core"
import { basename, join } from "node:path"

import { childFailureCause } from "../worker/failure-detail"

export interface FactsFailureCause {
  /** Short plain-words label; undefined when the cause is not known. */
  readonly label?: string
  /** "retry" when retrying is the action; "fix-first" when the user must change something. */
  readonly action: "retry" | "fix-first"
  /** The config setting to name when the fix is a setting. */
  readonly setting?: string
}

const CAUSES: Record<Exclude<FactsFailureReason, "child_exit" | "other">, FactsFailureCause> = {
  deadline_exceeded: { label: "timeout", action: "retry" },
  memory_write_lock_exhausted: { label: "the memory write lock stayed busy", action: "retry" },
  unknown_liveness: { label: "the facts child stopped responding", action: "retry" },
  quick_category_unavailable: {
    label: "no model is available for facts extraction",
    action: "fix-first",
    setting: "memory.facts.model",
  },
  invalid_extraction: { label: "parse error", action: "fix-first" },
  payload_entry_oversize: { label: "one entry is too large to extract", action: "fix-first" },
  payload_envelope_oversize: { label: "the batch is too large to extract", action: "fix-first" },
  secret_like_content: { label: "secret-like content in the batch", action: "fix-first" },
  parent_dirty: { label: "the memory repository has uncommitted changes", action: "fix-first" },
}

export function classifyFactsFailure(record: FactsFailureRecord): FactsFailureCause {
  if (record.lastReason === "other") return { action: "retry" }
  if (record.lastReason === "child_exit") {
    const detail = childFailureCause(record.lastDetail)
    return { label: detail ?? "the facts child exited", action: "fix-first" }
  }
  return CAUSES[record.lastReason]
}

function parkedOf(records: readonly FactsFailureRecord[]): readonly FactsFailureRecord[] {
  return records.filter((record) => record.state === "parked")
}

/** Label groups over parked records, most frequent first, label order breaking ties. */
function causeCounts(records: readonly FactsFailureRecord[]): readonly { cause: FactsFailureCause; count: number }[] {
  const byLabel = new Map<string, { cause: FactsFailureCause; count: number }>()
  for (const record of parkedOf(records)) {
    const cause = classifyFactsFailure(record)
    if (cause.label === undefined) continue
    const entry = byLabel.get(cause.label)
    if (entry === undefined) byLabel.set(cause.label, { cause, count: 1 })
    else entry.count += 1
  }
  return [...byLabel.values()].sort(
    (left, right) => right.count - left.count || (left.cause.label ?? "").localeCompare(right.cause.label ?? ""),
  )
}

/** The must-fix cause covering the most parked batches: the one the to-do names. */
export function dominantFixFirstCause(records: readonly FactsFailureRecord[]): FactsFailureCause | undefined {
  return causeCounts(records).find((entry) => entry.cause.action === "fix-first")?.cause
}

/**
 * The run directory of the newest parked batch, where its outcome log lives
 * (`<facts>/runs/<runId>`; the failure id IS the run id). The id is basename-checked
 * before it is joined into a path, mirroring `locateReflectionChildLog`.
 */
export function parkedRunPath(records: readonly FactsFailureRecord[], factsDir: string | undefined): string | undefined {
  if (factsDir === undefined) return undefined
  const newest = [...parkedOf(records)].sort(
    (left, right) => Date.parse(right.lastFailureAt) - Date.parse(left.lastFailureAt),
  )[0]
  const id = newest?.lastFailureId.trim() ?? ""
  if (id === "" || id === "." || id === ".." || basename(id) !== id) return undefined
  return join(factsDir, "runs", id)
}

/**
 * The quieter segment after the to-do: cause counts over the parked batches plus the
 * newest parked batch's run path. An unknown cause contributes no label, never a guess,
 * but the run path still renders so the reader has somewhere to look.
 */
export function factsParkedCauseSummary(
  records: readonly FactsFailureRecord[],
  factsDir: string | undefined,
): string | undefined {
  if (parkedOf(records).length === 0) return undefined
  const segments: string[] = []
  const counts = causeCounts(records)
  if (counts.length > 0) {
    const list = counts.map((entry) => `${entry.cause.label} x${entry.count}`).join(", ")
    segments.push(`${counts.length === 1 ? "cause" : "causes"}: ${list}`)
  }
  const runPath = parkedRunPath(records, factsDir)
  if (runPath !== undefined) segments.push(`last run: ${runPath}`)
  return segments.length === 0 ? undefined : segments.join("; ")
}
