/**
 * Smoke test for the extension module: fires session_start / session_shutdown
 * against a mock pi context and verifies the status text and timer lifecycle.
 *
 * Uses node:test mock timers so `new Date()` / `Date.now()` follow a fake clock.
 * The HH:MM local labels depend on the machine TZ; exact labels are covered by
 * the timezone matrix (test/timezone-matrix.test.ts). Here we assert the shape.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import ext, { statusText } from "../src/deepseek-peak-offpeak.ts";

type StatusMap = Map<string, string>;
const LOCAL = /^\d{2}:\d{2}$/;

function makePi() {
	const handlers = new Map<string, Array<(e: unknown, ctx: unknown) => Promise<void> | void>>();
	const statuses: StatusMap = new Map();
	const calls = { setStatus: 0 };

	const pi = {
		on: (event: string, handler: (e: unknown, ctx: unknown) => Promise<void> | void) => {
			handlers.set(event, [...(handlers.get(event) ?? []), handler]);
		},
	};

	const ctx = {
		ui: {
			theme: {
				fg: (color: string, text: string) => `[${color}]${text}`,
			},
			setStatus: (key: string, value: string | undefined) => {
				calls.setStatus++;
				if (value === undefined) statuses.delete(key);
				else statuses.set(key, value);
			},
		},
	};

	const fire = async (event: string) => {
		for (const h of handlers.get(event) ?? []) await h({}, ctx);
	};

	return { pi, ctx, statuses, calls, fire, handlers };
}

test("statusText: pre-regime shows flat pricing with countdown", (t) => {
	t.mock.timers.enable({ apis: ["Date"] });
	t.mock.timers.setTime(new Date("2026-08-16T05:35:00Z").getTime());

	const { text, color } = statusText(new Date());
	assert.equal(color, "dim");
	assert.match(text, /^DeepSeek flat pricing — peak\/off-peak from \d{2}:\d{2} local \(~10h 25m\)$/);
});

test("statusText: peak window", (t) => {
	t.mock.timers.enable({ apis: ["Date"] });
	t.mock.timers.setTime(new Date("2026-08-17T01:30:00Z").getTime());

	const { text, color } = statusText(new Date());
	assert.equal(color, "warning");
	assert.match(text, /^⚡ DeepSeek PEAK — until \d{2}:\d{2} local$/);
});

test("statusText: off-peak window", (t) => {
	t.mock.timers.enable({ apis: ["Date"] });
	t.mock.timers.setTime(new Date("2026-08-17T12:00:00Z").getTime());

	const { text, color } = statusText(new Date());
	assert.equal(color, "success");
	assert.match(text, /^🌙 DeepSeek off-peak — next peak \d{2}:\d{2} local$/);
});

test("extension: session_start sets status and schedules refresh; shutdown cleans up", async (t) => {
	t.mock.timers.enable({ apis: ["Date", "setInterval"] });
	t.mock.timers.setTime(new Date("2026-08-17T01:30:00Z").getTime());

	const { pi, ctx, statuses, calls, fire } = makePi();
	ext(pi as unknown as Parameters<typeof ext>[0]);

	await fire("session_start");
	assert.equal(statuses.size, 1);
	const text = statuses.get("deepseek");
	assert.ok(text, "expected a status for key 'deepseek'");
	assert.match(text, /^\[warning\]⚡ DeepSeek PEAK — until \d{2}:\d{2} local$/);

	// The interval re-renders the status every REFRESH_MS (30s).
	const before = calls.setStatus;
	t.mock.timers.tick(30_000);
	assert.ok(calls.setStatus > before, "interval should re-invoke update()");

	// After shutdown, ticking further must not call update() again.
	await fire("session_shutdown");
	const afterShutdown = calls.setStatus;
	t.mock.timers.tick(60_000);
	assert.equal(calls.setStatus, afterShutdown, "interval must be cleared on shutdown");
});

test("extension: repeated session_start replaces the old timer", async (t) => {
	t.mock.timers.enable({ apis: ["Date", "setInterval"] });
	t.mock.timers.setTime(new Date("2026-08-17T01:30:00Z").getTime());

	const { pi, ctx, calls, fire } = makePi();
	ext(pi as unknown as Parameters<typeof ext>[0]);

	await fire("session_start");
	await fire("session_start"); // restart — old timer must be cleared
	const before = calls.setStatus;
	t.mock.timers.tick(30_000);
	assert.ok(calls.setStatus > before);
});

test("extension: session_start is idempotent before the regime", async (t) => {
	t.mock.timers.enable({ apis: ["Date", "setInterval"] });
	t.mock.timers.setTime(new Date("2026-08-16T05:35:00Z").getTime());

	const { pi, ctx, statuses, fire } = makePi();
	ext(pi as unknown as Parameters<typeof ext>[0]);

	await fire("session_start");
	const text = statuses.get("deepseek");
	assert.ok(text);
	assert.match(text, /^\[dim\]DeepSeek flat pricing —/);
	// Local label must be a valid HH:MM.
	const m = text.match(/from (\d{2}:\d{2}) local/);
	assert.ok(m, "expected a local start time in the label");
	assert.match(m[1], LOCAL);
});
