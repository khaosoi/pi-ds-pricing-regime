/**
 * DeepSeek Peak / Off-Peak Footer Indicator
 *
 * Shows in the footer (bottom-left) whether DeepSeek is currently in
 * peak or off-peak billing, computed from the machine's local clock.
 * All boundary times in the status are shown in the machine's local
 * timezone — no timezone is hardcoded.
 *
 * A second status shows the DeepSeek platform credit balance in USD (fetched
 * from api.deepseek.com/user/balance with the provider's resolved API key,
 * cached and throttled to BALANCE_REFRESH_MS). The API returns one entry per
 * currency the account holds, so the USD entry is chosen explicitly. It is
 * likewise only shown while a DeepSeek model is selected; switching models
 * clears or restores both.
 *
 * A third status shows the regime-correct session spend (see
 * `sessionSpendUsd`). Pi's own cost figure comes from the model catalogue,
 * and the DeepSeek catalogue entry carries peak rates only (its cost field
 * has no time-of-day dimension), so it over-reports by 2x whenever the regime
 * is off-peak. Halving the DeepSeek messages billed off-peak makes the figure
 * match what the platform actually charges. Unlike the two statuses above,
 * this one is published for every provider, so it can replace pi-footer's
 * `cost` widget everywhere.
 *
 * The regime and balance statuses are only displayed while the selected model
 * comes from the DeepSeek provider (`ctx.model.provider === "deepseek"`);
 * switching models clears or restores them immediately.
 *
 * DeepSeek's regime (per api-docs.deepseek.com/quick_start/pricing):
 *   Peak hours (UTC): 01:00–04:00 and 06:00–09:00
 *   All other hours are off-peak (half the peak rates).
 *   In Beijing time (UTC+8) peak is 09:00–12:00 and 14:00–17:00, so weekday
 *   off-peak runs 12:00–14:00 and 17:00–09:00.
 *   Peak/off-peak billing has been live since 2026-08-16T16:00:00Z.
 *
 *   Since 2026-08-22T16:00:00Z (= 2026-08-23 00:00 Beijing), Saturdays and
 *   Sundays (Beijing calendar time) have no peak tiers at all: every call
 *   is billed at the uniform off-peak rate. With the weekday windows above,
 *   the resulting off-peak block runs from Friday 17:00 Beijing to Monday
 *   09:00 Beijing.
 *
 *   Flash series pricing effective 2026-09-10T04:00:00Z (= 12:00 Beijing on
 *   2026-09-10), per 1M tokens, off-peak: $0.003 input cache hit, $0.15
 *   input cache miss, $0.60 output. Peak hours are exactly double
 *   ($0.006 / $0.30 / $1.20). `deepseek-v4-flash` (internally V4.1-Flash) is
 *   now the only served model: V4 Pro and the experimental vision model are
 *   deprecated.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

/** Peak windows as [start, end) UTC hours. Edit here if DeepSeek changes the regime. */
export const PEAK_WINDOWS: ReadonlyArray<readonly [number, number]> = [
	[1, 4], // 01:00–04:00 UTC = 09:00–12:00 Beijing
	[6, 9], // 06:00–09:00 UTC = 14:00–17:00 Beijing
];

/**
 * Weekend flat-rate rule: from 2026-08-22T16:00:00Z (2026-08-23 00:00
 * Beijing), Saturdays and Sundays in Beijing time are off-peak all day.
 */
export const WEEKEND_OFFPEAK_UTC = Date.UTC(2026, 7, 22, 16, 0, 0);

/** Provider id whose models the billing indicator is shown for. Edit here if the provider id changes. */
export const DEEPSEEK_PROVIDER = "deepseek";

/** China observes a fixed UTC+8 offset year-round (no DST). */
const BEIJING_OFFSET_MS = 8 * 3_600_000;
const DAY_MS = 86_400_000;

// Pi's footer sorts extension statuses alphabetically by key, left to right.
// "zz-" prefix keeps these statuses right of others (e.g. "tavily-usage" stays
// on the left margin). The keys are never displayed — only the status text.
export const STATUS_KEY = "zz-deepseek-regime";
export const BALANCE_KEY = "zz-deepseek-balance";
export const SPEND_KEY = "zz-deepseek-spend";
const REFRESH_MS = 30_000; // refresh a few times per minute so the local-time label stays current

