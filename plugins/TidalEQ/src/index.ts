import { Tracer, type LunaUnload } from "@luna/core";
import { ipcRenderer, MediaItem, PlayState, redux, safeInterval } from "@luna/lib";

import { buildChain } from "./eq";
import { addPanelTab, EqPanel } from "./NowPlayingTab";
import {
	getTime, isAlive, loadTrack, prepareTrack, seek, setChain, setPaused, setVolume, startAnalysis, startPlayer, stopAnalysis, stopPlayer, stopTrack,
	trackFailed,
} from "./player.native";
import { setEqChangeHandler, settings, vizSettings } from "./Settings";
import { COVER, resetPcm, setPositionSource, startVisualizer } from "./Visualizer";
import { VizPanel } from "./VizPanel";
import { PCM_RATE } from "./viz";

export const unloads = new Set<LunaUnload>();
export const { trace } = Tracer("[TidalEQ]");
export { Settings } from "./Settings";

const SYNC_MS = 250;
const MAX_DRIFT_S = 0.3; // resync mpv to TIDAL beyond this
const BACK_CONFIRM_MS = 700; // on a track change TIDAL drops to 0 ~300 ms before switching tracks; don't replay the old one
const MAX_HOLD_S = 2; // mpv ahead by less than this: wait for TIDAL instead of seeking back (which replays audio)
const SETTLE_S = 1.5; // after loading a track, give mpv time to buffer before judging drift

let running = false;
let loadedId: MediaItem["id"] | null = null;
let loadedAt = 0;
let lastPaused: boolean | null = null;
let lastVolume = -1;
let busy = false;
let holdUntil = 0;
let backSeekSince = 0;
let analyzedId: MediaItem["id"] | null = null; // track the visualizer has samples for
let tidalPlaysId: MediaItem["id"] | null = null; // a track mpv couldn't get: TIDAL plays it itself, no retry loop
let generation = 0; // bumps on every start/stop, so a slow start that was overtaken gives up
let starting: Promise<void> | null = null;

const tidalVolume = () => redux.store.getState().playbackControls.volume ?? 100;
// TIDAL reports its position only every ~300 ms; fill the gaps with elapsed time so mpv isn't judged against a stale value
let lastReported = { value: -1, at: 0 };
const tidalPosition = () => {
	// Live player position; playTime only updates on play/pause/seek
	const reported = PlayState.currentTime || PlayState.playTime;
	const now = performance.now();
	if (reported !== lastReported.value) lastReported = { value: reported, at: now };
	if (!PlayState.playing) return reported;
	return reported + Math.min(0.5, (now - lastReported.at) / 1000);
};

// TIDAL's own player keeps playing (so progress, queue and next track work as always), just silent
const setOriginalVolume = (volume: number) =>
	ipcRenderer.send("player.message", JSON.stringify({ command: "media.volume", volume }));

const sync = async () => {
	if (!running || busy || performance.now() < holdUntil) return;
	busy = true;
	try {
		// mpv crashed or was closed: hand the sound back to TIDAL instead of staying muted
		if (!(await isAlive())) {
			trace.msg.err("mpv stopped, so TIDAL is playing normally again. Turn the equalizer off and on to retry.");
			await stop();
			return;
		}
		const media = await MediaItem.fromPlaybackContext();
		if (media && media.id === tidalPlaysId) {
			setOriginalVolume(tidalVolume());
			return;
		}
		if (!media || media.contentType !== "track") {
			// mpv only does audio: let TIDAL play videos itself
			if (loadedId !== null) await stopTrack();
			loadedId = analyzedId = null;
			setOriginalVolume(tidalVolume());
			return;
		}
		setOriginalVolume(0);

		if (media.id !== loadedId) {
			const quality = PlayState.playbackContext?.actualAudioQuality;
			const info = await media.playbackInfo(quality).catch(() => undefined);
			if (!info) return letTidalPlay(media.id, "Couldn't get this track for the equalizer");
			await loadTrack(info, tidalPosition(), !PlayState.playing);
			loadedId = media.id;
			loadedAt = performance.now();
			backSeekSince = 0;
			lastPaused = !PlayState.playing;
			return;
		}

		// The download failed (offline, region...): let TIDAL play this track rather than leave it silent
		if (performance.now() - loadedAt > SETTLE_S * 1000 && (await trackFailed())) return letTidalPlay(media.id, "Couldn't load this track for the equalizer");

		// The visualizer decodes the track separately; (re)start it when turned on or after a track change
		// Only once the cover is on screen: no decoding for tracks nobody looks at. Once started it keeps going, so
		// closing and reopening the now-playing view doesn't decode the same track again.
		const wantAnalysis = vizSettings().enabled;
		if (wantAnalysis && analyzedId !== loadedId && coverShown()) {
			await startAnalysis(PCM_RATE, settings.mpvPath);
			resetPcm(true);
			analyzedId = loadedId;
		} else if (!wantAnalysis && analyzedId !== null) {
			await stopAnalysis();
			resetPcm(false);
			analyzedId = null;
		}

		const paused = !PlayState.playing;
		if (paused !== lastPaused) {
			await setPaused(paused);
			lastPaused = paused;
		}

		const volume = tidalVolume();
		if (volume !== lastVolume) {
			await setVolume(volume);
			lastVolume = volume;
		}

		if (!paused && performance.now() - loadedAt > SETTLE_S * 1000) {
			const mpvTime = await getTime();
			const tidalTime = tidalPosition();
			const ahead = mpvTime === null ? 0 : mpvTime - tidalTime;
			if (ahead > MAX_DRIFT_S && ahead < MAX_HOLD_S) {
				// Pause mpv for exactly the gap; the sync after the hold resumes it (lastPaused is reset)
				await setPaused(true);
				lastPaused = null;
				holdUntil = performance.now() + ahead * 1000;
			} else if (ahead >= MAX_HOLD_S) {
				// Big jump back: only once it has lasted, so a track change in progress doesn't restart the old track
				if (!backSeekSince) backSeekSince = performance.now();
				else if (performance.now() - backSeekSince > BACK_CONFIRM_MS) {
					backSeekSince = 0;
					await seek(tidalTime);
				}
				return;
			} else if (ahead < -MAX_DRIFT_S) await seek(tidalTime);
			backSeekSince = 0;
		}
	} catch (err) {
		trace.warn("sync failed", err);
	} finally {
		busy = false;
	}
};

