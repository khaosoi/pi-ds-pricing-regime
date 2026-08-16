/**
 * Unit tests for the pure regime logic.
 * Deterministic: explicit Date objects, no clock mocking needed except formatCountdown.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
	PEAK_WINDOWS,
	EFFECTIVE_UTC,
	inPeak,
	nextBoundaryUtcHour,
	nextBoundaryUtc,
	formatCountdown,
} from "../extensions/deepseek-peak-offpeak.ts";

test("peak windows are configured as documented", () => {
	assert.deepEqual(PEAK_WINDOWS, [
		[1, 4],
		[6, 10],
	]);
});

test("effective date is 2026-08-16T16:00:00Z", () => {
	assert.equal(EFFECTIVE_UTC, Date.UTC(2026, 7, 16, 16, 0, 0));
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

test("formatCountdown: past target, hours, and days", () => {
	const now = Date.now();
	assert.equal(formatCountdown(now - 1_000), "now");
	assert.equal(formatCountdown(now + 3 * 3_600_000), "~3h");
	assert.equal(formatCountdown(now + 10 * 3_600_000 + 24 * 60_000), "~10h 24m");
	assert.equal(formatCountdown(now + 25 * 3_600_000), "~25h");
	assert.equal(formatCountdown(now + 49 * 3_600_000), "~2d");
});
