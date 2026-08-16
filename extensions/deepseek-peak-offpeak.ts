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

/** Render a UTC hour as wall-clock "HH:MM" in the machine's local timezone. */
export function utcHourToLocalString(utcHour: number): string {
	const now = new Date();
	const at = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), utcHour, 0, 0));
	const hh = String(at.getHours()).padStart(2, "0");
	const mm = String(at.getMinutes()).padStart(2, "0");
	return `${hh}:${mm}`;
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
		const at = new Date(EFFECTIVE_UTC);
		const hh = String(at.getHours()).padStart(2, "0");
		const mm = String(at.getMinutes()).padStart(2, "0");
		return {
			color: "dim",
			text: `DeepSeek flat pricing — peak/off-peak from ${hh}:${mm} local (${formatCountdown(EFFECTIVE_UTC)})`,
		};
	}

	if (inPeak(now)) {
		return { color: "warning", text: `⚡ DeepSeek PEAK — until ${utcHourToLocalString(nextBoundaryUtcHour(now))} local` };
	}
	return { color: "success", text: `🌙 DeepSeek off-peak — next peak ${utcHourToLocalString(nextBoundaryUtcHour(now))} local` };
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
