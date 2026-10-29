export type LyricStyle = "normal" | "bold" | "italic" | "smallCaps";

const SMALL_CAPS = "ᴀʙᴄᴅᴇꜰɢʜɪᴊᴋʟᴍɴᴏᴘǫʀꜱᴛᴜᴠᴡxʏᴢ";

// Offsets into Unicode's Mathematical Alphanumeric Symbols block
const mathLetter = (ch: string, upperStart: number, lowerStart: number, digitStart?: number) => {
	const c = ch.charCodeAt(0);
	if (c >= 65 && c <= 90) return String.fromCodePoint(upperStart + c - 65);
	if (c >= 97 && c <= 122) return String.fromCodePoint(lowerStart + c - 97);
	if (digitStart !== undefined && c >= 48 && c <= 57) return String.fromCodePoint(digitStart + c - 48);
	return ch;
};

const styleChar: Record<Exclude<LyricStyle, "normal">, (ch: string) => string> = {
	bold: (ch) => mathLetter(ch, 0x1d400, 0x1d41a, 0x1d7ce),
	// Italic small h lives outside the block, as the Planck constant
	italic: (ch) => (ch === "h" ? "ℎ" : mathLetter(ch, 0x1d434, 0x1d44e)),
	smallCaps: (ch) => {
		const c = ch.charCodeAt(0);
		return c >= 97 && c <= 122 ? SMALL_CAPS[c - 97] : ch;
	},
};

/**
 * Restyles Latin letters with Unicode look-alikes (Discord can't show colors or bold).
 * Accented letters are split into base letter + accent first, so "ñ" and "é" keep their marks.
 */
export const applyStyle = (text: string, style: LyricStyle) => {
	if (style === "normal" || !text) return text;
	const map = styleChar[style];
	return Array.from(text.normalize("NFD"), map).join("");
};
