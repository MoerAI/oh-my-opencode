// Shared fixtures and readers for the task-host-e2e scenarios (todo 41): the sandbox omo.json every
// daemon scenario uses, the mock scripts that keep a child mid-turn or let it finish, and the readers
// that turn a child's session JSONL and the task store into scenario facts.
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

export const CHILD_PROMPT = "do the host child work and report"
const FAILURE_TOKENS = ["too_many_sessions", "host_unavailable"]

/** No `default_execution_mode`: `auto` must resolve to daemon sessions on its own (scenario I). */
export function hostConfig(overrides = {}) {
  return {
    task: { global_concurrency: 16, residency_max_children: 16, ...(overrides.task ?? {}) },
    team: { max_members: 8 },
    categories: { proc: { description: "Daemon-hosted mock category.", model: "omo-mock/mock-1" } },
    ...(overrides.extra ?? {}),
  }
}

export function spawnScript(count, childSteps, prefix = "c") {
  const parentSteps = []
  for (let index = 0; index < count; index += 1) {
    parentSteps.push({
      type: "tool_call",
      name: "task",
      arguments: { category: "proc", run_in_background: true, name: `${prefix}${index}`, prompt: CHILD_PROMPT },
    })
  }
  parentSteps.push({ type: "text", text: "parent fan-out complete" })
  return { parentSteps, childSteps }
}

/**
 * A child that stays mid-turn: the last scripted step repeats forever, so every provider call issues
 * another short bash sleep and the child's transcript keeps growing while it is never terminal.
 */
export const CHILD_BUSY = [{ type: "tool_call", name: "bash", arguments: { command: "sleep 2" } }]
export const CHILD_DONE = [{ type: "text", text: "host child mock work complete" }]

export const TERMINAL_STATUSES = new Set(["completed", "error", "lost", "cancelled"])

/**
 * A poll must stop when the answer can no longer change: once every expected child has reached a
 * terminal status, waiting for a live session count is waiting for something that will never happen.
 */
export function childrenSettled(records, count) {
  return records.length >= count && records.every((record) => TERMINAL_STATUSES.has(record.status))
}

export function childSessionFiles(sandbox, taskId) {
  const dir = join(sandbox.stateDir, "sessions", taskId)
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((file) => file.endsWith(".jsonl")).map((file) => join(dir, file))
}

export function jsonlLines(path) {
  if (!existsSync(path)) return []
  return readFileSync(path, "utf8").split("\n").filter((line) => line.trim().length > 0)
}

export function transcriptSizes(sandbox, records) {
  return Object.fromEntries(records.map((record) => [
    record.task_id,
    childSessionFiles(sandbox, record.task_id).reduce((total, file) => total + jsonlLines(file).length, 0),
  ]))
}

export function failureTokens(text) {
  return FAILURE_TOKENS.filter((token) => text.includes(token))
}

export function recordFailureTokens(records) {
  return failureTokens(records.map((record) => `${record.error_message ?? ""}`).join(" "))
}

/**
 * The shared child-start probe. Every daemon scenario depends on `open_session` succeeding, so when a
 * child cannot start the scenario says so with the store's own failure kind instead of reporting a
 * downstream symptom.
 */
export function childStartDiagnosis(sandbox, records) {
  const failed = records.filter((record) => record.status === "error")
  const sessionsDir = join(sandbox.stateDir, "sessions")
  return {
    total: records.length,
    running: records.filter((record) => record.status === "running").length,
    completed: records.filter((record) => record.status === "completed").length,
    errored: failed.length,
    errorMessages: [...new Set(failed.map((record) => record.error_message))].slice(0, 3),
    childSessionsDirExists: existsSync(sessionsDir),
    executionModes: [...new Set(records.map((record) => record.execution_mode))],
  }
}

