#!/usr/bin/env node
/**
 * Timezone matrix for the DeepSeek peak/off-peak logic.
 *
 * Run under a forced TZ (the test does this via child processes):
 *   TZ=Etc/GMT-8  node scripts/timezone-matrix.mjs   # UTC+8 (e.g. Hong Kong)
 *   TZ=Etc/GMT-10 node scripts/timezone-matrix.mjs   # UTC+10 (e.g. AEST)
 *   TZ=Etc/GMT+5  node scripts/timezone-matrix.mjs   # UTC-5 (e.g. US Eastern, winter)
 *
 * Each row: [utcHour, expectedPeak, expectedBoundaryLocal, expectedStatusText]
 * Rows use a fixed post-regime date (2026-08-17) so statusText() takes the
 * peak/off-peak branch. Fixed-offset Etc/GMT zones are used so the expected
 * local labels never drift with daylight-saving changes.
 */
import { inPeak, nextBoundaryUtcHour, utcHourToLocalString, statusText } from "../src/deepseek-peak-offpeak.ts";

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

const rows = TABLES[tz];
if (!rows) {
	console.error(`no expectation table for TZ=${tz}`);
	console.error(`expected one of: ${Object.keys(TABLES).join(", ")}`);
	process.exit(2);
}

const DAY = "2026-08-17T"; // post-regime, so statusText takes the peak/off-peak branch
let failures = 0;

for (const [hour, expectedPeak, expectedBoundary, expectedStatus] of rows) {
	const iso = `${DAY}${String(hour).padStart(2, "0")}:00:00Z`;
	const now = new Date(iso);
	const peak = inPeak(now);
	const boundary = nextBoundaryUtcHour(now);
	const local = utcHourToLocalString(boundary);
	const { text, color } = statusText(now);
	const expectedColor = expectedPeak ? "warning" : "success";

	if (peak !== expectedPeak || local !== expectedBoundary || text !== expectedStatus || color !== expectedColor) {
		failures++;
		console.error(
			`FAIL TZ=${tz} ${iso}: expected peak=${expectedPeak} boundary=${expectedBoundary} status="${expectedStatus}" ` +
				`color=${expectedColor}, got peak=${peak} boundary=${boundary} (local ${local}) status="${text}" (${color})`,
		);
	} else {
		console.log(`ok   TZ=${tz} ${iso}  →  ${text}  (${color})`);
	}
}

if (failures > 0) {
	console.error(`\n${failures} failure(s) for TZ=${tz}`);
	process.exit(1);
}
console.log(`\nall rows passed for TZ=${tz}`);
