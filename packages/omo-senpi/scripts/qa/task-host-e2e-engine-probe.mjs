// Engine-client probes for task-host-e2e.mjs (todo 41). `omo daemon status` publishes session COUNTS and
// the task store collapses a start failure to one fixed sentence, so the two questions those surfaces
// cannot answer - what a session's context carries, and why `open_session` refused - are asked straight
// on the socket with the engine client this repo pins. Both are DIAGNOSTICS: a binary whose engine
// cannot be imported here reports `unavailable` rather than failing a scenario on a harness dependency.

async function withClient(socketPath, use) {
  let client
  try {
    const { RpcClient } = await import("@code-yeongyu/senpi")
    client = new RpcClient({ socketPath, onDisconnect: () => {} })
    await client.start()
    return await use(client)
  } catch (error) {
    return { probe: `unavailable: ${error instanceof Error ? error.message : String(error)}` }
  } finally {
    await client?.stop().catch(() => {})
  }
}

export async function probeSessionContext(socketPath) {
  return await withClient(socketPath, async (client) => {
    const rows = await client.listSessions({ include_workers: true })
    return { probe: "ok", rows: Array.isArray(rows) ? rows : (rows?.sessions ?? []) }
  })
}

/**
 * The root-cause probe for a child that could not start: opens ONE worker session exactly the way
 * `RpcHostRunner.openChild` does - a `<stateDir>/sessions/<taskId>/<iso>_<uuid>.jsonl` path, `kind:
 * "worker"`, `retain_on_disconnect` - and reports the host's verbatim refusal.
 */
export async function probeChildSessionOpen(socketPath, cwd, sessionPath) {
  return await withClient(socketPath, async (client) => {
    try {
      const opened = await client.openSession({
        sessionPath,
        cwd,
        provider: "omo-mock",
        modelId: "mock-1",
        kind: "worker",
        context: { role: "child", task_id: "st_probe" },
        retain_on_disconnect: true,
        auto_title: false,
      })
      await client.closeSession(opened.sessionId)
      return { probe: "ok", opened: true, sessionPath }
    } catch (error) {
      return { probe: "ok", opened: false, sessionPath, error: error instanceof Error ? error.message : String(error) }
    }
  })
}
