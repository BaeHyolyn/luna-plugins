/**
 * Sliding window limiter: at most `limit` sends in any `windowMs`.
 * Allows quick bursts (fast lyric lines) while never going over the budget.
 */
export const createRateLimiter = (limit: number, windowMs: number, now: () => number = Date.now) => {
	const sent: number[] = [];

	const prune = () => {
		while (sent.length > 0 && now() - sent[0] >= windowMs) sent.shift();
	};

	return {
		/** Milliseconds to wait before the next send is allowed (0 if it can go now). */
		delay() {
			prune();
			return sent.length < limit ? 0 : sent[0] + windowMs - now();
		},
		record() {
			prune();
			sent.push(now());
		},
	};
};
