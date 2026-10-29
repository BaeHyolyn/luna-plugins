import { Artist, ContentBase, MediaItem, PlayState, redux } from "@luna/lib";
import type { SetActivity } from "@xhayper/discord-rpc";

import { setActivity, StatusDisplayTypeEnum } from "./discord.native";
import { errSignal, trace } from "./index";
import { settings } from "./Settings";
import { createLookup } from "./lookup";
import { createLyrics, position } from "./lyrics";
import { createRateLimiter } from "./rateLimit";
import { applyStyle } from "./styles";
import { getVars } from "./template";
import { clamp, fillOrFallback } from "./text";

// Used for a line whose lyric tags are all empty (videos, songs without lyrics, intro, end of song)
const FALLBACK = { status: "{track} by {artist}", details: "{track}", state: "{artist}", cover: "{album} · {quality}" };

// Proxy this so we dont try import a node native module
const StatusDisplayType = await StatusDisplayTypeEnum();

const DEBOUNCE_MS = 250;
// Discord accepts 5 activity updates per 20 seconds
const limiter = createRateLimiter(5, 20_000);
const ASSETS = "https://raw.githubusercontent.com/BaeHyolyn/luna-plugins/main/assets";
const PAUSED_ICON = `${ASSETS}/paused.png`;
const qualityBadge = (quality: string) => (quality ? `${ASSETS}/quality-${quality.toLowerCase()}.png` : undefined);
const tidal = (path: string) => `https://tidal.com/${path}/u`;

// Tracks played from playlists carry a trimmed artist without a picture, so it's looked up in the background.
const lookupArtistPicture = createLookup(
	(id: redux.ItemId) => Artist.fromId(id).then((full) => full?.coverUrl("320")),
	() => updateActivity(),
);
const artistPicture = (artist: { id: redux.ItemId; picture?: string | null }) =>
	artist.picture ? ContentBase.formatCoverUrl(artist.picture, { res: "320" }) : lookupArtistPicture(artist.id);

const currentLyric = createLyrics(
	() => updateActivity(),
	() => settings.lyricLeadMs,
);

let lyricTimer: ReturnType<typeof setTimeout> | undefined;
const usesLyrics = () =>
	[settings.customStatusText, settings.customDetailsText, settings.customStateText, settings.customCoverText].some((t) =>
		/\{(lyric|nextLyric|nextLyric2)\}/.test(t ?? ""),
	);

// Schedules the next refresh for when the next lyric line starts, throttled for Discord's rate limit.
const lyricFor = (mediaItem: MediaItem) => {
	clearTimeout(lyricTimer);
	if (!PlayState.playing || !usesLyrics()) return { text: "", nextText: "", next2Text: "" };
	// Lines are picked and sent slightly early to make up for Discord's delay; the rate limiter handles the rest
	const { text, nextText, next2Text, msUntilNext } = currentLyric(mediaItem);
	if (msUntilNext !== undefined) lyricTimer = setTimeout(refreshNow, Math.max(msUntilNext, 50));
	const style = (s: string) => applyStyle(s, settings.lyricStyle);
	return { text: style(text), nextText: style(nextText), next2Text: style(next2Text) };
};

