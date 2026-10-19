/**
 * Unit tests for the regime-correct session spend: half cost for DeepSeek
 * messages billed off-peak, full cost otherwise. Pure functions — the entries
 * carry their own timestamps, so no clock mocking is needed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatSpend, sessionSpendUsd } from "../extensions/deepseek-peak-offpeak.ts";

/** An assistant message entry as pi stores it, with only the fields spend reads. */
function assistant(overrides: Record<string, unknown> = {}, total = 0.01) {
	const message = {
		role: "assistant",
		provider: "deepseek",
		model: "deepseek-flash",
		timestamp: Date.UTC(2026, 9, 19, 13, 46, 42), // Mon 2026-10-19 13:46 UTC — off-peak
		usage: { input: 1000, output: 10, cacheRead: 0, cacheWrite: 0, cost: { total } },
		...overrides,
	};
	return { type: "message", id: "e1", parentId: null, timestamp: "2026-10-19T13:46:42.560Z", message };
}

const PEAK_MS = Date.UTC(2026, 9, 19, 1, 30); // Mon 01:30 UTC — inside the 01:00–04:00 window
const WEEKEND_MS = Date.UTC(2026, 7, 22, 18, 0); // Sunday in Beijing time

test("sessionSpendUsd: no entries means no spend", () => {
	assert.equal(sessionSpendUsd([]), 0);
});

test("sessionSpendUsd: DeepSeek off-peak is halved", () => {
	assert.equal(sessionSpendUsd([assistant({}, 0.02)]), 0.01);
});

test("sessionSpendUsd: DeepSeek peak is charged as recorded", () => {
	assert.equal(sessionSpendUsd([assistant({ timestamp: PEAK_MS }, 0.02)]), 0.02);
});

test("sessionSpendUsd: the weekend flat rate is off-peak", () => {
	assert.equal(sessionSpendUsd([assistant({ timestamp: WEEKEND_MS }, 0.02)]), 0.01);
});

test("sessionSpendUsd: other providers are never halved", () => {
	const entry = assistant({ provider: "kimi-coding", model: "k3" }, 0.02);
	assert.equal(sessionSpendUsd([entry]), 0.02);
});

test("sessionSpendUsd: mix of peak, off-peak, and other providers", () => {
	const entries = [
		assistant({}, 0.02), // deepseek off-peak → 0.01
		assistant({ timestamp: PEAK_MS }, 0.02), // deepseek peak → 0.02
		assistant({ provider: "kimi-coding", timestamp: PEAK_MS }, 0.02), // other → 0.02
	];
	assert.ok(Math.abs(sessionSpendUsd(entries) - 0.05) < 1e-12);
});

test("sessionSpendUsd: falls back to the entry timestamp", () => {
	const entry = assistant({ timestamp: undefined }, 0.02);
	entry.timestamp = "2026-10-19T01:30:00.000Z"; // peak
	assert.equal(sessionSpendUsd([entry]), 0.02);
});

test("sessionSpendUsd: unreadable timestamps keep the full recorded cost", () => {
	const entry = assistant({ timestamp: "not-a-date" }, 0.02);
	entry.timestamp = "also-not-a-date";
	assert.equal(sessionSpendUsd([entry]), 0.02);
});

test("sessionSpendUsd: ignores non-assistant and malformed entries", () => {
	const entries = [
		null,
		undefined,
		"nonsense",
		42,
		{},
		{ type: "usage", usage: { cost: { total: 0.5 } } },
		{ type: "message", message: null },
		{ type: "message", message: { role: "user" } },
		{ type: "message", message: { role: "assistant" } },
		{ type: "message", message: { role: "assistant", usage: {} } },
		{ type: "message", message: { role: "assistant", usage: { cost: null } } },
		{ type: "message", message: { role: "assistant", usage: { cost: { total: "not-a-number" } } } },
	];
	assert.equal(sessionSpendUsd(entries), 0);
});

test("formatSpend: four decimals under a dollar, two above", () => {
	assert.equal(formatSpend(0), "$0.0000");
	assert.equal(formatSpend(0.0153967), "$0.0154");
	assert.equal(formatSpend(0.5), "$0.5000");
	assert.equal(formatSpend(1), "$1.00");
	assert.equal(formatSpend(12.345), "$12.35");
});
