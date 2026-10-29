/** Visualizer settings and the audio analysis behind it: FFT, log-spaced bands and bar smoothing. No DOM here. */

export const PCM_RATE = 22050; // decoded mono rate: covers up to ~11 kHz, plenty for a visualizer
export const FFT_SIZE = 2048; // ~93 ms window at 22050 Hz

export type VizShape = "square" | "circle";
export type VizStyle = "bars" | "wave" | "dots" | "layers";
export type VizPlacement = "outside" | "inside" | "both";
export type VizColorMode = "artwork" | "solid" | "gradient" | "spectrum";

export type VizSettings = {
	enabled: boolean;
	style: VizStyle;
	shape: VizShape;
	placement: VizPlacement;
	mirror: boolean; // low frequencies meet at the bottom, symmetric left/right
	fourWay: boolean; // with mirror: symmetric both ways, lows at the bottom and top (rotate 90° for side "wings")
	bars: number;
	gap: number; // px between the cover and the bars
	length: number; // px, longest bar
	width: number; // 0..1 of each bar's slot
	roundCaps: boolean;
	rotation: number; // degrees
	spin: number; // turns per minute
	colorMode: VizColorMode;
	color1: string;
	color2: string;
	colorPoints: [number, number][]; // where "From cover" picks its colors, as 0..1 positions on the cover (manual mode)
	autoColors: boolean; // pick the color points again from every new cover
	colorCount: number; // how many colors auto mode picks
	opacity: number; // 0..1
	glow: number; // px
	sensitivity: number; // dB of headroom: lower = taller bars
	range: number; // dB shown from the floor to the top
	tilt: number; // dB per octave added above 1 kHz (removed below) so the highs aren't always tiny
	attack: number; // ms to rise
	decay: number; // ms to fall
	smoothing: number; // 0..1 neighbour smoothing (Monstercat style)
	peaks: boolean;
	layers: number; // "layers" style: how many stacked waves, each a step behind and bigger than the one inside it
	particles: boolean; // sparks drifting out from the ring, more with the bass
	roundCover: boolean; // show the cover as a circle, with the ring hugging it
	pulse: number; // 0..1 how much the cover beats with the bass
	minFreq: number;
	maxFreq: number;
	fps: number; // 0 = monitor refresh rate
	syncOffset: number; // ms, positive shows the music later
};

export const defaultViz = (): VizSettings => ({
	enabled: true,
	style: "bars",
	shape: "square",
	placement: "outside",
	mirror: true,
	fourWay: false,
	bars: 96,
	gap: 10,
	length: 48,
	width: 0.6,
	roundCaps: true,
	rotation: 0,
	spin: 0,
	colorMode: "artwork",
	color1: "#ffffff",
	color2: "#33ffee",
	colorPoints: [
		[0.25, 0.25],
		[0.75, 0.25],
		[0.75, 0.75],
		[0.25, 0.75],
	],
	autoColors: true,
	colorCount: 24,
	opacity: 0.85,
	glow: 8,
	sensitivity: 12,
	range: 50,
	tilt: 3,
	attack: 40,
	decay: 220,
	smoothing: 0.35,
	peaks: false,
	layers: 7,
	particles: false,
	roundCover: false,
	pulse: 0.3,
	minFreq: 40,
	maxFreq: 10000,
	fps: 60,
	syncOffset: 0,
});

/** In-place radix-2 FFT. `re`/`im` length must be a power of two. */
export const fft = (re: Float32Array, im: Float32Array) => {
	const n = re.length;
	for (let i = 1, j = 0; i < n; i++) {
		let bit = n >> 1;
		for (; j & bit; bit >>= 1) j ^= bit;
		j ^= bit;
		if (i < j) {
			[re[i], re[j]] = [re[j], re[i]];
			[im[i], im[j]] = [im[j], im[i]];
		}
	}
	for (let len = 2; len <= n; len <<= 1) {
		const ang = (-2 * Math.PI) / len;
		const wr = Math.cos(ang);
		const wi = Math.sin(ang);
		for (let i = 0; i < n; i += len) {
			let cr = 1;
			let ci = 0;
			for (let k = 0; k < len / 2; k++) {
				const a = i + k;
				const b = a + len / 2;
				const xr = re[b] * cr - im[b] * ci;
				const xi = re[b] * ci + im[b] * cr;
				re[b] = re[a] - xr;
				im[b] = im[a] - xi;
				re[a] += xr;
				im[a] += xi;
				[cr, ci] = [cr * wr - ci * wi, cr * wi + ci * wr];
			}
		}
	}
};

