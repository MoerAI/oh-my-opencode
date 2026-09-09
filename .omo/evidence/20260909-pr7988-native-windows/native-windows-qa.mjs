import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const evidenceDirectory = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(evidenceDirectory, "..", "..", "..");
const modelCatalogPath = join(evidenceDirectory, "..", "20260908-6077-deferred-git-bash", "model-catalog.json");
const resultPath = join(evidenceDirectory, "result.json");
const replayPath = join(evidenceDirectory, "replay.ndjson");
const stderrPath = join(evidenceDirectory, "app-server-stderr.log");
const runnerHome = process.env.USERPROFILE?.trim() || homedir();
const runnerCodexConfig = join(runnerHome, ".codex", "config.toml");
const originalEnvironment = { ...process.env };
const configHashBefore = sha256FileOrAbsent(runnerCodexConfig);
const sandbox = mkdtempSync(join(tmpdir(), "omo-pr7988-native-windows-"));
const home = join(sandbox, "home");
const codexHome = join(sandbox, "codex");
const binDirectory = join(sandbox, "bin");
const projectDirectory = join(sandbox, "project");
const controlDirectory = join(sandbox, "control");
const codexExecutable = resolveNativeCodexExecutable();
const replay = [];
const hookRuns = [];
const modelRequests = [];
let appServerStderr = "";
let appServerExited = false;
let child;
let model;
let nativeCommand = { completed: false, outputObserved: false };
let contextDelivered = false;
let selectedDeferredTool = null;
let gitBashResolution = null;
let firstRequestTools = [];
let toolSearchExposed = false;
let deferredGitBashTools = [];
let result = {
  status: "FAIL",
  platform: process.platform,
  nativeWindowsTested: process.platform === "win32",
  codexExecutable: basename(codexExecutable),
  runnerConfig: { before: configHashBefore, after: null, unchanged: false },
};

