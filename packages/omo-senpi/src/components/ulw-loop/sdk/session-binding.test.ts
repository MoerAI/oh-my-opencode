import { expect, test } from "bun:test"
import { join } from "node:path"
import { toolkitContextFromEnv } from "./session-binding"

const env = { PI_SESSION_ID: "s1", PI_SESSION_CWD: "/w", PI_GOAL_STORE_FILE: "/g/s1.json" }
// The binder derives the fallback candidate with `path.join`, so the expectation is built from the same
// segments instead of a POSIX literal that Windows never produces.
const fallback = join("/w", ".omo", "goal", "s1.json")

test("#given documented env #when bound #then context and ordered candidates are explicit", () => {
  expect(toolkitContextFromEnv(env)).toEqual({ cwd: "/w", sessionId: "s1", rawSessionId: "s1", surface: "omo-senpi", goalStorePaths: ["/g/s1.json", fallback], warnings: [] })
  expect(toolkitContextFromEnv({ ...env, PI_GOAL_STORE_FILE: fallback }).goalStorePaths).toEqual([fallback])
  expect(toolkitContextFromEnv({ ...env, PI_GOAL_STORE_FILE: undefined }).goalStorePaths).toEqual([fallback])
})

test("#given missing or invalid session facts #when bound #then domain codes fail closed", () => {
  for (const [input, code] of [
    [{ ...env, PI_SESSION_ID: undefined }, "ULW_LOOP_SESSION_ID_REQUIRED"],
    [{ ...env, PI_SESSION_ID: "  " }, "ULW_LOOP_SESSION_ID_REQUIRED"],
    [{ ...env, PI_SESSION_ID: ".." }, "ULW_LOOP_SESSION_ID_INVALID"],
    [{ ...env, PI_SESSION_CWD: undefined }, "ULW_LOOP_CWD_REQUIRED"],
  ] satisfies [Record<string, string | undefined>, string][]) {
    expect(() => toolkitContextFromEnv(input)).toThrow(expect.objectContaining({ name: "UlwLoopError", code }))
  }
})

test("#given a relative goal-store override #when bound #then it is ignored with a warning", () => {
  const bound = toolkitContextFromEnv({ ...env, PI_GOAL_STORE_FILE: "relative.json" })
  expect(bound.goalStorePaths).toEqual([fallback])
  expect(bound.warnings).toHaveLength(1)
})
