# Issue 7471 Session Resume Diagnostics

## What was tested

- Failing-first launcher regression:
  `bun test packages/omo-native/test/launcher.test.ts`
- Surface: the published `omo-ai` launcher forwarding `--session <id>` to the
  pinned Senpi engine.
- Intended behavior: when a JSONL filename contains the requested ID but its
  session header has a different canonical ID, the launcher must identify the
  searched root, rejected candidate, mismatch, and valid resume alternatives.

## What was observed before the fix

The new regression failed because the launcher printed no diagnostic:

```text
Expected to contain: "searched .../.omo/agent/sessions"
Received: ""
1 tests failed
37 pass
```

The fake Senpi process still received the original session ID, proving the
failure is diagnostic rather than argument forwarding.

## What was observed after the fix

- Focused regression: `38 pass, 0 fail`.
- Full omo-native suite: `204 pass, 6 skip, 0 fail`.
- Package typecheck: clean.
- Package build: completed with 36 required staged artifacts.
- Real isolated launcher output identified:
  - `/tmp/omo-7471-qa/agent/sessions` as the searched root,
  - the exact mismatched JSONL candidate,
  - the canonical header ID,
  - both `omo --session <header-id>` and path-based resume alternatives.
- `--help` rendered the real command surface.
- Invalid `--session-id 'bad/id' --print` exited 1 with the expected validation
  message.

## Why this evidence is enough

The regression drives the published launcher boundary with its real argument
forwarding and a fake pinned engine, while the manual QA drives the built
launcher with the actual pinned Senpi CLI. Together they prove both deterministic
diagnostic behavior and unchanged engine handoff.

## What was omitted

- Temporary fixture paths are summarized because they are regenerated per run.
- No credentials, tokens, environment dumps, or private session content were
  captured.
