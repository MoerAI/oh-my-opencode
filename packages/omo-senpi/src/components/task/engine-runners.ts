import type { ToolDefinition } from "@code-yeongyu/senpi"
import type { OmoConfig, OmoTaskSettings } from "@oh-my-opencode/omo-config-core"
import {
  BUILTIN_AGENTS,
  CURATED_READONLY_AGENT_NAMES,
  InProcessRunner,
  ULW_REVIEWER_AGENT_NAMES,
  RpcHostRunner,
  RpcProcessRunner,
  ensureTaskDaemon,
  createInProcessManagedRunner,
  createParentRegistrySessionContext,
  createRpcManagedRunner,
  mapOmoConfigAgents,
  parseExtensionEntries,
  type AgentDefinition,
  type KernelToolBindingRegistry,
  type ManagedRunner,
} from "@oh-my-opencode/senpi-task"

import { resolveAgentHome } from "../agent-home/resolve-agent-home"
import { MEMORY_TOOL_NAME } from "../memory/tools"
import type { TaskRuntimeContext } from "./runtime-context"

// Memory tools are bound to the parent session's identity (repo commits + writer lock); question
// tools need a parent user UI. A task child must never inherit either, so they ride the same
// ui-only exclusion as render-only tools.
export const TASK_CHILD_UI_ONLY_TOOL_NAMES: readonly string[] = [
  MEMORY_TOOL_NAME,
  "request_user_input",
  "ask_user_question",
]

export interface RunnerBuildContext {
  readonly runtime: TaskRuntimeContext
  readonly sharedParentTools: () => readonly ToolDefinition[]
  readonly settings: OmoTaskSettings
  // The engine's runtime-only parent kernel-tool map (item 6); absent in bare test wirings.
  readonly kernelToolBindings?: KernelToolBindingRegistry
  // Where the shared daemon lives and which platform decides it can be used. Injected so a suite
  // can pin the win32 branch without pretending to run on Windows; both default to this process.
  readonly platform?: NodeJS.Platform
  readonly agentDir?: string
  readonly env?: Readonly<Record<string, string | undefined>>
  // Where a daemon fallback reason goes. Defaults to the module logger; the engine passes the
  // session's deduped notice list so the same reason reaches `task_output` exactly once.
  readonly onHostWarning?: (message: string) => void
}

export interface TaskRunnerFactories {
  readonly inProcess: (context: RunnerBuildContext) => ManagedRunner
  readonly process: (context: RunnerBuildContext) => ManagedRunner
}

export const DEFAULT_RUNNER_FACTORIES: TaskRunnerFactories = {
  inProcess: buildInProcessRunner,
  process: buildProcessRunner,
}

export function resolveTaskAgents(config: OmoConfig): Readonly<Record<string, AgentDefinition>> {
  const merged: Record<string, AgentDefinition> = { ...BUILTIN_AGENTS }
  for (const [name, definition] of Object.entries(mapOmoConfigAgents(config))) {
    merged[name] = { ...merged[name], ...definition }
  }
  for (const name of CURATED_READONLY_AGENT_NAMES) {
    const definition = merged[name]
    if (definition !== undefined) merged[name] = { ...definition, executionMode: "in-process" }
  }
  for (const name of ULW_REVIEWER_AGENT_NAMES) {
    const definition = merged[name]
    if (definition !== undefined) merged[name] = { ...definition, executionMode: "in-process" }
  }
  return merged
}

function buildInProcessRunner(build: RunnerBuildContext): ManagedRunner {
  const inProcess = new InProcessRunner({
    get sharedParentTools(): readonly ToolDefinition[] {
      return build.sharedParentTools()
    },
    uiOnlyToolNames: TASK_CHILD_UI_ONLY_TOOL_NAMES,
    depthPolicy: { maxDepth: Math.max(build.settings.max_depth + 1, 1) },
    ...(build.kernelToolBindings === undefined ? {} : { kernelToolBindings: build.kernelToolBindings }),
  })
  const context = createParentRegistrySessionContext(() => build.runtime.modelRegistry())
  return createInProcessManagedRunner(inProcess, context)
}

function buildProcessRunner(build: RunnerBuildContext): ManagedRunner {
  return createRpcManagedRunner(buildProcessChildRunner(build))
}

/**
 * WHICH runner a `process` child gets. The default is a session of the machine-wide senpi daemon;
 * `task.process_runner: "child-process"` and win32 (no daemon runner path there) keep the per-child
 * process runner, which is also the daemon runner's loud fallback for the narrow set of reasons the
 * engine marks fallback-allowed.
 */
export function buildProcessChildRunner(build: RunnerBuildContext): RpcHostRunner | RpcProcessRunner {
  const inheritedExtensions = parseExtensionEntries(process.argv)
  const perChild = new RpcProcessRunner({ inheritedExtensions })
  const platform = build.platform ?? process.platform
  if (build.settings.process_runner !== "host" || platform === "win32") return perChild
  const env = build.env ?? process.env
  const idleExitMs = build.settings.host_idle_exit_ms
  return new RpcHostRunner({
    policy: build.settings.host_engine_policy,
    agentDir: build.agentDir ?? resolveAgentHome({ env }),
    env,
    inheritedExtensions,
    fallback: perChild,
    ...(build.onHostWarning === undefined ? {} : { onWarning: build.onHostWarning }),
    // The only omo.json knob the launch spec yields to; every other daemon launch input is the
    // spec's, so `omo daemon run` and a child-triggered ensure cannot drift.
    ...(idleExitMs === undefined ? {} : { ensureDaemon: (input) => ensureTaskDaemon({ ...input, ports: { idleExitMs } }) }),
  })
}
