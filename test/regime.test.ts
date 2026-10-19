/**
 * Unit tests for the pure regime logic.
 * Deterministic: all instants are explicit; no system clock is changed or read.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
	PEAK_WINDOWS,
	WEEKEND_OFFPEAK_UTC,
	formatLocalDayPrefix,
	inPeak,
	isWeekendBeijing,
	nextBoundaryUtcHour,
	nextBoundaryUtc,
	statusText,
} from "../extensions/deepseek-peak-offpeak.ts";

test("peak windows are configured as documented", () => {
	assert.deepEqual(PEAK_WINDOWS, [
		[1, 4],
		[6, 9],
	]);
});

test("weekend rule takes effect 2026-08-22T16:00:00Z (2026-08-23 00:00 Beijing)", () => {
	assert.equal(WEEKEND_OFFPEAK_UTC, Date.UTC(2026, 7, 22, 16, 0, 0));
});

test("inPeak: window boundaries are half-open", () => {
	const day = "2026-08-17T";
	const cases: Array<[string, boolean]> = [
		["00:59:59Z", false],
		["01:00:00Z", true],
		["03:59:59Z", true],
		["04:00:00Z", false],
		["05:59:59Z", false],
		["06:00:00Z", true],
		["08:59:59Z", true],
		["09:00:00Z", false],
		["10:00:00Z", false],
		["23:59:59Z", false],
	];
	for (const [time, expected] of cases) {
		assert.equal(inPeak(new Date(day + time)), expected, `inPeak(${time})`);
	}
});

test("nextBoundaryUtcHour: peak → window end, off-peak → next window start (wraps)", () => {
	const day = "2026-08-17T";
	const cases: Array<[string, number]> = [
		// peak → end of current window
		["01:30:00Z", 4],
		["03:59:00Z", 4],
		["06:20:00Z", 9],
		["08:59:00Z", 9],
		// off-peak → start of next window
		["00:30:00Z", 1],
		["05:35:00Z", 6],
		["09:00:00Z", 1], // wraps to tomorrow 01:00 UTC
		["11:00:00Z", 1],
		["23:59:00Z", 1],
	];
	for (const [time, expected] of cases) {
		assert.equal(nextBoundaryUtcHour(new Date(day + time)), expected, `nextBoundaryUtcHour(${time})`);
	}
});

test("nextBoundaryUtc: peak ends today, off-peak wraps to tomorrow when needed", () => {
	const cases: Array<[string, string]> = [
		// peak → end of current window, same UTC day
		["2026-08-17T01:30:00Z", "2026-08-17T04:00:00Z"],
		["2026-08-17T06:20:00Z", "2026-08-17T09:00:00Z"],
		// off-peak → next window start, same day
		["2026-08-17T00:30:00Z", "2026-08-17T01:00:00Z"],
		["2026-08-17T05:35:00Z", "2026-08-17T06:00:00Z"],
		// off-peak → wraps to the next UTC day
		["2026-08-17T11:00:00Z", "2026-08-18T01:00:00Z"],
		["2026-08-17T23:59:00Z", "2026-08-18T01:00:00Z"],
	];
	for (const [nowIso, expectedIso] of cases) {
		assert.equal(
			nextBoundaryUtc(new Date(nowIso)).getTime(),
			new Date(expectedIso).getTime(),
			`nextBoundaryUtc(${nowIso})`,
		);
	}
});

test("formatLocalDayPrefix: empty for the same local date, weekday name otherwise", () => {
	const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
	// The same-instant case is same-local-date in every timezone.
	assert.equal(formatLocalDayPrefix(new Date("2026-08-29T01:39:00Z"), new Date("2026-08-29T01:39:00Z")), "");
	// Two instants over 24h apart are on different local dates in every timezone.
	const now = new Date("2026-08-29T01:39:00Z"); // Saturday morning
	const monday = new Date("2026-08-31T01:00:00Z");
	assert.equal(formatLocalDayPrefix(now, monday), "Monday ");
	assert.equal(formatLocalDayPrefix(now, new Date("2026-08-30T01:00:00Z")), "Sunday ");
	// For same-UTC-date instants the local-date relation is timezone-dependent,
	// so derive the expectation from the machine's local calendar.
	const later = new Date("2026-08-29T09:00:00Z");
	const expected = now.getDate() === later.getDate() ? "" : `${DAY_NAMES[later.getDay()]} `;
	assert.equal(formatLocalDayPrefix(now, later), expected);
});

test("inPeak: Beijing weekdays peak 09:00–12:00 and 14:00–17:00", () => {
	// Beijing is UTC+8 all year; instants are the Beijing wall clock minus 8h.
	const cases: Array<[string, boolean, string]> = [
		["2026-08-31T00:59:00Z", false, "Monday 08:59 Beijing"],
		["2026-08-31T01:00:00Z", true, "Monday 09:00 Beijing"],
		["2026-08-31T03:59:00Z", true, "Monday 11:59 Beijing"],
		["2026-08-31T04:00:00Z", false, "Monday 12:00 Beijing"],
		["2026-08-31T05:59:00Z", false, "Monday 13:59 Beijing"],
		["2026-08-31T06:00:00Z", true, "Monday 14:00 Beijing"],
		["2026-08-31T08:59:00Z", true, "Monday 16:59 Beijing"],
		["2026-08-31T09:00:00Z", false, "Monday 17:00 Beijing"],
	];
	for (const [iso, expected, label] of cases) {
		assert.equal(inPeak(new Date(iso)), expected, label);
	}
});

test("inPeak: the weekend off-peak block runs Friday 17:00 → Monday 09:00 Beijing", () => {
	// Friday: the 14:00–17:00 Beijing peak ends at 09:00 UTC.
	assert.equal(inPeak(new Date("2026-08-28T08:59:00Z")), true); // Fri 16:59 Beijing
	assert.equal(inPeak(new Date("2026-08-28T09:00:00Z")), false); // Fri 17:00 Beijing
	assert.equal(inPeak(new Date("2026-08-28T12:00:00Z")), false); // Fri 20:00 Beijing
	// Saturday and Sunday are off-peak all day.
	assert.equal(inPeak(new Date("2026-08-29T02:00:00Z")), false); // Sat 10:00 Beijing
	assert.equal(inPeak(new Date("2026-08-30T07:00:00Z")), false); // Sun 15:00 Beijing
	// Monday: the 09:00–12:00 Beijing peak starts at 01:00 UTC.
	assert.equal(inPeak(new Date("2026-08-31T00:59:00Z")), false); // Mon 08:59 Beijing
	assert.equal(inPeak(new Date("2026-08-31T01:00:00Z")), true); // Mon 09:00 Beijing
});

test("isWeekendBeijing follows the Beijing calendar day (fixed UTC+8)", () => {
	assert.equal(isWeekendBeijing(new Date("2026-08-22T15:59:59Z")), true); // Sat 23:59:59 Beijing
	assert.equal(isWeekendBeijing(new Date("2026-08-22T16:00:00Z")), true); // Sun 00:00:00 Beijing
	assert.equal(isWeekendBeijing(new Date("2026-08-23T15:59:59Z")), true); // Sun 23:59:59 Beijing
	assert.equal(isWeekendBeijing(new Date("2026-08-23T16:00:00Z")), false); // Mon 00:00:00 Beijing
	assert.equal(isWeekendBeijing(new Date("2026-08-23T07:00:00Z")), true); // Sun 15:00 Beijing
	assert.equal(isWeekendBeijing(new Date("2026-08-24T15:59:59Z")), false); // Mon 23:59 Beijing
});

test("inPeak: weekends are off-peak once the weekend rule is live", () => {
	// Before the weekend rule, the legacy tiered schedule applied on Saturdays too.
	assert.equal(inPeak(new Date("2026-08-15T02:00:00Z")), true); // Sat 02:00 UTC
	// The rule flips exactly at 2026-08-22T16:00:00Z (Sun 00:00 Beijing). The
	// last legacy peak is Saturday 06:00–09:00 UTC; after that no more peaks.
	assert.equal(inPeak(new Date("2026-08-22T08:30:00Z")), true);
	assert.equal(inPeak(new Date("2026-08-22T16:00:00Z")), false);
	assert.equal(inPeak(new Date("2026-08-23T07:00:00Z")), false); // Sunday
	assert.equal(inPeak(new Date("2026-08-23T02:00:00Z")), false); // Sunday, would-be peak hour
	// Monday resumes the tiered schedule.
	assert.equal(inPeak(new Date("2026-08-24T02:00:00Z")), true);
});

test("nextBoundaryUtc: live weekends roll the next peak to Monday 01:00 UTC", () => {
	const cases: Array<[string, string]> = [
		["2026-08-22T18:00:00Z", "2026-08-24T01:00:00Z"], // Saturday evening → Monday peak
		["2026-08-23T23:59:00Z", "2026-08-24T01:00:00Z"], // Sunday late night → Monday peak
		["2026-08-28T12:00:00Z", "2026-08-31T01:00:00Z"], // Friday off-peak skips the whole weekend
		["2026-08-21T06:20:00Z", "2026-08-21T09:00:00Z"], // Friday peak still ends the same day
	];
	for (const [nowIso, expectedIso] of cases) {
		assert.equal(
			nextBoundaryUtc(new Date(nowIso)).getTime(),
			new Date(expectedIso).getTime(),
			`nextBoundaryUtc(${nowIso})`,
		);
	}
});

test("nextBoundaryUtc: throws when the scan finds no window within maxScanDays", (t) => {
	t.mock.timers.enable({ apis: ["Date"] });
	t.mock.timers.setTime(new Date("2026-08-28T12:00:00Z").getTime()); // Friday, off-peak

	assert.throws(() => nextBoundaryUtc(new Date(), 0), /no peak window found/);
	// Production default of 9 days always contains a weekday peak window.
	assert.ok(nextBoundaryUtc(new Date()) instanceof Date);
});

test("statusText: weekend before the flat-rate cutoff uses the plain off-peak text", (t) => {
	t.mock.timers.enable({ apis: ["Date"] });
	t.mock.timers.setTime(new Date("2026-08-15T18:00:00Z").getTime()); // Saturday in Beijing, before the cutoff

	const { text } = statusText(new Date());
	assert.match(text, /^DeepSeek off-peak — next peak/);
	assert.doesNotMatch(text, /weekend flat rate/);
});
