import type { PlaybackInfo } from "@luna/lib";
import { fetchMediaItemStream } from "@luna/lib.native";
import { spawn, type ChildProcess } from "child_process";
import { clipboard } from "electron";
import { randomBytes } from "crypto";
import { closeSync, fstatSync, openSync, readdirSync, readFileSync, readSync, rmSync } from "fs";
import { createServer, type Server } from "http";
import { connect, type Socket } from "net";
import { tmpdir } from "os";
import { join } from "path";
import type { Readable } from "stream";

// Two decks (one mpv each) so the DJ can mix the next track in while the current one plays out
type Deck = { mpv: ChildProcess | null; ipc: Socket | null; pending: Map<number, (reply: { error: string; data?: unknown }) => void>; token: string };
const newDeck = (): Deck => ({ mpv: null, ipc: null, pending: new Map(), token: "" });
const decks = [newDeck(), newDeck()];
let active = 0;
const deck = () => decks[active];
const idle = () => decks[1 - active];
let server: Server | null = null;
let port = 0;
let nextRequest = 1;
// One track per load; the random token keeps other local programs from reading it.
// The player and the visualizer's decoder share one download: a request replays what arrived so far, then follows it live.
type Track = {
	info: PlaybackInfo;
	source?: Readable;
	chunks: Buffer[]; // kept for requests that come later (mpv re-opening, the decoder starting after the player)
	received: number;
	retained: boolean; // false once over RETAIN_LIMIT: later requests then download on their own
	done: boolean;
	failed: boolean;
	started: boolean;
	listeners: Set<(chunk: Buffer | null) => void>; // null = the download ended
};
// Above this, stop keeping the download in memory (a 2-hour hi-res mix would otherwise hold gigabytes)
const RETAIN_LIMIT = 400 * 1024 * 1024;
const streams = new Map<string, Track>();
const dropStream = (token: string) => {
	streams.get(token)?.source?.destroy();
	streams.delete(token);
};
/** Drops every download except the one a deck still needs. */
const clearStreams = (keep = "") => {
	for (const token of [...streams.keys()]) if (token !== keep) dropStream(token);
};
let mpvBinary = "";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// The local server is shared by the player and the visualizer's decoder, and starts with whichever needs it first
const ensureServer = async () => {
	if (!server) await startServer();
};

const startDownload = (track: Track) => {
	track.started = true;
	const finish = (failed: boolean) => {
		track.done = true;
		track.failed = failed;
		track.listeners.forEach((l) => l(null));
		track.listeners.clear();
	};
	fetchMediaItemStream(track.info)
		.then((source) => {
			track.source = source;
			source.on("data", (c: Buffer) => {
				track.received += c.length;
				if (track.retained) track.chunks.push(c);
				if (track.retained && track.received > RETAIN_LIMIT) {
					track.retained = false;
					track.chunks = []; // the listeners already have it all
				}
				track.listeners.forEach((l) => l(c));
			});
			source.on("end", () => finish(track.received === 0));
			source.on("error", () => finish(true));
		})
		.catch(() => finish(true));
};

