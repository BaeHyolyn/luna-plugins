import type { LunaUnload } from "@luna/core";
import { MediaItem, PlayState } from "@luna/lib";

import { responseDb } from "./eq";
import { readPcm } from "./player.native";
import { settings, vizSettings } from "./Settings";
import { analyze, autoPoints, bandEdges, bandLevels, coverPixels, PCM_RATE, sampleColors, smoothBars, type VizSettings } from "./viz";

// Draws the spectrum around TIDAL's now-playing cover on one canvas, in its own animation loop (never through React).
// Samples come from the silent decoder mpv (readPcm); the position from the playing mpv, extrapolated between polls.

const VIEW = "[data-test=new-now-playing]";
// The cover is an <img>, or a <video> for albums with an animated cover
export const COVER = `${VIEW} [class*=_artworkWrapper_] :is(img, video)`;
/** The cover's still image: an animated cover's poster frame is the same artwork. */
export const coverImageSrc = (el: Element | null) => (el instanceof HTMLVideoElement ? el.poster : el instanceof HTMLImageElement ? el.src : "");

// Decoded samples of the current track
let pcm = new Float32Array(PCM_RATE * 60 * 5);
let pcmLength = 0;
let pcmBytes = 0;
let pcmDone = true;
let pcmLeftover = new Uint8Array(0);

// While the Visualizer tab is open and the music is paused, animate a made-up spectrum so changes can still be seen
let preview = false;
export const setPreview = (on: boolean) => (preview = on);

let pcmGeneration = 0; // bumps on every reset, so a read still in flight for the previous track is dropped
let pulling = false;

// Playing position: polled from mpv a few times a second, extrapolated in between
let polled = { time: 0, at: 0 };
// Where the playing position comes from: mpv while it plays, TIDAL's player when the equalizer is off
let positionSource: () => Promise<number | null> = async () => null;
export const setPositionSource = (fn: typeof positionSource) => (positionSource = fn);
const pollTime = async () => {
	const time = await positionSource();
	if (time !== null) polled = { time, at: performance.now() };
};
const position = (offsetMs: number) => {
	const t = PlayState.playing ? polled.time + (performance.now() - polled.at) / 1000 : polled.time;
	return t - offsetMs / 1000;
};

/** Called on every track load: forget the old samples and read the new ones as they're decoded. */
export const resetPcm = (decoding: boolean) => {
	pcmGeneration++;
	polled = { time: 0, at: performance.now() }; // don't analyse the old track's position until the first poll
	pcmLength = 0;
	pcmBytes = 0;
	pcmLeftover = new Uint8Array(0);
	pcmDone = !decoding;
};

const pullPcm = async () => {
	if (pcmDone || pulling) return; // one read at a time, or two could read the same bytes
	pulling = true;
	const mine = pcmGeneration;
	let read: Awaited<ReturnType<typeof readPcm>>;
	try {
		read = await readPcm(pcmBytes);
	} finally {
		pulling = false;
	}
	const { data, done } = read;
	if (mine !== pcmGeneration) return;
	if (data?.length) {
		pcmBytes += data.length;
		// Samples are 4 bytes; a read can end mid-sample, so carry the remainder to the next read
		const bytes = new Uint8Array(pcmLeftover.length + data.length);
		bytes.set(pcmLeftover);
		bytes.set(data, pcmLeftover.length);
		const whole = bytes.length - (bytes.length % 4);
		pcmLeftover = bytes.slice(whole);
		const samples = new Float32Array(bytes.buffer, 0, whole / 4);
		if (pcmLength + samples.length > pcm.length) {
			const bigger = new Float32Array(Math.max(pcm.length * 2, pcmLength + samples.length));
			bigger.set(pcm.subarray(0, pcmLength));
			pcm = bigger;
		}
		pcm.set(samples, pcmLength);
		pcmLength += samples.length;
	}
	if (done && !data?.length) pcmDone = true;
};


/**
 * TIDAL's own accent color for the album, lightened: TIDAL tints the now-playing background with the same color,
 * so the raw one would vanish into it.
 */
