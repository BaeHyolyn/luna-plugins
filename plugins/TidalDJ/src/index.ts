import { LunaPlugin, Tracer, type LunaUnload } from "@luna/core";
import { MediaItem, PlayState, redux, safeInterval, TidalApi } from "@luna/lib";

import { mixPoint, pickNext, type Grid } from "./pick";
import { settings } from "./Settings";

export const unloads = new Set<LunaUnload>();
export const { trace } = Tracer("[TidalDJ]");
export { Settings } from "./Settings";

// Never queue a song twice in a session, nor one TIDAL refused to play before
const played = new Set<string>(settings.blocked);
const recentArtists: string[] = []; // most recent first
const RECENT_ARTISTS = 8;
// Artists skipped early this session; shortcut: forgotten on restart, persist if users want it to stick
const skippedArtists = new Set<string>();
const SKIP_EARLY_S = 30;
redux.intercept("playbackControls/SKIP_NEXT", unloads, () => {
	const artistId = lastSeed?.tidalItem.artist?.id;
	if (artistId !== undefined && PlayState.currentTime < SKIP_EARLY_S) skippedArtists.add(String(artistId));
});
const taste = () => {
	const { artists, tracks } = redux.store.getState().favorites;
	return { favArtists: new Set<string>(artists.map(String)), favTracks: new Set<string>(tracks.map(String)), skippedArtists };
};

const queueNext = async (item: MediaItem) => {
	const { elements, currentIndex } = PlayState.playQueue;
	if (!settings.enabled || currentIndex < elements.length - 1) return; // the user's own queue comes first
	const radio = await TidalApi.fetch<{ items: redux.Track[] }>(`https://desktop.tidal.com/v1/tracks/${item.id}/radio?limit=50&${TidalApi.queryArgs()}`);
	const candidates = (radio?.items ?? []).map((t) => ({ id: t.id, artistId: t.artist?.id, bpm: t.bpm ?? undefined }));
	// TidalEQ's measured tempo when it's there: TIDAL's own is often missing
	const bpm = (await mixer()?.analyzeTrack(item.id).catch(() => null))?.bpm ?? (await item.bpm());
	const next = pickNext(candidates, settings.mode, played, recentArtists, bpm, taste());
	if (next === undefined) return trace.msg.warn("No new radio songs for this track, the queue will end here.");
	played.add(String(next.id));
	djQueued.add(String(next.id));
	// TIDAL's player only loads songs it already holds in its store; a bare radio id fails "not available in location"
	await MediaItem.fromId(next.id);
	PlayState.playNext(next.id);
};

/** Drops the songs queued after this one and lets the DJ pick from here. */
const djNow = () => {
	const { elements, currentIndex } = PlayState.playQueue;
	for (const e of elements.slice(currentIndex + 1)) redux.actions["playQueue/REMOVE_ELEMENT"]({ uid: e.uid });
	settings.enabled = true;
	// lastSeed is unset when the plugin loaded mid-song
	MediaItem.fromPlaybackContext()
		.then((item) => item && queueNext(item))
		.catch(trace.err.withContext("djNow"));
};

const djQueued = new Set<string>();
let lastSeed: MediaItem | undefined;
MediaItem.onMediaTransition(unloads, (item) => {
	lastSeed = item;
	played.add(String(item.id));
	const artistId = item.tidalItem.artist?.id;
	if (artistId !== undefined) {
		recentArtists.unshift(String(artistId));
		recentArtists.length = Math.min(recentArtists.length, RECENT_ARTISTS);
	}
	queueNext(item).catch(trace.err.withContext("queueNext"));
});

