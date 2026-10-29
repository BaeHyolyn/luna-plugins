import React from "react";

import { keyStep, responseDb, type Band, type Macros } from "./eq";

// Drawing space in CSS pixels; the width follows the panel so text keeps its size in small windows
const L = 52; // left margin for dB labels
const R = 12;
const TOP = 34; // below the region header
const PH = 236; // plot height
const VH = TOP + PH + 30;
const DB = 12; // plot range: -12..+12 dB
const F_MIN = 20;
const DECADES = 3; // 20 Hz .. 20 kHz

// Translucent whites so the graph sits on TIDAL's artwork-tinted background
const C = {
	panel: "transparent",
	plot: "rgba(255,255,255,0.03)",
	grid: "rgba(255,255,255,0.05)",
	gridStrong: "rgba(255,255,255,0.12)",
	label: "rgba(255,255,255,0.55)",
	curve: "#ffffff",
	header: "rgba(255,255,255,0.04)",
	selected: "#33ffee",
};

const REGIONS: [number, number, string][] = [
	[20, 60, "SUB BASS"],
	[60, 250, "BASS"],
	[250, 500, "LOW MIDS"],
	[500, 2000, "MID RANGE"],
	[2000, 6000, "UPPER MIDS"],
	[6000, 20000, "HIGHS"],
];
const FREQ_LABELS: [number, string][] = [
	[20, "20Hz"], [50, "50Hz"], [100, "100Hz"], [200, "200Hz"], [500, "500Hz"],
	[1000, "1kHz"], [2000, "2kHz"], [5000, "5kHz"], [10000, "10kHz"], [20000, "20kHz"],
];
const MINOR = [30, 40, 60, 70, 80, 90, 300, 400, 600, 700, 800, 900, 3000, 4000, 6000, 7000, 8000, 9000];

const y = (db: number) => TOP + ((DB - db) / (2 * DB)) * PH;
const dbAt = (py: number) => DB - ((Math.min(Math.max(py, TOP), TOP + PH) - TOP) / PH) * 2 * DB;

const noGain = (b: Band) => b.type === "highpass" || b.type === "lowpass";


type Props = {
	bands: Band[];
	macros: Macros;
	selected: number | null;
	onSelect: (i: number | null) => void;
	onBand: (i: number, b: Band) => void;
};

