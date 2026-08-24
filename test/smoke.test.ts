/**
 * Smoke test for the extension module: fires session_start / session_shutdown
 * against a mock pi context and verifies the status text and timer lifecycle.
 *
 * Uses node:test process-local mock timers so `new Date()` follows a virtual
 * test clock; this never changes the operating system's clock. The HH:MM local
 * labels depend on the machine TZ; exact labels are covered by
 * the timezone matrix (test/timezone-matrix.test.ts). Here we assert the shape.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import ext, { statusText } from "../extensions/deepseek-peak-offpeak.ts";

type StatusMap = Map<string, string>;

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

test("statusText: weekend flat rate", (t) => {
	t.mock.timers.enable({ apis: ["Date"] });
	t.mock.timers.setTime(new Date("2026-08-22T18:00:00Z").getTime()); // Sunday in Beijing time

	const { text, color } = statusText(new Date());
	assert.equal(color, "success");
	assert.match(text, /^🌙 DeepSeek off-peak \(weekend flat rate\) — next peak \d{2}:\d{2} local$/);
});

test("extension: session_start sets status and schedules refresh; shutdown cleans up", async (t) => {
	t.mock.timers.enable({ apis: ["Date", "setInterval"] });
	t.mock.timers.setTime(new Date("2026-08-17T01:30:00Z").getTime());

	const { pi, statuses, calls, fire } = makePi();
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

	const { pi, calls, fire } = makePi();
	ext(pi as unknown as Parameters<typeof ext>[0]);

	await fire("session_start");
	await fire("session_start"); // restart — old timer must be cleared
	const before = calls.setStatus;
	t.mock.timers.tick(30_000);
	assert.ok(calls.setStatus > before);
});
