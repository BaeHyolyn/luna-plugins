import { ReactiveStore } from "@luna/core";
import { LunaSelectItem, LunaSelectSetting, LunaSettings, LunaSwitchSetting, LunaTextSetting } from "@luna/ui";
import React from "react";

import { defaultSettings, PRESETS, type Band, type BandType, type EqSettings, type Macros, type SmartVolume } from "./eq";
import { EqGraph } from "./EqGraph";
import { defaultViz, type VizSettings } from "./viz";

export const DEFAULT_MPV = "C:\\Program Files\\MPV Player\\mpv.exe";

export const settings = await ReactiveStore.getPluginStorage("TidalEQ", {
	...defaultSettings(),
	mpvPath: DEFAULT_MPV,
	viz: defaultViz(),
	vizPresets: [] as { name: string; viz: Partial<VizSettings> }[], // looks the user saved
});
// Stored visualizer settings over the defaults, so options added in later versions get their default
export const vizSettings = (): VizSettings => ({ ...defaultViz(), ...settings.viz });

// Called by index.ts whenever the equalizer changes, so mpv picks it up immediately
let onEqChange: () => void = () => {};
export const setEqChangeHandler = (fn: () => void) => (onEqChange = fn);


const BAND_TYPES: [BandType, string][] = [
	["peaking", "Peak"],
	["lowshelf", "Low shelf"],
	["highshelf", "High shelf"],
	["highpass", "High-pass"],
	["lowpass", "Low-pass"],
];

const cell: React.CSSProperties = { display: "flex", flexDirection: "column", alignItems: "center", gap: 6, minWidth: 0 };
const small: React.CSSProperties = { fontSize: 11, opacity: 0.7, fontVariantNumeric: "tabular-nums" };
const field: React.CSSProperties = {
	width: "100%",
	background: "transparent",
	color: "inherit",
	border: "1px solid rgba(255,255,255,0.2)",
	borderRadius: 4,
	padding: "2px 4px",
	fontSize: 11,
	textAlign: "center",
};

export const BandEditor = ({ band, onChange }: { band: Band; onChange: (b: Band) => void }) => {
	const noGain = band.type === "highpass" || band.type === "lowpass";
	const item = (label: string, control: React.ReactNode) => (
		<label style={{ ...cell, alignItems: "stretch", flex: "1 1 90px" }}>
			<span style={small}>{label}</span>
			{control}
		</label>
	);
	return (
		<div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end", marginTop: 10 }}>
			<span style={{ width: 12, height: 12, borderRadius: 6, background: "#33ffee", alignSelf: "center" }} />
			{item(
				"Type",
				<select value={band.type} onChange={(e) => onChange({ ...band, type: e.target.value as BandType })} style={field}>
					{BAND_TYPES.map(([v, label]) => (
						<option key={v} value={v} style={{ color: "black" }}>
							{label}
						</option>
					))}
				</select>,
			)}
			{item("Frequency (Hz)", <input type="number" min={20} max={20000} value={band.freq} style={field} onChange={(e) => onChange({ ...band, freq: +e.target.value })} />)}
			{item("Gain (dB)", <input type="number" min={-12} max={12} step={0.5} value={band.gain} disabled={noGain} style={field} onChange={(e) => onChange({ ...band, gain: +e.target.value })} />)}
			{item("Q (width)", <input type="number" min={0.1} max={10} step={0.1} value={band.q} style={field} onChange={(e) => onChange({ ...band, q: +e.target.value })} />)}
			<label style={{ ...small, display: "flex", gap: 4, alignItems: "center", opacity: 1 }}>
				<input type="checkbox" checked={band.enabled} onChange={(e) => onChange({ ...band, enabled: e.target.checked })} />
				On
			</label>
		</div>
	);
};