const HANN = Float32Array.from({ length: FFT_SIZE }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1)));
const re = new Float32Array(FFT_SIZE);
const im = new Float32Array(FFT_SIZE);
export const spectrum = new Float32Array(FFT_SIZE / 2); // dBFS per bin, refreshed by analyze()

/** Spectrum (dBFS per bin) of the window of `pcm` centred on sample `at`; silence outside the decoded range. */
export const analyze = (pcm: Float32Array, length: number, at: number) => {
	const start = Math.round(at) - FFT_SIZE / 2;
	for (let i = 0; i < FFT_SIZE; i++) {
		const k = start + i;
		re[i] = k >= 0 && k < length ? pcm[k] * HANN[i] : 0;
		im[i] = 0;
	}
	fft(re, im);
	// Hann window sums to N/2; a full-scale sine then reads ~0 dB
	const norm = 4 / FFT_SIZE;
	for (let i = 0; i < FFT_SIZE / 2; i++) spectrum[i] = 20 * Math.log10(Math.hypot(re[i], im[i]) * norm + 1e-9);
	return spectrum;
};

/** Log-spaced band edges (Hz) for `count` bands between min and max. */
export const bandEdges = (count: number, minFreq: number, maxFreq: number) => {
	const lo = Math.max(10, Math.min(minFreq, maxFreq - 10));
	const hi = Math.min(PCM_RATE / 2, Math.max(maxFreq, lo + 10));
	return Float32Array.from({ length: count + 1 }, (_, i) => lo * (hi / lo) ** (i / count));
};

/** Loudest bin in each band, in dB. Bands narrower than one bin read the bin they fall in. */
export const bandLevels = (spec: Float32Array, edges: Float32Array, out: Float32Array) => {
	const hz = PCM_RATE / FFT_SIZE;
	for (let b = 0; b < out.length; b++) {
		const from = Math.min(spec.length - 1, Math.floor(edges[b] / hz));
		const to = Math.min(spec.length - 1, Math.max(from, Math.floor(edges[b + 1] / hz)));
		let max = -Infinity;
		for (let i = from; i <= to; i++) if (spec[i] > max) max = spec[i];
		out[b] = max;
	}
	return out;
};

/**
 * Moves `state` toward `target` (both 0..1): fast rise, slow fall, frame-rate independent.
 * `out` gets the drawn values: each bar lifted toward its neighbours so peaks spread into smooth hills
 * (kept out of `state` so the spread doesn't build up frame after frame).
 */
export const smoothBars = (
	state: Float32Array,
	target: Float32Array,
	out: Float32Array,
	dtMs: number,
	s: Pick<VizSettings, "attack" | "decay" | "smoothing">,
) => {
	const up = 1 - Math.exp(-dtMs / Math.max(1, s.attack));
	const down = 1 - Math.exp(-dtMs / Math.max(1, s.decay));
	for (let i = 0; i < state.length; i++) state[i] += (target[i] - state[i]) * (target[i] > state[i] ? up : down);
	if (s.smoothing <= 0) return out.set(state), out;
	const falloff = 1 + (1 - s.smoothing) * 2; // 1 = flat hills, 3 = barely any spread
	for (let i = 0; i < state.length; i++) {
		let v = state[i];
		for (let d = 1; d < 8; d++) {
			const n = Math.max(i - d >= 0 ? state[i - d] : 0, i + d < state.length ? state[i + d] : 0) / falloff ** d;
			if (n > v) v = n;
		}
		out[i] = v;
	}
	return out;
};

export const MAX_COLOR_POINTS = 24;
const GRID = 64; // the cover is sampled from a 64x64 copy

/** RGB 0..255 → HSL 0..1, and back. */
const toHsl = (r: number, g: number, b: number): [number, number, number] => {
	[r, g, b] = [r / 255, g / 255, b / 255];
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const l = (max + min) / 2;
	if (max === min) return [0, 0, l];
	const d = max - min;
	const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
	const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
	return [h / 6, s, l];
};
const fromHsl = (h: number, s: number, l: number) => {
	const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
	const p = 2 * l - q;
	const ch = (t: number) => {
		t = (t + 1) % 1;
		const v = t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p;
		return Math.round(v * 255);
	};
	return `rgb(${ch(h + 1 / 3)},${ch(h)},${ch(h - 1 / 3)})`;
};
// Colors darker than this are lifted, so a point on a black area still shows on TIDAL's tinted background
const MIN_LIGHTNESS = 0.55;

