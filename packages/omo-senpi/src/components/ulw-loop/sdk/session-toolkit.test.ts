import { afterEach, beforeEach, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { agentToolkit } from "./session-toolkit"

const keys = ["PI_SESSION_ID", "PI_SESSION_CWD", "PI_GOAL_STORE_FILE"]
let saved: (string | undefined)[] = []
let cwd = ""
beforeEach(() => {
  saved = keys.map(key => process.env[key])
  cwd = mkdtempSync(join(tmpdir(), "sdk-session-"))
  process.env.PI_SESSION_ID = "sdk-session"
  process.env.PI_SESSION_CWD = cwd
  delete process.env.PI_GOAL_STORE_FILE
})
afterEach(() => {
  keys.forEach((key, i) => { const value = saved[i]; if (value === undefined) delete process.env[key]; else process.env[key] = value })
  rmSync(cwd, { recursive: true, force: true })
})

test("#given no session #when status runs #then it resolves a failure without writes", async () => {
  delete process.env.PI_SESSION_ID
  expect(await agentToolkit.status()).toMatchObject({ ok: false, operation: "status", error: { code: "ULW_LOOP_SESSION_ID_REQUIRED" } })
  expect(existsSync(join(cwd, ".omo", "ulw-loop"))).toBe(false)
})

test("#given changing env #when calls overlap #then binding is synchronous and never cached", async () => {
  expect(await agentToolkit.status()).toMatchObject({ ok: false })
  const first = agentToolkit.createGoals({ brief: "- alpha goal" })
  process.env.PI_SESSION_ID = "second"
  const second = agentToolkit.createGoals({ brief: "- beta goal" })
  expect((await first).ok).toBe(true)
  expect((await second).ok).toBe(true)
  for (const id of ["sdk-session", "second"]) expect(existsSync(join(cwd, ".omo", "ulw-loop", id, "goals.json"))).toBe(true)
})

for (const explicit of [false, true]) {
  test(`#given a driver store #when checkpoint explicit=${explicit} #then the chosen snapshot reaches the ledger`, async () => {
    const goal = { objective: explicit ? "explicit" : "store", status: "active" }
    process.env.PI_GOAL_STORE_FILE = join(cwd, "driver.json")
    writeFileSync(process.env.PI_GOAL_STORE_FILE, JSON.stringify({ version: 1, goal: { objective: "store", status: "active" } }))
    expect((await agentToolkit.createGoals({ brief: "- alpha goal\n- beta goal" })).ok).toBe(true)
    expect((await agentToolkit.completeGoals()).ok).toBe(true)
    const goalId = "G001-alpha-goal"
    for (const criterionId of ["C001", "C002", "C003"]) expect((await agentToolkit.recordEvidence({ goalId, criterionId, status: "pass", evidence: "proof" })).ok).toBe(true)
    expect((await agentToolkit.checkpoint({ goalId, status: "complete", evidence: "proof", ...(explicit ? { codexGoalJson: JSON.stringify({ goal }) } : {}) })).ok).toBe(true)
    const ledger = readFileSync(join(cwd, ".omo", "ulw-loop", "sdk-session", "ledger.jsonl"), "utf8").trim().split("\n").map(line => JSON.parse(line))
    expect(ledger.map(entry => entry.codexGoal)).toContainEqual({ goal })
  })
}

test("#given no snapshot #when review blockers are recorded #then missing argument is an envelope", async () => {
  expect(await agentToolkit.recordReviewBlockers({ goalId: "G001", title: "blocker", objective: "fix", evidence: "proof" })).toMatchObject({ ok: false, operation: "record-review-blockers", error: { code: "ULW_LOOP_ARGUMENT_MISSING" } })
})
