import { describe, expect, onTestFinished, test } from "bun:test"
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { hostStopBudgetMs } from "../../packages/omo-native/bin/lib/daemon-stop-budget.js"
import { smokeStopCommand, stopSmokeHosts } from "./omo-native-eval-smoke-stop.mjs"

describe("packaged eval smoke shutdown", () => {
  test.each([{}, { SENPI_RPC_CHILD_STALLED_STOP_MAX_MS: "120000" }])(
    "the command and outer deadline cover the same engine budget for each endpoint",
    (env) => {
      const budget = hostStopBudgetMs(env)
      for (const count of [0, 1, 3]) {
        const command = smokeStopCommand(env, count)
        expect(command.args.slice(0, 5)).toEqual(["daemon", "stop", "--all", "--wait", "--timeout"])
        expect(Number(command.args[5]) * 1_000).toBeGreaterThanOrEqual(budget)
        expect(command.timeout).toBeGreaterThan(Math.max(1, count) * budget * 2)
      }
    },
  )

  function binary(exitCode, { statusExitCode = 0, endpoints = [
    { pid: 4242, generations: [{ pid: 4243 }] },
    { pid: 9999, endpoint_kind: "tui" },
  ] } = {}) {
    const root = mkdtempSync(join(tmpdir(), "omo-smoke-stop-"))
    onTestFinished(() => rmSync(root, { recursive: true, force: true }))
    const path = join(root, "omo")
    const stopReceipt = join(root, "stop-sent")
    writeFileSync(path, `#!${process.execPath}
import { writeFileSync } from "node:fs"
const args = process.argv.slice(2)
if (args[1] === "status") {
  console.log(${JSON.stringify(JSON.stringify({ endpoints }))})
  process.exit(${statusExitCode})
} else {
  if (args.join(" ") !== "daemon stop --all --wait --timeout 97") process.exit(2)
  writeFileSync(${JSON.stringify(stopReceipt)}, "")
  console.log(${JSON.stringify(exitCode === 0 ? "/tmp/test.sock: drained (1 polls)" : "/tmp/test.sock: TIMEOUT: still live (pid 4243, 0 sessions, 0 claims)")})
  process.exit(${exitCode})
}
`)
    chmodSync(path, 0o755)
    return { root, path, stopReceipt }
  }

  test.skipIf(process.platform === "win32")("an executable that drains immediately returns its shutdown receipt", async () => {
    const fixture = binary(0)
    const result = await stopSmokeHosts(fixture.path, { cwd: fixture.root, env: {} })
    expect(result.stdout).toContain("drained (1 polls)")
  })

  test.skipIf(process.platform === "win32")("a failed executable keeps ownership pids and the timeout output", async () => {
    const fixture = binary(3)
    const failure = await stopSmokeHosts(fixture.path, { cwd: fixture.root, env: {} }).catch((error) => error)
    expect(failure).toBeInstanceOf(Error)
    expect(failure.message).toContain("daemon stop failed (pid 4243, 4242)")
    expect(failure.message).toContain("TIMEOUT: still live (pid 4243")
  })

  test.skipIf(process.platform === "win32")("status exit 3 with no host still sends stop and passes", async () => {
    const fixture = binary(0, { statusExitCode: 3, endpoints: [] })
    const result = await stopSmokeHosts(fixture.path, { cwd: fixture.root, env: {} })
    expect(existsSync(fixture.stopReceipt)).toBe(true)
    expect(result.stdout).toContain("drained")
  })

  test.skipIf(process.platform === "win32")("status exit 3 with a stalled host sends stop and names its pid on failure", async () => {
    const fixture = binary(3, {
      statusExitCode: 3,
      endpoints: [{ pid: null, reachable: false, generations: [{ pid: 4243, alive: true }] }],
    })
    const failure = await stopSmokeHosts(fixture.path, { cwd: fixture.root, env: {} }).catch((error) => error)
    expect(existsSync(fixture.stopReceipt)).toBe(true)
    expect(failure).toBeInstanceOf(Error)
    expect(failure.message).toContain("daemon stop failed (pid 4243)")
    expect(failure.message).toContain("TIMEOUT: still live (pid 4243")
  })
})
