import { optionalRendererText } from "./renderer-text"
import type { ParentModelFallback, ParentModelFallbackReason } from "./state"

const REASON_PHRASES: Readonly<Record<ParentModelFallbackReason, string>> = {
  usage_limit: "hit its usage limit",
  not_signed_in: "is not signed in",
  unavailable: "was overloaded or unavailable",
  refused: "refused the request",
  error: "failed",
}

function resetsSuffix(fallback: ParentModelFallback): string {
  const resets = optionalRendererText(fallback.resets)
  return resets === undefined ? "" : ` (resets ${resets})`
}

export function parentModelFallbackToken(fallback: ParentModelFallback | undefined): string | undefined {
  if (fallback === undefined) return undefined
  const short = fallback.reason === "usage_limit" ? "usage limit" : fallback.reason.replaceAll("_", " ")
  const resets = optionalRendererText(fallback.resets)
  return `parent-model:${short}${resets === undefined ? "" : `, resets ${resets}`}`
}

/**
 * The full sentence for task_output and the completion notice: which model it ran on, which model gave
 * out and why, and any tool call that was cut off and never ran.
 */
export function describeParentModelFallback(fallback: ParentModelFallback | undefined, parentModel: string | undefined): string | undefined {
  if (fallback === undefined) return undefined
  const parent = optionalRendererText(parentModel) ?? "the parent session's model"
  const from = optionalRendererText(fallback.from_model) ?? "its category model"
  const detail = fallback.reason === "error" || fallback.reason === "refused" ? optionalRendererText(fallback.detail) : undefined
  const interrupted = (fallback.interrupted_tools ?? []).map((tool) => optionalRendererText(tool)).filter((tool) => tool !== undefined)
  const head = `ran on the parent session's model ${parent}: ${from} ${REASON_PHRASES[fallback.reason]}${resetsSuffix(fallback)}`
  const withDetail = detail === undefined ? head : `${head} (${detail})`
  return interrupted.length === 0 ? withDetail : `${withDetail}; interrupted tool call not run: ${interrupted.join(", ")}`
}
