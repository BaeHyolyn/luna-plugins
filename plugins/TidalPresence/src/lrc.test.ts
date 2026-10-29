import assert from "node:assert/strict";
import { lineAt, lyricAt, parseLrc, planSends, type Line } from "./lrc";

const lines = parseLrc("[00:12.50] First line\r\n[00:05.00] Intro\n[01:02.00]\nnot a lyric\n[01:10.25] Last");

// Parsing
assert.deepEqual(
	lines.map((l) => l.time),
	[5, 12.5, 62, 70.25],
);
assert.equal(lines[1].text, "First line");

// Current and next line
assert.deepEqual(lineAt(lines, 0), { text: "", nextText: "Intro", next2Text: "First line", next: 5 });
assert.deepEqual(lineAt(lines, 5), { text: "Intro", nextText: "First line", next2Text: "♪", next: 12.5 });
assert.deepEqual(lineAt(lines, 30), { text: "First line", nextText: "♪", next2Text: "Last", next: 62 });
assert.deepEqual(lineAt(lines, 63), { text: "♪", nextText: "Last", next2Text: "", next: 70.25 });
assert.deepEqual(lineAt(lines, 500), { text: "Last", nextText: "", next2Text: "", next: undefined });
assert.deepEqual(lineAt([], 10), { text: "", nextText: "", next2Text: "", next: undefined });

// Lead: sending 300ms early already shows the upcoming line, but not earlier
assert.equal(lyricAt(lines, 12.2, 300).text, "First line");
assert.equal(lyricAt(lines, 12.0, 300).text, "Intro");
assert.equal(Math.round(lyricAt(lines, 30, 300).msUntilNext!), 31_700);
assert.equal(lyricAt(lines, 500, 300).msUntilNext, undefined);

// With a plan, the next send is the next planned line, skipping unplanned ones
assert.equal(Math.round(lyricAt(lines, 6, 0, [5, 62]).msUntilNext!), 56_000);

// Planner never goes over the budget
const withinBudget = (times: number[], limit: number, windowSec: number) =>
	times.every((t, k) => k + limit >= times.length || times[k + limit] - t >= windowSec);
const at = (...times: number[]): Line[] => times.map((time) => ({ time, text: `l${time}` }));

{
	const fast = at(0, 1, 2, 3, 4, 5, 6, 7, 8, 9);
	const plan = planSends(fast, 4, 20);
	assert.equal(plan.length, 4, "only 4 sends fit in 20s");
	assert.ok(withinBudget(plan, 4, 20));
	assert.ok(plan.includes(9), "the longest line (the last one) is kept");
}

// Spaced out lines all fit
assert.deepEqual(planSends(at(0, 10, 20, 30, 40, 50), 4, 20), [0, 10, 20, 30, 40, 50]);

// Long lines win over short ones when the budget is tight
assert.deepEqual(planSends(at(0, 1, 2, 3, 4, 30), 2, 20), [0, 4, 30]);

// A realistic dense song stays within budget
{
	const song = at(...Array.from({ length: 80 }, (_, i) => Math.round(i * 2.3 * 10) / 10));
	const plan = planSends(song, 4, 20);
	assert.ok(withinBudget(plan, 4, 20));
	assert.ok(plan.length >= 30, `uses the budget well (${plan.length} sends)`);
}

console.log("lrc: all tests passed");
