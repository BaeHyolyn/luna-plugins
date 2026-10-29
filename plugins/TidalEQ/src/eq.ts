/** Equalizer model and its translation into an mpv audio filter chain (FFmpeg lavfi). */

export type BandType = "peaking" | "lowshelf" | "highshelf" | "highpass" | "lowpass";
export type SmartVolume = "off" | "quiet" | "balanced" | "loud";

export type Band = { enabled: boolean; type: BandType; freq: number; gain: number; q: number };

export type Macros = { bass: number; voice: number; treble: number };

export type EqSettings = {
	enabled: boolean;
	preamp: number; // dB, applied before the bands so boosts have headroom
	bands: Band[];
	macros: Macros; // broad Bass / Voice / Treble controls on top of the bands
	smartVolume: SmartVolume;
	limiter: boolean;
};

export const BAND_FREQS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

export const flatBands = (): Band[] => BAND_FREQS.map((freq) => ({ enabled: true, type: "peaking", freq, gain: 0, q: 1 }));

export const defaultSettings = (): EqSettings => ({
	enabled: true,
	preamp: 0,
	bands: flatBands(),
	macros: { bass: 0, voice: 0, treble: 0 },
	smartVolume: "off",
	limiter: true,
});

/** The three broad controls, as regular bands so they share the filter and the curve math. */
export const macroBands = (m: Macros): Band[] => [
	{ enabled: true, type: "lowshelf", freq: 120, gain: m.bass, q: 0.7 },
	{ enabled: true, type: "peaking", freq: 1500, gain: m.voice, q: 0.8 },
	{ enabled: true, type: "highshelf", freq: 8000, gain: m.treble, q: 0.7 },
];

const withGains = (gains: number[]): Band[] => flatBands().map((b, i) => ({ ...b, gain: gains[i] ?? 0 }));

// Gains for 32 64 125 250 500 1k 2k 4k 8k 16k Hz. Preamp covers each preset's biggest boost.
const preset = (label: string, preamp: number, gains: number[]) => ({ label, preamp, bands: () => withGains(gains) });

export const PRESETS: Record<string, { label: string; bands: () => Band[]; preamp: number }> = {
	flat: { label: "Flat", bands: flatBands, preamp: 0 },
	deepBass: preset("Music: Deep Bass", -6, [5, 6, 3.5, 0, -1.5, -1, 0, 0, 1, 1.5]),
	punchy: preset("Music: Punchy", -5, [3, 4.5, 2, -1, -2, 0, 1, 2, 3.5, 3]),
	bright: preset("Music: Bright", -5, [0, 0, 0, -1, -1.5, 0, 1, 2.5, 4, 4.5]),
	vocals: preset("Music: Clear Vocals", -4, [-3, -2.5, -1.5, -1, 0.5, 2.5, 3.5, 2, 0, -1]),
	hiphop: preset("Music: Hip-Hop", -5, [4, 4.5, 2.5, 0, -1, 0, 1, 1, 1.5, 1]),
	trap: preset("Music: Trap", -5, [5, 5, 2, -0.5, -1.5, -0.5, 0.5, 1.5, 2.5, 2]),
	edm: preset("Music: EDM", -4.5, [4, 4, 1, -1, -1.5, 0, 1, 2, 3, 3.5]),
	rock: preset("Music: Rock", -3, [2, 2.5, 1.5, -0.5, -1, 0.5, 2, 2.5, 2, 1.5]),
	metal: preset("Music: Metal", -3.5, [2.5, 2, 0.5, -1.5, -1, 1, 2, 3, 2.5, 1.5]),
	pop: preset("Music: Pop", -2.5, [1.5, 2, 1, 0, -0.5, 0.5, 1.5, 2, 2, 1.5]),
	kpop: preset("Music: K-Pop", -3, [2, 2.5, 1, 0, -0.5, 1, 2, 2, 2.5, 2]),
	jazz: preset("Music: Jazz", -2, [1, 1.5, 1.5, 0.5, 0, 0, -0.5, 0, 0.5, 1]),
	classical: preset("Music: Classical", -2.5, [1, 1, 0.5, 0, 0, 0, 0, 0.5, 1.5, 2]),
	lofi: preset("Music: Lo-fi", -3, [1.5, 2.5, 2, 0.5, 0, -1, -1.5, -1, -0.5, -2]),
	acoustic: preset("Music: Acoustic", -2.5, [0.5, 1, 1.5, 1, 0, 0.5, 1.5, 2, 1.5, 1]),
	podcast: preset("Podcast", -3, [-6, -3, 0, 1, 1, 2, 3, 2, 0, -2]),
	dialog: preset("Movie: Dialog", -3.5, [-3, -2, -1, 0, 1, 2.5, 3, 2, 1, 0]),
	immersion: preset("Movie: Immersion", -4, [3.5, 3, 1.5, 0, -1, 0, 0.5, 1.5, 3, 3.5]),
};

