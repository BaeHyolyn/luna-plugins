import { MediaItem, PlayState } from "@luna/lib";
import React from "react";

import { heading, Pill, text, type Looks } from "./NowPlayingTab";
import { settings, vizSettings } from "./Settings";
import { copyText, pasteText } from "./player.native";
import { COVER, coverImageSrc, setPreview } from "./Visualizer";
import { autoPoints, coverPixels, defaultViz, MAX_COLOR_POINTS, sampleColors, sanitizeViz, VIZ_PRESETS, VIZ_RANGES, type VizSettings } from "./viz";

// Controls for the visualizer. Changes are stored right away and the visualizer reads them on its next frame.
// Every control can go back to its own default (↺, or double-click a slider), every section too, and everything at once.

type Key = keyof VizSettings;
type Update = (next: Partial<VizSettings>) => void;

const useViz = () => {
	const [viz, setViz] = React.useState(vizSettings);
	const update: Update = (next) => {
		const merged = { ...vizSettings(), ...next }; // from storage, so quick successive changes all stick
		setViz(merged);
		// A plain copy: values read from storage are live proxies, which the database refuses to save
		settings.viz = plain(merged);
	};
	return [viz, update] as const;
};

const DEFAULTS = defaultViz();
const plain = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const changed = (viz: VizSettings, keys: Key[]) => keys.filter((k) => !same(viz[k], DEFAULTS[k]));
const defaultsOf = (keys: Key[]) => Object.fromEntries(keys.map((k) => [k, DEFAULTS[k]])) as Partial<VizSettings>;
const show = (v: unknown) => (typeof v === "boolean" ? (v ? "On" : "Off") : String(v));

const label: React.CSSProperties = { ...text, color: "#fff", width: 92, flexShrink: 0 };
const small: React.CSSProperties = { ...text, fontSize: 12 };
const linkButton: React.CSSProperties = { ...small, background: "none", border: "none", padding: 0, cursor: "pointer", textDecoration: "underline" };

/** Shown only when the value differs from its default; puts that one setting back. */
const ResetOne = ({ viz, k, name, update }: { viz: VizSettings; k: Key; name: string; update: Update }) => {
	const off = same(viz[k], DEFAULTS[k]);
	return (
		<button
			type="button"
			title={`Back to default (${show(DEFAULTS[k])})`}
			aria-label={`Reset ${name} to default`}
			onClick={() => update({ [k]: DEFAULTS[k] })}
			style={{ ...small, width: 20, flexShrink: 0, background: "none", border: "none", padding: 0, cursor: off ? "default" : "pointer", color: "#fff", visibility: off ? "hidden" : "visible" }}
		>
			↺
		</button>
	);
};

