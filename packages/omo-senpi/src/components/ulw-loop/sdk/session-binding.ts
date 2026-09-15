import { isAbsolute, join } from "node:path"
import { normalizeUlwLoopSessionId } from "../../../../../omo-codex/plugin/components/ulw-loop/src/paths.js"
import { UlwLoopError } from "../../../../../omo-codex/plugin/components/ulw-loop/src/runtime.js"
import type { ToolkitContext } from "../../../../../omo-codex/plugin/components/ulw-loop/src/sdk.js"

export interface SessionToolkitContext extends ToolkitContext {
  readonly rawSessionId: string
  readonly goalStorePaths: readonly string[]
  readonly warnings: readonly string[]
}

export function toolkitContextFromEnv(env: Readonly<Record<string, string | undefined>> = process.env): SessionToolkitContext {
  const rawSessionId = env.PI_SESSION_ID
  if (!rawSessionId?.trim()) throw new UlwLoopError("PI_SESSION_ID is required.", "ULW_LOOP_SESSION_ID_REQUIRED")
  const sessionId = normalizeUlwLoopSessionId(rawSessionId)
  if (sessionId === null) throw new UlwLoopError("PI_SESSION_ID is invalid.", "ULW_LOOP_SESSION_ID_INVALID")
  const cwd = env.PI_SESSION_CWD
  if (!cwd?.trim()) throw new UlwLoopError("PI_SESSION_CWD is required.", "ULW_LOOP_CWD_REQUIRED")
  const warnings: string[] = []
  const goalStorePaths: string[] = []
  const override = env.PI_GOAL_STORE_FILE
  if (override) {
    if (isAbsolute(override)) goalStorePaths.push(override)
    else warnings.push("Ignoring relative PI_GOAL_STORE_FILE.")
  }
  goalStorePaths.push(join(cwd, ".omo", "goal", `${encodeURIComponent(rawSessionId)}.json`))
  return { cwd, sessionId, rawSessionId, surface: "omo-senpi", goalStorePaths: [...new Set(goalStorePaths)], warnings }
}
