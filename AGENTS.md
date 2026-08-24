# pi-ds-pricing-regime — repo conventions

A [pi](https://github.com/earendil-works/pi-coding-agent) extension that always
shows DeepSeek's peak/off-peak billing mode in the footer (bottom-left),
timezone-aware. It is intentionally independent of the currently selected pi
model/provider. Loaded automatically when working inside this repo.

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
| `just link` / `just unlink` | Symlink `extensions/deepseek-peak-offpeak.ts` into `~/.pi/agent/extensions/` (or remove) |
| `just pack` | `npm pack --dry-run` — inspect the future tarball |

## Structure

- `extensions/deepseek-peak-offpeak.ts` — the extension. **Constants live at the
  top**: `PEAK_WINDOWS` (peak hours, `[start, end)` UTC) and `WEEKEND_OFFPEAK_UTC`
  (weekend flat-rate start; Sat/Sun Beijing time is off-peak all day from then;
  the tiered regime itself has been live since 2026-08-16T16:00:00Z). If
  DeepSeek changes the regime, edit here. Pure helpers (`inPeak`,
  `isWeekendBeijing`, `nextBoundaryUtcHour`, `nextBoundaryUtc`, `formatLocalTime`,
  `statusText`) are exported for tests; the default export wires them to
  `ctx.ui.setStatus`.
- `test/` — `regime.test.ts` (window/boundary/weekend math),
  `smoke.test.ts` (mock pi context + process-local mock timers; status text +
  timer lifecycle), `timezone-matrix.test.ts` (spawns the matrix script under
  fixed-offset and real DST TZs and asserts exact local labels).
- `biome.json` — formatter and linter configuration. Biome covers TypeScript,
  JavaScript, JSON, and config files; Markdown and `justfile` prose are not
  formatted by these recipes.
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
- The timezone matrix covers the midnight wrap (off-peak → next-day peak) and
  weekend flat-rate scenarios, including DST transitions.
- Pure helpers receive explicit instants; `statusText(now)` is deterministic
  given the clock. Keep it that way — any new state should be pure and
  testable before being wired to the UI.

## Publishing (do NOT do without explicit user go-ahead)

Currently `"private": true` as an accidental-publish guard. Release checklist
(documented in README):

1. `just pack` — confirm tarball contents
2. Set `"private": false` (or delete the line), bump `version`
3. `npm login` (account `khaosoigai`), then `npm publish` (`prepublishOnly` runs check, typecheck, and tests)

Public identities: GitHub/git = `khaosoi`, npm = `khaosoigai`. Commits are
authored by the global git config (`khaosoi <165171671+khaosoi@users.noreply.github.com>`);
do not override with other identities.
