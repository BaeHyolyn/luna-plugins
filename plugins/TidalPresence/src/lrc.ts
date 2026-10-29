export type Line = { time: number; text: string };

/** Parses LRC subtitles ("[mm:ss.xx] text") into lines sorted by time (seconds). */
export const parseLrc = (lrc: string): Line[] =>
	lrc
		.split(/\r?\n/)
		.flatMap((raw) => {
			const m = raw.match(/^\[(\d+):(\d+(?:\.\d+)?)\]\s*(.*)$/);
			return m ? [{ time: Number(m[1]) * 60 + Number(m[2]), text: m[3].trim() }] : [];
		})
		.sort((a, b) => a.time - b.time);

/** The line playing at `time` (seconds), the one after it, and when that next one starts. Empty lines are instrumental breaks. */
export const lineAt = (lines: Line[], time: number) => {
	let i = -1;
	while (i + 1 < lines.length && lines[i + 1].time <= time) i++;
	const textOf = (k: number) => (k >= 0 && lines[k] ? lines[k].text || "♪" : "");
	return { text: textOf(i), nextText: textOf(i + 1), next2Text: textOf(i + 2), next: lines[i + 1]?.time as number | undefined };
};

/**
 * Picks which line starts to send so the right line is on screen as long as possible,
 * with at most `limit` sends in any `windowSec`. Longer lines are kept first; short lines
 * that would break the budget are skipped (the previous line simply stays a bit longer).
 * Returns the chosen start times, sorted.
 */
export const planSends = (lines: Line[], limit: number, windowSec: number): number[] => {
	const lastEnd = (lines.at(-1)?.time ?? 0) + 5;
	const candidates = lines
		.map((line, i) => ({ time: line.time, weight: (lines[i + 1]?.time ?? lastEnd) - line.time }))
		.sort((a, b) => b.weight - a.weight);

	const chosen: number[] = [];
	const fits = (times: number[]) => times.every((t, k) => k + limit >= times.length || times[k + limit] - t >= windowSec);

	for (const { time } of candidates) {
		const next = [...chosen, time].sort((a, b) => a - b);
		if (fits(next)) chosen.splice(0, chosen.length, ...next);
	}
	return chosen;
};

/**
 * The lines to show at `position` (seconds), looking `leadMs` ahead so a send made slightly
 * early already carries the upcoming line, and how long until the next planned send.
 */
export const lyricAt = (lines: Line[], position: number, leadMs: number, planned?: number[]) => {
	const ahead = position + leadMs / 1000;
	const { text, nextText, next2Text, next } = lineAt(lines, ahead);
	const nextSend = planned ? planned.find((t) => t > ahead) : next;
	return { text, nextText, next2Text, msUntilNext: nextSend === undefined ? undefined : (nextSend - ahead) * 1000 };
};