try {
  assert.equal(process.platform, "win32", "This driver must run on a native Windows runner");
  for (const path of [home, codexHome, binDirectory, projectDirectory, controlDirectory]) mkdirSync(path, { recursive: true });

  const env = isolatedEnvironment();
  Object.assign(process.env, env);
  const version = execFileSync(codexExecutable, ["--version"], { env, encoding: "utf8", windowsHide: true }).trim();
  assert.match(version, /^codex-cli 0\.144\.6(?:\s|$)/, `Expected Codex 0.144.6, got ${version}`);

  const { installMarketplaceLocally } = await import(pathToFileURL(join(repoRoot, "packages", "omo-codex", "scripts", "install-local.mjs")).href);
  const installation = await installMarketplaceLocally({
    repoRoot,
    codexHome,
    binDir: binDirectory,
    projectDirectory,
    env,
  });
  const plugin = installation.installed.find((entry) => entry.name === "omo");
  assert(plugin, "The real installer did not install omo");
  assert(installation.gitBashPath, "The native Windows installer did not resolve Git Bash");
  assert(existsSync(installation.gitBashPath), `Resolved Git Bash path is absent: ${installation.gitBashPath}`);

  const localHookPath = join(repoRoot, "packages", "omo-codex", "plugin", "components", "git-bash", "dist", "codex-hook.js");
  const installedHookPath = join(plugin.path, "components", "git-bash", "dist", "codex-hook.js");
  const localHookSha256 = sha256File(localHookPath);
  assert.equal(sha256File(installedHookPath), localHookSha256, "Installed Git Bash hook differs from this checkout's build");

  const installedMcpManifest = JSON.parse(readFileSync(join(plugin.path, ".mcp.json"), "utf8"));
  const installedGitBashMcp = installedMcpManifest.mcpServers?.git_bash;
  assert.equal(installedGitBashMcp?.command, "node", "The installed Git Bash MCP must use its shipped Node entrypoint");
  assert(Array.isArray(installedGitBashMcp?.args), "The installed Git Bash MCP must declare arguments");
  const installedGitBashEntrypoint = installedGitBashMcp.args[0];
  assert.equal(typeof installedGitBashEntrypoint, "string");
  assert(existsSync(installedGitBashEntrypoint), "The installed Git Bash MCP entrypoint is absent");
  assert(installedGitBashEntrypoint.endsWith(join("components", "git-bash-mcp", "dist", "cli.js")), "The installed MCP entrypoint is not the bundled Git Bash server");

  const installedConfig = readFileSync(installation.configPath, "utf8");
  assert.match(installedConfig, /\[plugins\."omo@sisyphuslabs"\.mcp_servers\.git_bash\][\s\S]*?enabled\s*=\s*true/, "The real installer did not enable the installed Git Bash MCP");

  const { applyGitBashPreToolUseReminder } = await import(pathToFileURL(installedHookPath).href);
  const control = JSON.parse(applyGitBashPreToolUseReminder({
    cwd: projectDirectory,
    hook_event_name: "PreToolUse",
    model: "mock-model",
    permission_mode: "default",
    session_id: "control",
    tool_input: { command: "echo QA_EXEC_OK" },
    tool_name: "Bash",
    tool_use_id: "control",
    transcript_path: null,
    turn_id: "control",
  }, { platform: "win32", env, pluginDataRoot: controlDirectory }));
  const expectedContext = control.hookSpecificOutput.additionalContext;
  const expectedContextSha256 = sha256Text(expectedContext);

  model = createLocalModelServer({ expectedContext, replay });
  const listening = once(model, "listening", { signal: AbortSignal.timeout(10_000) });
  model.listen(0, "127.0.0.1");
  await listening;
  const address = model.address();
  assert(address && typeof address === "object", "The local model did not expose a loopback address");

  const overrides = [
    'approval_policy="never"',
    'sandbox_mode="danger-full-access"',
    "features.code_mode=true",
    "features.unified_exec=true",
    `model_catalog_json=${tomlString(modelCatalogPath)}`,
    'model="mock-model"',
    'model_provider="qa"',
    'model_providers.qa.name="native-windows-qa"',
    `model_providers.qa.base_url="http://127.0.0.1:${address.port}/v1"`,
    'model_providers.qa.wire_api="responses"',
    "model_providers.qa.request_max_retries=0",
    "model_providers.qa.stream_max_retries=0",
    'plugins."omo@sisyphuslabs".mcp_servers.context7.enabled=false',
    'plugins."omo@sisyphuslabs".mcp_servers.grep_app.enabled=false',
    'plugins."omo@sisyphuslabs".mcp_servers.lsp.enabled=false',
  ];

  child = spawn(codexExecutable, [...overrides.flatMap((value) => ["-c", value]), "app-server"], {
    cwd: projectDirectory,
    env,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stderr.on("data", (chunk) => {
    appServerStderr += chunk.toString();
  });

  const completedTurn = await driveAppServer({
    child,
    projectDirectory,
    hookRuns,
    replay,
    observeNativeCommand: (item) => {
      nativeCommand = {
        completed: item.exitCode === 0,
        outputObserved: strings(item).some((value) => value.includes("QA_EXEC_OK")),
      };
    },
    observeModelRequest: (observation) => {
      modelRequests.push(observation);
      if (observation.sequence === 1) {
        firstRequestTools = observation.toolNames;
        toolSearchExposed = observation.toolSearchExposed;
        deferredGitBashTools = observation.gitBashTools;
      }
      if (observation.containsExpectedContext) contextDelivered = true;
      if (observation.gitBashResolution !== null) {
        selectedDeferredTool = observation.gitBashResolution.name;
        gitBashResolution = observation.gitBashResolution.resolution;
      }
    },
  });

  assert.equal(completedTurn.status, "completed", JSON.stringify(completedTurn));
  const completedPreToolUse = hookRuns.filter((run) => run.method === "hook/completed" && run.eventName === "preToolUse" && run.status === "completed");
  assert(completedPreToolUse.length > 0, "The installed Git Bash PreToolUse hook did not complete");
  for (const completed of completedPreToolUse) {
    assert(hookRuns.some((started) => started.method === "hook/started" && started.id === completed.id), "Each completed Git Bash hook must have a matching start notification");
  }
  assert(hookRuns.filter((run) => run.method === "hook/completed").every((run) => run.status === "completed"), "Installed hooks must complete successfully");
  assert(nativeCommand.completed, "Native exec_command did not exit successfully");
  assert(nativeCommand.outputObserved, "Native exec_command did not emit QA_EXEC_OK");
  assert(contextDelivered, "The installed hook context did not reach the subsequent local-model request");
  assert(firstRequestTools.includes("exec"), "Code mode did not expose exec");
  assert(toolSearchExposed, "Code mode did not expose tool_search");
  assert.equal(deferredGitBashTools.length, 0, "Git Bash tools must be discovered through ALL_TOOLS instead of the initial top-level surface");
  assert(selectedDeferredTool?.includes("git_bash") && selectedDeferredTool.endsWith("which_bash"), "exec did not select the installed git_bash which_bash tool through ALL_TOOLS");
  assert(gitBashResolution && gitBashResolution.found === true, "The installed git_bash which_bash call did not find Git Bash");
  assert.equal(typeof gitBashResolution.path, "string");
  assert.match(gitBashResolution.path, /bash\.exe$/i, "which_bash did not return a native bash.exe path");
  assert.notEqual(gitBashResolution.source, "not-required", "which_bash was not executed on native Windows");
  const markerPaths = findReminderMarkers([codexHome, home]);
  assert(markerPaths.length > 0, "The installed Git Bash hook did not write a session reminder marker");

  result = {
    status: "PASS",
    platform: process.platform,
    nativeWindowsTested: true,
    codex: version,
    codexExecutable: basename(codexExecutable),
    installation: {
      marketplace: installation.marketplaceName,
      realInstallerUsed: true,
      gitBashPath: installation.gitBashPath,
      localHookSha256,
      installedHookMatches: true,
      installedGitBashEntrypoint: "components/git-bash-mcp/dist/cli.js",
      installedGitBashMcpEnabled: true,
    },
    hookRuns,
    nativeExec: nativeCommand,
    hookContext: { delivered: contextDelivered, sha256: expectedContextSha256 },
    codeMode: {
      toolSearchExposed,
      initialGitBashTools: deferredGitBashTools,
      selectedTool: selectedDeferredTool,
      whichBash: gitBashResolution,
    },
    localModel: { requests: modelRequests.length, externalModelCalls: 0, endpoint: "127.0.0.1" },
    reminderMarkerCount: markerPaths.length,
    runnerConfig: { before: configHashBefore, after: null, unchanged: false },
    replay: "replay.ndjson",
    isolation: {
      home: "isolated",
      codexHome: "isolated",
      remotePluginMcpsDisabledAtAppServer: ["context7", "grep_app", "lsp"],
    },
  };
} catch (error) {
  result = {
    ...result,
    status: "FAIL",
    error: error instanceof Error ? error.stack ?? error.message : String(error),
    hookRuns,
    nativeExec: nativeCommand,
    hookContextDelivered: contextDelivered,
    codeMode: { toolSearchExposed, initialGitBashTools: deferredGitBashTools, selectedTool: selectedDeferredTool, whichBash: gitBashResolution },
    localModel: { requests: modelRequests.length, externalModelCalls: 0, endpoint: "127.0.0.1" },
    replay: "replay.ndjson",
  };
  process.exitCode = 1;
} finally {
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = once(child, "exit", { signal: AbortSignal.timeout(15_000) });
    child.stdin.end();
    execFileSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true });
    await exited;
  }
  appServerExited = child ? child.exitCode !== null || child.signalCode !== null : false;
  if (model?.listening) {
    const closed = once(model, "close", { signal: AbortSignal.timeout(15_000) });
    model.closeAllConnections();
    model.close();
    await closed;
  }
  const configHashAfter = sha256FileOrAbsent(runnerCodexConfig);
  result.runnerConfig = { before: configHashBefore, after: configHashAfter, unchanged: configHashBefore === configHashAfter };
  result.appServerExited = appServerExited;
  if (!result.runnerConfig.unchanged && result.status === "PASS") {
    result.status = "FAIL";
    result.error = "Runner ~/.codex/config.toml changed during isolated QA";
    process.exitCode = 1;
  }
  process.chdir(repoRoot);
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnvironment)) delete process.env[key];
  }
  Object.assign(process.env, originalEnvironment);
  try {
    rmSync(sandbox, { recursive: true, force: true });
    result.sandboxRemoved = true;
  } catch (error) {
    result.status = "FAIL";
    result.cleanupError = String(error);
    result.sandboxRemoved = false;
    process.exitCode = 1;
  }
  writeFileSync(replayPath, `${replay.map((entry) => JSON.stringify(sanitize(entry))).join("\n")}\n`);
  writeFileSync(stderrPath, sanitizeText(appServerStderr));
  writeFileSync(resultPath, `${JSON.stringify(sanitize(result), null, 2)}\n`);
  console.log(JSON.stringify(sanitize(result)));
}

