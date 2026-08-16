/**
 * Runs the timezone matrix under three forced timezones in child processes.
 * Each child asserts exact local-time labels produced by the extension logic.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runMatrix } from "../scripts/timezone-matrix.mjs";

const script = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "timezone-matrix.mjs");
// Fixed-offset zones (stable expectations) plus real DST zones (transition scenarios).
const tzs = ["Etc/GMT-8", "Etc/GMT-10", "Etc/GMT+5", "America/New_York", "Australia/Sydney"];

for (const tz of tzs) {
	test(`timezone matrix: ${tz}`, () => {
		const out = execFileSync(process.execPath, [script], {
			env: { ...process.env, TZ: tz },
			encoding: "utf8",
		});
		assert.match(out, /all rows passed/, `matrix failed for ${tz}:\n${out}`);
	});
}

test("timezone matrix: unknown timezone returns a configuration error", () => {
	const errors: string[] = [];
	const code = runMatrix("Unknown/Test", { error: (message: string) => errors.push(message) });
	assert.equal(code, 2);
	assert.match(errors[0], /no expectation table/);
	assert.match(errors[1], /expected one of/);
});

test("timezone matrix: fixed-row mismatch returns a failure", () => {
	const errors: string[] = [];
	const code = runMatrix("Test/Fixed", {
		tables: {
			"Test/Fixed": [[0, true, "00:00", "deliberately wrong"]],
		},
		dstScenarios: {},
		error: (message: string) => errors.push(message),
	});
	assert.equal(code, 1);
	assert.match(errors[0], /FAIL TZ=Test\/Fixed/);
	assert.match(errors[1], /1 failure/);
});

test("timezone matrix: DST-row mismatch returns a failure", () => {
	const errors: string[] = [];
	const code = runMatrix("Test/DST", {
		tables: {},
		dstScenarios: {
			"Test/DST": [["2026-08-17T12:00:00Z", "deliberately wrong"]],
		},
		error: (message: string) => errors.push(message),
	});
	assert.equal(code, 1);
	assert.match(errors[0], /FAIL TZ=Test\/DST/);
	assert.match(errors[1], /1 failure/);
});
