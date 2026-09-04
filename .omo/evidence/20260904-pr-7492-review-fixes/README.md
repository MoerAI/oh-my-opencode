# PR 7492 config diagnostic review-fix QA

## What was tested

- Added failing-first tests for profile-scoped category hints and Desktop-only
  OpenCode config discovery.
- Ran the focused config-directory and plugin-factory suites with Bun 1.4.0.
- Ran the OpenCode adapter typecheck and complete plugin build.
- Self-tested the `opencode-qa` common sandbox and SSE probe.
- Drove the real `opencode debug config --print-logs` command twice:
  - with categories only in the macOS Desktop Tauri config;
  - with `OPENCODE_CONFIG_DIR` pointing to `profiles/focused`.
- Set isolated HOME and all XDG roots for both real OpenCode runs and compared
  the real OpenCode database session count before and after.

## What was observed

- Before implementation, the new suite failed because the discovery helper
  did not exist, the profile warning pointed only to `~/.omo/omo.jsonc`, and
  the Desktop-only config produced no warning.
- After implementation: 49 pass, 0 fail, 82 assertions.
- OpenCode adapter typecheck: exit 0.
- Full plugin build: exit 0.
- `opencode-qa` common self-check and SSE self-test: pass.
- Real Desktop run printed the exact ignored-category source under
  `~/Library/Application Support/ai.opencode.desktop/opencode.jsonc`.
- Real profile run pointed to
  `~/.omo/omo.jsonc under profiles.focused.opencode.categories`.
- Both real runs exited zero.
- The real OpenCode database contained 8072 sessions before and after each
  run.

## Why this is enough

The focused tests pin the cross-platform candidate list and both diagnostic
branches. The real OpenCode runs load the locally built plugin through
OpenCode's actual config/plugin startup path, observe each warning on stderr,
and prove the isolated runs did not add sessions to the real database.

## What was omitted

Resolved configuration JSON, credentials, auth headers, private user config,
and unrelated OpenCode logs are omitted. The exact relevant warning lines,
exit statuses, config fixtures, and database counts are retained.