function createLocalModelServer({ expectedContext, replay: events }) {
  let requestCount = 0;
  const server = createServer(async (request, response) => {
    let raw = "";
    for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw);
    requestCount += 1;
    const observation = observeModelRequest(body, requestCount, expectedContext);
    events.push({ type: "model_request", ...observation });
    const item = responseItemFor(requestCount);
    events.push({ type: "model_response", sequence: requestCount, itemType: item.type, toolName: item.name });
    const responseId = `native_windows_qa_${requestCount}`;
    const frames = [
      { type: "response.created", response: { id: responseId, created_at: 1, model: "mock-model" } },
      { type: "response.output_item.added", output_index: 0, item },
      { type: "response.output_item.done", output_index: 0, item: { ...item, status: "completed" } },
      { type: "response.completed", response: { id: responseId, usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } },
    ];
    response.writeHead(200, { "content-type": "text/event-stream" });
    for (const frame of frames) response.write(`data: ${JSON.stringify(frame)}\n\n`);
    response.end();
  });
  return server;
}

function responseItemFor(sequence) {
  if (sequence === 1) {
    return {
      type: "function_call",
      id: "native_exec_command",
      call_id: "native_exec_command",
      name: "exec_command",
      arguments: JSON.stringify({ cmd: "echo QA_EXEC_OK", login: false }),
    };
  }
  if (sequence === 2) {
    return {
      type: "custom_tool_call",
      id: "deferred_git_bash_lookup",
      call_id: "deferred_git_bash_lookup",
      name: "exec",
      input: 'const bash = ALL_TOOLS.find((tool) => tool.name.includes("git_bash") && tool.name.endsWith("which_bash")); if (!bash) throw new Error("which_bash absent"); const resolution = await tools[bash.name]({}); text(`QA_GIT_BASH_RESOLUTION:${JSON.stringify({ name: bash.name, resolution })}`);',
    };
  }
  return {
    type: "message",
    id: "native_windows_complete",
    role: "assistant",
    content: [{ type: "output_text", text: "Completed." }],
  };
}