/** Average color around each point of a GRID x GRID RGBA image, brightened when too dark to see. */
export const sampleColors = (pixels: Uint8ClampedArray, points: [number, number][]) =>
	points.map(([px, py]) => {
		const cx = Math.round(Math.min(1, Math.max(0, px)) * (GRID - 1));
		const cy = Math.round(Math.min(1, Math.max(0, py)) * (GRID - 1));
		let r = 0, g = 0, b = 0, n = 0;
		for (let y = Math.max(0, cy - 2); y <= Math.min(GRID - 1, cy + 2); y++)
			for (let x = Math.max(0, cx - 2); x <= Math.min(GRID - 1, cx + 2); x++) {
				const i = (y * GRID + x) * 4;
				r += pixels[i];
				g += pixels[i + 1];
				b += pixels[i + 2];
				n++;
			}
		const [h, sat, l] = toHsl(r / n, g / n, b / n);
		return fromHsl(h, sat, Math.max(l, MIN_LIGHTNESS));
	});

const coverCache = new Map<string, Promise<Uint8ClampedArray | null>>();
/** The cover as GRID x GRID RGBA pixels (fetched, since the <img> itself can't be read across origins), or null. */
export const coverPixels = (src: string) => {
	let p = coverCache.get(src);
	if (!p) {
		p = fetch(src)
			.then((r) => r.blob())
			.then((blob) => createImageBitmap(blob, { resizeWidth: GRID, resizeHeight: GRID, resizeQuality: "medium" }))
			.then((bitmap) => {
				const c = new OffscreenCanvas(GRID, GRID);
				const g = c.getContext("2d")!;
				g.drawImage(bitmap, 0, 0);
				return g.getImageData(0, 0, GRID, GRID).data;
			})
			.catch(() => null);
		if (coverCache.size > 20) coverCache.clear();
		coverCache.set(src, p);
	}
	return p;
};

/**
 * Points on the most vivid, mutually different colors of the cover (GRID x GRID RGBA pixels):
 * the most vivid first, then each next one as vivid as possible and as far as possible from those already picked.
 */
export const autoPoints = (pixels: Uint8ClampedArray, count = 4): [number, number][] => {
	const cells: { x: number; y: number; rgb: [number, number, number]; vivid: number }[] = [];
	for (let y = 2; y < GRID - 2; y += 2)
		for (let x = 2; x < GRID - 2; x += 2) {
			const i = (y * GRID + x) * 4;
			const rgb: [number, number, number] = [pixels[i], pixels[i + 1], pixels[i + 2]];
			const [, sat, l] = toHsl(...rgb);
			cells.push({ x, y, rgb, vivid: sat * (1 - Math.abs(l - 0.55) * 1.4) + l * 0.15 });
		}
	const picked: typeof cells = [];
	const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) / 441;
	// Colors closer than this to one already picked are skipped, unless the cover has nothing else
	let minApart = 0.18;
	while (picked.length < count && picked.length < cells.length) {
		let best: (typeof cells)[number] | null = null;
		let bestScore = -Infinity;
		for (const c of cells) {
			const apart = picked.length ? Math.min(...picked.map((p) => dist(p.rgb, c.rgb))) : 1;
			if (apart < minApart) continue;
			// Being different from the colors already picked matters more than being vivid, so the ring isn't one color 4 times
			const score = c.vivid * 0.35 + apart * 0.65;
			if (score > bestScore && !picked.includes(c)) (best = c), (bestScore = score);
		}
		if (best) picked.push(best);
		else minApart /= 2; // a one-color cover: accept closer colors
	}
	// In hue order, so the ring flows from one color to the next instead of jumping around
	const hue = (c: (typeof cells)[number]) => {
		const [h, sat] = toHsl(...c.rgb);
		return sat < 0.12 ? 2 + toHsl(...c.rgb)[2] : h; // greys after the colors, dark to light
	};
	picked.sort((a, b) => hue(a) - hue(b));
	return picked.map((c) => [Math.round((c.x / (GRID - 1)) * 1000) / 1000, Math.round((c.y / (GRID - 1)) * 1000) / 1000]);
};