export const buildActivity = (mediaItem: MediaItem): SetActivity => {
	const item = mediaItem.tidalItem;
	const lyric = lyricFor(mediaItem);
	const vars = getVars(mediaItem, lyric.text, lyric.nextText, lyric.next2Text);
	const { sourceUrl, sourceEntityId, sourceEntityType } = redux.store.getState().playQueue;
	const playlist = redux.store.getState().content?.playlists?.[sourceEntityId];
	const publicPlaylist = playlist?.publicPlaylist ?? playlist?.sharingLevel === "PUBLIC";

	const artist = item.artists?.[0] ?? item.artist;
	const artistUrl = artist ? tidal(`artist/${artist.id}`) : undefined;
	const albumUrl = item.album ? tidal(`album/${item.album.id}`) : undefined;
	const trackUrl = tidal(`${item.contentType}/${mediaItem.id}`);
	// Luna types tidalItem as a Track, but music videos come through here too
	const media = item as Readonly<redux.Track | redux.Video>;
	const isVideo = media.contentType === "video";

	const activity: SetActivity = {
		type: isVideo ? 3 : 2, // Watching : Listening
		statusDisplayType: StatusDisplayType.Name,
		name: fillOrFallback(settings.customStatusText, FALLBACK.status, vars),
		details: fillOrFallback(settings.customDetailsText, FALLBACK.details, vars) ?? clamp(vars.track),
		detailsUrl: trackUrl,
		state: fillOrFallback(settings.customStateText, FALLBACK.state, vars),
		stateUrl: artistUrl,
		buttons: [{ label: isVideo ? "Watch on TIDAL" : "Listen on TIDAL", url: trackUrl }],
	};

	// Discord allows at most 2 buttons; playlist takes priority over album
	if (sourceEntityType === "playlist" && publicPlaylist && settings.displayPlaylistButton) {
		activity.buttons!.push({ label: "View Playlist", url: `https://tidal.com/browse${sourceUrl}` });
	} else if (albumUrl && settings.displayAlbumButton) {
		activity.buttons!.push({ label: "View Album", url: albumUrl });
	}

	const videoThumb =
		media.contentType === "video" && media.imageId
			? `https://resources.tidal.com/images/${media.imageId.split("-").join("/")}/480x320.jpg`
			: undefined;
	const cover = videoThumb ?? ContentBase.getAlbumCoverUrl(item.album);
	if (cover) {
		activity.largeImageKey = cover;
		activity.largeImageText = fillOrFallback(settings.customCoverText, FALLBACK.cover, vars);
		activity.largeImageUrl = videoThumb ? trackUrl : albumUrl;
	}

	if (PlayState.playing) {
		if (settings.smallIcon === "artist" && artist) {
			const picture = artistPicture(artist);
			if (picture) {
				activity.smallImageKey = picture;
				activity.smallImageText = clamp(artist.name);
				activity.smallImageUrl = artistUrl;
			}
		} else if (settings.smallIcon === "quality") {
			activity.smallImageKey = qualityBadge(vars.quality);
			activity.smallImageText = vars.quality ? `${vars.quality} quality` : undefined;
		}
		if (settings.timeMode !== "none") {
			activity.startTimestamp = Date.now() - position() * 1000;
			// An end timestamp is what makes Discord draw the progress bar
			if (settings.timeMode === "bar" && item.duration) activity.endTimestamp = activity.startTimestamp + item.duration * 1000;
		}
	} else {
		activity.smallImageKey = PAUSED_ICON;
		activity.smallImageText = "Paused";
	}

	return activity;
};

const isHiddenArtist = (mediaItem: MediaItem) => {
	const hidden = settings.hiddenArtists
		.split(",")
		.map((name) => name.trim().toLowerCase())
		.filter(Boolean);
	if (hidden.length === 0) return false;
	const item = mediaItem.tidalItem;
	const artists = item.artists?.length ? item.artists : item.artist ? [item.artist] : [];
	return artists.some((a) => hidden.includes(a.name.toLowerCase()));
};

let timer: ReturnType<typeof setTimeout> | undefined;
let running: Promise<void> | undefined;
let lastSent: string | undefined;
let stopped = false;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const snapshot = async (mediaItem?: MediaItem) => {
	const visible = !settings.privateMode && (PlayState.playing || settings.displayOnPause);
	mediaItem ??= visible ? await MediaItem.fromPlaybackContext() : undefined;
	const activity = visible && mediaItem && !isHiddenArtist(mediaItem) ? buildActivity(mediaItem) : undefined;
	// Timestamps shift by a few ms between calls, so compare at 1s precision
	const key = JSON.stringify([settings.pipeId, activity], (k, v) => (k.endsWith("Timestamp") ? Math.round(v / 1000) : v));
	return { activity, key };
};

const push = async (mediaItem?: MediaItem) => {
	let { activity, key } = await snapshot(mediaItem);
	if (key === lastSent) return;

	const wait = limiter.delay();
	if (wait > 0) {
		await sleep(wait);
		if (stopped) return;
		// Rebuild from what's playing now so the lyric line and song are current, not from before the wait
		({ activity, key } = await snapshot());
		if (key === lastSent) return;
	}

	await setActivity(activity, settings.pipeId);
	limiter.record();
	lastSent = key;
};

const schedule = (mediaItem: MediaItem | undefined, delay: number) => {
	clearTimeout(timer);
	timer = setTimeout(async () => {
		await running;
		if (stopped) return;
		running = push(mediaItem)
			.then(() => (errSignal!._ = undefined))
			.catch((e) => {
				lastSent = undefined;
				trace.err.withContext("Failed to set activity")(e);
			});
	}, delay);
};

/** Debounced: bursts of playback events collapse into a single Discord update. */
export const updateActivity = (mediaItem?: MediaItem) => schedule(mediaItem, DEBOUNCE_MS);

// Lyric lines are timed already, so they skip the debounce
const refreshNow = () => schedule(undefined, 0);

export const stopPresence = () => {
	stopped = true;
	clearTimeout(timer);
	clearTimeout(lyricTimer);
};
