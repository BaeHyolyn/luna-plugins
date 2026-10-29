const MAX_LEN = 127;

/** Fits a string to Discord's activity field limits (2 to 128 characters). */
export const clamp = (s?: string | null) => {
	if (!s) return;
	if (s.length < 2) s += " ";
	if (s.length <= MAX_LEN) return s;
	let cut = s.slice(0, MAX_LEN - 3);
	// Don't split a 2-unit character (styled letters, emoji) in half
	if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1);
	return cut + "...";
};

// Separators left dangling when a tag is empty, e.g. "{album} · {quality}" with no quality
const SEPARATOR = String.raw`\s+[·•|-]\s+|\s*[·•|]\s*`;
const tidySeparators = (s: string) =>
	s
		.replace(new RegExp(`(?:${SEPARATOR}){2,}`, "g"), " · ")
		.replace(new RegExp(`^(?:${SEPARATOR}|[\\s·•|-])+|(?:${SEPARATOR}|[\\s·•|-])+$`, "g"), "");

export const fill = (template: string, vars: Record<string, string>) =>
	clamp(tidySeparators(template.replace(/\{(\w+)\}/g, (tag, key: string) => (key in vars ? vars[key] : tag))));

const LYRIC_TAGS = /\{(lyric|nextLyric|nextLyric2)\}/g;

/**
 * Like fill, but when every lyric tag in the template is empty (no lyrics, a video,
 * the intro or the end of the song) it uses `fallback` instead of leaving the line blank.
 */
export const fillOrFallback = (template: string, fallback: string, vars: Record<string, string>) => {
	const lyricTags = template.match(LYRIC_TAGS);
	const lyricsEmpty = lyricTags !== null && lyricTags.every((tag) => !vars[tag.slice(1, -1)]);
	return fill(lyricsEmpty ? fallback : template, vars);
};