const clamp = (v: number, lo: number, hi: number, fallback: number) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback);
// Rounded fixed-point numbers only, so a setting can never inject text into the filter string
const num = (v: number, digits = 2) => String(Number(v.toFixed(digits)));

const LAVFI_NAME: Record<BandType, string> = {
	peaking: "equalizer",
	lowshelf: "lowshelf",
	highshelf: "highshelf",
	highpass: "highpass",
	lowpass: "lowpass",
};

const SMART_VOLUME: Record<Exclude<SmartVolume, "off">, string> = {
	// dynaudnorm: f = frame ms, g = smoothing window, m = max gain; larger m lifts quiet passages more
	quiet: "dynaudnorm=f=500:g=31:m=4",
	balanced: "dynaudnorm=f=250:g=15:m=8",
	loud: "dynaudnorm=f=150:g=9:m=16",
};

export const bandFilter = (band: Band): string | undefined => {
	if (!band.enabled) return;
	const type = LAVFI_NAME[band.type] ? band.type : "peaking";
	const freq = clamp(band.freq, 20, 20000, 1000);
	const q = clamp(band.q, 0.1, 10, 1);
	if (type === "highpass" || type === "lowpass") return `${LAVFI_NAME[type]}=f=${num(freq, 0)}:t=q:w=${num(q)}`;
	const gain = clamp(band.gain, -24, 24, 0);
	if (gain === 0) return; // a 0 dB band changes nothing
	return `${LAVFI_NAME[type]}=f=${num(freq, 0)}:t=q:w=${num(q)}:g=${num(gain, 1)}`;
};

/**
 * Gain in dB that one band applies at `freq`, using the same biquad formulas as FFmpeg's filters
 * (RBJ Audio EQ Cookbook), so the drawn curve is what mpv actually plays.
 */