const albumColor = async (): Promise<string | null> => {
	const album = await (await MediaItem.fromPlaybackContext())?.album();
	const hex = album?.tidalAlbum?.vibrantColor;
	if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) return null;
	const mix = (i: number) => Math.round(parseInt(hex.slice(i, i + 2), 16) * 0.55 + 255 * 0.45);
	return `rgb(${mix(1)},${mix(3)},${mix(5)})`;
};

/** Rough brightness of an rgb()/#hex color, 0..255. */
const lum = (c: string) => {
	const n = c.startsWith("#") ? [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)) : (c.match(/\d+/g) ?? []).map(Number);
	return (n[0] ?? 0) * 0.3 + (n[1] ?? 0) * 0.59 + (n[2] ?? 0) * 0.11;
};

const PARTICLE_LIFE = 1.6; // seconds
const PARTICLE_RANGE = 90; // px past the ring they can travel

/** How many times the bands go round the ring: once, twice (mirror) or four times (four-way). */
const symmetry = (v: VizSettings) => (!v.mirror ? 1 : v.fourWay ? 4 : 2);

/** How much bigger layer k is than the innermost one: outer layers reach further out. */
const layerScale = (k: number) => 1 + k * 0.05;

/** a → b at t (0..1), for #rrggbb colors. */
const mixHex = (a: string, b: string, t: number) => {
	const ch = (c: string, i: number) => parseInt(c.slice(i, i + 2), 16);
	const m = (i: number) => Math.round(ch(a, i) + (ch(b, i) - ch(a, i)) * t);
	return `rgb(${m(1)},${m(3)},${m(5)})`;
};

/** One color per layer, innermost first. */
const layerColors = (v: VizSettings, pointColors: string[], art: string): string[] =>
	Array.from({ length: v.layers }, (_, k) => {
		const t = v.layers > 1 ? k / (v.layers - 1) : 0;
		switch (v.colorMode) {
			case "spectrum": {
				// white inside, then yellow, through red and violet, to green outside
				if (k === 0) return "hsl(0,0%,97%)";
				const u = v.layers > 2 ? (k - 1) / (v.layers - 2) : 0;
				return `hsl(${(50 - u * 290 + 360) % 360},95%,${62 - u * 8}%)`;
			}
			case "artwork":
				return pointColors.length ? pointColors[Math.round(t * (pointColors.length - 1))] : art;
			case "gradient":
				return mixHex(v.color1, v.color2, t);
			default:
				return v.color1;
		}
	});