const Slider = ({ viz, k, name, unit = "", update }: { viz: VizSettings; k: Key; name: string; unit?: string; update: Update }) => {
	const [min, max, step] = VIZ_RANGES[k]!;
	const v = viz[k] as number;
	const [typing, setTyping] = React.useState<string | null>(null);
	const decimals = step < 1 ? 2 : 0;
	const commit = () => {
		const n = Number(typing);
		if (typing !== null && typing.trim() !== "" && Number.isFinite(n)) update({ [k]: Math.min(max, Math.max(min, n)) });
		setTyping(null);
	};
	return (
		<div style={{ display: "flex", alignItems: "center", gap: 10, flex: "1 1 280px", minWidth: 0 }}>
			<span style={label}>{name}</span>
			<input
				type="range" min={min} max={max} step={step} value={v} aria-label={name}
				title="Double-click to go back to the default"
				onChange={(e) => update({ [k]: +e.target.value })}
				onDoubleClick={() => update({ [k]: DEFAULTS[k] })}
				style={{ flex: 1, minWidth: 0, accentColor: "#fff" }}
			/>
			{typing === null ? (
				<button type="button" title="Click to type a value" onClick={() => setTyping(String(v))}
					style={{ ...small, color: "#fff", width: 76, textAlign: "right", fontVariantNumeric: "tabular-nums", background: "none", border: "none", padding: 0, cursor: "text" }}>
					{v.toFixed(decimals)}
					{unit}
				</button>
			) : (
				<input
					autoFocus type="number" min={min} max={max} step={step} value={typing} aria-label={`${name} value`}
					onChange={(e) => setTyping(e.target.value)} onBlur={commit}
					onKeyDown={(e) => (e.key === "Enter" ? commit() : e.key === "Escape" && setTyping(null))}
					style={{ ...small, color: "#fff", width: 76, textAlign: "right", background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.3)", borderRadius: 4 }}
				/>
			)}
			<ResetOne viz={viz} k={k} name={name} update={update} />
		</div>
	);
};

const Choice = <K extends Key>({ looks, viz, k, name, options, update }: { looks: Looks; viz: VizSettings; k: K; name: string; options: [VizSettings[K], string][]; update: Update }) => (
	<div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
		<span style={label}>{name}</span>
		<div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
			{options.map(([o, optionName]) => (
				<Pill key={String(o)} looks={looks} pressed={o === viz[k]} onClick={() => update({ [k]: o })}>
					{optionName}
				</Pill>
			))}
		</div>
		<ResetOne viz={viz} k={k} name={name} update={update} />
	</div>
);

const Section = ({ title, viz, keys, update, children }: { title: string; viz: VizSettings; keys: Key[]; update: Update; children: React.ReactNode }) => {
	const dirty = changed(viz, keys).length > 0;
	return (
		<section style={{ marginTop: 28 }}>
			<div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
				<h3 style={heading}>{title}</h3>
				{dirty && (
					<button type="button" style={linkButton} onClick={() => update(defaultsOf(keys))}>
						Reset {title.toLowerCase()}
					</button>
				)}
			</div>
			<div style={{ display: "flex", flexDirection: "column", gap: 12 }}>{children}</div>
		</section>
	);
};
const Row = ({ children }: { children: React.ReactNode }) => <div style={{ display: "flex", flexWrap: "wrap", gap: "12px 28px" }}>{children}</div>;

const coverSrc = () => coverImageSrc(document.querySelector(COVER));

/**
 * The current cover with a dot where each color comes from. Auto picks them again from every new cover;
 * moving, adding or removing a dot switches to manual, starting from the dots shown.
 */
const ColorPoints = ({ looks, viz, update }: { looks: Looks; viz: VizSettings; update: Update }) => {
	const [src, setSrc] = React.useState(coverSrc);
	const [pixels, setPixels] = React.useState<Uint8ClampedArray | null>(null);
	const box = React.useRef<HTMLDivElement>(null);
	const drag = React.useRef<number | null>(null);
	// Follow track changes
	React.useEffect(() => {
		const t = setInterval(() => setSrc(coverSrc()), 1000);
		return () => clearInterval(t);
	}, []);
	React.useEffect(() => {
		let live = true;
		if (src) coverPixels(src).then((p) => live && setPixels(p));
		return () => void (live = false);
	}, [src]);
	const auto = React.useMemo(() => (pixels ? autoPoints(pixels, viz.colorCount) : []), [pixels, viz.colorCount]);
	const points = viz.autoColors ? auto : viz.colorPoints;
	const colors = pixels ? sampleColors(pixels, points) : points.map(() => "#fff");
	const manual = (colorPoints: [number, number][]) => update({ autoColors: false, colorPoints });
	const dot = points.length > 12 ? 12 : 16;

	const at = (e: React.PointerEvent | React.MouseEvent): [number, number] => {
		const r = box.current!.getBoundingClientRect();
		const clamp = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 1000) / 1000;
		return [clamp((e.clientX - r.left) / r.width), clamp((e.clientY - r.top) / r.height)];
	};

	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
			<Choice looks={looks} viz={viz} update={update} k="autoColors" name="Points" options={[[true, "Auto (every song)"], [false, "Manual"]]} />
			{viz.autoColors && (
				// In a row: a slider directly in this column would stretch vertically
				<Row>
					<Slider viz={viz} update={update} k="colorCount" name="Colors" />
				</Row>
			)}
			<div style={{ display: "flex", gap: 20, alignItems: "flex-start", flexWrap: "wrap" }}>
				<div
					ref={box}
					style={{ position: "relative", width: 180, height: 180, borderRadius: 4, overflow: "hidden", cursor: "crosshair", touchAction: "none", flexShrink: 0, background: "rgba(255,255,255,0.06)" }}
					onPointerMove={(e) => drag.current !== null && manual(points.map((p, i) => (i === drag.current ? at(e) : p)))}
					onPointerUp={() => (drag.current = null)}
					// On the cover (or the empty box when there's no cover), not on a dot
					onClick={(e) => (e.target === e.currentTarget || e.target === e.currentTarget.querySelector("img")) && points.length < MAX_COLOR_POINTS && manual([...points, at(e)])}
				>
					{src && <img src={src} alt="" draggable={false} style={{ width: "100%", height: "100%", display: "block", userSelect: "none" }} />}
					{points.map(([x, y], i) => (
						<span
							key={i}
							title="Drag to move, double-click to remove"
							onPointerDown={(e) => {
								e.stopPropagation();
								(e.currentTarget.parentElement as HTMLElement).setPointerCapture(e.pointerId);
								drag.current = i;
							}}
							onDoubleClick={(e) => {
								e.stopPropagation();
								if (points.length > 1) manual(points.filter((_, j) => j !== i));
							}}
							// Keyboard: arrows move the dot (Shift for bigger steps), Delete removes it
							tabIndex={0}
							role="button"
							aria-label={`Color point ${i + 1}: arrows move it, Delete removes it`}
							onKeyDown={(e) => {
								const step = e.shiftKey ? 0.1 : 0.02;
								const move: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
								const clamp = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 1000) / 1000;
								if (move[e.key]) {
									e.preventDefault();
									const [dx, dy] = move[e.key];
									manual(points.map((p, j) => (j === i ? [clamp(p[0] + dx), clamp(p[1] + dy)] : p)));
								} else if ((e.key === "Delete" || e.key === "Backspace") && points.length > 1) {
									e.preventDefault();
									manual(points.filter((_, j) => j !== i));
								}
							}}
							style={{
								position: "absolute", left: `${x * 100}%`, top: `${y * 100}%`, width: dot, height: dot, margin: -dot / 2, borderRadius: dot,
								background: colors[i], border: "2px solid #fff", boxShadow: "0 0 0 1px rgba(0,0,0,0.5)", cursor: "grab", boxSizing: "border-box",
							}}
						/>
					))}
				</div>
				<div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0, flex: "1 1 220px" }}>
					<p style={small}>
						{viz.autoColors
							? "The colors are picked again from every new cover: the most vivid and different ones, in color order. Move, add or remove a dot to choose them yourself."
							: `Your own points, kept for every song. Drag a dot to move it, click the cover to add one (up to ${MAX_COLOR_POINTS}), double-click a dot to remove it.`}{" "}
						Dark areas are brightened so they still show.
					</p>
					<div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
						{colors.map((c, i) => (
							<span key={i} style={{ width: 20, height: 20, borderRadius: 4, background: c, boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.25)" }} />
						))}
					</div>
					{!viz.autoColors && (
						<div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
							<Pill looks={looks} pressed={false} onClick={() => pixels && manual(autoPoints(pixels, points.length))}>
								Pick from this cover
							</Pill>
							<Pill looks={looks} pressed={false} onClick={() => manual(DEFAULTS.colorPoints)}>
								Reset points
							</Pill>
						</div>
					)}
				</div>
			</div>
		</div>
	);
};

