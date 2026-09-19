// Daemon fan-out and detach/attach scenarios for task-host-e2e.mjs (todo 41): A proves one daemon
// carries two parents' worth of children as sessions, B proves those sessions outlive their parent and
// are re-attached without replaying a prompt, I proves the default-mode rule both ways.
import { join } from "node:path"

import { createScenarioSandbox, writeMockScript, writeOmoConfig } from "./task-host-e2e-sandbox.mjs"
import {
  cleanupScenario,
  daemonStatus,
  observeDaemon,
  perChildRpcProcesses,
  readTaskRecords,
  runBin,
  spawnParent,
  waitFor,
} from "./task-host-e2e-process.mjs"

/** The engine's own words about who serves the socket: what a parent printed about host/ensure/handoff. */
function hostLines(text) {
  const seen = new Set()
  for (const line of text.split("\n")) {
    const trimmed = line.trim()
    if (trimmed.length > 0 && /host|ensure|handoff|daemon|generation|socket/i.test(trimmed)) seen.add(trimmed.slice(0, 220))
  }
  return [...seen].slice(0, 12)
}
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

export async function scenarioA(run) {
  const sandbox = createScenarioSandbox(run, "sA", { omoConfig: hostConfig(), script: spawnScript(16, CHILD_BUSY) })
  const startedAt = Date.now()
  const parents = [0, 1].map(() => spawnParent(sandbox, run.mockEntry, "fan out sixteen daemon children", { capture: true }))
  const parentExits = []
  parents.forEach((parent, index) => {
    void parent.closed.then((closed) => parentExits.push({ parent: index, status: closed.status, signal: closed.signal, ms: Date.now() - startedAt }))
  })
  const watched = await observeDaemon(sandbox, (probe) => {
    if (probe.json?.sessions?.worker >= 32) return true
    return childrenSettled(readTaskRecords(sandbox), 32)
  }, { timeoutMs: 180_000, intervalMs: 1_000 })
  const observed = watched.matched ?? watched.lastProbe ?? daemonStatus(sandbox, { includeWorkers: true })
  const records = readTaskRecords(sandbox)
  const perChild = perChildRpcProcesses(sandbox)
  const parentOutput = parents.map((parent) => parent.chunks.stdout + parent.chunks.stderr).join("\n")
  const tokens = [...new Set([...failureTokens(parentOutput), ...recordFailureTokens(records)])]
  const facts = {
    sessionsTotal: observed.json?.sessions?.total ?? null,
    sessionsWorker: observed.json?.sessions?.worker ?? null,
    zombies: observed.json?.zombies ?? null,
    daemonPid: observed.json?.pid ?? null,
    instanceId: observed.json?.instanceId ?? null,
    perChildRpcProcessCount: perChild.length,
    failureTokens: tokens,
    // Two parents ensure the SAME daemon concurrently and then exit while their children keep running,
    // so the question "was this one host for the whole scenario?" has to be answered from a timeline,
    // not from a single status call. Every identity change is an entry; the parents' exits are stamped
    // on the same clock, and their stderr host lines say which side started, reused or handed off.
    daemonIdentityTimeline: watched.timeline,
    daemonIdentitiesSeen: [...new Set(watched.timeline.map((entry) => entry.instanceId).filter(Boolean))].length,
    parentExits,
    parentStderrHostLines: parents.map((parent) => hostLines(parent.chunks.stderr)),
    childStart: childStartDiagnosis(sandbox, records),
    // The store collapses every start failure to one fixed sentence, so when no child could start the
    // daemon itself is asked with the exact `open_session` the host runner issues, and its verbatim
    // refusal is recorded. Without it the evidence would name a symptom and not a cause.
    ...(records.some((record) => record.status === "error")
      ? {
          rootCause: await run.probeChildSessionOpen(
            join(sandbox.agentDir, "rpc", "rpc.sock"),
            sandbox.cwd,
            join(sandbox.stateDir, "sessions", "st_probe", "probe.jsonl"),
          ),
        }
      : {}),
  }
  const pass =
    facts.sessionsTotal >= 32 && facts.sessionsWorker >= 32 && tokens.length === 0 && perChild.length === 0 &&
    facts.daemonIdentitiesSeen === 1
  for (const parent of parents) {
    try {
      process.kill(-parent.child.pid, "SIGKILL")
    } catch {
      // already gone
    }
  }
  const receipt = await cleanupScenario(sandbox, { hostPids: [facts.daemonPid].filter(Boolean) })
  return {
    scenario: "A",
    title: "one daemon, two parents x 16 process children",
    status: pass ? "pass" : "fail",
    ...(pass ? {} : { reason: `sessions.total=${facts.sessionsTotal} sessions.worker=${facts.sessionsWorker} perChildRpc=${perChild.length} tokens=${tokens.join(",")} daemonIdentities=${facts.daemonIdentitiesSeen}` }),
    facts,
    receipt,
  }
}

