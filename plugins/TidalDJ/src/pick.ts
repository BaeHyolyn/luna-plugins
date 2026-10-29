export type Mode = "flow" | "chill" | "party" | "discover" | "club";
export type Candidate = { id: number | string; artistId?: number | string; bpm?: number };
/** What the user likes (favorites) and dislikes (artists skipped this session). */
export type Taste = { favArtists?: Set<string>; favTracks?: Set<string>; skippedArtists?: Set<string> };

// BPM range each mood accepts; "flow" stays close to the current song instead
const RANGE: Partial<Record<Mode, [number, number]>> = { chill: [0, 105], party: [118, 999] };
const FLOW_SPREAD = 12;
// TIDAL often counts half-time genres (reggaeton, trap) double: 172 that feels like 86.
// shortcut: also halves real 150+ BPM music (drum & bass), fine until someone wants it in Party
const feltBpm = (bpm?: number) => (bpm !== undefined && bpm > 150 ? bpm / 2 : bpm);

// TidalEQ beat-mixes only within ±8% (half/double tempo counts): Club cuts mid-song, so a fade there sounds wrong
const MIX_STRETCH = 0.08;
export const mixable = (a: number, b: number) => [1, 2, 0.5].some((m) => Math.abs((a * m) / b - 1) <= MIX_STRETCH);

/** Best next track from the radio candidates, or undefined when none is new. */
export const pickNext = (candidates: Candidate[], mode: Mode, played: Set<string>, recentArtists: string[], currentBpm?: number, taste: Taste = {}) => {
	const rawBpm = currentBpm;
	currentBpm = feltBpm(currentBpm);
	const fresh = candidates.filter((c) => !played.has(String(c.id)));
	const score = (c: Candidate) => {
		let s = 0;
		const artistAgo = c.artistId === undefined ? -1 : recentArtists.indexOf(String(c.artistId));
		if (artistAgo !== -1) s -= mode === "discover" ? 100 : 10 - artistAgo; // a repeat hurts more the more recent it was
		const artist = String(c.artistId);
		if (taste.favArtists?.has(artist)) s += 5;
		if (taste.favTracks?.has(String(c.id))) s += 3;
		if (taste.skippedArtists?.has(artist)) s -= 15;
		const range = RANGE[mode];
		const bpm = feltBpm(c.bpm);
		if (mode === "club" && rawBpm !== undefined && (c.bpm === undefined || !mixable(c.bpm, rawBpm))) s -= 30;
		if (bpm !== undefined) {
			if (range) s -= bpm < range[0] ? range[0] - bpm : bpm > range[1] ? bpm - range[1] : 0;
			else if (currentBpm !== undefined) {
				// Club matches beats, not feel: 70 under 139 lines up as double time
				const raw = c.bpm!;
				const gap = mode === "club" && rawBpm !== undefined ? Math.min(...[1, 2, 0.5].map((m) => Math.abs(raw * m - rawBpm))) : Math.abs(bpm - currentBpm);
				s -= Math.max(0, gap - FLOW_SPREAD);
			}
		}
		return s;
	};
	// Stable: radio order (TIDAL's own relevance) breaks ties
	return fresh.map((c, i) => ({ c, s: score(c), i })).sort((a, b) => b.s - a.s || a.i - b.i)[0]?.c;
};


/** TidalEQ's beat grid of a track (see its analyzeTrack). */
export type Grid = { bpm: number; introEnd: number; outroStart: number; duration: number };
const MIX_BARS = 16;
const CLUB_SHARE = 0.6; // Club leaves after this much of the song: earlier felt rushed (user, live test)
const CLUB_MAIN_BARS = 32; // and never before 32 bars past the intro

/** Position (s) in the playing song where its mix into the next one (at `nextBpm`) should start. */
export const mixPoint = (g: Grid, mode: Mode, nextBpm?: number) => {
	const bar = 240 / g.bpm;
	const end = Math.max(0, Math.min(g.outroStart, g.duration - MIX_BARS * bar)); // over its outro, never squeezed at the very end
	// Club: leave once the song has shown its main part, like a DJ cutting a track short
	// Only when the next song beat-mixes: a mid-song fade between clashing tempos sounds like a mistake
	return mode === "club" && nextBpm !== undefined && mixable(g.bpm, nextBpm) ? Math.min(end, Math.max(g.duration * CLUB_SHARE, g.introEnd + CLUB_MAIN_BARS * bar)) : end;
};
