import { PlayState, Quality, redux, type MediaItem } from "@luna/lib";


const qualityNames = new Map<Quality, string>([
	[Quality.HiRes, "Max"],
	[Quality.MQA, "Master"],
	[Quality.High, "HiFi"],
	[Quality.Low, "High"],
	[Quality.Lowest, "Low"],
]);

const fmtDuration = (seconds?: number) => {
	if (!seconds) return "";
	const s = Math.round(seconds);
	return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export const TAGS = ["track", "artist", "album", "year", "duration", "trackNumber", "quality", "lyric", "nextLyric", "nextLyric2", "playlist"] as const;
export type Vars = Record<(typeof TAGS)[number], string>;

// Everything comes from data TIDAL already has in memory, so building vars never hits the network.
export const getVars = (mediaItem: MediaItem, lyric = "", nextLyric = "", nextLyric2 = ""): Vars => {
	const item = mediaItem.tidalItem;
	const playing = Quality.fromAudioQuality(PlayState.playbackContext?.actualAudioQuality);
	const artists = item.artists?.length ? item.artists : item.artist ? [item.artist] : [];
	return {
		track: item.version ? `${item.title} (${item.version})` : item.title,
		artist: artists.map((a) => a.name).join(", ") || "Unknown Artist",
		album: item.album?.title ?? "",
		year: (item.releaseDate ?? item.album?.releaseDate ?? item.streamStartDate ?? "").slice(0, 4),
		duration: fmtDuration(item.duration),
		trackNumber: item.trackNumber?.toString() ?? "",
		quality: item.contentType === "track" ? (qualityNames.get(playing ?? mediaItem.bestQuality) ?? "") : "",
		lyric,
		nextLyric,
		nextLyric2,
		playlist: redux.store.getState().playQueue?.sourceName ?? "",
	};
};
