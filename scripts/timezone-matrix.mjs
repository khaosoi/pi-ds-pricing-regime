#!/usr/bin/env node
/**
 * Timezone matrix for the DeepSeek peak/off-peak logic.
 *
 * Run under a forced TZ (the test does this via child processes):
 *   TZ=Etc/GMT-8  node scripts/timezone-matrix.mjs   # UTC+8 (e.g. Hong Kong)
 *   TZ=Etc/GMT-10 node scripts/timezone-matrix.mjs   # UTC+10 (e.g. AEST)
 *   TZ=Etc/GMT+5  node scripts/timezone-matrix.mjs   # UTC-5 (e.g. US Eastern, winter)
 *   TZ=America/New_York node scripts/timezone-matrix.mjs   # DST zone (fall-back + spring-forward)
 *   TZ=Australia/Sydney node scripts/timezone-matrix.mjs   # DST zone (AEST fall-back)
 *
 * Two sections:
 * 1. Fixed-offset tables — each row [utcHour, expectedPeak, expectedBoundaryLocal,
 *    expectedStatusText] on a post-regime date (2026-08-17). Etc/GMT zones never
 *    drift with DST, so these expectations are stable.
 * 2. Scenarios per zone — real timezone transitions (all dates post-regime so
 *    statusText takes the peak/off-peak branch) plus weekend flat-rate cases:
 *    boundaries landing on a different date than `now`, with or without a DST
 *    transition in between, and next-peak labels that skip live weekends.
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inPeak, nextBoundaryUtc, formatLocalTime, statusText } from "../extensions/deepseek-peak-offpeak.ts";

const tz = process.env.TZ ?? "(unset)";

// Local-time peak windows per zone, derived from the UTC windows [1,4) & [6,10):
//   Etc/GMT-8 (UTC+8):  peak 09:00–12:00, 14:00–18:00
//   Etc/GMT-10 (UTC+10): peak 11:00–14:00, 16:00–20:00
//   Etc/GMT+5 (UTC-5):  peak 20:00–23:00, 01:00–05:00
const TABLES = {
	"Etc/GMT-8": [
		[0, false, "09:00", "🌙 DeepSeek off-peak — next peak 09:00 local"],
		[1, true, "12:00", "⚡ DeepSeek PEAK — until 12:00 local"],
		[3, true, "12:00", "⚡ DeepSeek PEAK — until 12:00 local"],
		[5, false, "14:00", "🌙 DeepSeek off-peak — next peak 14:00 local"],
		[6, true, "18:00", "⚡ DeepSeek PEAK — until 18:00 local"],
		[9, true, "18:00", "⚡ DeepSeek PEAK — until 18:00 local"],
		// 19:00 local Monday → next peak is tomorrow (Tuesday) 09:00 local.
		[11, false, "09:00", "🌙 DeepSeek off-peak — next peak Tuesday 09:00 local"],
	],
	"Etc/GMT-10": [
		[0, false, "11:00", "🌙 DeepSeek off-peak — next peak 11:00 local"],
		[1, true, "14:00", "⚡ DeepSeek PEAK — until 14:00 local"],
		[3, true, "14:00", "⚡ DeepSeek PEAK — until 14:00 local"],
		[5, false, "16:00", "🌙 DeepSeek off-peak — next peak 16:00 local"],
		[6, true, "20:00", "⚡ DeepSeek PEAK — until 20:00 local"],
		[9, true, "20:00", "⚡ DeepSeek PEAK — until 20:00 local"],
		// 21:00 local Monday → next peak is tomorrow (Tuesday) 11:00 local.
		[11, false, "11:00", "🌙 DeepSeek off-peak — next peak Tuesday 11:00 local"],
	],
	"Etc/GMT+5": [
		[0, false, "20:00", "🌙 DeepSeek off-peak — next peak 20:00 local"],
		[1, true, "23:00", "⚡ DeepSeek PEAK — until 23:00 local"],
		[3, true, "23:00", "⚡ DeepSeek PEAK — until 23:00 local"],
		[5, false, "01:00", "🌙 DeepSeek off-peak — next peak 01:00 local"],
		[6, true, "05:00", "⚡ DeepSeek PEAK — until 05:00 local"],
		[9, true, "05:00", "⚡ DeepSeek PEAK — until 05:00 local"],
		[11, false, "20:00", "🌙 DeepSeek off-peak — next peak 20:00 local"],
	],
};

// [isoUtc, expectedStatusText] — all dates are post-regime.
// Transitions: NY falls back 2026-11-01T06:00Z (a Sunday), springs forward
// 2027-03-14T07:00Z (also a Sunday); Sydney falls back 2027-04-03T16:00Z (a
// Saturday). Weekend instants use the weekend flat-rate label and roll the
// next peak to Monday 01:00 UTC.
const DST_SCENARIOS = {
	"Etc/GMT-8": [
		// Friday 20:00 HKT off-peak → the whole weekend is skipped.
		["2026-08-28T12:00:00Z", "🌙 DeepSeek off-peak — next peak Monday 09:00 local"],
		// Sunday 02:00 HKT → weekend flat rate, next peak Monday 09:00 local.
		["2026-08-22T18:00:00Z", "🌙 DeepSeek off-peak (weekend flat rate) — next peak Monday 09:00 local"],
		// Saturday 09:39 HKT → still the whole weekend ahead; the label must say
		// Monday so 09:00 is not mistaken for today's clock time.
		["2026-08-29T01:39:00Z", "🌙 DeepSeek off-peak (weekend flat rate) — next peak Monday 09:00 local"],
	],
	"Etc/GMT-10": [
		// Sunday 10:00 AEST → weekend flat rate, next peak Monday 01:00Z = Monday 11:00 local.
		["2026-08-23T00:00:00Z", "🌙 DeepSeek off-peak (weekend flat rate) — next peak Monday 11:00 local"],
	],
	"Etc/GMT+5": [
		// Saturday 13:00 local (after the 16:00Z rule start) → weekend flat rate;
		// next peak Monday 01:00Z lands on *Sunday* 20:00 local, and the label
		// shows the boundary's local weekday.
		["2026-08-22T18:00:00Z", "🌙 DeepSeek off-peak (weekend flat rate) — next peak Sunday 20:00 local"],
	],
	"America/New_York": [
		// Sunday across the fall-back instant: 05:30Z Nov 1 = 01:30 EDT; the next
		// peak (Monday 01:00Z) is labeled 20:00 EST on the *previous* date.
		["2026-11-01T05:30:00Z", "🌙 DeepSeek off-peak (weekend flat rate) — next peak 20:00 local"],
		// Late UTC Sunday evening is already Monday in Beijing (23:30Z = 18:30 EST
		// Sunday local, but Monday 07:30 Beijing) → normal weekday off-peak.
		["2026-11-01T23:30:00Z", "🌙 DeepSeek off-peak — next peak 20:00 local"],
		// Monday morning after fall-back: 05:30Z = 00:30 EST; next peak 06:00Z = 01:00 EST.
		["2026-11-02T05:30:00Z", "🌙 DeepSeek off-peak — next peak 01:00 local"],
		// Spring-forward Sunday: 07:30Z Mar 14 = 03:30 EDT; next peak Mon 01:00Z = Sun 21:00 EDT.
		["2027-03-14T07:30:00Z", "🌙 DeepSeek off-peak (weekend flat rate) — next peak 21:00 local"],
		// Spring-forward Monday sanity: 07:30Z Mar 15 = 03:30 EDT, peak until 10:00Z = 06:00 EDT.
		["2027-03-15T07:30:00Z", "⚡ DeepSeek PEAK — until 06:00 local"],
	],
	"Australia/Sydney": [
		// Sydney Saturday fall-back: the next peak (Monday 01:00Z Apr 5 = 11:00
		// AEST Apr 5) is a different local date → labelled Monday.
		["2027-04-03T23:30:00Z", "🌙 DeepSeek off-peak (weekend flat rate) — next peak Monday 11:00 local"],
		// Monday sanity after the transition: 04:30Z Apr 5 = 14:30 AEST, off-peak until 06:00Z = 16:00 AEST.
		["2027-04-05T04:30:00Z", "🌙 DeepSeek off-peak — next peak 16:00 local"],
	],
};

/**
 * Run the matrix for one timezone.
 *
 * The optional tables/scenarios and output functions make the defensive paths
 * testable without adding test-only environment switches to the CLI.
 */
