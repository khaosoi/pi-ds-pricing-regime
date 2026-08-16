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

## The regime

Source: [DeepSeek API pricing](https://api-docs.deepseek.com/quick_start/pricing)

- **Peak hours (UTC):** `01:00–04:00` and `06:00–10:00`; all other hours are off-peak at half the peak rates.
- **Effective:** `2026-08-16T16:00:00Z` (before that, billing is flat).

Both are constants at the top of [`src/deepseek-peak-offpeak.ts`](src/deepseek-peak-offpeak.ts)
(`PEAK_WINDOWS`, `EFFECTIVE_UTC`) — edit them if DeepSeek changes the regime.

## Install

```sh
npm install        # dev deps (typescript, @types/node) — once
npm run link       # symlink src/deepseek-peak-offpeak.ts into ~/.pi/agent/extensions/
```

Then run `/reload` inside pi (or restart pi). The extension is auto-discovered
from the global extensions dir; the symlink keeps the source of truth in this
repo. `npm run unlink` removes it (any pre-existing file is kept as `*.bak`).

> Alternative: copy `src/deepseek-peak-offpeak.ts` into `.pi/extensions/` of a
> project for a project-local install.

## Development

```sh
npm run typecheck  # tsc against pi's types (global install at node_modules/...)
npm test           # node:test — unit, smoke, and timezone matrix tests
```

No test framework is needed: Node ≥ 23 runs the TypeScript sources directly
(type stripping), and tests use the built-in `node:test` runner.

- `test/regime.test.ts` — window boundaries, next-boundary math, countdown.
- `test/smoke.test.ts` — loads the real extension with a mock pi context and
  mocked timers: pre-regime / peak / off-peak status text, and timer lifecycle.
- `test/timezone-matrix.test.ts` — runs `scripts/timezone-matrix.mjs` under
  three forced timezones (UTC+8, UTC+10, UTC-5) and asserts exact local-time
  labels, including the midnight wrap to the next day's peak.

## Notes

- Labels show the *next regime boundary* in local time, not the full schedule,
  to keep the footer compact (e.g. `until 12:00 local` rather than
  `09:00–12:00, 14:00–18:00`).
- `utcHourToLocalString` converts a UTC hour to wall-clock using *today's*
  date; around DST transitions the boundary label can be off by an hour for a
  few days. Acceptable for a status indicator, but worth knowing.
