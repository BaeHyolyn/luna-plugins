import assert from "node:assert/strict";
import { applyStyle } from "./styles";
import { clamp } from "./text";

assert.equal(applyStyle("Matte Black 2", "normal"), "Matte Black 2");
assert.equal(applyStyle("Matte Black 2", "bold"), "𝐌𝐚𝐭𝐭𝐞 𝐁𝐥𝐚𝐜𝐤 𝟐");
assert.equal(applyStyle("the night", "italic"), "𝑡ℎ𝑒 𝑛𝑖𝑔ℎ𝑡");
assert.equal(applyStyle("Matte Black", "smallCaps"), "Mᴀᴛᴛᴇ Bʟᴀᴄᴋ");

// Accents and ñ keep their marks on the styled letter
assert.equal(applyStyle("canción", "bold"), "𝐜𝐚𝐧𝐜𝐢𝐨́𝐧");
assert.equal(applyStyle("año", "bold"), "𝐚𝐧̃𝐨");
assert.equal(applyStyle("¿Qué?", "smallCaps"), "¿Qᴜᴇ́?");

// Punctuation, emoji and empty text are left alone
assert.equal(applyStyle("♪ ¡ok! 🎤", "bold"), "♪ ¡𝐨𝐤! 🎤");
assert.equal(applyStyle("", "bold"), "");

// Styled letters take 2 UTF-16 units; clamping must never cut one in half
// (the leading space shifts the cut onto an odd offset, which used to split a letter)
for (const prefix of ["", " "]) {
	const long = clamp(prefix + applyStyle("a".repeat(100), "bold"))!;
	assert.ok(long.length <= 127);
	assert.ok(!/[\uD800-\uDBFF]$/.test(long.slice(0, -3)), `no lone high surrogate before the ellipsis (prefix "${prefix}")`);
	assert.ok(long.endsWith("..."));
}

console.log("styles: all tests passed");