export function runMatrix(
	tz,
	{ tables = TABLES, dstScenarios = DST_SCENARIOS, log = console.log, error = console.error } = {},
) {
	const fixedRows = tables[tz];
	const dstRows = dstScenarios[tz];
	if (!fixedRows && !dstRows) {
		error(`no expectation table for TZ=${tz}`);
		error(`expected one of: ${[...Object.keys(tables), ...Object.keys(dstScenarios)].join(", ")}`);
		return 2;
	}

	const DAY = "2026-08-17T"; // post-regime, so statusText takes the peak/off-peak branch
	let failures = 0;

	for (const [hour, expectedPeak, expectedBoundary, expectedStatus] of fixedRows ?? []) {
		const iso = `${DAY}${String(hour).padStart(2, "0")}:00:00Z`;
		const now = new Date(iso);
		const peak = inPeak(now);
		const local = formatLocalTime(nextBoundaryUtc(now));
		const { text, color } = statusText(now);
		const expectedColor = expectedPeak ? "warning" : "success";

		if (peak !== expectedPeak || local !== expectedBoundary || text !== expectedStatus || color !== expectedColor) {
			failures++;
			error(
				`FAIL TZ=${tz} ${iso}: expected peak=${expectedPeak} boundary=${expectedBoundary} status="${expectedStatus}" ` +
					`color=${expectedColor}, got peak=${peak} boundary=${local} status="${text}" (${color})`,
			);
		} else {
			log(`ok   TZ=${tz} ${iso}  →  ${text}  (${color})`);
		}
	}

	for (const [iso, expectedStatus] of dstRows ?? []) {
		const { text, color } = statusText(new Date(iso));
		if (text !== expectedStatus) {
			failures++;
			error(`FAIL TZ=${tz} ${iso}: expected status="${expectedStatus}", got "${text}" (${color})`);
		} else {
			log(`ok   TZ=${tz} ${iso}  →  ${text}  (${color})`);
		}
	}

	if (failures > 0) {
		error(`\n${failures} failure(s) for TZ=${tz}`);
		return 1;
	}
	log(`\nall rows passed for TZ=${tz}`);
	return 0;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
	process.exitCode = runMatrix(tz);
}