export const startVisualizer = (unloads: Set<LunaUnload>) => {
	const canvas = document.createElement("canvas");
	// Mounted inside the cover's box (see the loop), stacked above the image so "Inside" bars show over the cover
	// It never covers the side panel: drawing is clipped at its edge.
	canvas.style.cssText = "position:absolute;pointer-events:none;left:0;top:0;z-index:1;";
	const ctx = canvas.getContext("2d")!;
	unloads.add(() => canvas.remove());

	// What beats with the bass: the cover's own box (image, TIDAL's 1px border and glare together), not just the image
	let cover: HTMLElement | null = null;
	let coverSrc = "";
	let artColor: string | null = null;
	let pixels: Uint8ClampedArray | null = null; // the current cover, for the color points
	let pointColors: string[] = [];
	let pointsKey = "";
	// "layers" style: each layer follows the bars a little later than the one inside it
	let layerState = new Float32Array(0);
	// Sparks for the particles option: angle, distance from the ring, speed (px/s), size, age (s); a fixed pool, no allocations
	const MAX_PARTICLES = 90;
	const particles = new Float32Array(MAX_PARTICLES * 5);
	let liveParticles = 0;
	let pointsSeen: VizSettings["colorPoints"] | null = null; // the manual points last sampled (same array until edited)
	// TIDAL's tab bar, player bar and side panel, so the drawing stays clear of them
	let ui: { panel?: DOMRect; tabs?: DOMRect; player?: DOMRect } = {};
	let uiAt = 0;
	// Round cover: one class on the cover's box rounds the image, TIDAL's 1px border (::after) and its glare together
	const roundStyle = document.createElement("style");
	roundStyle.textContent = `.tidaleq-round > :is(img, video, [class*=_glare_]), .tidaleq-round::after { border-radius: 50% !important; }`;
	document.head.appendChild(roundStyle);
	unloads.add(() => roundStyle.remove());
	const restoreCover = () => {
		if (cover) cover.style.scale = "";
		cover?.classList.remove("tidaleq-round");
	};
	unloads.add(restoreCover);

	// Per-bar buffers, rebuilt when the bar count or frequency range changes
	let key = "";
	let edges = new Float32Array(0);
	let eqDb = new Float32Array(0);
	let levels = new Float32Array(0);
	let target = new Float32Array(0);
	let state = new Float32Array(0);
	let shown = new Float32Array(0);
	let peaks = new Float32Array(0);
	let eqKey = "";

	const rebuild = (v: VizSettings, bands: number) => {
		const k = `${bands}|${v.minFreq}|${v.maxFreq}`;
		if (k === key) return;
		key = k;
		edges = bandEdges(bands, v.minFreq, v.maxFreq);
		[eqDb, levels, target, state, shown, peaks] = [0, 0, 0, 0, 0, 0].map(() => new Float32Array(bands));
		eqKey = "";
	};

	// What the equalizer adds at each band's centre, so the bars show what you hear (recomputed only when it changes,
	// checked a few times a second rather than every frame)
	let eqChecked = 0;
	const refreshEq = (now: number) => {
		if (now - eqChecked < 300 && eqKey) return;
		eqChecked = now;
		const k = settings.enabled ? JSON.stringify([settings.bands, settings.macros, settings.preamp, key]) : key;
		if (k === eqKey) return;
		eqKey = k;
		for (let b = 0; b < eqDb.length; b++) {
			const fc = Math.sqrt(edges[b] * edges[b + 1]);
			eqDb[b] = settings.enabled ? responseDb(settings, fc) + settings.preamp : 0;
		}
	};

	let last = performance.now();
	let lastPoll = 0;
	let lastPull = 0;
	let frame = 0;
	let running = true;
	unloads.add(() => (running = false));

	const loop = (now: number) => {
		if (!running) return;
		frame = requestAnimationFrame(loop);
		const v = vizSettings();
		if (v.fps > 0 && now - last < 1000 / v.fps - 2) return;
		const dt = Math.min(100, now - last);
		last = now;
		// Off: don't touch the page at all
		if (!v.enabled) {
			if (canvas.width) canvas.width = 0;
			restoreCover();
			return;
		}

		const img = document.querySelector<HTMLElement>(COVER);
		// The cover's flat box: layout size around its on-screen centre, so a 3D tilt or our beat scale doesn't inflate it
		const box = img?.getBoundingClientRect();
		const rect = box && new DOMRect(box.left + box.width / 2 - img!.offsetWidth / 2, box.top + box.height / 2 - img!.offsetHeight / 2, img!.offsetWidth, img!.offsetHeight);
		const visible = !!rect && rect.width > 40 && img!.checkVisibility?.({ opacityProperty: true, visibilityProperty: true }) !== false;
		if (!visible) {
			if (canvas.width) canvas.width = 0;
			restoreCover();
			return;
		}
		// The cover's own box (image, TIDAL's border and glare): it tilts with the mouse and we scale it with the bass.
		// The canvas lives inside it, so TIDAL moves, tilts and scales cover and bars as one piece.
		const coverBox = img!.parentElement?.closest("[class*=_artworkWrapper_]") ? img!.parentElement! : img!;
		if (coverBox !== cover) restoreCover(), (cover = coverBox);
		if (canvas.parentElement !== coverBox) {
			if (getComputedStyle(coverBox).position === "static") {
				coverBox.style.position = "relative";
				unloads.add(() => (coverBox.style.position = ""));
			}
			coverBox.appendChild(canvas); // last, so it sits above the image and the glare
		}
		coverBox.classList.toggle("tidaleq-round", v.roundCover);
		if (coverImageSrc(img) !== coverSrc) {
			coverSrc = coverImageSrc(img);
			const src = coverSrc;
			// Both lookups are async: only keep the answer if the cover hasn't changed again meanwhile
			albumColor().then((c) => src === coverSrc && (artColor = c)).catch(() => src === coverSrc && (artColor = null));
			pixels = null;
			pointsKey = "";
			coverPixels(src).then((p) => src === coverSrc && (pixels = p));
		}

		if (now - lastPoll > 100) (lastPoll = now), void pollTime();
		if (now - lastPull > 200) (lastPull = now), void pullPcm();

		const bands = Math.max(4, Math.round(v.bars / symmetry(v)));
		rebuild(v, bands);
		refreshEq(now);

		// Spectrum at the playing position → 0..1 per band
		const spec = analyze(pcm, pcmLength, position(v.syncOffset) * PCM_RATE);
		bandLevels(spec, edges, levels);
		for (let b = 0; b < bands; b++) {
			const fc = Math.sqrt(edges[b] * edges[b + 1]);
			const db = levels[b] + eqDb[b] + v.tilt * Math.log2(fc / 1000);
			target[b] = PlayState.playing
				? Math.min(1, Math.max(0, (db + v.sensitivity + v.range) / v.range))
				: preview
					? 0.25 + 0.35 * (1 - b / bands) * (0.6 + 0.4 * Math.sin(now / 180)) + 0.2 * Math.max(0, Math.sin(now / 260 + b * 0.55))
					: 0;
		}
		smoothBars(state, target, shown, dt, v);
		for (let b = 0; b < bands; b++) peaks[b] = Math.max(shown[b], peaks[b] - dt / 1500);
		if (v.style === "layers") {
			if (layerState.length !== v.layers * bands) layerState = new Float32Array(v.layers * bands);
			for (let k = 0; k < v.layers; k++) {
				const follow = 1 - Math.exp(-dt / (35 + k * 45)); // outer layers lag more
				for (let b = 0; b < bands; b++) layerState[k * bands + b] += (shown[b] - layerState[k * bands + b]) * follow;
			}
		}
		if (v.particles) updateParticles(dt, bands);
		else liveParticles = 0;

		draw(v, rect!, img!, bands, now);

		// The cover beats with the bass (first ~15% of the bands)
		if (v.pulse > 0) {
			let bass = 0;
			const n = Math.max(1, Math.round(bands * 0.15));
			for (let b = 0; b < n; b++) bass += shown[b];
			// The canvas is inside the scaled box, so the bars grow with the cover
			cover!.style.scale = String(1 + (bass / n) * v.pulse * 0.06);
		} else restoreCover();
	};

	const draw = (v: VizSettings, rect: DOMRect, img: HTMLElement, bands: number, now: number) => {
		// Room around the cover for the longest bar and its glow; a circle also reaches past the cover's corners
		// A round cover makes every outline a circle hugging it; a circle around a square cover goes round its corners
		const circular = v.shape === "circle" || v.roundCover;
		const coverRadius = v.roundCover ? Math.max(rect.width, rect.height) / 2 : Math.hypot(rect.width, rect.height) / 2;
		const corner = circular ? coverRadius - Math.max(rect.width, rect.height) / 2 : 0;
		const reach = v.style === "layers" ? v.length * layerScale(v.layers - 1) : v.length;
		const margin = Math.max(0, v.gap) + reach + v.glow * 2 + 8 + corner + (v.particles ? PARTICLE_RANGE : 0);
		const dpr = window.devicePixelRatio || 1;
		const W = Math.ceil(rect.width + margin * 2);
		const H = Math.ceil(rect.height + margin * 2);
		if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
			canvas.width = Math.round(W * dpr);
			canvas.height = Math.round(H * dpr);
			canvas.style.width = `${W}px`;
			canvas.style.height = `${H}px`;
		} else ctx.clearRect(0, 0, canvas.width, canvas.height);
		// Around the image, in the cover box's own coordinates: no copied transforms, nothing to drift
		canvas.style.left = `${img.offsetLeft - margin}px`;
		canvas.style.top = `${img.offsetTop - margin}px`;
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		// Stay clear of TIDAL's own UI: an open side panel (Lyrics, Credits, our tabs), the tab bar above and the player below
		const left = rect.left - margin;
		const top = rect.top - margin;
		// (looked up a few times a second, not every frame)
		if (now - uiAt > 250) {
			uiAt = now;
			ui = {
				panel: document.querySelector("[class*=_panelWrapperActive_]")?.getBoundingClientRect(),
				tabs: document.querySelector("[data-test=new-now-playing] [class*=_contentButtons_]")?.getBoundingClientRect(),
				player: document.querySelector("[data-test=footer-player]")?.getBoundingClientRect(),
			};
		}
		const { panel, tabs, player } = ui;
		const x1 = panel && panel.left > rect.right - 1 ? panel.left - 12 - left : W;
		const y0 = tabs?.height ? tabs.bottom + 4 - top : 0;
		const y1 = player?.height ? player.top - 4 - top : H;
		ctx.save();
		ctx.beginPath();
		ctx.rect(0, y0, x1, y1 - y0);
		ctx.clip();

		// The cover in canvas coordinates, grown by the gap
		const cx = W / 2;
		const cy = H / 2;
		const hw = rect.width / 2 + v.gap;
		const hh = rect.height / 2 + v.gap;
		const radius = coverRadius + v.gap;
		const n = bands * symmetry(v);
		const perimeter = circular ? 2 * Math.PI * radius : 4 * (hw + hh);
		const slot = perimeter / n;
		// Bar thickness follows the slot, capped so a low bar count doesn't turn into blobs
		const thick = Math.min(40, Math.max(1, slot * v.width));
		const turn = v.rotation / 360 + (v.spin * now) / 60000;

		// Point on the outline and its outward direction, for a fraction 0..1 starting at the bottom centre, clockwise on screen
		const legs: [number, number, number, number, number, number, number][] = [
			// length, start x, start y, step x, step y, normal x, normal y
			[hw, cx, cy + hh, -1, 0, 0, 1],
			[2 * hh, cx - hw, cy + hh, 0, -1, -1, 0],
			[2 * hw, cx - hw, cy - hh, 1, 0, 0, -1],
			[2 * hh, cx + hw, cy - hh, 0, 1, 1, 0],
			[hw, cx + hw, cy + hh, -1, 0, 0, 1],
		];
		const at = (f: number): [number, number, number, number] => {
			f = ((f % 1) + 1) % 1;
			if (circular) {
				const a = Math.PI / 2 + f * 2 * Math.PI;
				return [cx + Math.cos(a) * radius, cy + Math.sin(a) * radius, Math.cos(a), Math.sin(a)];
			}
			let s = f * perimeter;
			for (const [len, x, y, dx, dy, nx, ny] of legs) {
				if (s <= len) return [x + dx * s, y + dy * s, nx, ny];
				s -= len;
			}
			return [cx, cy + hh, 0, 1];
		};
		// Bar i of the ring → its band (mirrored: both halves count up from the bottom)
		// Bar i of the ring → its band. Mirrored, the bands count up and back down once per half (or per quarter four-way),
		// so the lows meet at the bottom (and top) and both sides match.
		const bandOf = (i: number) => {
			if (!v.mirror) return i;
			const j = i % (bands * 2);
			return j < bands ? j : bands * 2 - 1 - j;
		};
		const valueAt = (i: number) => shown[bandOf(i)];
		const peakAt = (i: number) => peaks[bandOf(i)];
		// Where a bar of `len` px starts and ends, depending on placement
		const span = (len: number): [number, number] =>
			v.placement === "outside" ? [0, len] : v.placement === "inside" ? [0, -len] : [-len / 2, len / 2];

		// Colors: one paint for the whole frame keeps it to a single draw call
		const art = artColor ?? v.color1;
		// Colors from points on the cover: picked automatically from each new cover, or the user's own points.
		// Worked out only when the cover, the mode or the points change, not every frame.
		const key = pixels ? `${coverSrc}|${v.autoColors}|${v.colorCount}` : "";
		if (key !== pointsKey || (!v.autoColors && v.colorPoints !== pointsSeen)) {
			pointsKey = key;
			pointsSeen = v.colorPoints;
			const points = !pixels ? [] : v.autoColors ? autoPoints(pixels, v.colorCount) : v.colorPoints ?? [];
			pointColors = pixels && points.length ? sampleColors(pixels, points) : [];
		}
		let paint: string | CanvasGradient = v.colorMode === "artwork" ? art : v.color1;
		if (v.colorMode === "gradient" || v.colorMode === "spectrum" || v.colorMode === "artwork") {
			const g = ctx.createConicGradient(Math.PI / 2 + turn * 2 * Math.PI, cx, cy);
			const stops =
				v.colorMode === "spectrum"
					? [0, 60, 120, 180, 240, 300, 360].map((h) => `hsl(${h},90%,60%)`)
					: v.colorMode === "artwork"
						? pointColors.length
							? // around the ring and back to the first; mirrored so both sides match
								v.mirror ? [...pointColors, ...pointColors.slice(0, -1).reverse()] : [...pointColors, pointColors[0]]
							: [art, v.color1, art]
						: [v.color1, v.color2, v.color1];
			if (stops.length < 2) stops.push(stops[0]); // a single color point
			stops.forEach((c, i) => g.addColorStop(i / (stops.length - 1), c));
			paint = g;
		}
		ctx.globalAlpha = v.opacity;
		ctx.shadowBlur = v.glow;
		// Glow in the lightest color in use: a dark glow just looks like a smudge
		const lightest = (cs: string[]) => cs.reduce((a, c) => (lum(c) > lum(a) ? c : a), cs[0]);
		ctx.shadowColor =
			v.colorMode === "solid" ? v.color1
			: v.colorMode === "gradient" ? lightest([v.color1, v.color2])
			: v.colorMode === "artwork" && pointColors.length ? lightest(pointColors)
			: v.colorMode === "spectrum" ? "rgba(255,255,255,0.6)"
			: art;
		ctx.strokeStyle = ctx.fillStyle = paint;
		ctx.lineCap = v.roundCaps ? "round" : "butt";
		ctx.lineJoin = "round";

		// Smooth closed curve through the tips of a ring of values, via midpoints
		const smoothRing = (value: (i: number) => number, scale: number, offset = 0) => {
			const pts: [number, number][] = [];
			for (let i = 0; i < n; i++) {
				const [x, y, nx, ny] = at(i / n + turn);
				const [, end] = span(2 + offset + value(i) * v.length * scale);
				pts.push([x + nx * end, y + ny * end]);
			}
			const mid = (a: [number, number], b: [number, number]) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] as const;
			const start = mid(pts[n - 1], pts[0]);
			const path = new Path2D();
			path.moveTo(start[0], start[1]);
			for (let i = 0; i < n; i++) {
				const m = mid(pts[i], pts[(i + 1) % n]);
				path.quadraticCurveTo(pts[i][0], pts[i][1], m[0], m[1]);
			}
			path.closePath();
			return path;
		};
		// The ring's base outline, to fill only around the cover and never over it (even-odd)
		const withOutline = (path: Path2D) => {
			const band = new Path2D(path);
			if (circular) band.moveTo(cx + radius, cy), band.arc(cx, cy, radius, 0, 2 * Math.PI);
			else band.rect(cx - hw, cy - hh, hw * 2, hh * 2);
			return band;
		};

		ctx.beginPath();
		if (v.style === "layers") {
			// Outermost first, each layer filled in its own color; only the outermost glows (a glow per layer is costly)
			const colors = layerColors(v, pointColors, art);
			for (let k = v.layers - 1; k >= 0; k--) {
				const off = k * bands;
				ctx.shadowBlur = k === v.layers - 1 ? v.glow : 0;
				ctx.shadowColor = colors[k];
				ctx.fillStyle = colors[k];
				// Steep curve so quiet parts stay low and the peaks stand out; a 2 px step keeps a thin rim of every color
				// Steep curve so quiet parts stay low and the peaks stand out. At rest only the thin white ring shows; the
				// colors peek out around it as the outer layers lag behind the music.
				ctx.fill(withOutline(smoothRing((i) => layerState[off + bandOf(i)] ** 2.4, layerScale(k))), "evenodd");
			}
		} else if (v.style === "wave") {
			const wave = smoothRing(valueAt, 1);
			const band = withOutline(wave);
			ctx.lineWidth = Math.max(1, thick * 0.5);
			ctx.globalAlpha = v.opacity * 0.35;
			ctx.fill(band, "evenodd");
			ctx.globalAlpha = v.opacity;
			ctx.stroke(wave);
		} else if (v.style === "dots") {
			for (let i = 0; i < n; i++) {
				const [x, y, nx, ny] = at((i + 0.5) / n + turn);
				const [, end] = span(2 + valueAt(i) * v.length);
				const r = thick / 2;
				ctx.moveTo(x + nx * end + r, y + ny * end);
				ctx.arc(x + nx * end, y + ny * end, r, 0, 2 * Math.PI);
			}
			ctx.fill();
		} else {
			for (let i = 0; i < n; i++) {
				const [x, y, nx, ny] = at((i + 0.5) / n + turn);
				if (valueAt(i) < 0.02) continue; // silent bars would only draw a dotted outline
				const [a, b] = span(1 + valueAt(i) * v.length);
				ctx.moveTo(x + nx * a, y + ny * a);
				ctx.lineTo(x + nx * b, y + ny * b);
			}
			ctx.lineWidth = thick;
			ctx.stroke();
		}

		if (v.peaks && (v.style === "bars" || v.style === "dots")) {
			ctx.beginPath();
			ctx.shadowBlur = 0;
			for (let i = 0; i < n; i++) {
				const [x, y, nx, ny] = at((i + 0.5) / n + turn);
				const [, end] = span(3 + peakAt(i) * v.length);
				ctx.moveTo(x + nx * end, y + ny * end);
				ctx.lineTo(x + nx * (end + 2 * Math.sign(end || 1)), y + ny * (end + 2 * Math.sign(end || 1)));
			}
			ctx.lineWidth = thick;
			ctx.stroke();
		}

		if (v.particles && liveParticles) {
			ctx.shadowBlur = 0;
			ctx.fillStyle = "#ffffff";
			const base = circular ? radius : Math.max(hw, hh);
			for (let p = 0; p < liveParticles; p++) {
				const o = p * 5;
				const r = base + particles[o + 1];
				ctx.globalAlpha = v.opacity * Math.max(0, 1 - particles[o + 4] / PARTICLE_LIFE);
				ctx.beginPath();
				ctx.arc(cx + Math.cos(particles[o]) * r, cy + Math.sin(particles[o]) * r, particles[o + 3], 0, 2 * Math.PI);
				ctx.fill();
			}
		}
		ctx.restore();
	};

	// Sparks: spawned around the ring, more on bass hits; they drift outward and fade
	const updateParticles = (dt: number, bands: number) => {
		const sec = dt / 1000;
		let bass = 0;
		const nb = Math.max(1, Math.round(bands * 0.15));
		for (let b = 0; b < nb; b++) bass += shown[b];
		bass /= nb;
		// Age and move; a dead one is replaced by the last live one, so the pool stays packed
		for (let p = 0; p < liveParticles; p++) {
			const o = p * 5;
			particles[o + 4] += sec;
			particles[o + 1] += particles[o + 2] * sec * (1 + bass * 2);
			if (particles[o + 4] >= PARTICLE_LIFE || particles[o + 1] > PARTICLE_RANGE) {
				liveParticles--;
				particles.copyWithin(o, liveParticles * 5, liveParticles * 5 + 5);
				p--;
			}
		}
		let spawn = (2 + bass * bass * 60) * sec;
		while (spawn > 0 && liveParticles < MAX_PARTICLES) {
			if (spawn < 1 && Math.random() > spawn) break;
			const o = liveParticles++ * 5;
			particles[o] = Math.random() * 2 * Math.PI;
			particles[o + 1] = Math.random() * 10;
			particles[o + 2] = 20 + Math.random() * 40;
			particles[o + 3] = 0.8 + Math.random() * 1.8;
			particles[o + 4] = 0;
			spawn--;
		}
	};

	frame = requestAnimationFrame(loop);
	unloads.add(() => cancelAnimationFrame(frame));
};
