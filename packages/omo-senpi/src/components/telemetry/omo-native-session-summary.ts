import { createHash } from "node:crypto"

import type { EventTelemetryProperties, TelemetryDiagnosticInput } from "@oh-my-opencode/telemetry-core"

import type { OmoNativeEventName } from "./product-identity"
import type { SummaryStore } from "./session-summary-store"
import {
  addTurn,
  openWindow,
  summaryProperties,
  type EndedBy,
  type SummaryTurn,
  type SummaryWindow,
} from "./session-summary-window"

export type { SummaryTurn } from "./session-summary-window"

// Share of sessions whose raw turn_completed rows go to PostHog. Turns are sampled here only because
// PostHog is today's only sink; the first-party collector receives every turn through its own path.
export const RAW_TURN_SAMPLE_RATE = 0.05
export const CHECKPOINT_MAX_TURNS = 50
export const CHECKPOINT_MAX_WINDOW_MS = 30 * 60_000

export type SessionSummaryOptions = {
  readonly captureEvent: (name: OmoNativeEventName, properties: EventTelemetryProperties) => void
  readonly store: SummaryStore
  readonly diagnostics?: (input: TelemetryDiagnosticInput) => void
  readonly sessionRole?: string
  readonly now?: () => number
  readonly sampleRate?: number
}

export type SessionSummaryRecorder = {
  readonly isRawTurnSampled: (sessionHash: string) => boolean
  readonly sampleRate: number
  readonly recordTurn: (sessionHash: string, turn: SummaryTurn) => void
  /** `reload` keeps the session's sequence and file so the next registration continues it. */
  readonly finish: (sessionHash: string, reason: string | undefined) => void
}

type Live = { nextSeq: number; window: SummaryWindow | null }

export function isSessionSampled(sessionHash: string, sampleRate: number): boolean {
  if (sampleRate >= 1) return true
  if (sampleRate <= 0) return false
  const bucket = createHash("sha256").update(`turn-sample:${sessionHash}`).digest().readUInt32BE(0)
  return bucket / 0x1_0000_0000 < sampleRate
}

export function createSessionSummaryRecorder(options: SessionSummaryOptions): SessionSummaryRecorder {
  const now = options.now ?? Date.now
  const sampleRate = options.sampleRate ?? RAW_TURN_SAMPLE_RATE
  const sessionRole = options.sessionRole ?? "main"
  const live = new Map<string, Live>()
  let recovered = false

  const emit = (sessionHash: string, window: SummaryWindow, seq: number, endedBy: EndedBy, role: string): void => {
    options.captureEvent("session_summary", summaryProperties(sessionHash, window, {
      endedBy,
      seq,
      sampleRate,
      sampled: isSessionSampled(sessionHash, sampleRate),
      sessionRole: role,
    }))
  }

  // Rollups a crashed or killed process left behind are sent once, from the first live event, so the
  // capture path is already installed and only one of several racing processes claims each file. The
  // claimer leaves a window-less placeholder carrying the next seq (and the orphan's age, so it expires),
  // because the user may resume that session in any other process.
  const recoverOrphans = (): void => {
    if (recovered) return
    recovered = true
    for (const orphan of options.store.claimOrphans()) {
      const nextSeq = orphan.window === null ? orphan.nextSeq : orphan.nextSeq + 1
      if (nextSeq > 0) {
        writeSafely({ sessionHash: orphan.sessionHash, sessionRole: orphan.sessionRole, nextSeq, window: null, updatedAt: orphan.updatedAt })
      }
      if (orphan.window !== null) emit(orphan.sessionHash, orphan.window, orphan.nextSeq, "recovered", orphan.sessionRole)
    }
  }

  const liveFor = (sessionHash: string): Live => {
    const cached = live.get(sessionHash)
    if (cached !== undefined) return cached
    const stored = options.store.read(sessionHash)
    const entry: Live = stored === undefined ? { nextSeq: 0, window: null } : { nextSeq: stored.nextSeq, window: stored.window }
    live.set(sessionHash, entry)
    return entry
  }

  const persist = (sessionHash: string, entry: Live): void => {
    writeSafely({ sessionHash, sessionRole, nextSeq: entry.nextSeq, window: entry.window })
  }

  function writeSafely(rollup: Parameters<SummaryStore["write"]>[0]): void {
    try {
      options.store.write(rollup)
    } catch (error) {
      options.diagnostics?.({
        event: "telemetry_activity_state_write_failed",
        source: "omo-native-session-summary",
        error: error instanceof Error ? error : new Error(String(error)),
        errorKind: "error",
      })
    }
  }

  // The closed window leaves disk BEFORE it is sent: a crash in between loses one window instead of
  // sending it twice, so summed totals can only undercount, never double count.
  const flush = (sessionHash: string, entry: Live, endedBy: EndedBy): void => {
    const window = entry.window ?? openWindow(now(), 0)
    const seq = entry.nextSeq
    entry.nextSeq += 1
    entry.window = null
    if (endedBy === "shutdown") options.store.remove(sessionHash)
    else persist(sessionHash, entry)
    emit(sessionHash, window, seq, endedBy, sessionRole)
  }

  return {
    sampleRate,
    isRawTurnSampled: (sessionHash) => isSessionSampled(sessionHash, sampleRate),
    recordTurn(sessionHash, turn) {
      recoverOrphans()
      const entry = liveFor(sessionHash)
      const at = now()
      entry.window ??= openWindow(at, turn.turnIndex)
      addTurn(entry.window, turn, at)
      if (entry.window.totals.length >= CHECKPOINT_MAX_TURNS || at - entry.window.startedAt >= CHECKPOINT_MAX_WINDOW_MS) {
        flush(sessionHash, entry, "checkpoint")
      } else {
        persist(sessionHash, entry)
      }
    },
    finish(sessionHash, reason) {
      recoverOrphans()
      const entry = liveFor(sessionHash)
      live.delete(sessionHash)
      if (reason === "reload") {
        if (entry.window !== null) flush(sessionHash, entry, "reload")
        else if (entry.nextSeq > 0) persist(sessionHash, entry)
        return
      }
      if (entry.window !== null || entry.nextSeq > 0) flush(sessionHash, entry, "shutdown")
      else options.store.remove(sessionHash)
    },
  }
}
