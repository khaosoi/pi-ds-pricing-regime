/**
 * Unit tests for the balance helpers: parsing the DeepSeek /user/balance
 * response body and rendering the status text. Pure functions — no clocks,
 * no network.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { FALLBACK_LOW_BALANCE, formatBalance, parseBalance } from "../extensions/deepseek-peak-offpeak.ts";

const API_BODY = {
	is_available: true,
	balance_infos: [
		{
			currency: "CNY",
			total_balance: "110.00",
			granted_balance: "10.00",
			topped_up_balance: "100.00",
		},
	],
};

test("parseBalance: documented response shape", () => {
	assert.deepEqual(parseBalance(API_BODY), { total: 110, currency: "CNY", isAvailable: true });
});

test("parseBalance: takes the first balance entry", () => {
	const body = {
		...API_BODY,
		balance_infos: [API_BODY.balance_infos[0], { currency: "USD", total_balance: "5.00" }],
	};
	assert.deepEqual(parseBalance(body), { total: 110, currency: "CNY", isAvailable: true });
});

test("parseBalance: is_available false is preserved", () => {
	assert.equal(parseBalance({ ...API_BODY, is_available: false })?.isAvailable, false);
	assert.equal(parseBalance(API_BODY)?.isAvailable, true);
	assert.equal(parseBalance({ balance_infos: API_BODY.balance_infos })?.isAvailable, true);
});

test("parseBalance: malformed bodies return undefined", () => {
	assert.equal(parseBalance(undefined), undefined);
	assert.equal(parseBalance(null), undefined);
	assert.equal(parseBalance("oops"), undefined);
	assert.equal(parseBalance({}), undefined);
	assert.equal(parseBalance({ balance_infos: [] }), undefined);
	assert.equal(parseBalance({ balance_infos: [{}] }), undefined);
	assert.equal(parseBalance({ balance_infos: [{ total_balance: "not-a-number", currency: "CNY" }] }), undefined);
});

test("formatBalance: symbol currencies render icon + amount", () => {
	assert.deepEqual(formatBalance({ total: 110, currency: "CNY" }), { text: "¥110", low: false });
	assert.deepEqual(formatBalance({ total: 12.345, currency: "USD" }), { text: "$12.35", low: false });
	assert.deepEqual(formatBalance({ total: 0.4, currency: "USD" }), { text: "$0.40", low: true });
});

test("parseBalance: non-string currency falls back to empty", () => {
	assert.deepEqual(parseBalance({ balance_infos: [{ total_balance: "5", currency: 8 }] }), {
		total: 5,
		currency: "",
		isAvailable: true,
	});
});

test("parseBalance: non-object balance entries are rejected", () => {
	assert.equal(parseBalance({ balance_infos: ["nonsense"] }), undefined);
	assert.equal(parseBalance({ balance_infos: [null] }), undefined);
});

test("parseBalance: numeric total_balance is accepted (lenient)", () => {
	assert.deepEqual(parseBalance({ balance_infos: [{ total_balance: 12, currency: "CNY" }] }), {
		total: 12,
		currency: "CNY",
		isAvailable: true,
	});
});

test("formatBalance: unknown currencies render 'amount CODE'", () => {
	// 12 is above the fallback threshold, so not low.
	assert.deepEqual(formatBalance({ total: 12, currency: "EUR" }), { text: "12 EUR", low: false });
});

test("formatBalance: no currency renders just the amount", () => {
	assert.deepEqual(formatBalance({ total: 12, currency: "" }), { text: "12", low: false });
});

test("formatBalance: low-balance thresholds per currency", () => {
	// CNY threshold is 20: 20 is not low, 19.99 is.
	assert.equal(formatBalance({ total: 20, currency: "CNY" }).low, false);
	assert.equal(formatBalance({ total: 19.99, currency: "CNY" }).low, true);
	// USD threshold is 5.
	assert.equal(formatBalance({ total: 5, currency: "USD" }).low, false);
	assert.equal(formatBalance({ total: 4.99, currency: "USD" }).low, true);
	// Unlisted currencies use the fallback threshold.
	assert.equal(formatBalance({ total: FALLBACK_LOW_BALANCE, currency: "EUR" }).low, false);
	assert.equal(formatBalance({ total: FALLBACK_LOW_BALANCE - 0.01, currency: "EUR" }).low, true);
});