/** DeepSeek platform origin for the balance API (api-docs.deepseek.com/api-create-user-balance). */
export const BALANCE_ORIGIN = "https://api.deepseek.com";
/** Minimum interval between balance API calls. The balance only changes when credits are granted or topped up, so a few minutes is ample. */
export const BALANCE_REFRESH_MS = 5 * 60_000;
/** Balance colour thresholds in native currency units; currencies not listed fall back to FALLBACK_LOW_BALANCE. */
export const LOW_BALANCE: Readonly<Record<string, number>> = { CNY: 20, USD: 5 };
export const FALLBACK_LOW_BALANCE = 10;
/** Currency code → symbol; currencies not listed render as "12.34 EUR". */
const CURRENCY_SYMBOLS: Readonly<Record<string, string>> = { CNY: "¥", USD: "$" };

/** True when `now` falls on a Saturday or Sunday in Beijing calendar time. */
export function isWeekendBeijing(now: Date): boolean {
	const day = new Date(now.getTime() + BEIJING_OFFSET_MS).getUTCDay();
	return day === 0 || day === 6;
}

/**
 * True when `now` (UTC) falls inside a peak window.
 * Once the weekend rule is live (WEEKEND_OFFPEAK_UTC), Saturdays and Sundays
 * in Beijing time never peak. Before that instant the legacy tiered schedule
 * applied every day of the week.
 */
export function inPeak(now: Date): boolean {
	if (now.getTime() >= WEEKEND_OFFPEAK_UTC && isWeekendBeijing(now)) return false;
	const hour = now.getUTCHours();
	return PEAK_WINDOWS.some(([start, end]) => hour >= start && hour < end);
}

/**
 * The next regime boundary after `now`, as a UTC hour (0–23), assuming the
 * weekday tiered schedule (used for the peak → end-of-window computation).
 * - If currently peak: the end of the current peak window.
 * - If currently off-peak: the start of the next peak window (wrapping to tomorrow).
 */
export function nextBoundaryUtcHour(now: Date): number {
	const minute = now.getUTCHours() * 60 + now.getUTCMinutes();
	const boundaries = inPeak(now)
		? PEAK_WINDOWS.map(([, end]) => end * 60)
		: PEAK_WINDOWS.map(([start]) => start * 60);
	const next = boundaries.find((b) => b > minute);
	return Math.floor((next ?? boundaries[0]) / 60);
}

