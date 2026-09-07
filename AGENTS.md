# pi-ds-pricing-regime — repo conventions

A [pi](https://github.com/earendil-works/pi-coding-agent) extension that always
shows DeepSeek's peak/off-peak billing mode in the footer (bottom-left),
timezone-aware, while the selected model comes from the DeepSeek provider
(`ctx.model.provider === "deepseek"`); other providers hide the status.
Installed globally as an npm package — see Install below.

## Commands

Use `just` (recipe bodies run the same npm scripts):

| Command | Runs |
| --- | --- |
| `just build` | Formatting/lint check, typecheck, and tests — the release gate (also `prepublishOnly`) |
| `just check` | Formatting check + Biome lint |
| `just format` | Format TypeScript, JavaScript, JSON, and config files with Biome |
| `just format-check` | Verify Biome formatting without changing files |
| `just lint` | Run Biome lint rules |
| `just typecheck` | `tsc -p tsconfig.json` (pi types resolved via the local peer dep) |
| `just test` | `node --test` — native TS, no test framework (needs Node ≥ 23) |
| `just coverage` | `node --test --experimental-test-coverage` — coverage report |
| `just pack` | `npm pack --dry-run` — inspect the future tarball |

## Structure

- `extensions/deepseek-peak-offpeak.ts` — the extension. **Constants live at the
  top**: `PEAK_WINDOWS` (peak hours, `[start, end)` UTC), `WEEKEND_OFFPEAK_UTC`
  (weekend flat-rate start; Sat/Sun Beijing time is off-peak all day from then;
  the tiered regime itself has been live since 2026-08-16T16:00:00Z), and
  `DEEPSEEK_PROVIDER` (the provider id that gates visibility). If
  DeepSeek changes the regime, edit here. Pure helpers (`inPeak`,
  `isWeekendBeijing`, `nextBoundaryUtcHour`, `nextBoundaryUtc`, `formatLocalTime`,
  `formatLocalDayPrefix`, `isDeepSeekModel`, `statusText`) are exported for
  tests; the default export wires them to `ctx.ui.setStatus`, gated on
  `ctx.model` and refreshed on `model_select`.
- `test/` — `regime.test.ts` (window/boundary/weekend math),
  `smoke.test.ts` (mock pi context + process-local mock timers; status text +
  timer lifecycle), `timezone-matrix.test.ts` (spawns the matrix script under
  fixed-offset and real DST TZs and asserts exact local labels).
- `biome.json` — formatter and linter configuration. Biome covers TypeScript,
  JavaScript, JSON, and config files; Markdown and `justfile` prose are not
  formatted by these recipes.
- `scripts/timezone-matrix.mjs` — expectation tables per forced TZ: fixed
  `Etc/GMT` zones (stable expectations) plus real DST zones with
  transition-scenario assertions.
- `package.json` — publish-ready (scoped name, MIT, `pi` manifest → `./extensions`,
  `files` whitelist, `publishConfig.access: public`, `prepublishOnly` gate).

## Install

Installed as an **npm package** (`npm:@khaosoigai/pi-ds-pricing-regime`; entry
lives in the `packages` array in `~/.pi/agent/settings.json`). Pi installs it
to `~/.pi/agent/npm/node_modules/@khaosoigai/pi-ds-pricing-regime/`.
`pi update --extensions` upgrades it to the latest published version; run that
after a release, then restart pi.

An alternative install path is the git package from the GitHub repo
(`pi install git:github.com/khaosoi/pi-ds-pricing-regime`), which clones to
`~/.pi/agent/git/github.com/khaosoi/pi-ds-pricing-regime/`, runs `npm install`
there, and pulls latest `main` unpinned. Pin a ref with
`pi install git:github.com/khaosoi/pi-ds-pricing-regime@<ref>` when a
stable point is wanted.

The old symlink installer (`scripts/install.mjs`, `just link`/`just unlink`)
has been removed.

## Worktrees

All tooling config is tracked (justfile, biome.json, tsconfig.json, package.json +
lockfile), so a `git worktree add` gets identical settings. One caveat:
`node_modules/` is untracked — run `npm ci` in each new worktree before
`just build`.

## Testing notes

- Clock-dependent tests use `t.mock.timers` only as process-local virtual time
  (Date + setInterval APIs); they never change the operating system clock.
- The timezone matrix covers the midnight wrap (off-peak → next-day peak) and
  weekend flat-rate scenarios, including DST transitions.
- Pure helpers receive explicit instants; `statusText(now)` is deterministic
  given the clock, and `isDeepSeekModel` is pure on the model object. Keep it
  that way — any new state should be pure and testable before being wired to
  the UI.

## Publishing (do NOT do without explicit user go-ahead)

v0.1.0 is published to npm as `@khaosoigai/pi-ds-pricing-regime`. Release
checklist for a new version (documented in README):

1. `just pack` — confirm tarball contents
2. Bump `version` in `package.json`
3. Merge to `main` and tag the release
4. `npm login` (account `khaosoigai`), then `npm publish`
   (`prepublishOnly` runs check, typecheck, and tests; 2FA browser
   authentication is required)

Public identities: GitHub/git = `khaosoi`, npm = `khaosoigai`. Commits are
authored by the global git config (`khaosoi <165171671+khaosoi@users.noreply.github.com>`);
do not override with other identities.