/**
 * The control for A. A is the only scenario where TWO clients ensure the same daemon at once, so when A
 * reports the host being replaced under its children there are two candidate causes: concurrent ensures
 * racing each other, or a fan-out the daemon does not survive on its own. A1 is A with ONE parent: a
 * stable identity here blames the race, an unstable one exonerates it.
 */
export async function scenarioA1(run) {
  const sandbox = createScenarioSandbox(run, "sA1", { omoConfig: hostConfig(), script: spawnScript(16, CHILD_BUSY, "s") })
  const startedAt = Date.now()
  const parent = spawnParent(sandbox, run.mockEntry, "fan out sixteen daemon children from one parent", { capture: true })
  const parentExits = []
  void parent.closed.then((closed) => parentExits.push({ parent: 0, status: closed.status, signal: closed.signal, ms: Date.now() - startedAt }))
  const watched = await observeDaemon(sandbox, (probe) => {
    if (probe.json?.sessions?.worker >= 16) return true
    return childrenSettled(readTaskRecords(sandbox), 16)
  }, { timeoutMs: 180_000, intervalMs: 1_000 })
  const observed = watched.matched ?? watched.lastProbe ?? daemonStatus(sandbox, { includeWorkers: true })
  const records = readTaskRecords(sandbox)
  const identities = [...new Set(watched.timeline.map((entry) => entry.instanceId).filter(Boolean))]
  const facts = {
    sessionsTotal: observed.json?.sessions?.total ?? null,
    sessionsWorker: observed.json?.sessions?.worker ?? null,
    daemonIdentityTimeline: watched.timeline,
    daemonIdentitiesSeen: identities.length,
    parentExits,
    parentStderrHostLines: hostLines(parent.chunks.stderr),
    perChildRpcProcessCount: perChildRpcProcesses(sandbox).length,
    childStart: childStartDiagnosis(sandbox, records),
  }
  const pass = facts.sessionsWorker >= 16 && identities.length === 1 && facts.perChildRpcProcessCount === 0
  try {
    process.kill(-parent.child.pid, "SIGKILL")
  } catch {
    // already gone
  }
  const receipt = await cleanupScenario(sandbox, { hostPids: [observed.json?.pid].filter(Boolean) })
  return {
    scenario: "A1",
    title: "single-parent control: 16 children, one daemon identity",
    status: pass ? "pass" : "fail",
    ...(pass ? {} : { reason: `sessions.worker=${facts.sessionsWorker} daemonIdentities=${identities.length} perChildRpc=${facts.perChildRpcProcessCount}` }),
    facts,
    receipt,
  }
}

