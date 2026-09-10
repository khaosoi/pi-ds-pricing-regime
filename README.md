# pi-ds-pricing-regime

A [pi](https://github.com/earendil-works/pi-coding-agent) extension that shows
whether DeepSeek is currently in **peak** or **off-peak** billing mode, in the
bottom-left of the footer. It reads the machine's clock, so all boundary times
display in the machine's local timezone — nothing is hardcoded.

## What it shows

| State | Footer text (bottom-left) |
| --- | --- |
| Peak hours | `DeepSeek PEAK — until 12:00 local` (amber) |
| Off-peak | `DeepSeek off-peak — next peak 09:00 local` (green) |
| Weekend (Beijing time) | `DeepSeek off-peak (weekend flat rate) — next peak Monday 09:00 local` (green) |

When the next boundary is not today (e.g. on a weekend morning), the label
includes the boundary's local weekday so `09:00` is not mistaken for today's
clock time.

The status refreshes every 30s, so it flips exactly at hour boundaries.

The indicator is shown **only while the selected model comes from the DeepSeek
provider** (`ctx.model.provider === "deepseek"`) — the regime is DeepSeek API
pricing, so it is meaningless for other providers. Switching models with
`/model` or `Ctrl+P` clears or restores the status immediately. The provider id
is a constant (`DEEPSEEK_PROVIDER`) at the top of the extension.

## Pairing with a configurable footer

The extension publishes plain pi statuses (`ctx.ui.setStatus`), so it works
with the **built-in footer** out of the box — no companion extension required.
It publishes two keys, sorted alphabetically there:

| Status key | Shows |
| --- | --- |
| `zz-deepseek-regime` | `DeepSeek PEAK — until 12:00 local` (see table above) |
| `zz-deepseek-balance` | `¥12.34` — DeepSeek platform credit balance, warning-coloured under the `LOW_BALANCE` thresholds |

For a configurable multi-line footer we recommend
[pi-footer](https://github.com/wobondar/pi-footer) (`pi install
npm:pi-footer`). It renders any published status through its `external-status`
widget, so this extension needs no changes — add widgets keyed to the status
keys above on their own line, e.g. `Tavily: 73%` (from a usage tracker) →
regime → balance, ordered exactly as configured and hidden when empty. Hide
the same keys from pi-footer's automatic extension-status row
(`extensionStatusRow.hiddenKeys` in `~/.pi/agent/extensions/pi-footer.json`)
to avoid showing them twice. Removing pi-footer (`pi remove npm:pi-footer`)
restores the built-in footer with these statuses intact.

## The regime

Source: [DeepSeek API pricing](https://api-docs.deepseek.com/quick_start/pricing)

- **Peak hours (UTC):** `01:00–04:00` and `06:00–10:00`; all other hours are
  off-peak at half the peak rates.
- **Live since:** `2026-08-16T16:00:00Z` (before that, billing was flat).
- **Weekends:** since `2026-08-22T16:00:00Z` (= 2026-08-23 00:00 Beijing), Saturdays and
  Sundays in Beijing calendar time have no peak tiers — every call bills at the uniform
  off-peak rate. The next peak after a live weekend is Monday 01:00 UTC; late UTC Sunday
  evenings are already Monday in Beijing, so weekday rules resume there.

All are constants at the top of
[`extensions/deepseek-peak-offpeak.ts`](extensions/deepseek-peak-offpeak.ts)
(`PEAK_WINDOWS`, `WEEKEND_OFFPEAK_UTC`, `DEEPSEEK_PROVIDER`) — edit them if
DeepSeek changes the regime.

## Pricing

The Flash series was repriced effective `2026-09-10T04:00:00Z` (12:00 Beijing
on 2026-09-10). Per 1M tokens:

| | Input (cache hit) | Input (cache miss) | Output |
| --- | --- | --- | --- |
| Off-peak | $0.003 | $0.15 | $0.60 |
| Peak (double) | $0.006 | $0.30 | $1.20 |

`deepseek-v4-flash` (internally V4.1-Flash) is the only served model: V4 Pro
and the experimental vision model are deprecated. The peak/off-peak windows
and the weekend flat-rate rule are unchanged by the repricing.

## Install

Install as a pi package from npm:

```sh
pi install npm:@khaosoigai/pi-ds-pricing-regime
```

The package is structured as a pi package: `package.json` declares a
[`pi` manifest](https://pi.dev/docs/packages) loading `./extensions`, and the
package is listed with the `pi-package` keyword for the [package gallery](https://pi.dev/packages).

### From git (alternative)

The source repo can also be installed directly from git:

```sh
pi install git:github.com/khaosoi/pi-ds-pricing-regime
```

Pi clones it to `~/.pi/agent/git/github.com/khaosoi/pi-ds-pricing-regime/` and
runs `npm install` there; restart pi (or `/reload`) to load it. The settings
entry has no pinned ref, so `pi update --extensions` pulls latest `main`.
Pin a ref with `pi install git:github.com/khaosoi/pi-ds-pricing-regime@<ref>`.

> Alternative: copy `extensions/deepseek-peak-offpeak.ts` into `.pi/extensions/`
> of a project for a project-local install.

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

- `test/regime.test.ts` — window boundaries, next-boundary math, weekend
  flat-rate rule.
- `test/smoke.test.ts` — loads the real extension with a mock pi context and
  mocked timers: peak / off-peak / weekend status text, and timer lifecycle.
- `test/timezone-matrix.test.ts` — runs `scripts/timezone-matrix.mjs` under
  fixed-offset zones (UTC+8, UTC+10, UTC-5) and real DST zones
  (America/New_York, Australia/Sydney), asserting exact local-time labels
  including the midnight wrap to the next day's peak and regime boundaries
  that land on DST transition instants.

CI (`.github/workflows/ci.yml`) runs formatting/lint checks, typecheck, and
41 tests on Node 24 for every push/PR.

## Publishing

The package is published to npm as `@khaosoigai/pi-ds-pricing-regime`. The
metadata is already in place:

- scoped name `@khaosoigai/pi-ds-pricing-regime` (name reserved to your npm account)
- MIT license (`LICENSE` + `license` field)
- `repository`/`bugs`/`homepage` point at `github.com/khaosoi/pi-ds-pricing-regime`
  — adjust if the repo gets a different name
- `publishConfig.access: "public"` so the scoped package publishes publicly
- `prepublishOnly` gate: runs typecheck + tests before every publish

To release a new version:

1. `npm run preview:package` — confirm the tarball contains only `extensions/`,
   `LICENSE`, `README.md`
2. Bump `version` in `package.json`
3. Merge to `main` and tag the release
4. `npm login` (account `khaosoigai`) and `npm publish` — the `prepublishOnly`
   gate re-runs check, typecheck, and tests as the final safety net

## Notes

- Labels show the *next regime boundary* in local time, not the full schedule,
  to keep the footer compact (e.g. `until 12:00 local` rather than
  `09:00–12:00, 14:00–18:00`).
- Boundary labels are rendered from the boundary's *actual instant*
  (`nextBoundaryUtc` → `formatLocalTime`), so they stay correct even when a
  DST transition falls between now and the boundary (covered by the DST
  scenarios in the timezone matrix).
- A boundary on a later local date is prefixed with its local weekday name
  (`formatLocalDayPrefix`), so Saturday morning reads `next peak Monday 09:00
  local` rather than a bare `09:00` that looks like today.