async function driveAppServer({ child: appServer, projectDirectory: cwd, hookRuns: runs, replay: events, observeNativeCommand, observeModelRequest: observeRequest }) {
  let pending = "";
  const finished = once(appServer, "error", { signal: AbortSignal.timeout(90_000) }).then(
    ([error]) => ({ kind: "error", error: String(error) }),
    (error) => ({ kind: "timeout", error: String(error) }),
  );
  const protocol = new Promise((resolveProtocol) => {
    const finish = (value) => resolveProtocol(value);
    const send = (message) => appServer.stdin.write(`${JSON.stringify(message)}\n`);
    appServer.once("exit", (code, signal) => finish({ kind: "early-exit", code, signal }));
    appServer.stdout.on("data", (chunk) => {
      pending += chunk.toString();
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) {
        if (line.trim().length === 0) continue;
        const message = JSON.parse(line);
        if (message.error) finish({ kind: "protocol-error", error: message.error });
        if (message.id === 1 && message.result) {
          send({ method: "initialized" });
          send({ id: 2, method: "thread/start", params: { cwd } });
          continue;
        }
        if (message.id === 2 && message.result) {
          send({ id: 3, method: "turn/start", params: { threadId: message.result.thread.id, input: [{ type: "text", text: "Run echo QA_EXEC_OK once." }] } });
          continue;
        }
        if (message.method === "hook/started" || message.method === "hook/completed") {
          const run = message.params.run;
          const event = { method: message.method, ...run };
          runs.push(event);
          events.push({ type: "hook", ...event });
          continue;
        }
        if (message.method === "item/completed" && message.params.item.type === "commandExecution") {
          observeNativeCommand(message.params.item);
          events.push({ type: "native_exec", exitCode: message.params.item.exitCode, outputObserved: strings(message.params.item).some((value) => value.includes("QA_EXEC_OK")) });
          continue;
        }
        if (message.method === "turn/completed") finish({ kind: "turn", turn: message.params.turn });
      }
    });
    send({ id: 1, method: "initialize", params: { clientInfo: { name: "pr-7988-native-windows-qa", version: "1" }, capabilities: { experimentalApi: true, requestAttestation: false } } });
  });
  const outcome = await Promise.race([protocol, finished]);
  if (outcome.kind !== "turn") throw new Error(`Codex app-server did not complete the turn: ${JSON.stringify(outcome)}`);
  for (const event of events) {
    if (event.type !== "model_request") continue;
    observeRequest(event);
  }
  return outcome.turn;
}

