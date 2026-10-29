import assert from "assert";

import { keyStep } from "./eq";
import { analyze, autoPoints, bandEdges, bandLevels, defaultViz, FFT_SIZE, PCM_RATE, sampleColors, sanitizeViz, smoothBars } from "./viz";

// A full-scale 1 kHz sine peaks at ~0 dB in the 1 kHz bin and is far lower elsewhere
const n = PCM_RATE;
const sine = Float32Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * 1000 * i) / PCM_RATE));
const spec = analyze(sine, n, n / 2);
const bin = Math.round(1000 / (PCM_RATE / FFT_SIZE));
assert(Math.abs(spec[bin]) < 1.5, `1 kHz bin should be ~0 dB, got ${spec[bin]}`);
assert(spec[Math.round(5000 / (PCM_RATE / FFT_SIZE))] < -60, "5 kHz should be quiet");

// Outside the decoded range is silence (analyze reuses one buffer, so read results before the next call)
assert(analyze(sine, n, -FFT_SIZE * 2)[bin] < -150, "before the start is silent");

// Bands: log spaced, and only the band holding 1 kHz is loud
const edges = bandEdges(32, 40, 10000);
assert(Math.abs(edges[0] - 40) < 1e-3 && Math.abs(edges[32] - 10000) < 1e-2, "edges span the range");
const levels = bandLevels(analyze(sine, n, n / 2), edges, new Float32Array(32));
const loud = levels.indexOf(Math.max(...levels));
assert(edges[loud] <= 1000 * 1.1 && edges[loud + 1] >= 1000 * 0.9, "the loudest band contains 1 kHz");

// Smoothing: rises faster than it falls, and the spread doesn't accumulate in the state
const state = new Float32Array(8);
const out = new Float32Array(8);
const opts = { attack: 40, decay: 200, smoothing: 0.5 };
smoothBars(state, Float32Array.from([0, 0, 0, 1, 0, 0, 0, 0]), out, 16, opts);
const risen = state[3];
assert(risen > 0.2 && state[2] === 0, "only the hit bar rises in the state");
assert(out[2] > 0 && out[2] < out[3], "neighbours are lifted in the output");
smoothBars(state, new Float32Array(8), out, 16, opts);
assert(risen - state[3] < risen * 0.2, "falls slower than it rose");
for (let i = 0; i < 200; i++) smoothBars(state, new Float32Array(8), out, 16, opts);
assert(Math.max(...out) < 0.01, "everything settles back to zero");

// Color points: left half red, right half blue, top rows black; each point reads its side, dark ones are lifted
const px = new Uint8ClampedArray(64 * 64 * 4);
for (let i = 0; i < 64 * 64; i++) px.set(i < 64 * 8 ? [0, 0, 0, 255] : i % 64 < 32 ? [255, 0, 0, 255] : [0, 0, 255, 255], i * 4);
assert.deepStrictEqual(sampleColors(px, [[0.1, 0.5], [0.9, 0.5], [2, 2]]), ["rgb(255,26,26)", "rgb(26,26,255)", "rgb(26,26,255)"]);
assert.deepStrictEqual(sampleColors(px, [[0.5, 0]]), ["rgb(140,140,140)"], "black is lifted to a visible grey");

// Auto points land on the two vivid halves, not on the black band
const auto = autoPoints(px, 2);
assert(auto.every(([, y]) => y > 8 / 63), "no auto point on black");
assert(auto.some(([x]) => x < 0.5) && auto.some(([x]) => x > 0.5), "one point on each color");

// Auto points come back in hue order (green stripe left, blue middle, red right → red, green, blue), up to 24
const stripes = new Uint8ClampedArray(64 * 64 * 4);
for (let i = 0; i < 64 * 64; i++) stripes.set(i % 64 < 21 ? [0, 200, 0, 255] : i % 64 < 42 ? [0, 0, 220, 255] : [220, 0, 0, 255], i * 4);
const ordered = autoPoints(stripes, 3);
assert(ordered[0][0] > 0.66 && ordered[1][0] < 0.33 && ordered[2][0] > 0.33 && ordered[2][0] < 0.66, `hue order: ${JSON.stringify(ordered)}`);
assert.strictEqual(autoPoints(stripes, 24).length, 24, "24 points even when the cover has few colors");

// Pasted settings: unknown keys dropped, bad values ignored, numbers clamped, points validated
const pasted = sanitizeViz({ bars: 9999, style: "laser", glow: "lots", color1: "red", colorPoints: [[0.5, 2], ["x", 1]], evil: "<script>", opacity: 0.5 });
assert.strictEqual(pasted.bars, 256);
assert.strictEqual(pasted.style, defaultViz().style);
assert.strictEqual(pasted.glow, defaultViz().glow);
assert.strictEqual(pasted.color1, defaultViz().color1);
assert.deepStrictEqual(pasted.colorPoints, [[0.5, 1]]);
assert.strictEqual(pasted.opacity, 0.5);
assert(!("evil" in pasted), "unknown keys are dropped");
assert.deepStrictEqual(sanitizeViz("nonsense"), defaultViz());

// Keyboard on an EQ band: arrows move it within limits, Shift moves more, other keys do nothing
const band = { enabled: true, type: "peaking" as const, freq: 1000, gain: 11.5, q: 1 };
assert.strictEqual(keyStep(band, "ArrowRight", false)!.freq, 1050);
assert.strictEqual(keyStep(band, "ArrowRight", true)!.freq, 1250);
assert.strictEqual(keyStep(band, "ArrowUp", true)!.gain, 12, "gain stops at +12");
assert.strictEqual(keyStep({ ...band, freq: 20 }, "ArrowLeft", false)!.freq, 20, "frequency stops at 20 Hz");
assert.strictEqual(keyStep(band, "Delete", false)!.gain, 0);
assert.strictEqual(keyStep({ ...band, type: "highpass" }, "ArrowUp", false), null, "high-pass has no gain");
assert.strictEqual(keyStep(band, "a", false), null);

console.log("viz: all tests passed");
