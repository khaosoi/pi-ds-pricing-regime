/**
 * DeepSeek Peak / Off-Peak Footer Indicator
 *
 * Shows in the footer (bottom-left) whether DeepSeek is currently in
 * peak or off-peak billing, computed from the machine's local clock.
 * All boundary times in the status are shown in the machine's local
 * timezone — no timezone is hardcoded.
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

/** China observes a fixed UTC+8 offset year-round (no DST). */
const BEIJING_OFFSET_MS = 8 * 3_600_000;
const DAY_MS = 86_400_000;

const STATUS_KEY = "deepseek";
const REFRESH_MS = 30_000; // refresh a few times per minute so the local-time label stays current

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

/**
 * The next regime boundary after `now`, as an absolute UTC instant.
 * Peak → end of the current window; off-peak → start of the next window,
 * scanning forward over UTC days while skipping candidate instants that fall
 * on a live Beijing weekend (the next peak after Friday is Monday 01:00 UTC).
 * Uses `now`'s own date, so the local-time label stays correct even when a
 * DST transition falls between `now` and the boundary.
 */
export function nextBoundaryUtc(now: Date): Date {
	const dayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
	if (inPeak(now)) {
		return new Date(dayStart + nextBoundaryUtcHour(now) * 3_600_000);
	}
	for (let d = 0; d < 9; d++) {
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

/** The status text for `now`, or undefined to clear the status. */
export function statusText(now: Date): { text: string; color: "warning" | "success" } {
	if (inPeak(now)) {
		return { color: "warning", text: `⚡ DeepSeek PEAK — until ${formatLocalTime(nextBoundaryUtc(now))} local` };
	}
	if (now.getTime() >= WEEKEND_OFFPEAK_UTC && isWeekendBeijing(now)) {
		return {
			color: "success",
			text: `🌙 DeepSeek off-peak (weekend flat rate) — next peak ${formatLocalTime(nextBoundaryUtc(now))} local`,
		};
	}
	return {
		color: "success",
		text: `🌙 DeepSeek off-peak — next peak ${formatLocalTime(nextBoundaryUtc(now))} local`,
	};
}

export default function (pi: ExtensionAPI) {
	let timer: ReturnType<typeof setInterval> | undefined;

	const update = (ctx: ExtensionContext) => {
		const { text, color } = statusText(new Date());
		ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg(color, text));
	};

	pi.on("session_start", async (_event, ctx) => {
		if (timer) clearInterval(timer);
		update(ctx);
		timer = setInterval(() => update(ctx), REFRESH_MS);
	});

	pi.on("session_shutdown", async () => {
		if (timer) {
			clearInterval(timer);
			timer = undefined;
		}
	});
}
