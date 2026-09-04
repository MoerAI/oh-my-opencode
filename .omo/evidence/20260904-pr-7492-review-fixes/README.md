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
  `<desktop-config>/opencode.jsonc`.
- Real profile run pointed to
  `~/.omo/omo.jsonc under profiles.focused.categories`.
- Both real runs exited zero.
- The real OpenCode database contained 8072 sessions before and after each
  run.
- After merging `upstream/dev@0a5dab201`, the 49 focused tests, adapter
  typecheck, full build, both real warning scenarios, and both database
  isolation checks passed again.
- A follow-up real OpenCode run recorded the sandbox path relationship:
  `XDG_DATA_HOME=<sandbox>/data` and
  `opencode db path=<sandbox>/data/opencode/opencode.db`. The sandbox database
  contained 0 sessions and the real database remained 8072 before and after.
  See `isolation-provenance.txt`.
- The final review follow-up added exact discovery for `OPENCODE_CONFIG`,
  every ancestor's `opencode.json(c)` and `.opencode/opencode.json(c)`,
  Windows `%APPDATA%/opencode`, and every simultaneous misplaced source.
  Failing-first results and final counts are recorded in
  `discovery-followup.txt`.
- Final focused discovery suites: 53 pass, 0 fail, 89 assertions.
- Final related startup and configuration suites: 212 pass, 0 fail,
  462 assertions across 24 files.
- Adapter typecheck, full build, OpenCode QA common self-check, SSE self-test,
  and the real isolated warning run all passed.
- After merging `dev@07e30350b`, the 212 related tests, adapter typecheck,
  full build, and real isolated warning run passed again. The sandbox database
  remained under its XDG data root with 0 sessions, and the real database
  remained 8072 before and after.
- Late review follow-up covered inline `OPENCODE_CONFIG_CONTENT`, lexical
  profile recovery through a symlink, and OpenCode-only profile targeting.
  All three regressions failed first, then passed with 4 assertions.
- Final related diagnostics suites passed 60 tests with 0 failures and 97
  assertions. Adapter typecheck, full build, the OpenCode QA common helper,
  and SSE self-test passed.
- Real isolated OpenCode runs diagnosed both the inline source and the active
  profile source. The profile hint now targets
  `profiles.focused.opencode.categories`; both runs exited zero. Each receipt
  records its tested commit, capture ID, UTC timestamp, driver, runner,
  resolved HOME and database path, explicit sandbox-containment assertions,
  zero isolated sessions, and the real database unchanged at 8072 sessions.
  See `late-review-followup.txt`.

## Why this is enough

The focused tests pin the cross-platform candidate list and both diagnostic
branches. The real OpenCode runs load the locally built plugin through
OpenCode's actual config/plugin startup path and observe each warning on
stderr. Canonical HOME and database paths were asserted to be descendants of
the sandbox; the unchanged real database count is a separate host-state check,
not the basis of the isolation claim.

## What was omitted

Resolved configuration JSON, credentials, auth headers, private user config,
and unrelated OpenCode logs are omitted. The exact relevant warning lines,
exit statuses, portable config fixtures, and database counts are retained.