/** This track plays through TIDAL's own player (no equalizer) until the next track. */
const letTidalPlay = async (id: MediaItem["id"], why: string) => {
	trace.msg.warn(`${why}: TIDAL plays it without the equalizer.`);
	tidalPlaysId = loadedId = id;
	analyzedId = null;
	await stopTrack().catch(() => {});
	setOriginalVolume(tidalVolume());
};

// One start at a time: EQ changes during a slow start would otherwise launch more mpv processes
/**
 * Equalizer off: TIDAL plays on its own and nothing is muted. If the visualizer is on, the track is only downloaded
 * and decoded for it, and the bars follow TIDAL's position.
 */
let vizOnlyId: MediaItem["id"] | null = null;
const coverShown = () => document.querySelector(COVER) !== null;
const syncVisualizerOnly = async () => {
	if (running || busy) return;
	busy = true;
	try {
		const media = vizSettings().enabled ? await MediaItem.fromPlaybackContext() : undefined;
		if (!media || media.contentType !== "track") {
			if (vizOnlyId !== null) {
				vizOnlyId = null;
				await stopAnalysis();
				resetPcm(false);
			}
			return;
		}
		// The download is only for the visualizer here, so wait until its cover is actually on screen
		if (media.id === vizOnlyId || !coverShown()) return;
		vizOnlyId = media.id;
		const info = await media.playbackInfo(PlayState.playbackContext?.actualAudioQuality).catch(() => undefined);
		if (!info || running) return;
		await prepareTrack(info);
		await startAnalysis(PCM_RATE, settings.mpvPath);
		resetPcm(true);
	} catch (err) {
		trace.warn("visualizer: could not prepare the track", err);
	} finally {
		busy = false;
	}
};

const start = () => (starting ??= doStart().finally(() => (starting = null)));
const doStart = async () => {
	if (!settings.enabled || running) return;
	const mine = ++generation;
	const error = await startPlayer(settings.mpvPath, buildChain(settings), tidalVolume());
	if (mine !== generation) return void (error || (await stopPlayer())); // stopped or unloaded meanwhile
	if (error) {
		trace.msg.err(`Could not start mpv, TIDAL keeps playing normally. Check the mpv path in TidalEQ settings. (${error})`);
		return;
	}
	running = true;
	vizOnlyId = null; // the player takes over the shared download from here
	loadedId = analyzedId = tidalPlaysId = null;
	lastPaused = null;
	lastVolume = -1;
	await sync();
};

const stop = async () => {
	generation++;
	running = false;
	loadedId = analyzedId = tidalPlaysId = null;
	await stopPlayer().catch(() => {});
	setOriginalVolume(tidalVolume());
};

// Dragging a band fires many changes per second; mpv rebuilds its filters on each one, so apply the last one only
const APPLY_DELAY_MS = 120;
let applyTimer: ReturnType<typeof setTimeout> | undefined;
setEqChangeHandler(() => {
	if (settings.enabled && !running) return void (starting ?? start());
	if (!settings.enabled && running) return void stop();
	clearTimeout(applyTimer);
	applyTimer = setTimeout(() => {
		if (running) setChain(buildChain(settings)).catch((err) => trace.warn("could not apply equalizer", err));
	}, APPLY_DELAY_MS);
});
unloads.add(() => clearTimeout(applyTimer));

// TIDAL re-sends its volume to its own player when the slider moves; mute it again right away
// (only while mpv is the one playing: not for videos or a track TIDAL plays itself)
redux.intercept("playbackControls/SET_VOLUME", unloads, () => {
	if (running && loadedId !== null && loadedId !== tidalPlaysId) setTimeout(() => setOriginalVolume(0), 50);
});

safeInterval(unloads, () => (running ? sync() : syncVisualizerOnly()), SYNC_MS);
// The visualizer follows mpv when it plays, otherwise TIDAL's own position
setPositionSource(async () => (running ? getTime() : tidalPosition()));
unloads.add(stop);
addPanelTab(unloads, "tidaleq", "Equalizer", EqPanel);
addPanelTab(unloads, "tidaleq-visualizer", "Visualizer", VizPanel);
startVisualizer(unloads);
start();
