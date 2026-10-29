import { PlayState, type MediaItem } from "@luna/lib";
import { createLookup } from "./lookup";
import { lyricAt, parseLrc, planSends } from "./lrc";

// Plan lyric sends with 4 of Discord's 5 updates per 20s, leaving one for pause/seek/song changes
const PLAN_LIMIT = 4;
const PLAN_WINDOW_SEC = 20;

// playTime only changes on play/pause/seek; currentTime is the live player position.
export const position = () => PlayState.currentTime || PlayState.playTime;

/**
 * Returns a reader for the lyric line to show now. `leadMs` looks slightly ahead so a line
 * sent a bit early (to make up for Discord's delay) is already the upcoming one.
 * Lyrics are fetched from TIDAL once per track in the background.
 */
export const createLyrics = (onLoaded: () => void, leadMs: () => number) => {
	const getLyrics = createLookup(
		(mediaItem: MediaItem) =>
			mediaItem.lyrics().then((lyrics) => {
				const lines = lyrics?.subtitles ? parseLrc(lyrics.subtitles) : [];
				return lines.length > 0 ? { lines, plan: planSends(lines, PLAN_LIMIT, PLAN_WINDOW_SEC) } : undefined;
			}),
		onLoaded,
	);
	return (mediaItem: MediaItem) => {
		const lyrics = getLyrics(mediaItem);
		return lyrics ? lyricAt(lyrics.lines, position(), leadMs(), lyrics.plan) : { text: "", nextText: "", next2Text: "", msUntilNext: undefined };
	};
};
