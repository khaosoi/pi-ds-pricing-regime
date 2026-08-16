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
 *   Peak/off-peak billing takes effect 2026-08-16T16:00:00Z.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

/** Peak windows as [start, end) UTC hours. Edit here if DeepSeek changes the regime. */
export const PEAK_WINDOWS: ReadonlyArray<readonly [number, number]> = [
	[1, 4], // 01:00–04:00 UTC
	[6, 10], // 06:00–10:00 UTC
];

/** Billing regime change: 2026-08-16T16:00:00Z. */
export const EFFECTIVE_UTC = Date.UTC(2026, 7, 16, 16, 0, 0);

const STATUS_KEY = "deepseek";
const REFRESH_MS = 30_000; // refresh a few times per minute so the local-time label stays current

/** True when `now` (UTC) falls inside a peak window. */
export function inPeak(now: Date): boolean {
	const hour = now.getUTCHours();
	return PEAK_WINDOWS.some(([start, end]) => hour >= start && hour < end);
}

/**
 * The next regime boundary after `now`, as a UTC hour (0–23).
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
 * Peak → end of the current window; off-peak → start of the next window
 * (wrapping to the next UTC day). Uses `now`'s own date, so the local-time
 * label stays correct even when a DST transition falls between `now` and
 * the boundary.
 */
export function nextBoundaryUtc(now: Date): Date {
	const dayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
	if (inPeak(now)) {
		return new Date(dayStart + nextBoundaryUtcHour(now) * 3_600_000);
	}
	const currentMinute = now.getUTCHours() * 60 + now.getUTCMinutes();
	const nextHour = nextBoundaryUtcHour(now);
	const dayOffset = nextHour * 60 > currentMinute ? 0 : 1; // wrapped past midnight → tomorrow
	return new Date(dayStart + (nextHour + 24 * dayOffset) * 3_600_000);
}

/** Human countdown like "~10h 24m" or "~2d", "now" when already reached. */
export function formatCountdown(targetUtc: number): string {
	const ms = targetUtc - Date.now();
	if (ms <= 0) return "now";
	const hours = ms / 3_600_000;
	if (hours < 48) {
		const h = Math.floor(hours);
		const m = Math.round((hours - h) * 60);
		return m > 0 ? `~${h}h ${m}m` : `~${h}h`;
	}
	return `~${Math.round(hours / 24)}d`;
}

/** The status text for `now`, or undefined to clear the status. */
export function statusText(now: Date): { text: string; color: "dim" | "warning" | "success" } {
	// Before the regime there is no peak/off-peak yet.
	if (now.getTime() < EFFECTIVE_UTC) {
		return {
			color: "dim",
			text: `DeepSeek flat pricing — peak/off-peak from ${formatLocalTime(new Date(EFFECTIVE_UTC))} local (${formatCountdown(EFFECTIVE_UTC)})`,
		};
	}

	if (inPeak(now)) {
		return { color: "warning", text: `⚡ DeepSeek PEAK — until ${formatLocalTime(nextBoundaryUtc(now))} local` };
	}
	return { color: "success", text: `🌙 DeepSeek off-peak — next peak ${formatLocalTime(nextBoundaryUtc(now))} local` };
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