export const EqGraph = ({ bands, macros, selected, onSelect, onBand }: Props) => {
	const svg = React.useRef<SVGSVGElement>(null);
	// Ids must be unique per graph: with two on the page (settings + Equalizer tab) the browser would use the first one's clip
	const uid = React.useId().replace(/:/g, "");
	const clipId = `tidaleq-plot-${uid}`;
	const fillId = `tidaleq-fill-${uid}`;
	const [VW, setVW] = React.useState(1000);
	React.useEffect(() => {
		const el = svg.current;
		if (!el) return;
		const ro = new ResizeObserver(([e]) => setVW(Math.max(320, Math.round(e.contentRect.width))));
		ro.observe(el);
		return () => ro.disconnect();
	}, []);
	const PW = VW - L - R;
	const x = (f: number) => L + (Math.log10(f / F_MIN) / DECADES) * PW;
	const fAt = (px: number) => F_MIN * 10 ** ((Math.min(Math.max(px, L), L + PW) - L) / PW * DECADES);
	// Fewer and shorter labels when narrow so they don't collide
	const narrow = VW < 600;
	const drag = React.useRef<number | null>(null);
	// Latest props for the native wheel listener
	const latest = React.useRef({ bands, selected, onBand });
	latest.current = { bands, selected, onBand };

	const toSvg = (e: React.PointerEvent) => {
		const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.current!.getScreenCTM()!.inverse());
		return pt;
	};

	const onMove = (e: React.PointerEvent) => {
		const i = drag.current;
		if (i === null) return;
		const p = toSvg(e);
		const band = bands[i];
		const freq = Math.round(fAt(p.x));
		const gain = noGain(band) ? band.gain : Math.round(dbAt(p.y) * 2) / 2;
		if (freq !== band.freq || gain !== band.gain) onBand(i, { ...band, freq, gain });
	};

	// Wheel changes the width (Q) of the selected band; needs a non-passive listener to stop page scroll
	React.useEffect(() => {
		const el = svg.current;
		if (!el) return;
		const onWheel = (e: WheelEvent) => {
			const { bands, selected, onBand } = latest.current;
			// Only over the selected dot: elsewhere the wheel scrolls the page as usual
			if (selected === null || (e.target as Element).getAttribute?.("data-band") !== String(selected)) return;
			e.preventDefault();
			const b = bands[selected];
			const q = Math.min(10, Math.max(0.1, b.q * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
			onBand(selected, { ...b, q: Math.round(q * 100) / 100 });
		};
		el.addEventListener("wheel", onWheel, { passive: false });
		return () => el.removeEventListener("wheel", onWheel);
	}, []);

	const curve = React.useMemo(() => {
		const pts: string[] = [];
		for (let k = 0; k <= 240; k++) {
			const f = F_MIN * 10 ** ((k / 240) * DECADES);
			pts.push(`${x(f).toFixed(1)},${y(responseDb({ bands, macros }, f)).toFixed(1)}`);
		}
		return `M${pts.join("L")}`;
	}, [bands, macros, VW]);

	return (
		<svg
			ref={svg}
			viewBox={`0 0 ${VW} ${VH}`}
			style={{ width: "100%", display: "block", background: C.panel, borderRadius: 8, touchAction: "none", userSelect: "none" }}
			onPointerMove={onMove}
			onPointerUp={() => (drag.current = null)}
			onPointerLeave={() => (drag.current = null)}
			onPointerDown={(e) => e.target === svg.current && onSelect(null)}
			role="group"
			aria-label="Equalizer frequency response"
		>
			<defs>
				<clipPath id={clipId}>
					<rect x={L} y={TOP} width={PW} height={PH} />
				</clipPath>
				<linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
					<stop offset="0%" stopColor={C.curve} stopOpacity={0.18} />
					<stop offset="50%" stopColor={C.curve} stopOpacity={0.02} />
					<stop offset="100%" stopColor={C.curve} stopOpacity={0.18} />
				</linearGradient>
			</defs>

			{REGIONS.map(([lo, hi, name]) => (
				<g key={name}>
					<rect x={x(lo) + 1} y={4} width={x(hi) - x(lo) - 2} height={22} fill={C.header} />
					<text x={(x(lo) + x(hi)) / 2} y={19} textAnchor="middle" fontSize={10} fill={C.label} letterSpacing={0.5}>
						{narrow ? name.replace("SUB BASS", "SUB").replace("MID RANGE", "MIDS").replace("UPPER MIDS", "UPPER") : name}
					</text>
				</g>
			))}

			<rect x={L} y={TOP} width={PW} height={PH} fill={C.plot} />
			{MINOR.map((f) => <line key={f} x1={x(f)} x2={x(f)} y1={TOP} y2={TOP + PH} stroke={C.grid} />)}
			{FREQ_LABELS.filter(([f]) => !narrow || [20, 100, 1000, 20000].includes(f)).map(([f, label]) => (
				<g key={f}>
					<line x1={x(f)} x2={x(f)} y1={TOP} y2={TOP + PH} stroke={C.gridStrong} />
					<text x={Math.min(Math.max(x(f), L + 16), L + PW - 18)} y={TOP + PH + 18} textAnchor="middle" fontSize={11} fill={C.label}>
						{label}
					</text>
				</g>
			))}
			{[12, 6, 0, -6, -12].map((db) => (
				<g key={db}>
					<line x1={L} x2={L + PW} y1={y(db)} y2={y(db)} stroke={db === 0 ? C.gridStrong : C.grid} />
					<text x={L - 8} y={y(db) + 4} textAnchor="end" fontSize={11} fill={C.label}>
						{db > 0 ? `+${db}` : db} dB
					</text>
				</g>
			))}

			<path d={`${curve}L${x(20000)},${y(0)}L${x(F_MIN)},${y(0)}Z`} fill={`url(#${fillId})`} clipPath={`url(#${clipId})`} />
			<path d={curve} fill="none" stroke={C.curve} strokeWidth={2} clipPath={`url(#${clipId})`} />

			{bands.map((b, i) => {
				const cx = x(Math.min(20000, Math.max(20, b.freq)));
				const cy = y(noGain(b) ? 0 : Math.max(-DB, Math.min(DB, b.gain)));
				return (
					<g key={i} opacity={b.enabled ? 1 : 0.35} style={{ cursor: "grab" }}>
						{selected === i && <circle cx={cx} cy={cy} r={14} fill="none" stroke={C.selected} strokeOpacity={0.7} strokeWidth={2} />}
						<circle
							cx={cx}
							cy={cy}
							r={7}
							data-band={i}
							fill={selected === i ? C.selected : "#ffffff"}
							stroke="rgba(0,0,0,0.5)"
							strokeWidth={1.5}
							onPointerDown={(e) => {
								e.stopPropagation();
								(e.target as Element).setPointerCapture(e.pointerId);
								drag.current = i;
								onSelect(i);
							}}
							onDoubleClick={() => onBand(i, { ...b, gain: 0 })}
							// Keyboard: Tab between bands, arrows move one, PageUp/PageDown change its width, Delete resets its gain
							tabIndex={0}
							role="slider"
							aria-label={`Band ${i + 1}`}
							aria-valuetext={`${Math.round(b.freq)} hertz, ${noGain(b) ? b.type : `${b.gain} decibels`}, Q ${b.q}`}
							onFocus={() => onSelect(i)}
							onKeyDown={(e) => {
								const next = keyStep(b, e.key, e.shiftKey);
								if (!next) return;
								e.preventDefault();
								onBand(i, next);
							}}
							style={{ outline: "none" }}
						>
							<title>{`${Math.round(b.freq)} Hz · ${noGain(b) ? b.type : `${b.gain > 0 ? "+" : ""}${b.gain} dB`} · Q ${b.q}`}</title>
						</circle>
					</g>
				);
			})}
		</svg>
	);
};
