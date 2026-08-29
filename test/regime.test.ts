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
} from "../extensions/deepseek-peak-offpeak.ts";

test("peak windows are configured as documented", () => {
	assert.deepEqual(PEAK_WINDOWS, [
		[1, 4],
		[6, 10],
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
		["09:59:59Z", true],
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
		["06:20:00Z", 10],
		["09:59:00Z", 10],
		// off-peak → start of next window
		["00:30:00Z", 1],
		["05:35:00Z", 6],
		["10:00:00Z", 1], // wraps to tomorrow 01:00 UTC
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
		["2026-08-17T06:20:00Z", "2026-08-17T10:00:00Z"],
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
	// last legacy peak is Saturday 06:00–10:00 UTC; after that no more peaks.
	assert.equal(inPeak(new Date("2026-08-22T09:00:00Z")), true);
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
		["2026-08-21T06:20:00Z", "2026-08-21T10:00:00Z"], // Friday peak still ends the same day
	];
	for (const [nowIso, expectedIso] of cases) {
		assert.equal(
			nextBoundaryUtc(new Date(nowIso)).getTime(),
			new Date(expectedIso).getTime(),
			`nextBoundaryUtc(${nowIso})`,
		);
	}
});