const startServer = () =>
	new Promise<void>((resolve, reject) => {
		server = createServer(async (req, res) => {
			const track = streams.get((req.url ?? "").replace(/^\/track\//, ""));
			if (!track) return void res.writeHead(404).end();
			res.writeHead(200, { "Content-Type": "application/octet-stream" });

			// The shared copy was dropped (very long track): this request downloads on its own
			if (!track.retained) {
				fetchMediaItemStream(track.info)
					.then((source) => (source.pipe(res), res.on("close", () => source.destroy())))
					.catch(() => res.end());
				return;
			}

			if (!track.started) startDownload(track);
			// What arrived so far, then the rest as it comes (same tick, so nothing is missed in between)
			for (const c of track.chunks) res.write(c);
			if (track.done) return void res.end();
			const listener = (chunk: Buffer | null) => (chunk ? res.write(chunk) : res.end());
			track.listeners.add(listener);
			res.on("close", () => track.listeners.delete(listener));
		});
		server.on("error", reject);
		server.listen(0, "127.0.0.1", () => {
			port = (server!.address() as { port: number }).port;
			resolve();
		});
	});

const send = (d: Deck, ...args: unknown[]) =>
	new Promise<unknown>((resolve, reject) => {
		const { ipc, pending } = d;
		if (!ipc) return reject(new Error("mpv is not running"));
		const id = nextRequest++;
		const timer = setTimeout(() => {
			pending.delete(id);
			reject(new Error(`mpv did not answer: ${args[0]}`));
		}, 3000);
		pending.set(id, (reply) => {
			clearTimeout(timer);
			if (reply.error === "success") resolve(reply.data);
			else reject(new Error(`${args[0]}: ${reply.error}`));
		});
		ipc.write(JSON.stringify({ command: args, request_id: id }) + "\n");
	});
const command = (...args: unknown[]) => send(deck(), ...args);

const connectIpc = async (d: Deck, pipe: string) => {
	let ipc: Socket | null = null;
	for (let attempt = 0; attempt < 50; attempt++) {
		try {
			ipc = await new Promise<Socket>((resolve, reject) => {
				const s = connect(pipe, () => resolve(s));
				s.once("error", reject);
			});
			break;
		} catch {
			await sleep(100);
		}
	}
	if (!ipc) throw new Error("Could not connect to mpv");
	d.ipc = ipc;
	const { pending } = d;
	let buffer = "";
	ipc.on("data", (chunk) => {
		buffer += chunk.toString();
		let nl;
		while ((nl = buffer.indexOf("\n")) >= 0) {
			const line = buffer.slice(0, nl);
			buffer = buffer.slice(nl + 1);
			try {
				const msg = JSON.parse(line);
				if (typeof msg.request_id === "number") pending.get(msg.request_id)?.(msg);
				pending.delete(msg.request_id);
			} catch {
				// mpv only sends JSON lines; ignore anything partial
			}
		}
	});
	ipc.on("close", () => (d.ipc = null));
};

/** False once mpv has exited or its connection dropped (crashed, killed by the user...). */
export const isAlive = () => decks.every((d) => d.mpv !== null && d.mpv.exitCode === null && d.ipc !== null);
/** True when the current track's download failed: the renderer then lets TIDAL play it. */
export const trackFailed = () => [...streams.values()].some((t) => t.failed);

// Temp files of a TIDAL session that crashed before cleaning up
const removeStaleTempFiles = () => {
	try {
		for (const f of readdirSync(tmpdir())) if (/^tidaleq-[0-9a-f]{16}\.pcm$/.test(f)) rmSync(join(tmpdir(), f), { force: true });
	} catch {
		// in use or not allowed: harmless
	}
};

/** Starts mpv (idle, no window) with the equalizer chain. Returns an error message, or "" when ready. */
export const startPlayer = async (mpvPath: string, chain: string, volume: number): Promise<string> => {
	await stopPlayer();
	removeStaleTempFiles();
	mpvBinary = mpvPath;
	try {
		await ensureServer();
		for (const d of decks) {
			const error = await spawnDeck(d, mpvPath, chain, volume);
			if (error) {
				await stopPlayer();
				return error;
			}
		}
		return "";
	} catch (err) {
		await stopPlayer();
		return String(err);
	}
};

const spawnDeck = async (d: Deck, mpvPath: string, chain: string, volume: number) => {
	const pipe = `\\\\.\\pipe\\tidaleq-${randomBytes(6).toString("hex")}`;
	const proc = spawn(
		mpvPath,
		[
			"--idle=yes",
			"--no-video",
			"--no-terminal",
			"--no-config",
			"--load-scripts=no",
			"--ytdl=no",
			"--audio-display=no",
			"--cache=yes",
			"--demuxer-max-bytes=300MiB",
			"--demuxer-max-back-bytes=300MiB",
			`--volume=${Math.round(volume)}`,
			`--input-ipc-server=${pipe}`,
			...(chain ? [`--af=${chain}`] : []),
		],
		{ windowsHide: true, stdio: "ignore" },
	);
	d.mpv = proc;
	const spawnError = new Promise<string>((resolve) => proc.once("error", (e) => resolve(String(e))));
	return Promise.race([spawnError, connectIpc(d, pipe).then(() => "")]);
};

let currentUrl = "";

/** Serves a track on the local server (replacing the previous one) and returns its URL; nothing plays yet. */
export const prepareTrack = async (info: PlaybackInfo) => {
	await ensureServer();
	clearStreams(idle().token);
	deck().token = serve(info);
	currentUrl = urlOf(deck().token);
	stopDecoder();
	return currentUrl;
};

const serve = (info: PlaybackInfo) => {
	const token = randomBytes(16).toString("hex");
	streams.set(token, { info, chunks: [], received: 0, retained: true, done: false, failed: false, started: false, listeners: new Set() });
	return token;
};
const urlOf = (token: string) => `http://127.0.0.1:${port}/track/${token}`;

// Bass swap: a labelled low shelf on each deck during a beat mix, so only one deck carries the bass at a time
const BASS = "@djbass";
const BASS_CUT = -12; // enough to stop two kicks booming; deeper made the incoming song sound like it had no EQ

/**
 * Loads a track on the idle deck, silent and paused at `startAt`; true once it can start right away.
 * `speed` matches its tempo to the playing track (pitch kept); `bassCut` starts it with the bass off for a bass swap.
 */
export const cueTrack = async (info: PlaybackInfo, startAt: number, speed = 1, bassCut = false) => {
	await ensureServer();
	const d = idle();
	if (d.token) dropStream(d.token);
	d.token = serve(info);
	await send(d, "set_property", "pause", true);
	await send(d, "set_property", "volume", 0);
	await send(d, "set_property", "speed", speed);
	await send(d, "af", "remove", BASS).catch(() => {});
	if (bassCut) await send(d, "af", "add", `${BASS}:lavfi=[bass=g=${BASS_CUT}:f=150:t=q:w=0.7]`);
	await send(d, "loadfile", urlOf(d.token), "replace", -1, `start=${Math.max(0, startAt).toFixed(2)}`);
	for (let i = 0; i < 100; i++) {
		const [pos, waiting] = await Promise.all([
			send(d, "get_property", "time-pos").catch(() => null),
			send(d, "get_property", "paused-for-cache").catch(() => true),
		]);
		// The local stream can't seek before the download reaches that point, so `start=` may be dropped: seek again
		if (typeof pos === "number" && pos < startAt - 0.5) await send(d, "seek", startAt, "absolute+exact").catch(() => {});
		else if (typeof pos === "number" && waiting === false) return true;
		if (streams.get(d.token)?.failed) break;
		await sleep(100);
	}
	return false;
};

/**
 * Crossfades from the playing deck into the cued one over `seconds` (equal power, so loudness doesn't dip),
 * then the cued deck becomes the playing one. `volume` is the user's volume on mpv's 0-100 scale.
 */
// Live controls for a running mix (the renderer can't pass callbacks over IPC): TIDAL's volume and pause
let mixVolume = 0;
let mixHeld = false;
export const mixControl = async (volume: number, paused: boolean) => {
	mixVolume = volume;
	mixHeld = paused;
};
export const startMix = async (seconds: number, volume: number, bassSwap = false) => {
	mixVolume = volume;
	mixHeld = false;
	const from = deck();
	const to = idle();
	if (bassSwap) await send(from, "af", "add", `${BASS}:lavfi=[bass=g=0:f=150:t=q:w=0.7]`).catch(() => (bassSwap = false));
	let swapped = !bassSwap;
	// mpv's volume is cubic (amplitude = (v/100)^3), so a gain g needs v = volume * cbrt(g)
	// Read live so a mute or slider move mid-mix sticks
	const level = (gain: number) => mixVolume * Math.cbrt(Math.max(0, gain));
	await send(to, "set_property", "pause", false);
	let start = Date.now();
	for (let x = 0; x < 1; ) {
		// Paused in TIDAL: hold both decks and the fade where they are
		if (mixHeld) {
			const at = Date.now();
			await Promise.all([send(from, "set_property", "pause", true), send(to, "set_property", "pause", true)]);
			while (mixHeld) await sleep(100);
			await Promise.all([send(from, "set_property", "pause", false), send(to, "set_property", "pause", false)]);
			start += Date.now() - at;
		}
		x = Math.min(1, (Date.now() - start) / (seconds * 1000));
		await Promise.all([
			send(from, "set_property", "volume", level(Math.cos((x * Math.PI) / 2))),
			send(to, "set_property", "volume", level(Math.sin((x * Math.PI) / 2))),
		]);
		// A quarter in (before the incoming song is loud), it takes the bass in one go (two kicks at once would boom)
		if (!swapped && x >= 0.25) {
			swapped = true;
			await Promise.all([send(from, "af-command", BASS, "g", String(BASS_CUT)), send(to, "af-command", BASS, "g", "0")]).catch(() => {});
		}
		if (x < 1) await sleep(40);
	}
	await send(from, "stop").catch(() => {});
	await send(from, "af", "remove", BASS).catch(() => {}); // the incoming one keeps it at 0 dB: removing it would click
	dropStream(from.token);
	from.token = "";
	active = 1 - active;
	currentUrl = urlOf(to.token);
	stopDecoder();
};

/** After a beat mix: eases the matched tempo back to the track's own over ~8 s. */
export const easeSpeed = async () => {
	const to = deck();
	const speed = Number(await send(to, "get_property", "speed").catch(() => 1));
	for (let i = 1; i <= 40 && speed !== 1; i++) {
		await send(to, "set_property", "speed", speed + ((1 - speed) * i) / 40).catch(() => {});
		await sleep(200);
	}
};

export const loadTrack = async (info: PlaybackInfo, startAt: number, paused: boolean) => {
	const url = await prepareTrack(info);
	await command("set_property", "pause", paused);
	await command("loadfile", url, "replace", -1, `start=${Math.max(0, startAt).toFixed(2)}`);
};

/**
 * Decodes the current track (loaded or just prepared) to mono float samples at `rate` for the visualizer (see readPcm).
 * Works without the player running: the visualizer can be on while the equalizer is off.
 */
export const startAnalysis = (rate: number, mpvPath: string) => {
	if (mpvPath) mpvBinary = mpvPath;
	stopDecoder();
	if (currentUrl && streams.size) startDecoder(currentUrl, rate);
};
export const stopAnalysis = () => stopDecoder();

export const stopTrack = async () => {
	clearStreams();
	currentUrl = "";
	stopDecoder();
	for (const d of decks) d.token = "";
	await Promise.all(decks.map((d) => send(d, "stop")));
};

// A second, silent mpv decodes the track much faster than real time into a temp file the visualizer reads as it grows
let decoder: ChildProcess | null = null;
let pcmFile: string | null = null;
let decoderDone = false;

const startDecoder = (url: string, rate: number) => {
	const file = join(tmpdir(), `tidaleq-${randomBytes(8).toString("hex")}.pcm`); // process.pid is undefined in Luna's sandbox
	pcmFile = file;
	decoderDone = false;
	const proc = spawn(
		mpvBinary,
		["--no-config", "--load-scripts=no", "--ytdl=no", "--no-video", "--no-terminal", "--audio-display=no", "--ao=pcm", `--ao-pcm-file=${file}`, "--ao-pcm-waveheader=no",
			"--audio-format=float", "--audio-channels=mono", `--audio-samplerate=${Math.round(rate)}`, url],
		{ windowsHide: true, stdio: "ignore" },
	);
	decoder = proc;
	proc.on("exit", () => {
		if (decoder === proc) decoderDone = true;
		else rmSync(file, { force: true });
	});
	proc.on("error", () => decoder === proc && (decoderDone = true));
};

const stopDecoder = () => {
	const file = pcmFile;
	const proc = decoder;
	decoder = null;
	pcmFile = null;
	if (proc && proc.exitCode === null) proc.kill(); // its exit handler deletes the file once it's closed
	else if (file) rmSync(file, { force: true });
};

/**
 * Decodes a whole track (mono float32 LE at `rate`) for beat analysis, apart from the decks and the visualizer.
 * Null if it fails, or if a track change drops its download first.
 */
export const decodeTrack = async (info: PlaybackInfo, rate: number, mpvPath: string): Promise<Uint8Array | null> => {
	if (mpvPath) mpvBinary = mpvPath;
	await ensureServer();
	const token = serve(info);
	const file = join(tmpdir(), `tidaleq-${randomBytes(8).toString("hex")}.pcm`);
	try {
		const ok = await new Promise<boolean>((resolve) => {
			const proc = spawn(
				mpvBinary,
				["--no-config", "--load-scripts=no", "--ytdl=no", "--no-video", "--no-terminal", "--audio-display=no", "--ao=pcm", `--ao-pcm-file=${file}`, "--ao-pcm-waveheader=no",
					"--audio-format=float", "--audio-channels=mono", `--audio-samplerate=${Math.round(rate)}`, urlOf(token)],
				{ windowsHide: true, stdio: "ignore" },
			);
			proc.on("exit", (code) => resolve(code === 0));
			proc.on("error", () => resolve(false));
		});
		return ok && streams.has(token) && !streams.get(token)?.failed ? readFileSync(file) : null;
	} catch {
		return null;
	} finally {
		dropStream(token);
		rmSync(file, { force: true });
	}
};

/** Decoded samples (float32 LE) from byte `offset`; `done` once the whole track has been read. */
export const readPcm = (offset: number, maxBytes = 1 << 22): { data: Uint8Array | null; done: boolean } => {
	if (!pcmFile) return { data: null, done: true };
	const finished = decoderDone;
	let fd: number;
	try {
		fd = openSync(pcmFile, "r");
	} catch {
		return { data: null, done: finished };
	}
	try {
		// Only what's there: this runs several times a second and usually finds nothing new
		const available = Math.min(maxBytes, Math.max(0, fstatSync(fd).size - offset));
		if (!available) return { data: null, done: finished };
		const buf = Buffer.allocUnsafe(available);
		const n = readSync(fd, buf, 0, available, offset);
		return { data: n ? buf.subarray(0, n) : null, done: finished && n < maxBytes };
	} finally {
		closeSync(fd);
	}
};

export const setPaused = (paused: boolean) => command("set_property", "pause", paused);
export const seek = (seconds: number) => command("seek", Math.max(0, seconds), "absolute+exact");
export const setVolume = (volume: number) => command("set_property", "volume", Math.max(0, Math.min(100, volume)));
export const setChain = (chain: string) => Promise.all(decks.map((d) => send(d, "set_property", "af", chain)));

/** mpv's playback position in seconds, or null while nothing is loaded. */
export const getTime = async (): Promise<number | null> => {
	try {
		const t = await command("get_property", "time-pos");
		return typeof t === "number" ? t : null;
	} catch {
		return null;
	}
};

export const stopPlayer = async () => {
	try {
		await Promise.all(decks.map((d) => d.ipc && send(d, "quit").catch(() => {})));
	} finally {
		for (const d of decks) {
			d.ipc?.destroy();
			d.mpv?.kill();
			d.pending.clear();
			Object.assign(d, { mpv: null, ipc: null, token: "" });
		}
		active = 0;
		server?.close();
		server = null;
		clearStreams();
		stopDecoder();
	}
};

// The page's clipboard API is blocked inside TIDAL; Electron's works
export const copyText = (text: string) => clipboard.writeText(text);
export const pasteText = () => clipboard.readText();
