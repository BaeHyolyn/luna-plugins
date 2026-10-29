import assert from "node:assert/strict";
import { createRateLimiter } from "./rateLimit";

let time = 0;
const limiter = createRateLimiter(5, 20_000, () => time);

// A burst of 5 goes through immediately
for (let i = 0; i < 5; i++) {
	assert.equal(limiter.delay(), 0, `send ${i + 1} should not wait`);
	limiter.record();
	time += 1000;
}

// The 6th has to wait until the first send leaves the 20s window (sent at t=0, now t=5000)
assert.equal(limiter.delay(), 15_000);

// Once the oldest one expires, exactly one more slot opens
time = 20_000;
assert.equal(limiter.delay(), 0);
limiter.record();
assert.equal(limiter.delay(), 1000, "next slot opens when the send at t=1000 expires");

// After a quiet period the full burst is available again
time = 60_000;
for (let i = 0; i < 5; i++) {
	assert.equal(limiter.delay(), 0);
	limiter.record();
}
assert.ok(limiter.delay() > 0);

console.log("rateLimit: all tests passed");