export async function scenarioB(run) {
  const sandbox = createScenarioSandbox(run, "sB", { omoConfig: hostConfig(), script: spawnScript(4, CHILD_BUSY) })
  const parent = spawnParent(sandbox, run.mockEntry, "detach with four children mid turn", { capture: true })
  const started = await waitFor(() => {
    const records = readTaskRecords(sandbox)
    const running = records.filter((record) => record.status === "running").length
    return running >= 4 || childrenSettled(records, 4) ? records : undefined
  }, { timeoutMs: 120_000, intervalMs: 500 })
  const records = started ?? readTaskRecords(sandbox)
  const before = transcriptSizes(sandbox, records)
  try {
    process.kill(-parent.child.pid, "SIGKILL")
  } catch {
    // already exited
  }
  await parent.closed
  const grew = await waitFor(() => {
    const after = transcriptSizes(sandbox, records)
    return Object.keys(before).every((id) => (after[id] ?? 0) > (before[id] ?? 0)) ? after : undefined
  }, { timeoutMs: 60_000, intervalMs: 1_000 })
  const after = grew ?? transcriptSizes(sandbox, records)
  writeMockScript(sandbox, { parentSteps: [{ type: "text", text: "resume complete" }], childSteps: CHILD_BUSY })
  const resumed = runBin(sandbox, run.parentArgs(sandbox, "resume the detached children"), { timeoutMs: 180_000 })
  const replays = Object.fromEntries(records.map((record) => [
    record.task_id,
    childSessionFiles(sandbox, record.task_id)
      .flatMap((file) => jsonlLines(file))
      .filter((line) => line.includes(CHILD_PROMPT)).length,
  ]))
  const facts = {
    childrenStarted: records.filter((record) => record.status === "running").length,
    transcriptLinesBefore: before,
    transcriptLinesAfter: after,
    grewAfterParentExit: grew !== undefined,
    resumeExit: resumed.status,
    promptOccurrencesPerChild: replays,
    noPromptReplay: Object.values(replays).every((count) => count === 1),
    childStart: childStartDiagnosis(sandbox, records),
  }
  const pass = facts.childrenStarted >= 4 && facts.grewAfterParentExit && resumed.status === 0 && facts.noPromptReplay
  const receipt = await cleanupScenario(sandbox, { hostPids: [daemonStatus(sandbox).json?.pid].filter(Boolean) })
  return {
    scenario: "B",
    title: "detach/attach: parent quits with 4 children mid-turn",
    status: pass ? "pass" : "fail",
    ...(pass ? {} : { reason: `started=${facts.childrenStarted} grew=${facts.grewAfterParentExit} resumeExit=${resumed.status} noReplay=${facts.noPromptReplay}` }),
    facts,
    receipt,
  }
}

export async function scenarioI(run) {
  const sandbox = createScenarioSandbox(run, "sI", { omoConfig: hostConfig(), script: spawnScript(1, CHILD_DONE, "auto") })
  const auto = runBin(sandbox, run.parentArgs(sandbox, "default mode child"), { timeoutMs: 180_000 })
  const autoRecords = readTaskRecords(sandbox)
  const autoRpc = perChildRpcProcesses(sandbox).length
  const autoStatus = daemonStatus(sandbox, { includeWorkers: true })
  writeOmoConfig(sandbox, hostConfig({ task: { default_execution_mode: "in-process" } }))
  writeMockScript(sandbox, spawnScript(1, CHILD_DONE, "inproc"))
  const inProcess = runBin(sandbox, run.parentArgs(sandbox, "in-process mode child"), { timeoutMs: 180_000 })
  const inProcessRecords = readTaskRecords(sandbox).filter((record) => record.name?.startsWith("inproc"))
  const facts = {
    autoExit: auto.status,
    autoExecutionModes: [...new Set(autoRecords.filter((r) => r.name?.startsWith("auto")).map((r) => r.execution_mode))],
    autoChildStatuses: autoRecords.filter((r) => r.name?.startsWith("auto")).map((r) => r.status),
    autoPerChildRpcProcesses: autoRpc,
    autoDaemonReachable: autoStatus.exitCode === 0,
    inProcessExit: inProcess.status,
    inProcessExecutionModes: [...new Set(inProcessRecords.map((record) => record.execution_mode))],
    inProcessStatuses: inProcessRecords.map((record) => record.status),
    childStart: childStartDiagnosis(sandbox, autoRecords.filter((record) => record.name?.startsWith("auto"))),
  }
  const autoOk = facts.autoExecutionModes.join() === "process" && autoRpc === 0 && facts.autoChildStatuses.every((s) => s === "completed")
  const inProcessOk = facts.inProcessExecutionModes.join() === "in-process" && facts.inProcessStatuses.every((s) => s === "completed")
  const receipt = await cleanupScenario(sandbox, { hostPids: [autoStatus.json?.pid].filter(Boolean) })
  return {
    scenario: "I",
    title: "default-mode rule: unset omo.json -> daemon sessions, in-process -> in-process",
    status: autoOk && inProcessOk ? "pass" : "fail",
    ...(autoOk && inProcessOk ? {} : { reason: `auto=${facts.autoExecutionModes.join()}/${facts.autoChildStatuses.join()} perChildRpc=${autoRpc} inProcess=${facts.inProcessExecutionModes.join()}/${facts.inProcessStatuses.join()}` }),
    facts,
    receipt,
  }
}
