export const BEAT_RATE = 11025; // mono rate decoded for beat analysis: kicks and snares are well below 5 kHz
const HOP = 256; // ~23 ms per onset frame

export type TrackGrid = {
	bpm: number;
	beat: number; // seconds of the first beat of the grid
	downbeat: number; // seconds of the first bar start (beat 1 of 4)
	introEnd: number; // seconds: first bar where the track reaches full energy
	outroStart: number; // seconds: bar after the last full-energy bar
	duration: number;
	confidence: number; // 0-1: how strongly onsets line up with the grid
};

export type MixPlan = {
	style: "beatmix" | "fade";
	outAt: number; // outgoing position (s) where the mix starts: always on one of its bar lines
	inAt: number; // incoming position (s) it starts from: on one of its bar lines
	speed: number; // incoming playback speed during the mix (matches the outgoing tempo)
	seconds: number;
};

const MAX_STRETCH = 0.08; // beyond ±8% a tempo change is audible: fade instead
// Below this the grid is a guess (no drums: piano, acoustic, ambient), fade instead. Measured on TIDAL: no-drum songs
// 0.38-0.59 (Debussy, Satie, Eno, Einaudi, Bon Iver), drum songs 0.52-1 (rap, house).
// shortcut: the score overlaps around 0.5-0.6, so a few sparse drum songs fade; upgrade with a kick-band measure if that annoys
const MIN_CONFIDENCE = 0.6;

/** How to go from `out` (now at `now` s, the mix can start `lead` s from now at the earliest) into `inn`. */
export const planMix = (out: TrackGrid, inn: TrackGrid, now: number, lead = 1.5, maxBars = 16): MixPlan => {
	const barOut = 240 / out.bpm;
	const barIn = 240 / inn.bpm;
	const nextBar = (t: number) => out.downbeat + Math.max(0, Math.ceil((t - out.downbeat) / barOut)) * barOut;
	// Past the outgoing track's end (cue ran long, or a very short track): fade out right away
	const outAt = Math.min(nextBar(now + lead), Math.max(0, out.duration - 1));
	const left = Math.floor((out.duration - outAt) / barOut); // whole bars the outgoing track still has
	// Half/double tempo counts as a match: the beats still line up
	const speed = [1, 2, 0.5].map((m) => (out.bpm / inn.bpm) * m).reduce((a, b) => (Math.abs(b - 1) < Math.abs(a - 1) ? b : a));
	if (Math.abs(speed - 1) > MAX_STRETCH || left < 4 || !(Math.min(out.confidence, inn.confidence) >= MIN_CONFIDENCE)) {
		// Without a shared beat, a longer fade hides the clash better
		return { style: "fade", outAt, inAt: inn.downbeat, speed: 1, seconds: Math.min(8, Math.max(1, out.duration - outAt)) };
	}
	const bars = Math.min(maxBars, left);
	// Ride the incoming intro so its full-energy part lands as the mix ends
	const introBars = Math.floor((inn.introEnd - inn.downbeat) / barIn);
	const inAt = Math.min(inn.downbeat + Math.max(0, introBars - bars) * barIn, inn.duration / 2);
	return { style: "beatmix", outAt, inAt, speed, seconds: bars * barOut };
};

/**
 * Beat grid of a whole decoded track (mono float samples at `rate`).
 * shortcut: one constant tempo per track, fine for pop/electronic; songs with tempo drift get a grid that slips, upgrade to a tracked beat if that shows up in mixes.
 */
export const analyzeBeats = (pcm: Float32Array, rate = BEAT_RATE): TrackGrid | null => {
	const frames = Math.floor(pcm.length / HOP);
	if (frames < 200) return null;
	const fps = rate / HOP;

	// Onset strength: rise of log energy per frame, with the low end (kick) counted twice via a one-pole low-pass
	const energy = new Float32Array(frames);
	const onset = new Float32Array(frames);
	let low = 0;
	let prev = 0;
	const a = Math.exp((-2 * Math.PI * 150) / rate);
	for (let f = 0; f < frames; f++) {
		let e = 0;
		let el = 0;
		for (let i = f * HOP; i < (f + 1) * HOP; i++) {
			const x = pcm[i];
			low = a * low + (1 - a) * x;
			e += x * x;
			el += low * low;
		}
		energy[f] = e / HOP;
		const v = Math.log1p(1000 * (e + 2 * el) / HOP);
		onset[f] = Math.max(0, v - prev);
		prev = v;
	}

	// Tempo: autocorrelation of the onsets over 70-180 BPM, leaning toward ~120 so half/double tempo loses ties
	const minLag = Math.floor((fps * 60) / 180);
	const maxLag = Math.ceil((fps * 60) / 70);
	const ac = new Float32Array(maxLag + 2);
	for (let lag = minLag - 1; lag <= maxLag + 1; lag++) {
		let s = 0;
		for (let f = lag; f < frames; f++) s += onset[f] * onset[f - lag];
		ac[lag] = s / (frames - lag);
	}
	let best = minLag;
	let bestScore = -1;
	for (let lag = minLag; lag <= maxLag; lag++) {
		const bpm = (fps * 60) / lag;
		const score = ac[lag] * Math.exp(-0.5 * (Math.log2(bpm / 120) / 0.9) ** 2);
		if (score > bestScore) [best, bestScore] = [lag, score];
	}
	// Period and phase together: the grid that collects the most onset over the whole track. A lag is only whole
	// frames (~0.6 BPM apart), which would drift half a second over a long mix; the full-length grid pins it down.
	const gridSum = (p: number, per: number) => {
		let s = 0;
		for (let t = p; t < frames - 1; t += per) s += Math.max(onset[Math.round(t)], 0.5 * (onset[Math.floor(t)] + onset[Math.ceil(t)]));
		return s;
	};
	let period = best;
	let phase = 0;
	let phaseScore = -1;
	for (let per = best - 1; per <= best + 1; per += 0.005)
		for (let p = 0; p < per; p += 0.5) {
			const s = gridSum(p, per);
			if (s > phaseScore) [period, phase, phaseScore] = [per, p, s];
		}

	// Which of the 4 beats starts the bar: the strongest on average
	const beats = Math.floor((frames - 1) / period);
	const bar = [0, 0, 0, 0];
	for (let k = 0; k < beats; k++) bar[k % 4] += onset[Math.round(phase + k * period)] ?? 0;
	const first = bar.indexOf(Math.max(...bar));

	let total = 0;
	for (let f = 0; f < frames; f++) total += onset[f];
	const confidence = Math.min(1, phaseScore / Math.max(1e-9, (total / frames) * beats) / 4);

	// Intro/outro: per-bar energy against the loud part of the track (75th percentile of bars)
	const barFrames = period * 4;
	const start = phase + first * period;
	const bars: number[] = [];
	for (let b = start; b + barFrames <= frames; b += barFrames) {
		let s = 0;
		for (let f = Math.round(b); f < Math.round(b + barFrames); f++) s += energy[f];
		bars.push(s / barFrames);
	}
	const loud = [...bars].sort((x, y) => x - y)[Math.floor(bars.length * 0.75)] ?? 0;
	const full = bars.map((e) => e >= loud * 0.6);
	const introBar = Math.max(0, full.indexOf(true));
	const outroBar = full.lastIndexOf(true) + 1 || bars.length;

	const sec = (frame: number) => (frame * HOP) / rate;
	return {
		bpm: (fps * 60) / period,
		beat: sec(phase),
		downbeat: sec(start),
		introEnd: sec(start + introBar * barFrames),
		outroStart: sec(start + outroBar * barFrames),
		duration: pcm.length / rate,
		confidence,
	};
};
