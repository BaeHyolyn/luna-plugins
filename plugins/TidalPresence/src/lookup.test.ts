import assert from "node:assert/strict";
import { createLookup } from "./lookup";

const tick = () => new Promise((r) => setTimeout(r, 0));

const main = async () => {
	// Found values are returned and trigger onLoaded once
	{
		let calls = 0;
		let loaded = 0;
		const get = createLookup(
			async (k: string) => (calls++, `v-${k}`),
			() => loaded++,
		);
		assert.equal(get("a"), undefined);
		assert.equal(get("a"), undefined, "no duplicate fetch while pending");
		await tick();
		assert.equal(get("a"), "v-a");
		assert.equal(calls, 1);
		assert.equal(loaded, 1);
	}

	// "Nothing found" is remembered and not fetched again
	{
		let calls = 0;
		let loaded = 0;
		const get = createLookup(
			async () => (calls++, undefined),
			() => loaded++,
		);
		get("x");
		await tick();
		assert.equal(get("x"), undefined);
		await tick();
		assert.equal(calls, 1);
		assert.equal(loaded, 0);
	}

	// A failure is forgotten, so the next call asks again
	{
		let calls = 0;
		let fail = true;
		const get = createLookup(
			async () => {
				calls++;
				if (fail) throw new Error("network");
				return "ok";
			},
			() => {},
		);
		get("k");
		await tick();
		fail = false;
		assert.equal(get("k"), undefined);
		await tick();
		assert.equal(calls, 2);
		assert.equal(get("k"), "ok");
	}

	console.log("lookup: all tests passed");
};

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