/** Built-in looks, the user's saved ones, and saving the current look under a name. */
const Presets = ({ looks, viz, update }: { looks: Looks; viz: VizSettings; update: Update }) => {
	const [saved, setSaved] = React.useState(() => [...(settings.vizPresets ?? [])]);
	const [naming, setNaming] = React.useState<string | null>(null);
	// A preset changes the look only: on/off and where the colors come from stay
	const apply = (p: Partial<VizSettings>) => {
		const now = vizSettings();
		const { enabled, colorPoints, autoColors, colorCount } = now;
		update({ ...sanitizeViz({ ...DEFAULTS, ...p }), enabled, colorPoints, autoColors, colorCount });
	};
	const store = (list: typeof saved) => {
		setSaved(list);
		settings.vizPresets = plain(list);
	};
	const save = () => {
		const name = naming?.trim();
		if (!name) return setNaming(null);
		const { enabled: _, colorPoints: __, autoColors: ___, colorCount: ____, ...look } = viz;
		store([...saved.filter((p) => p.name !== name), { name, viz: look }]);
		setNaming(null);
	};
	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
			<div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
				{Object.entries(VIZ_PRESETS).map(([key, p]) => (
					<Pill key={key} looks={looks} pressed={false} onClick={() => apply(p.viz)}>
						{p.label}
					</Pill>
				))}
			</div>
			<div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
				{saved.map((p) => (
					<span key={p.name} style={{ display: "inline-flex", alignItems: "center" }}>
						<Pill looks={looks} pressed={false} onClick={() => apply(p.viz)}>
							{p.name}
						</Pill>
						<button type="button" title={`Delete "${p.name}"`} aria-label={`Delete preset ${p.name}`} onClick={() => store(saved.filter((x) => x !== p))}
							style={{ ...small, background: "none", border: "none", cursor: "pointer", color: "#fff", padding: "0 4px" }}>
							×
						</button>
					</span>
				))}
				{naming === null ? (
					<button type="button" style={linkButton} onClick={() => setNaming("")}>
						Save current look…
					</button>
				) : (
					<span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
						<input autoFocus value={naming} placeholder="Name" maxLength={30} aria-label="Preset name"
							onChange={(e) => setNaming(e.target.value)} onKeyDown={(e) => (e.key === "Enter" ? save() : e.key === "Escape" && setNaming(null))}
							style={{ ...small, color: "#fff", background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.3)", borderRadius: 4, padding: "4px 8px" }} />
						<button type="button" style={linkButton} onClick={save}>Save</button>
						<button type="button" style={linkButton} onClick={() => setNaming(null)}>Cancel</button>
					</span>
				)}
			</div>
		</div>
	);
};

