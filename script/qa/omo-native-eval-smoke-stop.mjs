import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { hostStopBudgetMs } from "../../packages/omo-native/bin/lib/daemon-stop-budget.js"

const exec = promisify(execFile)
const EXEC_MARGIN_MS = 5_000

export function smokeStopCommand(env, endpointCount) {
  const budgetMs = hostStopBudgetMs(env)
  return {
    args: ["daemon", "stop", "--all", "--wait", "--timeout", String(budgetMs / 1_000)],
    // stop --all requests and then awaits each endpoint serially. Allow both
    // the engine's stop request and our observation wait for every endpoint.
    timeout: Math.max(1, endpointCount) * budgetMs * 2 + EXEC_MARGIN_MS,
  }
}

export async function stopSmokeHosts(binary, options) {
  const budgetMs = hostStopBudgetMs(options.env)
  const status = await exec(binary, ["daemon", "status", "--json"], {
    ...options, timeout: budgetMs + EXEC_MARGIN_MS,
  }).catch((error) => {
    // Exit 3 means no endpoint answers, not that inventory failed. A stalled
    // generation still appears in its JSON and still needs the stop request.
    if (error.code !== 3) throw error
    return error
  })
  const { endpoints } = JSON.parse(status.stdout.trim())
  const hosts = endpoints.filter((endpoint) => endpoint.endpoint_kind !== "tui")
  const command = smokeStopCommand(options.env, hosts.length)
  try {
    return await exec(binary, command.args, { ...options, timeout: command.timeout })
  } catch (error) {
    const pids = hosts.flatMap((host) =>
      (host.generations ?? []).map((generation) => generation.pid).concat(host.pid ?? [])
    ).filter((pid) => pid !== undefined && pid !== null)
    throw new Error(`daemon stop failed (pid ${[...new Set(pids)].join(", ") || "?"}): ${error.message}\n${error.stdout ?? ""}${error.stderr ?? ""}`)
  }
}
