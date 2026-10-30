import type { RequestOptions } from "@modelcontextprotocol/sdk/shared/protocol.js"
import type { ClaudeCodeMcpServer } from "@oh-my-opencode/claude-code-compat-core/claude-code-mcp-loader/types"

export interface SkillMcpRequestScope {
  requestTimeoutMs?: number
  signal?: AbortSignal
}

/**
 * The request timeout for one MCP call: the per-call override, else the server's configured
 * `timeout`. Only a finite positive number counts; zero, a negative number, NaN or Infinity
 * would arm an immediate (or never-firing) timer, so they fall back to the SDK default.
 */
export function resolveRequestTimeoutMs(config: ClaudeCodeMcpServer, scope?: SkillMcpRequestScope): number | undefined {
  for (const candidate of [scope?.requestTimeoutMs, config.timeout]) {
    if (typeof candidate === "number" && Number.isFinite(candidate) && candidate > 0) return candidate
  }
  return undefined
}

/** SDK request options for every direct MCP operation: abort signal (#3364) and timeout (#6631). */
export function buildRequestOptions(config: ClaudeCodeMcpServer, scope?: SkillMcpRequestScope): RequestOptions {
  const timeout = resolveRequestTimeoutMs(config, scope)
  return {
    ...(scope?.signal === undefined ? {} : { signal: scope.signal }),
    ...(timeout === undefined ? {} : { timeout }),
  }
}
