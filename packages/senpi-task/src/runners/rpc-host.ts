import { mkdir } from "node:fs/promises"
import { dirname } from "node:path"
import { randomUUID } from "node:crypto"
import { log } from "@oh-my-opencode/utils"

import type { HostEnginePolicy } from "../lazy/senpi-barrel"
import { asSenpiThinkingLevel } from "../senpi/thinking-level"
import { RunnerError } from "./in-process/runner-error"
import { HostUnavailableError, ensureTaskDaemon, type EnsureTaskDaemonInput, type EnsuredTaskDaemon } from "./rpc-host/daemon"
import { createHostSessionHandle } from "./rpc-host/handle"
import type { HostSessionChildHandle, HostSessionPort } from "./rpc-host/handle-port"
import { HostSessionClient, type OpenedHostSession } from "./rpc-host/session-client"
import { buildChildContext, resolveChildSessionPath } from "./rpc-host/session-context"
import type { HostSessionOpenInput } from "./rpc-host/session-transport"
import { createRpcModelAdmission, type RpcModelAdmission } from "./rpc/model-admission"
import { discardUnstartedRpcHandle } from "./rpc/start-cleanup"
import type { RpcChildHandle, RpcEntriesResult, RpcRunnerSpec, RpcSwitchSessionResult } from "./types"

const DEFAULT_HEARTBEAT_INTERVAL_MS = 10_000
const DEFAULT_CLOSE_GRACE_MS = 5_000

/** ONE child's session on the daemon: the port the handle drives, plus the calls the runner makes. */
export interface HostSessionChannel extends HostSessionPort {
  open(input: HostSessionOpenInput): Promise<OpenedHostSession>
  getEntries(since?: string): Promise<RpcEntriesResult>
  switchSession(sessionPath: string): Promise<RpcSwitchSessionResult>
}

export type EnsureTaskDaemonPort = (input: EnsureTaskDaemonInput) => Promise<EnsuredTaskDaemon>
export type CreateHostSessionChannel = (socketPath: string) => HostSessionChannel

/** The per-child runner this one delegates to when the daemon cannot host a child. */
export interface FallbackChildRunner {
  start(spec: RpcRunnerSpec): Promise<RpcChildHandle>
}

export type RpcHostRunnerOptions = {
  readonly policy: HostEnginePolicy
  readonly agentDir: string
  readonly env?: Readonly<Record<string, string | undefined>>
  readonly ensureDaemon?: EnsureTaskDaemonPort
  readonly createClient?: CreateHostSessionChannel
  readonly modelAdmission?: RpcModelAdmission
  // The parent's `-e` extension entries, forwarded exactly as the per-child runner forwards them:
  // the daemon loads its own extension set, but admission and the fallback still need the parent's.
  readonly inheritedExtensions?: readonly string[]
  readonly heartbeatIntervalMs?: number
  readonly closeGraceMs?: number
  readonly fallback?: FallbackChildRunner
  readonly onWarning?: (message: string) => void
  readonly now?: () => number
}

/** Whether a started child lives on the daemon (a session) or in its own process (the fallback). */
export function isHostSessionHandle(handle: RpcChildHandle): handle is HostSessionChildHandle {
  return "kind" in handle && handle.kind === "host-session"
}

/**
 * Runs a `process`-mode child as a SESSION of the machine-wide senpi daemon: it attaches to (or
 * creates) that daemon through the engine's own ensure, opens one retained worker session per
 * child, and returns the same steerable handle shape the per-child runner returns. It spawns
 * nothing itself and holds no pid - a session's death is a session record, never a signal.
 *
 * When the daemon cannot host a child for a reason the engine marked as fallback-allowed (a
 * narrower or pre-change daemon, win32, a Node runtime without bun), the child is delegated to the
 * per-child `RpcProcessRunner` and the reason is warned ONCE per runner. Every other reason fails
 * closed with `host_unavailable`: a refused client must never start a second host beside the daemon.
 */
export class RpcHostRunner {
  private readonly options: RpcHostRunnerOptions
  private readonly ensureDaemon: EnsureTaskDaemonPort
  private readonly createClient: CreateHostSessionChannel
  private readonly modelAdmission: RpcModelAdmission
  private readonly inheritedExtensions: readonly string[]
  private readonly now: () => number
  private readonly onWarning: (message: string) => void
  private readonly warned = new Set<string>()

  constructor(options: RpcHostRunnerOptions) {
    this.options = options
    this.ensureDaemon = options.ensureDaemon ?? ensureTaskDaemon
    this.createClient = options.createClient ?? ((socketPath) => new HostSessionClient({ socketPath }))
    this.modelAdmission = options.modelAdmission ?? createRpcModelAdmission()
    this.inheritedExtensions = options.inheritedExtensions ?? []
    this.now = options.now ?? Date.now
    this.onWarning = options.onWarning ?? ((message) => log("senpi-task host runner fallback", { message }))
  }

  async start(specInput: RpcRunnerSpec): Promise<RpcChildHandle> {
    const spec =
      specInput.extensions === undefined && this.inheritedExtensions.length > 0
        ? { ...specInput, extensions: this.inheritedExtensions }
        : specInput
    await this.modelAdmission(spec)
    try {
      const daemon = await this.ensureDaemon({
        agentDir: this.options.agentDir,
        env: this.options.env ?? process.env,
        policy: this.options.policy,
      })
      return await this.openChild(spec, daemon.socket)
    } catch (error) {
      if (RunnerError.is(error)) throw error
      return await this.delegate(error, spec)
    }
  }

