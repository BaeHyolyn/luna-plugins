import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { bandFilter, bandResponseDb, buildChain, defaultSettings, flatBands, PRESETS, responseDb, type EqSettings } from "./eq";

// Flat with the limiter off does nothing at all
assert.equal(buildChain({ ...defaultSettings(), limiter: false }), "");
assert.equal(buildChain({ ...defaultSettings(), enabled: false, preamp: 6 }), "");

// Flat with the limiter on is only the limiter
assert.equal(buildChain(defaultSettings()), "lavfi=[alimiter=limit=0.97:level=0]");

// Bands, preamp and smart volume in order
const s: EqSettings = { ...defaultSettings(), preamp: -3, smartVolume: "balanced" };
s.bands[0] = { enabled: true, type: "highpass", freq: 60, gain: 0, q: 0.707 };
s.bands[6] = { enabled: true, type: "peaking", freq: 2000, gain: 4, q: 1.2 };
assert.equal(
	buildChain(s),
	"lavfi=[volume=-3dB,highpass=f=60:t=q:w=0.71,equalizer=f=2000:t=q:w=1.2:g=4,dynaudnorm=f=250:g=15:m=8,alimiter=limit=0.97:level=0]",
);

// Shelves, disabled bands and clamping
assert.equal(bandFilter({ enabled: true, type: "lowshelf", freq: 100, gain: 3, q: 0.7 }), "lowshelf=f=100:t=q:w=0.7:g=3");
assert.equal(bandFilter({ enabled: false, type: "peaking", freq: 100, gain: 3, q: 1 }), undefined);
assert.equal(bandFilter({ enabled: true, type: "peaking", freq: 99999, gain: 99, q: 0 }), "equalizer=f=20000:t=q:w=0.1:g=24");

// Hostile values can never reach the filter string as text
const evil = { enabled: true, type: "peaking", freq: NaN, gain: "1,amovie=x" as unknown as number, q: Infinity } as const;
assert.equal(bandFilter(evil), undefined); // gain falls back to 0, so the band is dropped
assert.equal(bandFilter({ ...evil, type: "nope" as never, gain: 2 }), "equalizer=f=1000:t=q:w=1:g=2");

// Presets keep 10 bands and leave headroom for their boosts
for (const [key, p] of Object.entries(PRESETS)) {
	const bands = p.bands();
	assert.equal(bands.length, 10, key);
	assert.ok(p.preamp <= -Math.max(0, ...bands.map((b) => b.gain)) + 0.5, `${key} preamp must cover its biggest boost`);
}
assert.equal(flatBands().every((b) => b.gain === 0), true);

// Curve math: what the graph draws must match what each filter does
const near = (a: number, b: number, tol = 0.15) => Math.abs(a - b) <= tol;
const peak = { enabled: true, type: "peaking", freq: 1000, gain: 6, q: 1 } as const;
assert.ok(near(bandResponseDb(peak, 1000), 6), "peak hits its gain at its center");
assert.ok(Math.abs(bandResponseDb(peak, 50)) < 0.3 && Math.abs(bandResponseDb(peak, 15000)) < 0.3, "and leaves far frequencies alone");
const hp = { enabled: true, type: "highpass", freq: 100, gain: 0, q: 0.707 } as const;
assert.ok(near(bandResponseDb(hp, 100), -3, 0.2), "high-pass is -3 dB at its corner");
assert.ok(bandResponseDb(hp, 25) < -20 && Math.abs(bandResponseDb(hp, 2000)) < 0.1);
const ls = { enabled: true, type: "lowshelf", freq: 120, gain: 6, q: 0.7 } as const;
assert.ok(near(bandResponseDb(ls, 25), 6, 0.3) && Math.abs(bandResponseDb(ls, 5000)) < 0.1, "low shelf lifts the lows only");
const hs = { enabled: true, type: "highshelf", freq: 8000, gain: -4, q: 0.7 } as const;
assert.ok(near(bandResponseDb(hs, 19000), -4, 0.5) && Math.abs(bandResponseDb(hs, 200)) < 0.1, "high shelf moves the highs only");
assert.equal(bandResponseDb({ ...peak, enabled: false }, 1000), 0);
// Flat is flat; macros add on top of the bands
assert.ok(Math.abs(responseDb(defaultSettings(), 1234)) < 1e-9);
assert.ok(responseDb({ bands: flatBands(), macros: { bass: 6, voice: 0, treble: 0 } }, 30) > 5);
assert.ok(responseDb({ bands: flatBands(), macros: { bass: 0, voice: 4, treble: 0 } }, 1500) > 3.5);
// Macros reach the chain
assert.ok(buildChain({ ...defaultSettings(), macros: { bass: 3, voice: 0, treble: -2 } }).includes("lowshelf=f=120:t=q:w=0.7:g=3"));

// The chains are valid for the real mpv, when it is installed
const MPV = "C:\\Program Files\\MPV Player\\mpv.exe";
if (existsSync(MPV)) {
	for (const [key, p] of Object.entries(PRESETS)) {
		const chain = buildChain({ ...defaultSettings(), preamp: p.preamp, bands: p.bands(), smartVolume: "loud" });
		execFileSync(MPV, ["--no-config", "--ao=null", "--length=0.3", `--af=${chain}`, "av://lavfi:sine=f=1000:d=0.3"], { stdio: "ignore" });
	}
	console.log("eq: preset chains accepted by mpv");
}

console.log("eq: all tests passed");