// Some radio songs look playable but TIDAL's player still refuses them (real region locks).
// Playback then stops at the end of the previous song: drop the refused pick and play another.
const STUCK_MS = 4000;
let stuckSince = 0;
safeInterval(
	unloads,
	() => {
		const { playbackState, desiredPlaybackState, mediaProduct } = redux.store.getState().playbackControls;
		const { elements, currentIndex } = PlayState.playQueue;
		const loaded = String(mediaProduct?.productId);
		const current = elements[currentIndex];
		// The refused pick is the next song, or already the current one when TIDAL moved the queue anyway
		const bad = elements.slice(currentIndex, currentIndex + 2).find((e) => djQueued.has(String(e.mediaItemId)) && String(e.mediaItemId) !== loaded);
		// A pick that loaded after a replacement but was left stopped just needs a play
		const idle = bad === undefined && djQueued.has(String(current?.mediaItemId)) && desiredPlaybackState === "PLAYING";
		// NOT_PLAYING is TIDAL giving up at the end of the queue; a user pause is PAUSED and is left alone
		if ((bad === undefined && !idle) || playbackState !== "NOT_PLAYING") return void (stuckSince = 0);
		if (stuckSince === 0) return void (stuckSince = Date.now());
		if (Date.now() - stuckSince < STUCK_MS || lastSeed === undefined) return;
		stuckSince = 0;
		if (bad === undefined) return PlayState.play();
		djQueued.delete(String(bad.mediaItemId));
		played.add(String(bad.mediaItemId));
		settings.blocked = [...settings.blocked, String(bad.mediaItemId)];
		redux.actions["playQueue/REMOVE_ELEMENT"]({ uid: bad.uid });
		trace.log(`Song ${bad.mediaItemId} would not play, picking another`);
		queueNext(lastSeed)
			.then(() => {
				PlayState.moveTo(PlayState.playQueue.currentIndex + 1);
				PlayState.play();
			})
			.catch(trace.err.withContext("replaceStuck"));
	},
	1000,
);


// Mixing is done by TidalEQ (it owns the audio): find its enabled copy, wherever it was installed from
type Mixer = { analyzeTrack: (id: MediaItem["id"]) => Promise<Grid | null>; mixInto: (id: MediaItem["id"]) => Promise<boolean> };
const mixer = () =>
	Object.values(LunaPlugin.plugins).find((p) => p.name === "TidalEQ" && p.enabled && typeof (p.exports as Partial<Mixer> | undefined)?.mixInto === "function")?.exports as Mixer | undefined;

const MIX_LEAD_S = 3; // mixInto needs a moment to cue the next song; it then waits for the bar line itself
let mixedFrom = ""; // one mix attempt per song
let busy = false;
safeInterval(
	unloads,
	async () => {
		const id = String(PlayState.playbackContext?.actualProductId ?? "");
		const { elements, currentIndex } = PlayState.playQueue;
		const next = elements[currentIndex + 1]?.mediaItemId;
		const eq = mixer();
		if (busy || !settings.enabled || !settings.mix || !PlayState.playing || !id || id === mixedFrom || next === undefined || !eq) return;
		busy = true;
		try {
			const grid = await eq.analyzeTrack(id); // cached by TidalEQ after the first call
			if (!grid || String(PlayState.playbackContext?.actualProductId) !== id) return;
			// Club needs the next song's tempo too (analysed ahead, cached for the mix itself)
			const nextBpm = settings.mode === "club" ? (await eq.analyzeTrack(next))?.bpm : undefined;
			if (String(PlayState.playbackContext?.actualProductId) !== id) return;
			const at = mixPoint(grid, settings.mode, nextBpm);
			const now = PlayState.currentTime;
			if (now < at - MIX_LEAD_S || now > grid.duration - 2) return;
			mixedFrom = id;
			if (!(await eq.mixInto(next))) trace.log("Could not mix, TIDAL moves on by itself");
		} finally {
			busy = false;
		}
	},
	500,
);

// "DJ now" next to the play queue button in TIDAL's player bar: TIDAL re-renders the bar, so put it back when it goes
const djButton = document.createElement("button");
djButton.type = "button";
djButton.className = "withBackground";
djButton.dataset.test = "tidaldj-now";
djButton.setAttribute("aria-label", "DJ now");
// A record: TIDAL's own icons are 24x24 strokes in currentColor
djButton.innerHTML = `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="2.2"/><path d="M12 5.5a6.5 6.5 0 0 1 6.5 6.5"/></svg>`;
djButton.addEventListener("click", djNow);
const placeButton = () => {
	const queue = document.querySelector('[data-test="play-queue-button"]');
	if (queue && djButton.nextElementSibling !== queue) queue.before(djButton);
	// On while the DJ is the one choosing: the next song is its pick, or it's about to pick one (queue ends here)
	const { elements, currentIndex } = PlayState.playQueue;
	const next = elements[currentIndex + 1];
	const on = settings.enabled && (next === undefined || djQueued.has(String(next.mediaItemId)));
	djButton.setAttribute("aria-pressed", String(on));
	// Same look as TIDAL's active sound-output button (inline: its class names are hashed per release)
	djButton.style.color = on ? "#fff" : "";
	djButton.style.background = on ? "rgba(255, 255, 255, 0.08)" : "";
	djButton.style.borderRadius = "50%";
	djButton.title = on ? `DJ on (${settings.mode}): it picks the next songs` : "DJ now: drop the queued songs and let the DJ pick from here";
};
placeButton();
safeInterval(unloads, placeButton, 1000);
unloads.add(() => djButton.remove());
