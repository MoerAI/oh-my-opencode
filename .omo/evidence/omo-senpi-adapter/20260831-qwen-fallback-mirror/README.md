# Issue #6255 Senpi Qwen fallback mirror QA

## What was tested

- Driver harness:
  - `node packages/omo-senpi/scripts/qa/drive.mjs --self-test`
- Real isolated adapter session:
  - `SENPI_BIN="$(command -v senpi)" node packages/omo-senpi/scripts/qa/drive.mjs`
- Real isolated task lifecycle:
  - `TASK_E2E_OUT_DIR="$ev/live-task-dag" SENPI_BIN="$(command -v senpi)" node packages/omo-senpi/scripts/qa/task-e2e.mjs`
- Required package gate with the CI compiler:
  - `bunx bun@1.4.0 run test:senpi`
- Focused regression and adjacent contracts:
  - `bun test packages/senpi-task/src/agents/builtin/fallback-chains.test.ts`
  - `bun test packages/model-core/src/model-requirements-agents.test.ts`
  - `bun test packages/senpi-task/src/agents/builtin/builtin-agents.test.ts`
  - `bun run typecheck:packages`
  - `bunx tsgo --noEmit -p packages/omo-senpi/tsconfig.json`
  - `bunx bun@1.4.0 test packages/omo-senpi/plugin/scripts/build-extension.test.mjs`
- Runtime export probe importing `AGENT_FALLBACK_CHAINS`.

## What was observed

- Failing-first proof:
  - after updating only the independent mirror expectation, the focused test reported 5 pass and 1 fail;
  - both failing entries received `qwen3.5-plus` where `qwen3.7-plus` was expected.
- Corrected production mirror:
  - focused suites passed 24 tests with 289 assertions;
  - package typecheck and adapter tsgo exited successfully;
  - runtime export printed `explore: qwen3.7-plus` and `librarian: qwen3.7-plus`.
- Committed bundle proof:
  - initial CI rejected stale generated bundles;
  - regenerating with the workflow compiler, Bun 1.4.0, made the extension builder pass 12 tests with 27 assertions;
  - final GitHub CI passed 22 checks with 4 intentional skips and no failures.
- Live adapter driver:
  - `result=PASS`;
  - ultrawork injection and comment-checker behavior passed;
  - sandbox agent directory: `$TMPDIR/omo-senpi-qa-WUZkH1/agent`;
  - its whole-directory digest changed because unrelated real Senpi sessions were active, so this field is supporting evidence only.
- Live task driver:
  - reviewer-facing verdict: `live-task-dag/verdict.redacted.json`;
  - 21 of 27 lifecycle checks passed;
  - 6 current-runtime lifecycle assertions failed: `followup_revive`, `task_output_peek`, `jsonl_sequence`, `resume_revived_resident`, `resume_finished_steerable`, and `resume_ttl_not_revived`;
  - these lifecycle failures do not execute or select the changed fallback model;
  - decisive isolation fields passed: `realSenpiUntouched=true`, `realSenpiChangedPaths=[]`, and `leakedPids=0`;
  - the three observed real-home changes were classified as concurrent active sessions in `concurrentRealSenpiChangedPaths`.
- Required package gate:
  - exit 0;
  - largest suite: 2429 pass, 1 platform skip, 0 fail, 7827 assertions across 324 files;
  - evidence-resolver contract: 10 pass, 0 fail.

## Why this is enough

The changed behavior is a literal model identifier exported by a curated Senpi fallback table. The RED test fails on both stale entries, the focused GREEN tests cover the canonical and mirrored tables, and the runtime import proves actual consumers receive `qwen3.7-plus`. The repository package gate and generated-bundle test cover adapter packaging. The live adapter proves the real Senpi binary loads the plugin, while the task driver provides path-attributed isolation proof that the QA did not write to the real agent directory.

The six extra task-lifecycle failures are retained rather than hidden. They exercise revive/output sequencing contracts unrelated to fallback model selection; the changed source is not on those paths, the full package gate is green, and no lifecycle assertion was weakened.

## Cleanup receipt

- Live adapter sandbox `omo-senpi-qa-JkGw4n`: absent after driver exit.
- Nine task-driver sandbox roots: removed after verdict capture.
- Task-driver spawned PIDs: 0 leaked.
- No server, tmux session, browser context, container, port, or task-owned temporary directory remains.

## What was omitted

Raw dependency-install logs and compiler progress were summarized because they add no behavioral evidence. No credentials, provider tokens, authentication headers, environment dumps, private local configuration, or unrelated real-session content are included.

## Current-dev merge refresh

After the branch conflicted with `upstream/dev@ee7ae5d66`, the source and
focused test merged automatically. The generated `omo-task.js` conflict was
resolved only by rebuilding all six Senpi bundles with the canonical build
script.

Observed after the merge:

- focused fallback suite: 7 pass, 0 fail, 202 assertions;
- senpi-task and adapter tsgo: pass;
- full `test:senpi`: 2461 pass, 1 platform skip, 0 fail, 7906 assertions
  across 327 files;
- evidence resolver: 10 pass, 0 fail, 31 assertions;
- live driver self-test: pass;
- real isolated Senpi adapter: `result=PASS`,
  `realSenpiUntouched=true`, `realSenpiChangedPaths=[]`,
  `realSenpiProtectedChangedPaths=[]`,
  `realSenpiCredentialDigestUntouched=true`, and
  `realOmoUntouched=true`;
- the caller-provided agent directory was ignored and no real Senpi or OMO
  path change was observed;
- real task-DAG issue observables passed with one child extension marker,
  main exit `0`, and leaked PID count `0`; the same six unrelated lifecycle
  failures remain disclosed in `live-task-dag/verdict.redacted.json`;
- adapter sandbox `$TMPDIR/omo-senpi-qa-JkGw4n`, all nine task sandboxes,
  and the raw final-driver directory were removed with no matching process
  remaining.

The merge refresh exercises the same fallback export through current
Senpi package wiring and confirms that current upstream task/runtime changes
did not alter the Qwen 3.7 fallback contract.
