import assert from "node:assert/strict";
import { analyzeBeats, BEAT_RATE, planMix } from "./beats";

// 124 BPM four-on-the-floor: accented kick on beat 1, quiet 16-bar intro and outro around a loud middle
const BPM = 124;
const OFFSET = 0.37;
const beat = 60 / BPM;
const bars = 64;
const pcm = new Float32Array(Math.ceil((OFFSET + bars * 4 * beat + 1) * BEAT_RATE));
for (let k = 0; k < bars * 4; k++) {
	const barIndex = Math.floor(k / 4);
	const level = (barIndex < 16 || barIndex >= 48 ? 0.15 : 0.8) * (k % 4 === 0 ? 1 : 0.6);
	const at = Math.round((OFFSET + k * beat) * BEAT_RATE);
	for (let i = 0; i < 0.12 * BEAT_RATE; i++) pcm[at + i] += level * Math.exp(-i / (0.03 * BEAT_RATE)) * Math.sin((2 * Math.PI * 60 * i) / BEAT_RATE);
}

const g = analyzeBeats(pcm);
assert.ok(g);
assert.ok(Math.abs(g.bpm - BPM) < 0.5, `bpm ${g.bpm}`);
const near = (t: number, want: number) => Math.abs(((t - want + beat / 2) % beat) - beat / 2) < 0.03;
assert.ok(near(g.beat, OFFSET), `beat ${g.beat}`);
const barLen = 4 * beat;
assert.ok(Math.abs(((g.downbeat - OFFSET + barLen / 2) % barLen) - barLen / 2) < 0.05, `downbeat ${g.downbeat}`);
assert.ok(Math.abs(g.introEnd - (OFFSET + 16 * barLen)) < 0.1, `introEnd ${g.introEnd}`);
assert.ok(Math.abs(g.outroStart - (OFFSET + 48 * barLen)) < 0.1, `outroStart ${g.outroStart}`);
assert.ok(g.confidence > 0.3, `confidence ${g.confidence}`);
assert.equal(analyzeBeats(new Float32Array(1000)), null);
// planMix: 128 into 124 (3% apart) beat-mixes on a bar line; 128 into 90 fades; 170 into 85 counts as a match
const grid = (bpm: number, over = {}) => ({ bpm, beat: 0.2, downbeat: 0.2, introEnd: 30, outroStart: 200, duration: 240, confidence: 1, ...over });
const m = planMix(grid(128), grid(124), 100);
assert.equal(m.style, "beatmix");
assert.ok(Math.abs(m.speed - 128 / 124) < 1e-9);
const bar128 = 240 / 128;
assert.ok(m.outAt >= 101.5 && Math.abs(((m.outAt - 0.2) / bar128) % 1) < 1e-6, `outAt ${m.outAt}`);
assert.equal(m.seconds, 16 * bar128);
assert.equal(m.inAt, 0.2); // 30 s intro is < 16 bars at 124: start from the first bar
const long = planMix(grid(128), grid(124, { introEnd: 0.2 + 32 * (240 / 124) }), 100);
assert.ok(Math.abs(long.inAt - (0.2 + 16 * (240 / 124))) < 1e-9, `inAt ${long.inAt}`);
assert.equal(planMix(grid(128), grid(90), 100).style, "fade");
assert.ok(Math.abs(planMix(grid(170), grid(85), 100).speed - 1) < 1e-9);
const end = planMix(grid(128), grid(124), 235);
assert.equal(end.style, "fade"); // under 4 bars left
console.log("beats ok");
