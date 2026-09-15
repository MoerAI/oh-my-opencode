import { readFileSync, statSync } from "node:fs"
import { join } from "node:path"

const STATUS_KEY = "ulw-loop"
const FRAME_INTERVAL_MS = 320
const BRAILLE_BLANK = "\u2800"

export const ULW_LOOP_FOOTER_FRAMES = [
  `⚡ ultraworking${BRAILLE_BLANK.repeat(3)}`,
  `⚡ ultraworking.${BRAILLE_BLANK.repeat(2)}`,
  `⚡ ultraworking..${BRAILLE_BLANK}`,
  "⚡ ultraworking...",
] as const

type TimerHandle = ReturnType<typeof setInterval> | number

export interface UlwLoopFooterTimers {
  set(callback: () => void, intervalMs: number): TimerHandle
  clear(handle: TimerHandle): void
}

export interface UlwLoopFooterStatusOptions {
  readonly isGoalActive?: (runtime: UlwLoopFooterRuntime) => boolean
  readonly timers?: UlwLoopFooterTimers
}

export interface UlwLoopFooterUi {
  setStatus(key: string, text: string | undefined): void
}

export interface UlwLoopFooterRuntime {
  readonly ui: UlwLoopFooterUi
  readonly goalPaths: readonly string[]
}

export interface UlwLoopFooterStatus {
  sync(eventCtx: unknown, ulwActive: boolean): void
  dispose(): void
}

export function createUlwLoopFooterStatus(options: UlwLoopFooterStatusOptions = {}): UlwLoopFooterStatus {
  const goalCache = createGoalJsonCache()
  const isGoalActive = options.isGoalActive ?? ((runtime: UlwLoopFooterRuntime) => goalActiveFromContext(runtime, goalCache))
  const timers = options.timers ?? defaultTimers
  let timer: TimerHandle | undefined
  let frameIndex = 0
  let runtime: UlwLoopFooterRuntime | undefined
  let published = false
  let ulwActive = false

  function publish(): void {
    const frame = ULW_LOOP_FOOTER_FRAMES[frameIndex]
    if (runtime === undefined || frame === undefined) return
    runtime.ui.setStatus(STATUS_KEY, frame)
    published = true
  }

  function stop(): void {
    if (timer !== undefined) {
      timers.clear(timer)
      timer = undefined
    }
    if (published && runtime !== undefined) runtime.ui.setStatus(STATUS_KEY, undefined)
    published = false
    frameIndex = 0
  }

  function tick(): void {
    if (runtime === undefined || !ulwActive || !isGoalActive(runtime)) {
      stop()
      return
    }
    frameIndex = (frameIndex + 1) % ULW_LOOP_FOOTER_FRAMES.length
    publish()
  }

  return {
    sync(eventCtx, active) {
      const nextRuntime = runtimeFromContext(eventCtx)
      if (nextRuntime !== undefined) runtime = nextRuntime
      ulwActive = active
      if (runtime === undefined || !ulwActive || !isGoalActive(runtime)) {
        stop()
        return
      }
      if (timer !== undefined) return
      publish()
      timer = timers.set(tick, FRAME_INTERVAL_MS)
    },
    dispose() {
      ulwActive = false
      stop()
      goalCache.clear()
      runtime = undefined
    },
  }
}

const defaultTimers: UlwLoopFooterTimers = {
  set(callback, intervalMs) {
    const handle = setInterval(callback, intervalMs)
    handle.unref()
    return handle
  },
  clear(handle) {
    clearInterval(handle)
  },
}

function runtimeFromContext(value: unknown): UlwLoopFooterRuntime | undefined {
  if (!isRecord(value)) return undefined
  const ui = value["ui"]
  if (!isRecord(ui)) return undefined
  const setStatus = ui["setStatus"]
  if (typeof setStatus !== "function") return undefined
  return {
    ui: {
      setStatus(key, text) {
        Reflect.apply(setStatus, ui, [key, text])
      },
    },
    goalPaths: goalPathsFromContext(value),
  }
}

type GoalJsonCache = {
  read(path: string): Record<string, unknown> | undefined
  clear(): void
}

// The footer ticks at 320ms, but the goal JSON only needs re-reading when its mtime changes.
export function createGoalJsonCache(): GoalJsonCache {
  const entries = new Map<string, { mtimeMs: number; parsed: Record<string, unknown> | undefined }>()
  return {
    read(path) {
      let mtimeMs: number
      try {
        mtimeMs = statSync(path).mtimeMs
      } catch {
        entries.delete(path)
        return undefined
      }
      const hit = entries.get(path)
      if (hit !== undefined && hit.mtimeMs === mtimeMs) return hit.parsed
      let parsed: Record<string, unknown> | undefined
      try {
        const value: unknown = JSON.parse(readFileSync(path, "utf8"))
        parsed = isRecord(value) ? value : undefined
      } catch {
        parsed = undefined
      }
      entries.set(path, { mtimeMs, parsed })
      return parsed
    },
    clear() {
      entries.clear()
    },
  }
}

function readGoalJsonUncached(path: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(readFileSync(path, "utf8"))
    return isRecord(value) ? value : undefined
  } catch {
    return undefined
  }
}

function goalActiveFromContext(runtime: UlwLoopFooterRuntime, cache?: GoalJsonCache): boolean {
  for (const goalPath of runtime.goalPaths) {
    const parsed = cache === undefined ? readGoalJsonUncached(goalPath) : cache.read(goalPath)
    if (
      parsed !== undefined &&
      parsed["version"] === 1 &&
      isRecord(parsed["goal"]) &&
      typeof parsed["goal"]["status"] === "string"
    ) {
      return parsed["goal"]["status"] === "active"
    }
  }
  return false
}

export function goalPathsFromContext(value: unknown): readonly string[] {
  if (!isRecord(value)) return []
  const manager = value["sessionManager"]
  if (!isRecord(manager)) return []
  const getSessionFile = manager["getSessionFile"]
  const getSessionDir = manager["getSessionDir"]
  const getSessionId = manager["getSessionId"]
  if (typeof getSessionId !== "function") return []
  const sessionId = Reflect.apply(getSessionId, manager, [])
  if (typeof sessionId !== "string") return []
  const goalFile = `${encodeURIComponent(sessionId)}.json`
  const paths: string[] = []
  if (
    typeof getSessionFile === "function" &&
    typeof getSessionDir === "function" &&
    Reflect.apply(getSessionFile, manager, []) !== undefined
  ) {
    const sessionDir = Reflect.apply(getSessionDir, manager, [])
    if (typeof sessionDir === "string") paths.push(join(sessionDir, "extensions", "goal", goalFile))
  }
  const cwd = value["cwd"]
  if (typeof cwd === "string") paths.push(join(cwd, ".omo", "goal", goalFile))
  return paths
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