/** Copy the settings as text to share them, or paste someone's (checked and clamped before use). */
const Share = ({ viz, update }: { viz: VizSettings; update: Update }) => {
	const [status, setStatus] = React.useState("");
	const copy = async () => {
		try {
			await copyText(JSON.stringify({ tidaleqVisualizer: viz }));
			setStatus("Copied. Paste it anywhere to share your look.");
		} catch {
			setStatus("Couldn't use the clipboard.");
		}
	};
	const paste = async () => {
		try {
			const parsed = JSON.parse(await pasteText());
			const incoming = parsed?.tidaleqVisualizer;
			if (!incoming || typeof incoming !== "object") return setStatus("The clipboard doesn't have visualizer settings.");
			update({ ...sanitizeViz(incoming), enabled: viz.enabled });
			setStatus("Settings pasted.");
		} catch {
			setStatus("The clipboard doesn't have visualizer settings.");
		}
	};
	return (
		<div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
			<button type="button" style={linkButton} onClick={copy}>Copy settings</button>
			<button type="button" style={linkButton} onClick={paste}>Paste settings</button>
			{status && <span style={small} role="status">{status}</span>}
		</div>
	);
};

const SECTIONS: Record<string, Key[]> = {
	Look: ["style", "roundCover", "shape", "placement", "mirror", "fourWay", "roundCaps", "peaks", "layers", "particles"],
	Size: ["bars", "width", "length", "gap"],
	Color: ["colorMode", "color1", "color2", "colorPoints", "autoColors", "colorCount", "opacity", "glow"],
	Motion: ["rotation", "spin", "pulse", "smoothing", "attack", "decay"],
	Response: ["sensitivity", "range", "minFreq", "maxFreq", "tilt", "syncOffset"],
	Performance: ["fps"],
};

