import assert from "node:assert/strict";
import { mixable, mixPoint, pickNext } from "./pick";

const c = [
	{ id: 1, artistId: "a", bpm: 90 },
	{ id: 2, artistId: "b", bpm: 128 },
	{ id: 3, artistId: "c", bpm: 100 },
];
assert.equal(pickNext(c, "party", new Set(), [])?.id, 2);
assert.equal(pickNext(c, "chill", new Set(), [])?.id, 1);
assert.equal(pickNext(c, "flow", new Set(), [], 125)?.id, 2);
assert.equal(pickNext(c, "flow", new Set(), [], 95)?.id, 1); // tie within spread: radio order wins
assert.equal(pickNext(c, "discover", new Set(), ["a"])?.id, 2);
assert.equal(pickNext(c, "chill", new Set(["1"]), [])?.id, 3);
assert.equal(pickNext(c, "flow", new Set(["1", "2", "3"]), []), undefined);

// 172 is felt as 86: not a party song, and close to a 90 BPM one
const half = [{ id: 1, bpm: 172 }, { id: 2, bpm: 125 }];
assert.equal(pickNext(half, "party", new Set(), [])?.id, 2);
assert.equal(pickNext(half, "flow", new Set(), [], 90)?.id, 1);

// Favorites pull a song up, a skipped artist pushes it down
assert.equal(pickNext(c, "flow", new Set(), [], undefined, { favArtists: new Set(["c"]) })?.id, 3);
assert.equal(pickNext(c, "flow", new Set(), [], undefined, { favTracks: new Set(["2"]) })?.id, 2);
assert.equal(pickNext(c, "chill", new Set(), [], undefined, { skippedArtists: new Set(["a"]) })?.id, 3);
// Mix over the outro, but never with less than 16 bars left; Club leaves after the main part shows
const g = { bpm: 120, introEnd: 16, outroStart: 200, duration: 240 }; // 2 s bars
assert.equal(mixPoint(g, "flow"), 200);
assert.equal(mixPoint({ ...g, outroStart: 235 }, "flow"), 208);
assert.equal(mixPoint(g, "club", 122), 144); // 60% of 240 s
assert.equal(mixPoint({ ...g, introEnd: 90 }, "club", 61), 154); // 32 bars past a long intro; half time still beat-mixes
assert.equal(mixPoint(g, "club", 100), 200); // clashing tempo: wait for the outro
assert.equal(mixPoint(g, "club"), 200);
assert.equal(mixPoint({ ...g, outroStart: 235 }, "flow", undefined, 32), 176); // a 32-bar mix starts earlier
assert.equal(pickNext(c, "club", new Set(), [], 125)?.id, 2); // picks like flow
// Club needs a beat-mixable tempo: 139 takes 70 (half) over 120, a favorite can't beat it either
const club = [{ id: 1, artistId: "x", bpm: 120 }, { id: 2, bpm: 70 }];
assert.equal(pickNext(club, "club", new Set(), [], 139, { favArtists: new Set(["x"]) })?.id, 2);
// Edge cases: empty/blocked/missing data never throws, mix point stays inside the song
assert.equal(pickNext([], "club", new Set(), [], 120), undefined); // no candidates
assert.equal(pickNext([{ id: 1 }], "flow", new Set(["1"]), []), undefined); // all played
assert.equal(pickNext([{ id: 1 }, { id: 2 }], "club", new Set(), [])?.id, 1); // no bpm anywhere: radio order
assert.equal(pickNext([{ id: 1 }, { id: 2, bpm: 120 }], "club", new Set(), [], 120)?.id, 2); // missing bpm loses in club
assert.equal(pickNext([{ id: 1, bpm: 100 }, { id: 2, bpm: 120 }], "flow", new Set(), [], NaN)?.id, 1); // NaN current bpm: no crash
assert.equal(pickNext([{ id: 1, artistId: "a" }], "discover", new Set(), ["a"], undefined, { skippedArtists: new Set(["a"]) })?.id, 1); // all penalized still picks
assert.equal(mixable(NaN, 120), false);
assert.equal(mixable(120, 0), false);
const inSong = (t: number, d: number) => Number.isFinite(t) && t >= 0 && t <= d;
for (const mode of ["flow", "club", "chill"] as const)
	for (const gg of [g, { ...g, duration: 10 }, { ...g, outroStart: 0 }, { ...g, bpm: 0 }, { ...g, bpm: -120 }, { ...g, bpm: 1e9 }, { ...g, introEnd: 999 }])
		assert.ok(inSong(mixPoint(gg, mode, 122), gg.duration), `${mode} ${JSON.stringify(gg)}`);
assert.equal(mixPoint({ ...g, duration: 10 }, "flow"), 5); // shorter than 16 bars: never before half the song
assert.equal(mixPoint(g, "club", 80), 200); // clashing next tempo: no mid-song cut
assert.equal(mixPoint(g, "club", NaN), 200);

console.log("pick ok");
