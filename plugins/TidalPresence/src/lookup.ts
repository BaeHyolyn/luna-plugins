/**
 * Synchronous view over an async lookup that Luna already caches (MediaItem.lyrics, Artist.fromId).
 * Returns the value once it has arrived, otherwise starts the lookup and returns undefined;
 * onLoaded() is called when a value arrives so the status can refresh.
 * A failed lookup is forgotten, so the next call asks again (Luna drops failed results too).
 */
export const createLookup = <K, T>(fetch: (key: K) => Promise<T | undefined>, onLoaded: () => void) => {
	// undefined = pending or nothing found; a key is only absent before its first call or after a failure
	const known = new Map<K, T | undefined>();

	return (key: K): T | undefined => {
		if (known.has(key)) return known.get(key);
		known.set(key, undefined);
		fetch(key).then(
			(value) => {
				known.set(key, value);
				if (value !== undefined) onLoaded();
			},
			() => known.delete(key),
		);
		return undefined;
	};
};
