# pi-ds-pricing-regime — repo conventions

A [pi](https://github.com/earendil-works/pi-coding-agent) extension that always
shows DeepSeek's peak/off-peak billing mode in the footer (bottom-left),
timezone-aware. It is intentionally independent of the currently selected pi
model/provider. Loaded automatically when working inside this repo.

## Commands

Use `just` (recipe bodies run the same npm scripts):

| Command | Runs |
| --- | --- |
| `just build` | `npm run typecheck && npm test` — the release gate (also `prepublishOnly`) |
| `just typecheck` | `tsc -p tsconfig.json` (pi types resolved via the local peer dep) |
| `just test` | `node --test` — native TS, no test framework (needs Node ≥ 23) |
| `just link` / `just unlink` | Symlink `extensions/deepseek-peak-offpeak.ts` into `~/.pi/agent/extensions/` (or remove) |
| `just pack` | `npm pack --dry-run` — inspect the future tarball |

## Structure

- `extensions/deepseek-peak-offpeak.ts` — the extension. **Constants live at the
  top**: `PEAK_WINDOWS` (peak hours, `[start, end)` UTC) and `EFFECTIVE_UTC`
  (regime start). If DeepSeek changes the regime, edit here. Pure helpers
  (`inPeak`, `nextBoundaryUtcHour`, `nextBoundaryUtc`, `formatLocalTime`,
  `formatCountdown`, `statusText`) are exported for tests; the default export
  wires them to `ctx.ui.setStatus`.
- `test/` — `regime.test.ts` (window/boundary/countdown math),
  `smoke.test.ts` (mock pi context + mock timers; status text + timer
  lifecycle), `timezone-matrix.test.ts` (spawns the matrix script under forced
  `Etc/GMT±N` TZs and asserts exact local labels).
- `scripts/install.mjs` — link/unlink installer. Uses `os.homedir()` and the
  script's own location at runtime — **never hardcode user/machine paths in
  this repo**.
- `scripts/timezone-matrix.mjs` — expectation tables per forced TZ: fixed
  `Etc/GMT` zones (stable expectations) plus real DST zones with
  transition-scenario assertions.
- `package.json` — publish-ready (scoped name, MIT, `pi` manifest → `./extensions`,
  `files` whitelist, `publishConfig.access: public`, `prepublishOnly` gate).

## Testing notes

- Clock-dependent tests use `t.mock.timers` only as process-local virtual time
  (Date + setInterval APIs); they never change the operating system clock.
- Pure helpers receive explicit instants. The pre-regime countdown test is
  exact while the regime is still upcoming.
- The timezone matrix covers the midnight wrap (off-peak → next-day peak).
- `statusText(now)` is deterministic given the clock; keep it that way — any
  new state should be pure and testable before being wired to the UI.

## Publishing (do NOT do without explicit user go-ahead)

Currently `"private": true` as an accidental-publish guard. Release checklist
(documented in README):

1. `just pack` — confirm tarball contents
2. Set `"private": false` (or delete the line), bump `version`
3. `npm login` (account `khaosoigai`), then `npm publish` (`prepublishOnly` runs `just build`)

Public identities: GitHub/git = `khaosoi`, npm = `khaosoigai`. Commits are
authored by the global git config (`khaosoi <165171671+khaosoi@users.noreply.github.com>`);
do not override with other identities.