function observeModelRequest(body, sequence, expectedContext) {
  const toolEntries = (body.tools ?? []).flatMap((tool) => tool.type === "namespace"
    ? tool.tools.map((member) => ({ namespace: tool.name, name: member.name, deferred: member.defer_loading ?? tool.defer_loading ?? false }))
    : [{ namespace: null, name: tool.name, deferred: tool.defer_loading ?? false }]);
  const toolNames = toolEntries.map((tool) => tool.name).filter((name) => typeof name === "string");
  const gitBashTools = toolEntries.filter((tool) => tool.namespace?.includes("git_bash") || tool.name?.includes("git_bash"));
  const payload = findGitBashResolution(strings(body.input));
  return {
    sequence,
    toolNames,
    toolSearchExposed: (body.tools ?? []).some((tool) => tool.type === "tool_search"),
    gitBashTools,
    containsExpectedContext: strings(body.input).some((value) => value.includes(expectedContext)),
    gitBashResolution: payload,
  };
}

function findGitBashResolution(values) {
  const marker = "QA_GIT_BASH_RESOLUTION:";
  for (const value of values) {
    const index = value.indexOf(marker);
    if (index === -1) continue;
    const json = value.slice(index + marker.length).trim();
    try {
      const parsed = JSON.parse(json);
      if (typeof parsed?.name !== "string") continue;
      const raw = typeof parsed.resolution === "string" ? JSON.parse(parsed.resolution) : parsed.resolution;
      const resolution = raw?.content ? JSON.parse(raw.content[0].text) : raw;
      if (resolution && typeof resolution === "object") return { name: parsed.name, resolution };
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
    }
  }
  return null;
}

function isolatedEnvironment() {
  const env = {
    PATH: process.env.PATH ?? "",
    PATHEXT: process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD",
    SystemRoot: process.env.SystemRoot ?? process.env.WINDIR ?? "C:\\Windows",
    WINDIR: process.env.WINDIR ?? process.env.SystemRoot ?? "C:\\Windows",
    ComSpec: process.env.ComSpec ?? "C:\\Windows\\System32\\cmd.exe",
    ProgramFiles: process.env.ProgramFiles,
    "ProgramFiles(x86)": process.env["ProgramFiles(x86)"],
    SystemDrive: process.env.SystemDrive ?? "C:",
    HOME: home,
    USERPROFILE: home,
    HOMEDRIVE: home.slice(0, 2),
    HOMEPATH: home.slice(2),
    APPDATA: join(home, "AppData", "Roaming"),
    LOCALAPPDATA: join(home, "AppData", "Local"),
    TEMP: join(sandbox, "tmp"),
    TMP: join(sandbox, "tmp"),
    CODEX_HOME: codexHome,
    CODEX_LOCAL_BIN_DIR: binDirectory,
    OMO_CODEX_PROJECT: projectDirectory,
    OMO_CODEX_GIT_BASH_PATH: process.env.OMO_CODEX_GIT_BASH_PATH,
    OMO_DISABLE_POSTHOG: "1",
    OMO_CODEX_DISABLE_POSTHOG: "1",
    LAZYCODEX_CONFIG_MIGRATION_DISABLED: "1",
  };
  mkdirSync(env.TEMP, { recursive: true });
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete env[key];
  }
  return env;
}

function resolveNativeCodexExecutable() {
  const candidate = process.env.CODEX_EXE?.trim();
  assert(candidate, "CODEX_EXE must point to the native codex.exe installed for this workflow");
  assert.equal(extname(candidate).toLowerCase(), ".exe", "CODEX_EXE must be the real codex.exe, not an npm .cmd shim");
  assert(existsSync(candidate), `CODEX_EXE does not exist: ${candidate}`);
  return resolve(candidate);
}

function findReminderMarkers(roots) {
  const markers = [];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".seen")) continue;
      const parent = entry.parentPath ?? root;
      const candidate = join(parent, entry.name);
      if (candidate.includes(`${sep}git-bash-reminder${sep}`)) markers.push(candidate);
    }
  }
  return markers;
}

function strings(value) {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === "object") return Object.values(value).flatMap(strings);
  return [];
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function sha256FileOrAbsent(path) {
  return existsSync(path) ? sha256File(path) : "ABSENT";
}

function sha256Text(value) {
  return createHash("sha256").update(value).digest("hex");
}

function tomlString(value) {
  return JSON.stringify(value);
}

function sanitize(value) {
  if (typeof value === "string") return sanitizeText(value);
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, sanitize(entry)]));
  return value;
}

function sanitizeText(value) {
  return value
    .replaceAll(repoRoot, "<checkout>")
    .replaceAll(sandbox, "<sandbox>")
    .replaceAll(runnerHome, "<runner-home>")
    .replaceAll(/gh[opsu]_[A-Za-z0-9_]+/g, "<redacted-github-token>")
    .replaceAll(/sk-[A-Za-z0-9_-]+/g, "<redacted-api-key>");
}
