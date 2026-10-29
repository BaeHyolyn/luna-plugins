import type { PlaybackInfo } from "@luna/lib";
import { fetchMediaItemStream } from "@luna/lib.native";
import { spawn, type ChildProcess } from "child_process";
import { clipboard } from "electron";
import { randomBytes } from "crypto";
import { closeSync, fstatSync, openSync, readdirSync, readSync, rmSync } from "fs";
import { createServer, type Server } from "http";
import { connect, type Socket } from "net";
import { tmpdir } from "os";
import { join } from "path";
import type { Readable } from "stream";

let mpv: ChildProcess | null = null;
let ipc: Socket | null = null;
let server: Server | null = null;
let port = 0;
let nextRequest = 1;
const pending = new Map<number, (reply: { error: string; data?: unknown }) => void>();
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
const clearStreams = () => {
	for (const t of streams.values()) t.source?.destroy();
	streams.clear();
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

const command = (...args: unknown[]) =>
	new Promise<unknown>((resolve, reject) => {
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

const connectIpc = async (pipe: string) => {
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
	ipc.on("close", () => (ipc = null));
};

/** False once mpv has exited or its connection dropped (crashed, killed by the user...). */
export const isAlive = () => mpv !== null && mpv.exitCode === null && ipc !== null;
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
		const pipe = `\\\\.\\pipe\\tidaleq-${process.pid}-${randomBytes(4).toString("hex")}`;
		mpv = spawn(
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
		const spawnError = new Promise<string>((resolve) => mpv!.once("error", (e) => resolve(String(e))));
		const ready = connectIpc(pipe).then(() => "");
		const result = await Promise.race([spawnError, ready]);
		if (result) await stopPlayer();
		return result;
	} catch (err) {
		await stopPlayer();
		return String(err);
	}
};

let currentUrl = "";

/** Serves a track on the local server (replacing the previous one) and returns its URL; nothing plays yet. */
export const prepareTrack = async (info: PlaybackInfo) => {
	await ensureServer();
	const token = randomBytes(16).toString("hex");
	clearStreams();
	streams.set(token, { info, chunks: [], received: 0, retained: true, done: false, failed: false, started: false, listeners: new Set() });
	currentUrl = `http://127.0.0.1:${port}/track/${token}`;
	stopDecoder();
	return currentUrl;
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
	await command("stop");
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
export const setChain = (chain: string) => command("set_property", "af", chain);

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
		if (ipc) await command("quit").catch(() => {});
	} finally {
		ipc?.destroy();
		ipc = null;
		mpv?.kill();
		mpv = null;
		server?.close();
		server = null;
		clearStreams();
		stopDecoder();
		pending.clear();
	}
};

// The page's clipboard API is blocked inside TIDAL; Electron's works
export const copyText = (text: string) => clipboard.writeText(text);
export const pasteText = () => clipboard.readText();
