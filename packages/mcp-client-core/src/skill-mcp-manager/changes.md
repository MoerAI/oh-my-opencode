## 2026-10-30 - Configured request timeout reaches every direct MCP call (#6631)

`request-options.ts` builds the SDK request options for listTools, listResources,
listPrompts, callTool, readResource and getPrompt in one place: the caller's abort
signal (#3364) plus a request timeout from the per-call `requestTimeoutMs` or the
server config's `timeout`. Only a finite positive number counts; 0, negatives, NaN
and Infinity fall back to the SDK default so a bad config never arms an immediate
abort. A timeout the SDK fires sends notifications/cancelled, which closes that
request's HTTP stream (request-abort-fetch.ts). Carried forward from #7224 by
AceRothstein71.

## 2026-10-22 - Preserve notice state across reconnects (#10693)

The manager reuses its environment policy after disconnectAll, so closing its
watcher preserves bounded pending handles and notice deduplication. Ambient token
rotation still rematerializes the environment without repeating an unchanged
notice. The existing authority test exposed and verifies this regression.

## 2026-10-22 - Identify both vendored grant-store sources (#10693)

The header names senpi c7ac4b1a86 for formatting and 1cbe1594e for the Windows
rename-retry hunk. No runtime behavior changes.

## 2026-10-22 - Bound pending environment grant handles (#10693)

A replacement notice invalidates previous handles for the declaration. At most
128 handles are retained; evicted identities can issue a fresh notice. A grant
rechecks handle validity after asynchronous declaration validation before writing.

## 2026-10-22 - The vendored grants store refuses a write after a lost lock (#10693)

`env-grants-store.ts` takes senpi's lost-lock refusal (senpi b1b11bcde0): its proper-lockfile lock passes its own `onCompromised`, which never throws and only records the loss. Every rename attempt, including each Windows retry, refuses with `GrantsLockLostError` (code `ELOCKLOST`) once the lock was lost, leaving the old file and no temporary file, and a lost lock is not released. Before this the copy used proper-lockfile's default handler, which throws from a heartbeat timer. Tests in `env-grants-store.test.ts` (lost before the write; lost during a Windows backoff) fail on the earlier copy.