export const VizPanel = ({ looks }: { looks: Looks }) => {
	const [viz, update] = useViz();
	const [confirmReset, setConfirmReset] = React.useState(false);
	const [playing, setPlaying] = React.useState(PlayState.playing);
	const [eqOn, setEqOn] = React.useState(settings.enabled);
	const [isVideo, setIsVideo] = React.useState(false);
	const onOff: [boolean, string][] = [[true, "On"], [false, "Off"]];
	const p = { viz, update };

	// Animate a preview while this tab is open and the music is paused
	React.useEffect(() => {
		setPreview(true);
		const t = setInterval(() => {
			setPlaying(PlayState.playing);
			setEqOn(settings.enabled);
			MediaItem.fromPlaybackContext().then((m) => setIsVideo(m?.contentType === "video")).catch(() => {});
		}, 500);
		return () => {
			setPreview(false);
			clearInterval(t);
		};
	}, []);

	const widthName = viz.style === "wave" ? "Line width" : viz.style === "dots" ? "Dot size" : "Thickness";

	return (
		<div style={{ minHeight: "100%", color: "#fff", fontFamily: "inherit", display: "flex", flexDirection: "column" }}>
			<div style={{ margin: "auto 0", paddingBottom: 48 }}>
				<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
					<p style={text}>
						{isVideo
							? "This is a music video: the visualizer only works with audio tracks, so it stays still."
							: !playing
							? "Music paused: showing a preview so you can still see your changes."
							: eqOn
								? "Spectrum around the cover, after your equalizer."
								: "Spectrum around the cover. The equalizer is off, so it shows the original sound."}
					</p>
					<div style={{ display: "flex", gap: 8, alignItems: "center" }}>
						<Pill looks={looks} pressed={viz.enabled} onClick={() => update({ enabled: !viz.enabled })}>
							{viz.enabled ? "On" : "Off"}
						</Pill>
						{confirmReset ? (
							<>
								<span style={small}>Reset everything?</span>
								<Pill looks={looks} pressed={false} onClick={() => (update({ ...DEFAULTS, enabled: viz.enabled }), setConfirmReset(false))}>Yes</Pill>
								<Pill looks={looks} pressed={false} onClick={() => setConfirmReset(false)}>No</Pill>
							</>
						) : (
							<Pill looks={looks} pressed={false} onClick={() => setConfirmReset(true)}>Reset all</Pill>
						)}
					</div>
				</div>

				<div style={{ opacity: viz.enabled ? 1 : 0.4, transition: "opacity .2s" }}>
					<section style={{ marginTop: 28 }}>
						<h3 style={heading}>Presets</h3>
						<Presets looks={looks} viz={viz} update={update} />
					</section>

					<Section title="Look" keys={SECTIONS.Look} {...p}>
						<Choice looks={looks} {...p} k="style" name="Style" options={[["bars", "Bars"], ["wave", "Wave"], ["dots", "Dots"], ["layers", "Layers"]]} />
						<Choice looks={looks} {...p} k="roundCover" name="Round cover" options={onOff} />
						<Choice looks={looks} {...p} k="shape" name="Shape" options={[["square", "Follow cover"], ["circle", "Circle"]]} />
						<Choice looks={looks} {...p} k="placement" name="Placement" options={[["outside", "Outside"], ["inside", "Inside"], ["both", "Both ways"]]} />
						<Choice looks={looks} {...p} k="mirror" name="Mirror" options={onOff} />
						{viz.mirror && <Choice looks={looks} {...p} k="fourWay" name="Four-way" options={onOff} />}
						{viz.style === "bars" && <Choice looks={looks} {...p} k="roundCaps" name="Round ends" options={onOff} />}
						{(viz.style === "bars" || viz.style === "dots") && <Choice looks={looks} {...p} k="peaks" name="Peaks" options={onOff} />}
						{viz.style === "layers" && (
							<Row>
								<Slider {...p} k="layers" name="Layers" />
							</Row>
						)}
						<Choice looks={looks} {...p} k="particles" name="Particles" options={onOff} />
					</Section>

					<Section title="Size" keys={SECTIONS.Size} {...p}>
						<Row>
							<Slider {...p} k="bars" name={viz.style === "wave" || viz.style === "layers" ? "Detail" : viz.style === "dots" ? "Dots" : "Bars"} />
							{viz.style !== "layers" && <Slider {...p} k="width" name={widthName} />}
						</Row>
						<Row>
							<Slider {...p} k="length" name="Height" unit=" px" />
							<Slider {...p} k="gap" name="Distance" unit=" px" />
						</Row>
					</Section>

					<Section title="Color" keys={SECTIONS.Color} {...p}>
						<Choice looks={looks} {...p} k="colorMode" name="Colors" options={[["artwork", "From cover"], ["solid", "Solid"], ["gradient", "Gradient"], ["spectrum", "Rainbow"]]} />
						{viz.colorMode === "artwork" && <ColorPoints looks={looks} viz={viz} update={update} />}
						{(viz.colorMode === "solid" || viz.colorMode === "gradient") && (
							<div style={{ display: "flex", gap: 24, alignItems: "center", flexWrap: "wrap" }}>
								{(["color1", "color2"] as const).slice(0, viz.colorMode === "solid" ? 1 : 2).map((k, i) => (
									<label key={k} style={{ display: "flex", gap: 10, alignItems: "center" }}>
										<span style={label}>{viz.colorMode === "solid" ? "Color" : `Color ${i + 1}`}</span>
										<input type="color" value={viz[k]} onChange={(e) => update({ [k]: e.target.value })}
											style={{ width: 40, height: 28, border: "none", background: "transparent", padding: 0, cursor: "pointer" }} />
										<ResetOne viz={viz} k={k} name={viz.colorMode === "solid" ? "Color" : `Color ${i + 1}`} update={update} />
									</label>
								))}
							</div>
						)}
						<Row>
							<Slider {...p} k="opacity" name="Opacity" />
							<Slider {...p} k="glow" name="Glow" unit=" px" />
						</Row>
					</Section>

					<Section title="Motion" keys={SECTIONS.Motion} {...p}>
						<Row>
							<Slider {...p} k="rotation" name="Rotation" unit="°" />
							<Slider {...p} k="spin" name="Spin" unit=" rpm" />
						</Row>
						<Row>
							<Slider {...p} k="pulse" name="Cover beat" />
							<Slider {...p} k="smoothing" name="Smoothing" />
						</Row>
						<Row>
							<Slider {...p} k="attack" name="Rise" unit=" ms" />
							<Slider {...p} k="decay" name="Fall" unit=" ms" />
						</Row>
					</Section>

					<Section title="Response" keys={SECTIONS.Response} {...p}>
						<Row>
							<Slider {...p} k="sensitivity" name="Sensitivity" unit=" dB" />
							<Slider {...p} k="range" name="Range" unit=" dB" />
						</Row>
						<Row>
							<Slider {...p} k="minFreq" name="Lowest" unit=" Hz" />
							<Slider {...p} k="maxFreq" name="Highest" unit=" Hz" />
						</Row>
						<Row>
							<Slider {...p} k="tilt" name="Treble lift" unit=" dB/oct" />
							<Slider {...p} k="syncOffset" name="Sync" unit=" ms" />
						</Row>
					</Section>

					<Section title="Performance" keys={SECTIONS.Performance} {...p}>
						<Choice looks={looks} {...p} k="fps" name="Frame rate" options={[[30, "30"], [60, "60"], [120, "120"], [0, "Max"]]} />
					</Section>

					<section style={{ marginTop: 28 }}>
						<h3 style={heading}>Share</h3>
						<Share viz={viz} update={update} />
					</section>

					<p style={{ ...small, marginTop: 24 }}>Tip: ↺ puts one setting back, double-clicking a slider does the same, and each section has its own reset. Click a value to type it.</p>
				</div>
			</div>
		</div>
	);
};
