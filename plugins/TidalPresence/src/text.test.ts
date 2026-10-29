import assert from "node:assert/strict";
import { clamp, fill, fillOrFallback } from "./text";

const vars = { track: "Matte Black", artist: "$uicideboy$", album: "Sing Me a Lullaby", lyric: "", nextLyric: "", nextLyric2: "" };
const withLyrics = { ...vars, lyric: "line one", nextLyric: "line two", nextLyric2: "" };

// fill
assert.equal(fill("{track} by {artist}", vars), "Matte Black by $uicideboy$");
assert.equal(fill("{unknown} stays", vars), "{unknown} stays");
assert.equal(fill("{lyric}", vars), undefined, "empty result means no line");
assert.equal(clamp("x"), "x ", "Discord needs at least 2 characters");
assert.equal(clamp("a".repeat(200))!.length, 127);

// No lyrics (video, song without lyrics, intro): fall back
assert.equal(fillOrFallback("{lyric}", "{track}", vars), "Matte Black");
assert.equal(fillOrFallback("{nextLyric2}", "{album}", vars), "Sing Me a Lullaby");

// Lyrics playing: keep the lyric line
assert.equal(fillOrFallback("{lyric}", "{track}", withLyrics), "line one");
assert.equal(fillOrFallback("♪ {lyric}", "{track}", withLyrics), "♪ line one");

// Last line of the song: the tag this field uses is empty, so it falls back
assert.equal(fillOrFallback("{nextLyric2}", "{album}", withLyrics), "Sing Me a Lullaby");

// Mixed text with an empty lyric tag still falls back instead of showing a dangling "♪"
assert.equal(fillOrFallback("♪ {lyric}", "{artist}", vars), "$uicideboy$");

// Templates without lyric tags are never replaced
assert.equal(fillOrFallback("{artist} · {album}", "{track}", vars), "$uicideboy$ · Sing Me a Lullaby");

// Dangling separators from empty tags are cleaned up
const video = { ...vars, album: "", quality: "" };
assert.equal(fill("{album} · {quality}", video), undefined, "nothing left, no line");
assert.equal(fill("{album} · {quality}", { ...vars, quality: "" }), "Sing Me a Lullaby");
assert.equal(fill("{track} · {album} · {year}", { ...vars, album: "", year: "2024" }), "Matte Black · 2024");
assert.equal(fill("{artist} - {album}", { ...vars, album: "" }), "$uicideboy$");
// Separators inside real values are kept
assert.equal(fill("{track}", { ...vars, track: "Re-Up | Live · 2024" }), "Re-Up | Live · 2024");
assert.equal(fill("{track} on TIDAL", vars), "Matte Black on TIDAL");

console.log("text: all tests passed");
