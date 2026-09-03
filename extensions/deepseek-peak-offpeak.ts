/**
 * DeepSeek Peak / Off-Peak Footer Indicator
 *
 * Shows in the footer (bottom-left) whether DeepSeek is currently in
 * peak or off-peak billing, computed from the machine's local clock.
 * All boundary times in the status are shown in the machine's local
 * timezone — no timezone is hardcoded.
 *
 * A second status shows the DeepSeek platform credit balance (fetched from
 * api.deepseek.com/user/balance with the provider's resolved API key, cached
 * and throttled to BALANCE_REFRESH_MS). It is likewise only shown while a
 * DeepSeek model is selected; switching models clears or restores both.
 *
 * The status is only displayed while the selected model comes from the
 * DeepSeek provider (`ctx.model.provider === "deepseek"`); switching models
 * clears or restores it immediately.
 *
 * DeepSeek's regime (per api-docs.deepseek.com/quick_start/pricing):
 *   Peak hours (UTC): 01:00–04:00 and 06:00–10:00
 *   All other hours are off-peak (half the peak rates).
 *   Peak/off-peak billing has been live since 2026-08-16T16:00:00Z.
 *
 *   Since 2026-08-22T16:00:00Z (= 2026-08-23 00:00 Beijing), Saturdays and
 *   Sundays (Beijing calendar time) have no peak tiers at all: every call
 *   is billed at the uniform off-peak rate.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

/** Peak windows as [start, end) UTC hours. Edit here if DeepSeek changes the regime. */
export const PEAK_WINDOWS: ReadonlyArray<readonly [number, number]> = [
	[1, 4], // 01:00–04:00 UTC
	[6, 10], // 06:00–10:00 UTC
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
export function parseBalance(body: unknown): { total: number; currency: string; isAvailable: boolean } | undefined {
	if (typeof body !== "object" || body === null) return undefined;
	const record = body as Record<string, unknown>;
	const infos = Array.isArray(record.balance_infos) ? record.balance_infos : [];
	const info = infos[0];
	if (typeof info !== "object" || info === null) return undefined;
	const entry = info as Record<string, unknown>;
	const total = Number(entry.total_balance);
	if (!Number.isFinite(total)) return undefined;
	return {
		total,
		currency: typeof entry.currency === "string" ? entry.currency : "",
		isAvailable: record.is_available !== false,
	};
}

/**
 * The rendered balance status: "💰 ¥12.34", low-balances in the theme's
 * warning colour. Precision: integers lose the decimals ("¥12"), anything
 * else keeps two. Unknown currencies render as "12.34 EUR".
 */
export function formatBalance(balance: { total: number; currency: string }): {
	text: string;
	low: boolean;
} {
	const { total, currency } = balance;
	const amount = Number.isInteger(total) ? String(total) : total.toFixed(2);
	const symbol = CURRENCY_SYMBOLS[currency];
	const text = symbol ? `💰 ${symbol}${amount}` : `💰 ${amount}${currency ? ` ${currency}` : ""}`;
	const threshold = LOW_BALANCE[currency] ?? FALLBACK_LOW_BALANCE;
	return { text, low: total < threshold };
}

/** The status text for `now`, or undefined to clear the status. */
export function statusText(now: Date): { text: string; color: "warning" | "success" } {
	const boundary = nextBoundaryUtc(now);
	const label = `${formatLocalDayPrefix(now, boundary)}${formatLocalTime(boundary)}`;
	if (inPeak(now)) {
		return { color: "warning", text: `⚡ DeepSeek PEAK — until ${label} local` };
	}
	if (now.getTime() >= WEEKEND_OFFPEAK_UTC && isWeekendBeijing(now)) {
		return {
			color: "success",
			text: `🌙 DeepSeek off-peak (weekend flat rate) — next peak ${label} local`,
		};
	}
	return {
		color: "success",
		text: `🌙 DeepSeek off-peak — next peak ${label} local`,
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
