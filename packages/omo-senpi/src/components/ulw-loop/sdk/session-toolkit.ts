import {
  createAgentToolkit,
  ULW_LOOP_OPERATIONS,
  type AgentToolkit,
  type RecordReviewBlockersArgs,
  type ToolkitDispatchRequest,
  type ToolkitUnknownRequest,
  type ToolkitFailure,
  type ToolkitResponseFor,
} from "../../../../../omo-codex/plugin/components/ulw-loop/src/sdk.js"
import { UlwLoopError } from "../../../../../omo-codex/plugin/components/ulw-loop/src/runtime.js"
import { readDriverGoalJson } from "./driver-goal"
import { toolkitContextFromEnv, type SessionToolkitContext } from "./session-binding"

export type SessionRecordReviewBlockersArgs = Omit<RecordReviewBlockersArgs, "codexGoalJson"> & { readonly codexGoalJson?: string }
export type SessionAgentToolkit = Omit<AgentToolkit, "recordReviewBlockers"> & {
  readonly recordReviewBlockers: (args: SessionRecordReviewBlockersArgs) => Promise<ToolkitResponseFor<"record-review-blockers">>
}

function failure<Operation extends string>(operation: Operation, error: unknown): ToolkitFailure<Operation> {
  return {
    ok: false,
    operation,
    error: {
      code: error instanceof UlwLoopError ? error.code : "ULW_LOOP_ERROR",
      message: error instanceof Error ? error.message : String(error),
    },
  }
}

// Binding and snapshot reads happen on the synchronous portion of each call, never at import time.
async function invoke<Operation extends string, Result extends { readonly ok: boolean }>(
  operation: Operation,
  run: (toolkit: AgentToolkit, context: SessionToolkitContext, warnings: string[]) => Promise<Result>,
): Promise<Result | ToolkitFailure<Operation>> {
  try {
    const context = toolkitContextFromEnv(process.env)
    const toolkit = createAgentToolkit(context)
    const warnings = [...context.warnings]
    const response = await run(toolkit, context, warnings)
    if (response.ok && warnings.length > 0) {
      const existing = "warnings" in response && Array.isArray(response.warnings) ? response.warnings : []
      return { ...response, warnings: [...existing, ...warnings] }
    }
    return response
  } catch (error) {
    return failure(operation, error)
  }
}

function snapshot(explicit: string | undefined, context: SessionToolkitContext, warnings: string[]): string | undefined {
  if (explicit !== undefined) return explicit
  const derived = readDriverGoalJson(context.goalStorePaths)
  warnings.push(...derived.warnings)
  return derived.codexGoalJson
}

function isKnownRequest(request: ToolkitDispatchRequest | ToolkitUnknownRequest): request is ToolkitDispatchRequest {
  return ULW_LOOP_OPERATIONS.some(operation => operation === request.operation)
}

export const agentToolkit: SessionAgentToolkit = {
  help: () => invoke("help", toolkit => toolkit.help()),
  status: () => invoke("status", toolkit => toolkit.status()),
  createGoals: args => invoke("create-goals", toolkit => toolkit.createGoals(args)),
  completeGoals: args => invoke("complete-goals", toolkit => toolkit.completeGoals(args)),
  criteria: args => invoke("criteria", toolkit => toolkit.criteria(args)),
  recordEvidence: args => invoke("record-evidence", toolkit => toolkit.recordEvidence(args)),
  addGoal: args => invoke("add-goal", toolkit => toolkit.addGoal(args)),
  steer: args => invoke("steer", toolkit => toolkit.steer(args)),
  checkpoint: args => invoke("checkpoint", (toolkit, context, warnings) => {
    if (args.printTemplate === true) return toolkit.checkpoint(args)
    const codexGoalJson = snapshot(args.codexGoalJson, context, warnings)
    return toolkit.checkpoint({ ...args, ...(codexGoalJson === undefined ? {} : { codexGoalJson }) })
  }),
  recordReviewBlockers: args => invoke("record-review-blockers", (toolkit, context, warnings) => {
    const codexGoalJson = snapshot(args.codexGoalJson, context, warnings)
    if (codexGoalJson === undefined) throw new UlwLoopError("A driver goal snapshot is required.", "ULW_LOOP_ARGUMENT_MISSING")
    return toolkit.recordReviewBlockers({ ...args, codexGoalJson })
  }),
  dispatch: request => {
    if (isKnownRequest(request)) {
      if (request.operation === "checkpoint") return agentToolkit.checkpoint(request.args)
      if (request.operation === "record-review-blockers") return agentToolkit.recordReviewBlockers(request.args)
    }
    return invoke(request.operation, toolkit => toolkit.dispatch(request))
  },
}
