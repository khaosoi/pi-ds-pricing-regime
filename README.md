# pi-ds-pricing-regime

A [pi](https://github.com/earendil-works/pi-coding-agent) extension that shows
whether DeepSeek is currently in **peak** or **off-peak** billing mode, in the
bottom-left of the footer. It reads the machine's clock, so all boundary times
display in the machine's local timezone — nothing is hardcoded.

## What it shows

| State | Footer text (bottom-left) |
| --- | --- |
| Before the regime (flat pricing) | `DeepSeek flat pricing — peak/off-peak from 00:00 local (~10h 24m)` (dim) |
| Peak hours | `⚡ DeepSeek PEAK — until 12:00 local` (amber) |
| Off-peak | `🌙 DeepSeek off-peak — next peak 09:00 local` (green) |

The status refreshes every 30s, so it flips exactly at hour boundaries and the
countdown stays fresh.

The indicator is intentionally **always displayed**, regardless of which model
or provider is currently selected in pi. It reports DeepSeek's current billing
regime as a standalone clock-based reference, rather than claiming that the
currently selected model is necessarily DeepSeek.

## The regime

Source: [DeepSeek API pricing](https://api-docs.deepseek.com/quick_start/pricing)

- **Peak hours (UTC):** `01:00–04:00` and `06:00–10:00`; all other hours are off-peak at half the peak rates.
- **Effective:** `2026-08-16T16:00:00Z` (before that, billing is flat).

Both are constants at the top of
[`extensions/deepseek-peak-offpeak.ts`](extensions/deepseek-peak-offpeak.ts)
(`PEAK_WINDOWS`, `EFFECTIVE_UTC`) — edit them if DeepSeek changes the regime.

## Install

From this repo (development):

```sh
npm install        # dev deps (typescript, @types/node) — once
npm run link       # symlink extensions/deepseek-peak-offpeak.ts into ~/.pi/agent/extensions/
```

Then run `/reload` inside pi (or restart pi). The extension is auto-discovered
from the global extensions dir; the symlink keeps the source of truth in this
repo. `npm run unlink` removes it (any pre-existing file is kept as `*.bak`).

> Alternative: copy `extensions/deepseek-peak-offpeak.ts` into `.pi/extensions/`
> of a project for a project-local install.

### From npm (future)

Once published, it installs as a pi package:

```sh
pi install npm:@khaosoigai/pi-ds-pricing-regime
```

The package is structured as a pi package: `package.json` declares a
[`pi` manifest](https://pi.dev/docs/packages) loading `./extensions`, and the
package is listed with the `pi-package` keyword for the [package gallery](https://pi.dev/packages).

## Development

```sh
just format       # format TypeScript, JavaScript, JSON, and config files
just format-check # verify formatting without changing files
just lint         # run Biome lint rules
just check        # format-check + lint
just build        # check + typecheck + tests — the release gate
just typecheck    # tsc against pi's types (resolved via the peer dep in node_modules)
just test         # node:test — unit, smoke, and timezone matrix tests
just coverage     # run tests with Node's built-in coverage report (100% currently)
just pack         # npm pack --dry-run: inspect the future tarball
just link          # symlink into ~/.pi/agent/extensions/
just unlink        # remove the symlink
```

Biome formats and lints TypeScript, JavaScript, JSON, and configuration files.
The Markdown documentation and `justfile` are intentionally outside these
recipes. Or use the equivalent npm scripts directly (`npm run format`,
`npm run format:check`, `npm run lint`, `npm run check`, `npm test`, and
`npm run coverage`).

No test framework is needed: Node ≥ 23 runs the TypeScript sources directly
(type stripping), and tests use the built-in `node:test` runner. Tests never
modify the operating system clock; clock-dependent tests use only Node's
process-local virtual timers.

- `test/regime.test.ts` — window boundaries, next-boundary math, countdown.
- `test/smoke.test.ts` — loads the real extension with a mock pi context and
  mocked timers: pre-regime / peak / off-peak status text, and timer lifecycle.
- `test/timezone-matrix.test.ts` — runs `scripts/timezone-matrix.mjs` under
  fixed-offset zones (UTC+8, UTC+10, UTC-5) and real DST zones
  (America/New_York, Australia/Sydney), asserting exact local-time labels
  including the midnight wrap to the next day's peak and regime boundaries
  that land on DST transition instants.

CI (`.github/workflows/ci.yml`) runs formatting/lint checks, typecheck, and
20 tests on Node 24 for every push/PR.

## Publishing checklist (when you're ready)

Nothing is published yet — `package.json` still has `"private": true` as a
guard. The metadata for a future public release is already in place:

- scoped name `@khaosoigai/pi-ds-pricing-regime` (name reserved to your npm account)
- MIT license (`LICENSE` + `license` field)
- `repository`/`bugs`/`homepage` point at `github.com/khaosoi/pi-ds-pricing-regime` — adjust if the repo gets a different name
- `publishConfig.access: "public"` so the scoped package publishes publicly
- `prepublishOnly` gate: runs typecheck + tests before every publish

When you actually want to release:

1. `npm run preview:package` — confirm the tarball contains only `extensions/`, `LICENSE`, `README.md`
2. In `package.json`: set `"private": false` (or delete the line), bump `version`
3. `npm login` (account `khaosoigai`) then `npm publish`

## Notes

- Labels show the *next regime boundary* in local time, not the full schedule,
  to keep the footer compact (e.g. `until 12:00 local` rather than
  `09:00–12:00, 14:00–18:00`).
- Boundary labels are rendered from the boundary's *actual instant*
  (`nextBoundaryUtc` → `formatLocalTime`), so they stay correct even when a
  DST transition falls between now and the boundary (covered by the DST
  scenarios in the timezone matrix).
