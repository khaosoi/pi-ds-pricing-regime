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
 * 2. DST scenarios — real timezone transitions (all dates post-regime so
 *    statusText takes the peak/off-peak branch). These are the cases that
 *    caught the old "today's date" bug: a boundary landing on a different
 *    date than `now` with a DST transition in between.
 */
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
		[11, false, "09:00", "🌙 DeepSeek off-peak — next peak 09:00 local"],
	],
	"Etc/GMT-10": [
		[0, false, "11:00", "🌙 DeepSeek off-peak — next peak 11:00 local"],
		[1, true, "14:00", "⚡ DeepSeek PEAK — until 14:00 local"],
		[3, true, "14:00", "⚡ DeepSeek PEAK — until 14:00 local"],
		[5, false, "16:00", "🌙 DeepSeek off-peak — next peak 16:00 local"],
		[6, true, "20:00", "⚡ DeepSeek PEAK — until 20:00 local"],
		[9, true, "20:00", "⚡ DeepSeek PEAK — until 20:00 local"],
		[11, false, "11:00", "🌙 DeepSeek off-peak — next peak 11:00 local"],
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

// [isoUtc, expectedStatusText] — all dates are after EFFECTIVE_UTC (regime live).
// Transitions: NY falls back 2026-11-01T06:00Z, springs forward 2027-03-14T07:00Z;
// Sydney falls back 2027-04-03T16:00Z.
const DST_SCENARIOS = {
	"America/New_York": [
		// Boundary at the fall-back instant: 06:00Z Nov 1 = 01:00 EST (not 02:00 EDT).
		["2026-11-01T05:30:00Z", "🌙 DeepSeek off-peak — next peak 01:00 local"],
		// Wrap past midnight across the fall-back date boundary: 01:00Z Nov 2 = 20:00 EST.
		["2026-11-01T23:30:00Z", "🌙 DeepSeek off-peak — next peak 20:00 local"],
		// Spring-forward sanity: 10:00Z Mar 14 = 06:00 EDT.
		["2027-03-14T07:30:00Z", "⚡ DeepSeek PEAK — until 06:00 local"],
	],
	"Australia/Sydney": [
		// Wrap across the AEST fall-back (16:00Z Apr 3): 01:00Z Apr 4 = 11:00 AEST.
		["2027-04-03T23:30:00Z", "🌙 DeepSeek off-peak — next peak 11:00 local"],
	],
};

const fixedRows = TABLES[tz];
const dstRows = DST_SCENARIOS[tz];
if (!fixedRows && !dstRows) {
	console.error(`no expectation table for TZ=${tz}`);
	console.error(`expected one of: ${[...Object.keys(TABLES), ...Object.keys(DST_SCENARIOS)].join(", ")}`);
	process.exit(2);
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
		console.error(
			`FAIL TZ=${tz} ${iso}: expected peak=${expectedPeak} boundary=${expectedBoundary} status="${expectedStatus}" ` +
				`color=${expectedColor}, got peak=${peak} boundary=${local} status="${text}" (${color})`,
		);
	} else {
		console.log(`ok   TZ=${tz} ${iso}  →  ${text}  (${color})`);
	}
}

for (const [iso, expectedStatus] of dstRows ?? []) {
	const { text, color } = statusText(new Date(iso));
	if (text !== expectedStatus) {
		failures++;
		console.error(`FAIL TZ=${tz} ${iso}: expected status="${expectedStatus}", got "${text}" (${color})`);
	} else {
		console.log(`ok   TZ=${tz} ${iso}  →  ${text}  (${color})`);
	}
}

if (failures > 0) {
	console.error(`\n${failures} failure(s) for TZ=${tz}`);
	process.exit(1);
}
console.log(`\nall rows passed for TZ=${tz}`);
