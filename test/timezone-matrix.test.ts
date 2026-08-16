/**
 * Runs the timezone matrix under three forced timezones in child processes.
 * Each child asserts exact local-time labels produced by the extension logic.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const script = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "timezone-matrix.mjs");
const tzs = ["Etc/GMT-8", "Etc/GMT-10", "Etc/GMT+5"]; // UTC+8, UTC+10, UTC-5 (fixed offsets)

for (const tz of tzs) {
	test(`timezone matrix: ${tz}`, () => {
		const out = execFileSync(process.execPath, [script], {
			env: { ...process.env, TZ: tz },
			encoding: "utf8",
		});
		assert.match(out, /all rows passed/, `matrix failed for ${tz}:\n${out}`);
	});
}
