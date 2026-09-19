// Team + parking scenarios for task-host-e2e.mjs (todo 41): C proves a team member is a daemon session
// whose identity travels in the session context and whose lead mail is delivered, C2 proves a completed
// child is PARKED rather than closed and that `task_send` reopens it.
import { join } from "node:path"

import { createScenarioSandbox, writeMockScript, writeOmoConfig } from "./task-host-e2e-sandbox.mjs"
import {
  cleanupScenario,
  daemonStatus,
  perChildRpcProcesses,
  readTaskRecords,
  runBin,
  spawnParent,
  waitFor,
} from "./task-host-e2e-process.mjs"
import {
  CHILD_BUSY,
  CHILD_DONE,
  CHILD_PROMPT,
  childSessionFiles,
  childStartDiagnosis,
  childrenSettled,
  failureTokens,
  hostConfig,
  jsonlLines,
  recordFailureTokens,
  spawnScript,
  transcriptSizes,
} from "./task-host-e2e-support.mjs"

const TEAM_MAIL = "LEAD2MEMBER daemon mail delivered"

export async function scenarioC(run) {
  const config = hostConfig()
  config.categories.quick = { description: "Team member mock category.", model: "omo-mock/mock-1" }
  const sandbox = createScenarioSandbox(run, "sC", {
    omoConfig: config,
    script: {
      parentSteps: [
        {
          type: "tool_call",
          name: "team_create",
          arguments: {
            inline_spec: {
              name: "hostteam",
              members: [{ name: "quick", kind: "category", category: "quick", prompt: "You are team member 'quick'. Acknowledge and wait." }],
            },
          },
        },
        { type: "tool_call", name: "task_send", arguments: { to: "quick", message: TEAM_MAIL } },
        { type: "tool_call", name: "task_list", arguments: {} },
        { type: "text", text: "team scenario complete" },
      ],
      childSteps: CHILD_BUSY,
    },
  })
  const parent = spawnParent(sandbox, run.mockEntry, "create a team whose members live in the daemon", { capture: true })
  const started = await waitFor(() => {
    const records = readTaskRecords(sandbox).filter((record) => record.name === "quick")
    if (records.length === 0) return undefined
    return records.every((record) => record.status === "running") || childrenSettled(records, 1) ? records : undefined
  }, { timeoutMs: 120_000, intervalMs: 500 })
  const members = started ?? readTaskRecords(sandbox).filter((record) => record.name === "quick")
  const status = daemonStatus(sandbox, { includeWorkers: true })
  const mailDelivered = members.some((record) =>
    childSessionFiles(sandbox, record.task_id).some((file) => jsonlLines(file).some((line) => line.includes(TEAM_MAIL))))
  const context = await run.probeSessionContext(join(sandbox.agentDir, "rpc", "rpc.sock"))
  const memberContext = context.rows?.filter((row) => row.context?.role === "member") ?? []
  const facts = {
    memberRecords: members.length,
    memberStatuses: members.map((record) => record.status),
    sessionsWorker: status.json?.sessions?.worker ?? null,
    mailDelivered,
    sessionContextProbe: context.probe,
    memberSessionContexts: memberContext.map((row) => row.context),
    childStart: childStartDiagnosis(sandbox, readTaskRecords(sandbox)),
  }
  const pass = members.length > 0 && mailDelivered && memberContext.length > 0
  try {
    process.kill(-parent.child.pid, "SIGKILL")
  } catch {
    // already gone
  }
  const receipt = await cleanupScenario(sandbox, { hostPids: [status.json?.pid].filter(Boolean) })
  return {
    scenario: "C",
    title: "team members via daemon (identity from sessionContext, lead->member mail)",
    status: pass ? "pass" : "fail",
    ...(pass ? {} : { reason: `members=${members.length} mail=${mailDelivered} memberContexts=${memberContext.length} probe=${context.probe}` }),
    facts,
    receipt,
  }
}

const IDLE_EVICTION_MS = 15_000

export async function scenarioC2(run) {
  // The launch spec raises an inherited eviction window to the host's idle-exit window, so parking at
  // 15s needs BOTH the env var and `task.host_idle_exit_ms`, or the window silently becomes 15 minutes.
  const config = hostConfig({ task: { host_idle_exit_ms: IDLE_EVICTION_MS } })
  const sandbox = createScenarioSandbox(run, "sC2", {
    omoConfig: config,
    script: {
      parentSteps: [
        { type: "tool_call", name: "task", arguments: { category: "proc", run_in_background: true, name: "done", prompt: CHILD_PROMPT } },
        { type: "text", text: "parked child scenario complete" },
      ],
      childSteps: CHILD_DONE,
    },
  })
  const env = { SENPI_RPC_SESSION_IDLE_EVICTION_MS: String(IDLE_EVICTION_MS) }
  const first = runBin(sandbox, run.parentArgs(sandbox, "spawn one child and let it finish"), { timeoutMs: 180_000, env })
  const completed = readTaskRecords(sandbox).find((record) => record.name === "done")
  const before = daemonStatus(sandbox, { includeWorkers: true })
  // A park is only observable when there WAS a live worker session to park: with no worker, a zero
  // count is the starting state, not the eviction under test.
  const hadWorker = (before.json?.sessions?.worker ?? 0) >= 1
  const parked = !hadWorker ? undefined : await waitFor(() => {
    const probe = daemonStatus(sandbox, { includeWorkers: true })
    return probe.json !== undefined && probe.json.sessions.worker === 0 ? probe : undefined
  }, { timeoutMs: 90_000, intervalMs: 2_000 })
  const linesBefore = completed === undefined ? 0 : transcriptSizes(sandbox, [completed])[completed.task_id]
  writeMockScript(sandbox, {
    parentSteps: [
      { type: "tool_call", name: "task_send", arguments: { to: "done", message: "reopen the parked session" } },
      { type: "text", text: "reopen complete" },
    ],
    childSteps: CHILD_DONE,
  })
  const reopen = runBin(sandbox, run.parentArgs(sandbox, "reopen the parked child"), { timeoutMs: 180_000, env })
  const linesAfter = completed === undefined ? 0 : transcriptSizes(sandbox, [completed])[completed.task_id]
  const facts = {
    firstRunExit: first.status,
    childCompleted: completed?.status ?? null,
    workerSessionsBeforePark: before.json?.sessions?.worker ?? null,
    retainedBeforePark: before.json?.sessions?.retained ?? null,
    hadWorkerSessionBeforePark: hadWorker,
    parkObserved: hadWorker && parked !== undefined,
    workerSessionsAfterPark: parked?.json?.sessions?.worker ?? daemonStatus(sandbox, { includeWorkers: true }).json?.sessions?.worker ?? null,
    reopenExit: reopen.status,
    transcriptLinesBeforeReopen: linesBefore,
    transcriptLinesAfterReopen: linesAfter,
    childStart: childStartDiagnosis(sandbox, readTaskRecords(sandbox)),
  }
  const pass = completed?.status === "completed" && facts.parkObserved === true && reopen.status === 0 && linesAfter > linesBefore
  const receipt = await cleanupScenario(sandbox, { hostPids: [before.json?.pid].filter(Boolean) })
  return {
    scenario: "C2",
    title: "parking: completed child parked, task_send reopens it",
    status: pass ? "pass" : "fail",
    ...(pass ? {} : { reason: `child=${facts.childCompleted} parked=${facts.parkObserved} reopenExit=${reopen.status} lines ${linesBefore}->${linesAfter}` }),
    facts,
    receipt,
  }
}