/** "HH:MM" wall-clock for an instant, in the machine's local timezone. */
export function formatLocalTime(at: Date): string {
	const hh = String(at.getHours()).padStart(2, "0");
	const mm = String(at.getMinutes()).padStart(2, "0");
	return `${hh}:${mm}`;
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

/**
 * "" when `at` falls on the same local calendar date as `now`; otherwise the
 * English weekday name of `at` followed by a space (e.g. "Monday "). Used so a
 * boundary that is not today is not mistaken for today's clock time — e.g. on
 * Saturday morning the next peak reads "Monday 09:00 local", not "09:00 local".
 */
export function formatLocalDayPrefix(now: Date, at: Date): string {
	const sameLocalDay =
		now.getFullYear() === at.getFullYear() && now.getMonth() === at.getMonth() && now.getDate() === at.getDate();
	return sameLocalDay ? "" : `${DAY_NAMES[at.getDay()]} `;
}

/**
 * The next regime boundary after `now`, as an absolute UTC instant.
 * Peak → end of the current window; off-peak → start of the next window,
 * scanning forward over UTC days (up to `maxScanDays`) while skipping
 * candidate instants that fall on a live Beijing weekend (the next peak after
 * Friday is Monday 01:00 UTC). Uses `now`'s own date, so the local-time label
 * stays correct even when a DST transition falls between `now` and the
 * boundary.
 */
export function nextBoundaryUtc(now: Date, maxScanDays = 9): Date {
	const dayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
	if (inPeak(now)) {
		return new Date(dayStart + nextBoundaryUtcHour(now) * 3_600_000);
	}
	for (let d = 0; d < maxScanDays; d++) {
		const utcDayStart = dayStart + d * DAY_MS;
		for (const [start] of PEAK_WINDOWS) {
			const at = utcDayStart + start * 3_600_000;
			if (at <= now.getTime()) continue;
			if (at >= WEEKEND_OFFPEAK_UTC && isWeekendBeijing(new Date(at))) continue;
			return new Date(at);
		}
	}
	throw new Error("no peak window found within the next 9 days");
}

/**
 * True when the given model (e.g. `ctx.model`) is served by the DeepSeek
 * provider, i.e. when the peak/off-peak regime actually applies to it.
 */
export function isDeepSeekModel(model: { provider?: string } | undefined | null): boolean {
	return model?.provider === DEEPSEEK_PROVIDER;
}

/**
 * Parse a DeepSeek `/user/balance` response body into the first balance entry.
 * Returns undefined when the shape is not as documented (proxy response, API
 * change, error JSON) so callers can keep showing the previous value.
 */
/**
 * Currency the balance status reports. The balance API returns one entry per
 * currency the account holds (CNY and/or USD), in an order it does not
 * guarantee, so the USD entry is chosen explicitly: the pricing and the session
 * spend are USD.
 */
export const BALANCE_CURRENCY = "USD";

/**
 * Parse a DeepSeek `/user/balance` response body into a balance entry.
 * Returns undefined when the shape is not as documented (proxy response, API
 * change, error JSON) so callers can keep showing the previous value.
 *
 * The USD entry wins over any other currency, wherever it sits in
 * `balance_infos`. An account with no USD entry reports its own currency, which
 * is still rendered with the matching symbol rather than passed off as dollars.
 */
export function parseBalance(body: unknown): { total: number; currency: string; isAvailable: boolean } | undefined {
	if (typeof body !== "object" || body === null) return undefined;
	const record = body as Record<string, unknown>;
	const infos = Array.isArray(record.balance_infos) ? record.balance_infos : [];
	const valid = infos
		.filter((info): info is Record<string, unknown> => typeof info === "object" && info !== null)
		.filter((entry) => Number.isFinite(Number(entry.total_balance)));
	const entry = valid.find((candidate) => candidate.currency === BALANCE_CURRENCY) ?? valid[0];
	if (!entry) return undefined;
	return {
		total: Number(entry.total_balance),
		currency: typeof entry.currency === "string" ? entry.currency : "",
		isAvailable: record.is_available !== false,
	};
}

/**
 * The rendered balance status: "$12.34" (or the account's own currency when the
 * API reports no USD entry), low balances in the theme's warning colour.
 * Precision: integers lose the decimals ("$12"), anything else keeps two.
 */
export function formatBalance(balance: { total: number; currency: string }): {
	text: string;
	low: boolean;
} {
	const { total, currency } = balance;
	const amount = Number.isInteger(total) ? String(total) : total.toFixed(2);
	const symbol = CURRENCY_SYMBOLS[currency];
	const text = symbol ? `${symbol}${amount}` : `${amount}${currency ? ` ${currency}` : ""}`;
	const threshold = LOW_BALANCE[currency] ?? FALLBACK_LOW_BALANCE;
	return { text, low: total < threshold };
}

/**
 * The instant of an assistant-message entry, from its millisecond message
 * timestamp or its ISO entry timestamp. Undefined when neither is readable.
 */
function messageInstant(entry: Record<string, unknown>, message: Record<string, unknown>): number | undefined {
	const candidates = [message.timestamp, entry.timestamp];
	for (const candidate of candidates) {
		if (typeof candidate === "number" && Number.isFinite(candidate)) return candidate;
		if (typeof candidate !== "string") continue;
		const parsed = Date.parse(candidate);
		if (Number.isFinite(parsed)) return parsed;
	}
	return undefined;
}

/**
 * Regime-correct session spend in USD, summed from the assistant messages in
 * `entries` (e.g. `ctx.sessionManager.getBranch()`).
 *
 * Each message's recorded `usage.cost.total` already reflects its token split
 * and the catalogue rates, but the DeepSeek catalogue carries peak rates with no
 * time-of-day dimension. Off-peak billing — including the weekend flat rate — is
 * exactly half, so DeepSeek messages billed outside a peak window count at half
 * their recorded cost. Other providers, peak windows, and entries whose
 * timestamp cannot be read count as recorded.
 */
export function sessionSpendUsd(entries: readonly unknown[]): number {
	let total = 0;
	for (const entry of entries) {
		if (typeof entry !== "object" || entry === null) continue;
		const record = entry as Record<string, unknown>;
		const message = record.message;
		if (typeof message !== "object" || message === null) continue;
		const fields = message as Record<string, unknown>;
		if (fields.role !== "assistant") continue;
		const usage = fields.usage;
		if (typeof usage !== "object" || usage === null) continue;
		const cost = (usage as Record<string, unknown>).cost;
		if (typeof cost !== "object" || cost === null) continue;
		const recorded = Number((cost as Record<string, unknown>).total);
		if (!Number.isFinite(recorded)) continue;
		const at = messageInstant(record, fields);
		const offPeakDeepSeek = fields.provider === DEEPSEEK_PROVIDER && at !== undefined && !inPeak(new Date(at));
		total += offPeakDeepSeek ? recorded / 2 : recorded;
	}
	return total;
}

/**
 * The rendered spend: four decimals under $1 (so off-peak/peak differences are
 * visible), two above. Matches pi-footer's `cost` widget so the status is a
 * drop-in replacement for it.
 */
export function formatSpend(usd: number): string {
	return usd < 1 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`;
}

/** The status text for `now`, or undefined to clear the status. */
export function statusText(now: Date): { text: string; color: "warning" | "success" } {
	const boundary = nextBoundaryUtc(now);
	const label = `${formatLocalDayPrefix(now, boundary)}${formatLocalTime(boundary)}`;
	if (inPeak(now)) {
		return { color: "warning", text: `DeepSeek PEAK — until ${label} local` };
	}
	if (now.getTime() >= WEEKEND_OFFPEAK_UTC && isWeekendBeijing(now)) {
		return {
			color: "success",
			text: `DeepSeek off-peak (weekend flat rate) — next peak ${label} local`,
		};
	}
	return {
		color: "success",
		text: `DeepSeek off-peak — next peak ${label} local`,
	};
}

export default function (pi: ExtensionAPI) {
	let timer: ReturnType<typeof setInterval> | undefined;
	let balance: { text: string; low: boolean } | undefined;
	let lastFetched = 0;
	let inflight: Promise<void> | undefined;

	const applyBalance = (ctx: ExtensionContext) => {
		if (balance) {
			ctx.ui.setStatus(BALANCE_KEY, ctx.ui.theme.fg(balance.low ? "warning" : "success", balance.text));
		} else {
			ctx.ui.setStatus(BALANCE_KEY, undefined);
		}
	};

	/**
	 * Fetch the credit balance once and cache it. Fire-and-forget: failures
	 * (no stored key, network errors, non-2xx, unexpected body) leave the
	 * previous value untouched, and lastFetched was advanced at call time so
	 * a broken endpoint is retried no more than once per BALANCE_REFRESH_MS.
	 */
	const fetchBalance = (ctx: ExtensionContext) => {
		if (inflight) return;
		lastFetched = Date.now();
		inflight = (async () => {
			try {
				const auth = await ctx.modelRegistry?.getProviderAuth?.(DEEPSEEK_PROVIDER);
				const apiKey = auth?.auth?.apiKey;
				if (!apiKey) return;
				// A custom baseUrl (proxy) is respected for the balance endpoint too;
				// proxies that don't implement /user/balance just fail and keep the cache.
				const origin = auth.auth.baseUrl ? new URL(auth.auth.baseUrl).origin : BALANCE_ORIGIN;
				const res = await fetch(`${origin}/user/balance`, {
					headers: { Authorization: `Bearer ${apiKey}` },
				});
				if (!res.ok) return;
				const parsed = parseBalance(await res.json());
				if (parsed) {
					balance = formatBalance(parsed);
					if (!parsed.isAvailable) balance.low = true; // credits exist but can't pay — flag it
					applyBalance(ctx);
				}
			} catch {
				// keep showing the cached value
			} finally {
				inflight = undefined;
			}
		})();
	};

	const update = async (ctx: ExtensionContext, model: ExtensionContext["model"]) => {
		// Spend is meaningful for every provider, so it survives a model switch.
		const spend = formatSpend(sessionSpendUsd(ctx.sessionManager.getBranch()));
		ctx.ui.setStatus(SPEND_KEY, ctx.ui.theme.fg("success", spend));
		if (!isDeepSeekModel(model)) {
			ctx.ui.setStatus(STATUS_KEY, undefined);
			ctx.ui.setStatus(BALANCE_KEY, undefined);
			return;
		}
		const { text, color } = statusText(new Date());
		ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg(color, text));
		applyBalance(ctx);
		if (Date.now() - lastFetched >= BALANCE_REFRESH_MS) fetchBalance(ctx);
	};

	pi.on("session_start", async (_event, ctx) => {
		if (timer) clearInterval(timer);
		await update(ctx, ctx.model);
		timer = setInterval(() => void update(ctx, ctx.model), REFRESH_MS);
	});

	// Balance can drop mid-session (usage debits, new grants) — re-check on the
	// throttled schedule after each turn as well.
	pi.on("turn_end", async (_event, ctx) => {
		await update(ctx, ctx.model);
	});

	// Spend moves as soon as an assistant message lands, so refresh then too
	// rather than waiting for the turn to settle.
	pi.on("message_end", async (event, ctx) => {
		if (event.message.role !== "assistant") return;
		await update(ctx, ctx.model);
	});

	pi.on("model_select", async (event, ctx) => {
		await update(ctx, ctx.model ?? event.model);
	});

	pi.on("session_shutdown", async () => {
		if (timer) {
			clearInterval(timer);
			timer = undefined;
		}
	});
}
