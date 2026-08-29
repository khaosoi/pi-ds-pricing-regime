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
import ext, { isDeepSeekModel, STATUS_KEY, statusText } from "../extensions/deepseek-peak-offpeak.ts";

const DEEPSEEK_MODEL = { provider: "deepseek", id: "deepseek-chat" };
const OTHER_MODEL = { provider: "opencode-go", id: "glm-5.3-flash" };

type StatusMap = Map<string, string>;

function makePi(model: unknown = DEEPSEEK_MODEL) {
	const handlers = new Map<string, Array<(e: unknown, ctx: unknown) => Promise<void> | void>>();
	const statuses: StatusMap = new Map();
	const calls = { setStatus: 0 };

	const pi = {
		on: (event: string, handler: (e: unknown, ctx: unknown) => Promise<void> | void) => {
			handlers.set(event, [...(handlers.get(event) ?? []), handler]);
		},
	};

	const ctx = {
		model,
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

	const fire = async (event: string, e: unknown = {}) => {
		for (const h of handlers.get(event) ?? []) await h(e, ctx);
	};

	return { pi, ctx, statuses, calls, fire, handlers, setModel: (m: unknown) => (ctx.model = m) };
}

const OPTIONAL_DAY = "(?:[A-Z][a-z]+ )?"; // weekday prefix when the boundary is not today

test("statusText: peak window", (t) => {
	t.mock.timers.enable({ apis: ["Date"] });
	t.mock.timers.setTime(new Date("2026-08-17T01:30:00Z").getTime());

	const { text, color } = statusText(new Date());
	assert.equal(color, "warning");
	assert.match(text, new RegExp(`^⚡ DeepSeek PEAK — until ${OPTIONAL_DAY}\\d{2}:\\d{2} local$`));
});

test("statusText: off-peak window", (t) => {
	t.mock.timers.enable({ apis: ["Date"] });
	t.mock.timers.setTime(new Date("2026-08-17T12:00:00Z").getTime());

	const { text, color } = statusText(new Date());
	assert.equal(color, "success");
	assert.match(text, new RegExp(`^🌙 DeepSeek off-peak — next peak ${OPTIONAL_DAY}\\d{2}:\\d{2} local$`));
});

test("statusText: weekend flat rate", (t) => {
	t.mock.timers.enable({ apis: ["Date"] });
	t.mock.timers.setTime(new Date("2026-08-22T18:00:00Z").getTime()); // Sunday in Beijing time

	const { text, color } = statusText(new Date());
	assert.equal(color, "success");
	assert.match(
		text,
		new RegExp(`^🌙 DeepSeek off-peak \\(weekend flat rate\\) — next peak ${OPTIONAL_DAY}\\d{2}:\\d{2} local$`),
	);
});

test("isDeepSeekModel: matches the deepseek provider only", () => {
	assert.equal(isDeepSeekModel(DEEPSEEK_MODEL), true);
	assert.equal(isDeepSeekModel(OTHER_MODEL), false);
	assert.equal(isDeepSeekModel(undefined), false);
});

test("extension: session_start sets status and schedules refresh; shutdown cleans up", async (t) => {
	t.mock.timers.enable({ apis: ["Date", "setInterval"] });
	t.mock.timers.setTime(new Date("2026-08-17T01:30:00Z").getTime());

	const { pi, statuses, calls, fire } = makePi();
	ext(pi as unknown as Parameters<typeof ext>[0]);

	await fire("session_start");
	assert.equal(statuses.size, 1);
	const text = statuses.get(STATUS_KEY);
	assert.ok(text, "expected a status for key 'deepseek'");
	assert.match(text, new RegExp(`^\\[warning\\]⚡ DeepSeek PEAK — until ${OPTIONAL_DAY}\\d{2}:\\d{2} local$`));

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

test("extension: no status when the selected model is not from the deepseek provider", async (t) => {
	t.mock.timers.enable({ apis: ["Date", "setInterval"] });
	t.mock.timers.setTime(new Date("2026-08-17T01:30:00Z").getTime());

	const { pi, statuses, calls, fire, setModel } = makePi(OTHER_MODEL);
	ext(pi as unknown as Parameters<typeof ext>[0]);

	await fire("session_start");
	assert.equal(statuses.size, 0, "non-deepseek model must not show the status");
	t.mock.timers.tick(60_000);
	assert.equal(statuses.size, 0, "interval must keep the status hidden");
	assert.equal(calls.setStatus > 0, true, "interval still runs, clearing defensively");

	// Switching to a deepseek model turns the status on without a restart.
	setModel(DEEPSEEK_MODEL);
	await fire("model_select", { model: DEEPSEEK_MODEL });
	assert.match(statuses.get(STATUS_KEY) ?? "", /DeepSeek (PEAK|off-peak)/);
});

test("extension: model_select away from deepseek clears the status immediately", async (t) => {
	t.mock.timers.enable({ apis: ["Date", "setInterval"] });
	t.mock.timers.setTime(new Date("2026-08-17T01:30:00Z").getTime());

	const { pi, statuses, fire, setModel } = makePi(DEEPSEEK_MODEL);
	ext(pi as unknown as Parameters<typeof ext>[0]);

	await fire("session_start");
	assert.ok(statuses.get(STATUS_KEY), "expected the status under a deepseek model");

	setModel(OTHER_MODEL);
	await fire("model_select", { model: OTHER_MODEL });
	assert.equal(statuses.has(STATUS_KEY), false, "status must be cleared on switch away");

	// And it stays cleared while the interval ticks.
	t.mock.timers.tick(60_000);
	assert.equal(statuses.has(STATUS_KEY), false);
});