export const MacroSlider = ({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) => (
	<div style={{ display: "flex", alignItems: "center", gap: 10, flex: "1 1 220px", minWidth: 0 }}>
		<span style={{ ...small, opacity: 1, width: 42 }}>{label}</span>
		<input type="range" min={-12} max={12} step={0.5} value={value} aria-label={label}
			onChange={(e) => onChange(+e.target.value)} onDoubleClick={() => onChange(0)}
			style={{ flex: 1, minWidth: 0, accentColor: "#ffffff" }} />
		<span style={{ ...small, opacity: 1, width: 52, textAlign: "center", background: "rgba(255,255,255,0.06)", borderRadius: 4, padding: "3px 0" }}>
			{value.toFixed(1)} dB
		</span>
	</div>
);

// Each view keeps its own copy and writes every change through to storage
const currentEq = (): EqSettings => ({
	enabled: settings.enabled,
	preamp: settings.preamp,
	bands: settings.bands.map((b) => ({ ...b })),
	macros: { ...settings.macros },
	smartVolume: settings.smartVolume,
	limiter: settings.limiter,
});

export const useEq = () => {
	const [eq, setEq] = React.useState<EqSettings>(() => ({
		enabled: settings.enabled,
		preamp: settings.preamp,
		bands: settings.bands.map((b) => ({ ...b })),
		macros: { ...settings.macros },
		smartVolume: settings.smartVolume,
		limiter: settings.limiter,
	}));
	const update = (next: Partial<EqSettings>) => {
		// Merge into what's stored, not this view's copy: the settings page and the Equalizer tab can both be open
		const merged = { ...eq, ...currentEq(), ...next };
		setEq(merged);
		Object.assign(settings, merged);
		onEqChange();
	};
	return [eq, update] as const;
};

/** On/off, preset and the band graph; shared by the settings page and the now-playing Equalizer tab. */
export const EqEditor = ({ eq, update }: { eq: EqSettings; update: (next: Partial<EqSettings>) => void }) => {
	const [selected, setSelected] = React.useState<number | null>(null);
	const setBand = (i: number, b: Band) => update({ bands: eq.bands.map((x, j) => (j === i ? b : x)) });
	const setMacro = (key: keyof Macros, v: number) => update({ macros: { ...eq.macros, [key]: v } });

	return (
		<>
			<LunaSwitchSetting
				title="Equalizer"
				desc="Plays TIDAL through mpv with your equalizer. Turn off to go back to TIDAL's own player."
				checked={eq.enabled}
				onChange={(_, checked) => update({ enabled: checked })}
			/>
			<LunaSelectSetting
				title="Preset"
				desc="Starting point for the bands below. You can still edit every band after."
				value=""
				displayEmpty
				onChange={(e) => {
					const p = PRESETS[e.target.value as string];
					if (p) update({ bands: p.bands(), preamp: p.preamp });
				}}
			>
				<LunaSelectItem value="" disabled>
					Choose a preset…
				</LunaSelectItem>
				{Object.entries(PRESETS).map(([key, p]) => (
					<LunaSelectItem key={key} value={key}>
						{p.label}
					</LunaSelectItem>
				))}
			</LunaSelectSetting>

			<div style={{ padding: "8px 0" }}>
				<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
					<span style={{ fontWeight: 600 }}>Bands</span>
					<button type="button" onClick={() => update({ bands: PRESETS.flat.bands(), preamp: 0, macros: { bass: 0, voice: 0, treble: 0 } })}
						style={{ ...field, width: "auto", padding: "4px 10px" }}>
						Reset
					</button>
				</div>
				<EqGraph bands={eq.bands} macros={eq.macros} selected={selected} onSelect={setSelected} onBand={setBand} />
				<div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginTop: 12 }}>
					<MacroSlider label="Bass" value={eq.macros.bass} onChange={(v) => setMacro("bass", v)} />
					<MacroSlider label="Voice" value={eq.macros.voice} onChange={(v) => setMacro("voice", v)} />
					<MacroSlider label="Treble" value={eq.macros.treble} onChange={(v) => setMacro("treble", v)} />
				</div>
				{selected !== null && eq.bands[selected] ? (
					<BandEditor band={eq.bands[selected]} onChange={(b) => setBand(selected, b)} />
				) : (
					<p style={{ ...small, marginTop: 10 }}>
						Drag a dot to move a band (left/right = frequency, up/down = gain). Scroll on a selected dot to change its width. Double-click resets it to 0 dB.
					</p>
				)}
			</div>
		</>
	);
};

export const Settings = () => {
	const [eq, update] = useEq();
	const [mpvPath, setMpvPath] = React.useState(settings.mpvPath);

	return (
		<LunaSettings>
			<EqEditor eq={eq} update={update} />
			<LunaSelectSetting
				title="Preamp"
				desc="Lowers the level before the bands, so boosts don't clip. Presets set it for you."
				value={String(eq.preamp)}
				onChange={(e) => update({ preamp: +(e.target.value as string) })}
			>
				{/* Half-dB steps, so every preset's preamp shows up */}
				{Array.from({ length: 25 }, (_, i) => -i / 2).map((v) => (
					<LunaSelectItem key={v} value={String(v)}>
						{v} dB
					</LunaSelectItem>
				))}
			</LunaSelectSetting>
			<LunaSelectSetting
				title="Smart volume"
				desc="Evens out loud and quiet parts, like SteelSeries Smart Volume."
				value={eq.smartVolume}
				onChange={(e) => update({ smartVolume: e.target.value as SmartVolume })}
			>
				<LunaSelectItem value="off">Off</LunaSelectItem>
				<LunaSelectItem value="quiet">Quiet</LunaSelectItem>
				<LunaSelectItem value="balanced">Balanced</LunaSelectItem>
				<LunaSelectItem value="loud">Loud</LunaSelectItem>
			</LunaSelectSetting>
			<LunaSwitchSetting
				title="Limiter"
				desc="Stops the output from ever clipping. Keep it on."
				checked={eq.limiter}
				onChange={(_, checked) => update({ limiter: checked })}
			/>
			<LunaTextSetting
				title="mpv path"
				desc="Where mpv.exe is installed. Reload the plugin after changing it."
				value={mpvPath}
				onChange={(e) => setMpvPath((settings.mpvPath = e.target.value))}
			/>
		</LunaSettings>
	);
};
