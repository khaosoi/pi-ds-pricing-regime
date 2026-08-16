/**
 * Unit tests for the pure regime logic.
 * Deterministic: all instants are explicit; no system clock is changed or read.
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

test("formatCountdown: explicit reference instant, hours, and days", () => {
	const now = Date.UTC(2026, 7, 16, 5, 35, 0);
	assert.equal(formatCountdown(now - 1_000, now), "now");
	assert.equal(formatCountdown(now + 3 * 3_600_000, now), "~3h");
	assert.equal(formatCountdown(now + 10 * 3_600_000 + 24 * 60_000, now), "~10h 24m");
	assert.equal(formatCountdown(now + 25 * 3_600_000, now), "~25h");
	assert.equal(formatCountdown(now + 49 * 3_600_000, now), "~2d");

	// The result is tied to the supplied instant, not the ambient machine clock.
	const later = now + 60 * 60_000;
	assert.equal(formatCountdown(Date.UTC(2026, 7, 16, 16, 0), now), "~10h 25m");
	assert.equal(formatCountdown(Date.UTC(2026, 7, 16, 16, 0), later), "~9h 25m");
});