  /**
   * The LOUD, narrow fallback. `fallbackAllowed` is the engine's own verdict (`daemon.ts`), so the
   * set of reasons that may run a child as its own process is stated exactly once.
   */
  private async delegate(error: unknown, spec: RpcRunnerSpec): Promise<RpcChildHandle> {
    const fallback = this.options.fallback
    if (fallback === undefined || !(error instanceof HostUnavailableError) || !error.fallbackAllowed) {
      throw new RunnerError({
        kind: "host_unavailable",
        message: error instanceof Error ? error.message : String(error),
        cause: error,
      })
    }
    if (!this.warned.has(error.reason)) {
      this.warned.add(error.reason)
      this.onWarning(`host_unavailable:${error.reason} - task children run as their own process: ${error.message}`)
    }
    return await fallback.start(spec)
  }

  private async openChild(spec: RpcRunnerSpec, socket: string): Promise<RpcChildHandle> {
    const client = this.createClient(socket)
    const sessionPath =
      spec.resumeSessionPath ??
      resolveChildSessionPath(spec.state_dir, spec.task_id, new Date(this.now()), randomUUID())
    // The daemon lstat()s the JSONL's directory before it opens the session and refuses with
    // ENOENT when it is missing. A child process used to create that directory for itself; on the
    // daemon path the client names the path, so the client creates the directory.
    if (spec.resumeSessionPath === undefined) await mkdir(dirname(sessionPath), { recursive: true })
    const opened = await this.openSession(client, spec, sessionPath)
    const handle = createHostSessionHandle({
      client,
      session: { routingId: opened.sessionId, sessionPath, instanceId: opened.instanceId },
      taskId: spec.task_id,
      heartbeatIntervalMs: this.options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS,
      now: this.now,
      closeGraceMs: this.options.closeGraceMs ?? DEFAULT_CLOSE_GRACE_MS,
    })
    // A resumed child says nothing: an attached session is still mid-turn, and a session reopened
    // from its JSONL keeps its transcript - replaying the prompt would duplicate the work.
    if (spec.resumeSessionPath === undefined) await this.startTurn(handle, spec)
    return Object.assign(handle, {
      spawnSpec: {
        cwd: spec.cwd,
        ...(spec.extensions === undefined ? {} : { extensions: spec.extensions }),
        ...(spec.memberEnv === undefined ? {} : { memberEnv: spec.memberEnv }),
      },
      // The session was opened AT this path, so resuming it is already done; only a different path
      // is a real switch.
      switchSession: (target: string): Promise<RpcSwitchSessionResult> =>
        target === sessionPath ? Promise.resolve({ cancelled: false }) : client.switchSession(target),
      getEntries: (since?: string) => client.getEntries(since),
    })
  }

  private async openSession(
    client: HostSessionChannel,
    spec: RpcRunnerSpec,
    sessionPath: string,
  ): Promise<OpenedHostSession> {
    const model = splitModelRef(spec.model)
    const thinkingLevel = asSenpiThinkingLevel(spec.reasoning ?? spec.variant)
    try {
      return await client.open({
        sessionPath,
        cwd: spec.cwd,
        ...(model === undefined ? {} : model),
        ...(thinkingLevel === undefined ? {} : { thinkingLevel }),
        ...buildChildContext(spec),
        retainOnDisconnect: true,
        autoTitle: false,
      })
    } catch (error) {
      if (error instanceof HostUnavailableError) throw error
      throw new RunnerError({
        kind: "session_unavailable",
        message: error instanceof Error ? error.message : String(error),
        cause: error,
      })
    }
  }

  private async startTurn(handle: HostSessionChildHandle, spec: RpcRunnerSpec): Promise<void> {
    try {
      await handle.startInitialPrompt(spec.prompt)
    } catch (error) {
      // Captured BEFORE cleanup: a rejected prompt can leave the session live, and the teardown
      // below must never be recorded as the cause of the rejection.
      const exitOutcome = handle.exitOutcome()
      try {
        await discardUnstartedRpcHandle(handle)
      } catch (cleanupError) {
        log("senpi-task host session start cleanup failed", { taskId: spec.task_id, error: String(cleanupError) })
      }
      throw new RunnerError({
        kind: "child-prompt-failed",
        message: error instanceof Error ? error.message : String(error),
        cause: error,
        rejected_while: exitOutcome === undefined ? "alive" : "exited",
        ...(exitOutcome === undefined
          ? {}
          : { exit: { kind: exitOutcome.kind, code: exitOutcome.facts.code, signal: exitOutcome.facts.signal } }),
      })
    }
  }
}

/** `provider/modelId` as the child command line spells it; anything else leaves the daemon's default. */
function splitModelRef(model: string | undefined): { readonly provider: string; readonly modelId: string } | undefined {
  if (model === undefined) return undefined
  const separator = model.indexOf("/")
  if (separator <= 0 || separator === model.length - 1) return undefined
  return { provider: model.slice(0, separator), modelId: model.slice(separator + 1) }
}
