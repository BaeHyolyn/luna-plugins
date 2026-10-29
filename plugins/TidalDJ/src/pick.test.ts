import assert from "node:assert/strict";
import { mixPoint, pickNext } from "./pick";

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
assert.equal(pickNext(c, "club", new Set(), [], 125)?.id, 2); // picks like flow
// Club needs a beat-mixable tempo: 139 takes 70 (half) over 120, a favorite can't beat it either
const club = [{ id: 1, artistId: "x", bpm: 120 }, { id: 2, bpm: 70 }];
assert.equal(pickNext(club, "club", new Set(), [], 139, { favArtists: new Set(["x"]) })?.id, 2);
console.log("pick ok");