export const bandResponseDb = (band: Band, freq: number, sampleRate = 48000): number => {
	if (!band.enabled) return 0;
	const f0 = clamp(band.freq, 20, 20000, 1000);
	const q = clamp(band.q, 0.1, 10, 1);
	const g = clamp(band.gain, -24, 24, 0);
	const A = 10 ** (g / 40);
	const w0 = (2 * Math.PI * f0) / sampleRate;
	const cw = Math.cos(w0);
	const alpha = Math.sin(w0) / (2 * q);
	const sA = 2 * Math.sqrt(A) * alpha;
	let b: number[];
	let a: number[];
	switch (band.type) {
		case "lowshelf":
			b = [A * (A + 1 - (A - 1) * cw + sA), 2 * A * (A - 1 - (A + 1) * cw), A * (A + 1 - (A - 1) * cw - sA)];
			a = [A + 1 + (A - 1) * cw + sA, -2 * (A - 1 + (A + 1) * cw), A + 1 + (A - 1) * cw - sA];
			break;
		case "highshelf":
			b = [A * (A + 1 + (A - 1) * cw + sA), -2 * A * (A - 1 + (A + 1) * cw), A * (A + 1 + (A - 1) * cw - sA)];
			a = [A + 1 - (A - 1) * cw + sA, 2 * (A - 1 - (A + 1) * cw), A + 1 - (A - 1) * cw - sA];
			break;
		case "highpass":
			b = [(1 + cw) / 2, -(1 + cw), (1 + cw) / 2];
			a = [1 + alpha, -2 * cw, 1 - alpha];
			break;
		case "lowpass":
			b = [(1 - cw) / 2, 1 - cw, (1 - cw) / 2];
			a = [1 + alpha, -2 * cw, 1 - alpha];
			break;
		default:
			if (g === 0) return 0;
			b = [1 + alpha * A, -2 * cw, 1 - alpha * A];
			a = [1 + alpha / A, -2 * cw, 1 - alpha / A];
	}
	const w = (2 * Math.PI * freq) / sampleRate;
	const mag = (c: number[]) => {
		const re = c[0] + c[1] * Math.cos(w) + c[2] * Math.cos(2 * w);
		const im = -(c[1] * Math.sin(w) + c[2] * Math.sin(2 * w));
		return Math.hypot(re, im);
	};
	return 20 * Math.log10(mag(b) / mag(a));
};

/** Total gain in dB at `freq`: every band plus the Bass / Voice / Treble controls (preamp left out). */
export const responseDb = (s: Pick<EqSettings, "bands" | "macros">, freq: number): number =>
	[...s.bands, ...macroBands(s.macros)].reduce((sum, band) => sum + bandResponseDb(band, freq), 0);

/** The value for mpv's `af` property, or "" for no processing at all. */
export const buildChain = (s: EqSettings): string => {
	if (!s.enabled) return "";
	const filters: string[] = [];
	const preamp = clamp(s.preamp, -24, 24, 0);
	if (preamp !== 0) filters.push(`volume=${num(preamp, 1)}dB`);
	for (const band of [...s.bands, ...macroBands(s.macros ?? { bass: 0, voice: 0, treble: 0 })]) {
		const f = bandFilter(band);
		if (f) filters.push(f);
	}
	// own keys only: a tampered stored value like "constructor" must not reach mpv's arguments
	if (s.smartVolume !== "off" && Object.hasOwn(SMART_VOLUME, s.smartVolume)) filters.push(SMART_VOLUME[s.smartVolume]);
	if (s.limiter) filters.push("alimiter=limit=0.97:level=0");
	return filters.length ? `lavfi=[${filters.join(",")}]` : "";
};

/** A band after one key press, or null for keys that don't move it. Shift makes bigger steps. */
export const keyStep = (b: Band, key: string, big: boolean): Band | null => {
	const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
	const freqStep = big ? 1.25 : 1.05; // multiplicative: the axis is logarithmic
	const gainStep = big ? 2 : 0.5;
	const qStep = big ? 1.5 : 1.1;
	switch (key) {
		case "ArrowRight": return { ...b, freq: Math.round(clamp(b.freq * freqStep, 20, 20000)) };
		case "ArrowLeft": return { ...b, freq: Math.round(clamp(b.freq / freqStep, 20, 20000)) };
		case "ArrowUp": return (b.type === "highpass" || b.type === "lowpass") ? null : { ...b, gain: clamp(Math.round((b.gain + gainStep) * 2) / 2, -12, 12) };
		case "ArrowDown": return (b.type === "highpass" || b.type === "lowpass") ? null : { ...b, gain: clamp(Math.round((b.gain - gainStep) * 2) / 2, -12, 12) };
		case "PageUp": return { ...b, q: Math.round(clamp(b.q * qStep, 0.1, 10) * 100) / 100 };
		case "PageDown": return { ...b, q: Math.round(clamp(b.q / qStep, 0.1, 10) * 100) / 100 };
		case "Delete": case "Backspace": case "0": return { ...b, gain: 0 };
		default: return null;
	}
};