/** Slider limits for every numeric setting: used by the panel and to clamp pasted settings. */
export const VIZ_RANGES: Partial<Record<keyof VizSettings, [min: number, max: number, step: number]>> = {
	bars: [16, 256, 2],
	width: [0.1, 1, 0.05],
	length: [8, 200, 1],
	gap: [-40, 80, 1],
	opacity: [0.1, 1, 0.05],
	glow: [0, 40, 1],
	rotation: [0, 359, 1],
	spin: [-30, 30, 1],
	pulse: [0, 1, 0.05],
	smoothing: [0, 1, 0.05],
	attack: [5, 300, 1],
	decay: [20, 1500, 10],
	sensitivity: [-12, 40, 1],
	range: [20, 90, 1],
	minFreq: [20, 500, 5],
	maxFreq: [1000, 11000, 100],
	tilt: [0, 6, 0.5],
	colorCount: [2, MAX_COLOR_POINTS, 1],
	layers: [2, 10, 1],
	syncOffset: [-300, 300, 10],
};
const CHOICES: Partial<Record<keyof VizSettings, readonly unknown[]>> = {
	style: ["bars", "wave", "dots", "layers"],
	shape: ["square", "circle"],
	placement: ["outside", "inside", "both"],
	colorMode: ["artwork", "solid", "gradient", "spectrum"],
	fps: [30, 60, 120, 0],
};

/** Settings from outside (pasted, or a saved preset): keeps only known keys with valid values, clamped, over the defaults. */
export const sanitizeViz = (input: unknown): VizSettings => {
	const out = defaultViz();
	if (!input || typeof input !== "object") return out;
	const src = input as Record<string, unknown>;
	const o = out as Record<string, unknown>;
	for (const key of Object.keys(out) as (keyof VizSettings)[]) {
		const v = src[key];
		const range = VIZ_RANGES[key];
		const choices = CHOICES[key];
		if (choices) {
			if (choices.includes(v)) o[key] = v;
		} else if (range) {
			if (typeof v === "number" && Number.isFinite(v)) o[key] = Math.min(range[1], Math.max(range[0], v));
		} else if (key === "colorPoints") {
			if (Array.isArray(v)) {
				const pts = v
					.filter((p): p is [number, number] => Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === "number" && Number.isFinite(n)))
					.slice(0, MAX_COLOR_POINTS)
					.map(([x, y]) => [Math.min(1, Math.max(0, x)), Math.min(1, Math.max(0, y))] as [number, number]);
				if (pts.length) o[key] = pts;
			}
		} else if (key === "color1" || key === "color2") {
			if (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v)) o[key] = v;
		} else if (typeof v === typeof o[key]) o[key] = v;
	}
	return out;
};

/** Ready-made looks. Applying one keeps the on/off switch and the color points. */
export const VIZ_PRESETS: Record<string, { label: string; viz: Partial<VizSettings> }> = {
	default: { label: "Default", viz: {} },
	minimal: { label: "Minimal", viz: { bars: 72, width: 0.35, length: 28, glow: 0, opacity: 0.7, pulse: 0, smoothing: 0.5 } },
	neon: { label: "Neon ring", viz: { shape: "circle", colorMode: "spectrum", bars: 128, width: 0.5, glow: 24, spin: 2, length: 60 } },
	aura: { label: "Aura", viz: { style: "wave", length: 70, glow: 30, opacity: 0.9, smoothing: 0.7, pulse: 0.4, decay: 400 } },
	club: { label: "Club", viz: { bars: 64, length: 110, pulse: 0.8, peaks: true, decay: 300, sensitivity: 18, glow: 14 } },
	pearls: { label: "Pearls", viz: { style: "dots", bars: 72, length: 40, glow: 10, width: 0.7 } },
	rainbowLayers: {
		label: "Rainbow layers",
		// Bass opens "wings" left and right; at rest only a thin white ring; colors are thin lagging rims
		viz: {
			style: "layers", shape: "circle", roundCover: true, mirror: true, fourWay: true, rotation: 90, colorMode: "spectrum", layers: 7,
			bars: 64, length: 190, gap: 0, glow: 12, smoothing: 0.55, attack: 30, decay: 260, particles: true, pulse: 0.5,
			sensitivity: 8, minFreq: 35, maxFreq: 900, tilt: 0,
		},
	},

	inner: { label: "Inner glow", viz: { placement: "inside", bars: 128, length: 60, opacity: 0.6, glow: 16, width: 0.4 } },
};
