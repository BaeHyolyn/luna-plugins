import type { LunaUnload } from "@luna/core";
import { observe } from "@luna/lib";
import React from "react";
import { createRoot, type Root } from "react-dom/client";

import { PRESETS, type Band, type EqSettings, type Macros } from "./eq";
import { EqGraph } from "./EqGraph";
import { BandEditor, MacroSlider, useEq } from "./Settings";

// TIDAL's class names are hashed per build, so only data-test attributes and class names copied at runtime are used.
// Our tabs borrow the Credits panel: TIDAL opens it (and shifts the artwork aside), we cover its content with ours.

export const text: React.CSSProperties = { fontSize: 14, fontWeight: 400, color: "rgba(255,255,255,0.55)", margin: 0 };
export const heading: React.CSSProperties = { fontSize: 14, fontWeight: 500, color: "#fff", margin: "0 0 12px" };

// The preset whose bands and preamp match the current ones, if any
const currentPreset = (eq: EqSettings) =>
	Object.keys(PRESETS).find((k) => {
		const p = PRESETS[k];
		const bands = p.bands();
		return p.preamp === eq.preamp && eq.bands.every((b, i) => b.type === bands[i].type && b.freq === bands[i].freq && b.gain === bands[i].gain && b.q === bands[i].q && b.enabled);
	});

/** Same look as TIDAL's own tabs: their class names are passed in from the live buttons. */
export const Pill = ({ looks, pressed, onClick, children }: { looks: Looks; pressed: boolean; onClick: () => void; children: React.ReactNode }) => (
	<button type="button" aria-pressed={pressed} onClick={onClick} className={pressed ? `${looks.button} ${looks.pressed}` : looks.button}>
		<span className={looks.label}>{children}</span>
	</button>
);

export type Looks = { button: string; pressed: string; label: string };

export const EqPanel = ({ looks }: { looks: Looks }) => {
	const [eq, update] = useEq();
	const [selected, setSelected] = React.useState<number | null>(null);
	const preset = currentPreset(eq);
	const setBand = (i: number, b: Band) => update({ bands: eq.bands.map((x, j) => (j === i ? b : x)) });
	const setMacro = (key: keyof Macros, v: number) => update({ macros: { ...eq.macros, [key]: v } });

	return (
		// Fills TIDAL's scroll area; column flex + auto margins center it on the artwork when there is room
		<div style={{ minHeight: "100%", color: "#fff", fontFamily: "inherit", display: "flex", flexDirection: "column" }}>
			<div style={{ margin: "auto 0", paddingBottom: 48 }}>
			<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, marginBottom: 24 }}>
				<p style={text}>{eq.enabled ? "Playing through mpv with your equalizer." : "Off: TIDAL plays normally."}</p>
				<div style={{ display: "flex", gap: 8 }}>
					<Pill looks={looks} pressed={eq.enabled} onClick={() => update({ enabled: !eq.enabled })}>
						{eq.enabled ? "On" : "Off"}
					</Pill>
					<Pill looks={looks} pressed={false} onClick={() => update({ bands: PRESETS.flat.bands(), preamp: 0, macros: { bass: 0, voice: 0, treble: 0 } })}>
						Reset
					</Pill>
				</div>
			</div>

			<div style={{ opacity: eq.enabled ? 1 : 0.4, transition: "opacity .2s" }}>
				<EqGraph bands={eq.bands} macros={eq.macros} selected={selected} onSelect={setSelected} onBand={setBand} />
				{selected !== null && eq.bands[selected] ? (
					<BandEditor band={eq.bands[selected]} onChange={(b) => setBand(selected, b)} />
				) : (
					<p style={{ ...text, fontSize: 12, marginTop: 10 }}>Drag a dot to shape the sound. Scroll on it to change its width, double-click to reset.</p>
				)}

				<div style={{ display: "flex", flexWrap: "wrap", gap: 16, margin: "24px 0 32px" }}>
					<MacroSlider label="Bass" value={eq.macros.bass} onChange={(v) => setMacro("bass", v)} />
					<MacroSlider label="Voice" value={eq.macros.voice} onChange={(v) => setMacro("voice", v)} />
					<MacroSlider label="Treble" value={eq.macros.treble} onChange={(v) => setMacro("treble", v)} />
				</div>

				<h3 style={heading}>Presets</h3>
				<div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
					{Object.entries(PRESETS).map(([key, p]) => (
						<Pill key={key} looks={looks} pressed={key === preset} onClick={() => update({ bands: p.bands(), preamp: p.preamp })}>
							{p.label.replace(/^Music: /, "")}
						</Pill>
					))}
				</div>
			</div>
			<p style={{ ...text, fontSize: 12, marginTop: 32 }}>Preamp, smart volume and limiter are in the plugin settings.</p>
			</div>
		</div>
	);
};

type Tab = { button: HTMLButtonElement; close: () => void; isActive: () => boolean; reattach: (panel: HTMLElement) => void };
const tabs: Tab[] = [];
// TIDAL's "pressed" classes, learned from the Credits button the first time it's pressed
let pressedClasses: string[] = [];

// Learn TIDAL's "pressed" classes: from a pressed TIDAL tab compared to an unpressed one, or failing that from its stylesheets
const learnPressed = () => {
	const pressed = document.querySelector("[data-test^=toggle-][aria-pressed=true]:not([data-test^=toggle-tidaleq])");
	const plain = document.querySelector("[data-test^=toggle-][aria-pressed=false]:not([data-test^=toggle-tidaleq])");
	const extra = pressed && plain ? [...pressed.classList].filter((c) => !plain.classList.contains(c)) : [];
	if (extra.length) return void (pressedClasses = extra);
	if (pressedClasses.length) return;
	for (const sheet of document.styleSheets) {
		try {
			const match = [...sheet.cssRules].map((r) => r.cssText.match(/\.(_toggleButtonActive_\w+)/)).find(Boolean);
			if (match) return void (pressedClasses = [match[1]]);
		} catch {
			// cross-origin stylesheet
		}
	}
};

const credits = () => document.querySelector<HTMLButtonElement>("[data-test=toggle-credits]");
const creditsPanel = () => document.querySelector<HTMLElement>("[data-test=now-playing-credits]");
const setPressed = (el: Element, pressed: boolean) => {
	if (pressed) el.classList.add(...pressedClasses);
	else el.classList.remove(...pressedClasses);
	el.setAttribute("aria-pressed", String(pressed));
};

/** Adds a tab next to Lyrics that shows `Panel` where TIDAL's Credits would be. Tabs appear in the order they're added. */
export const addPanelTab = (unloads: Set<LunaUnload>, id: string, label: string, Panel: React.FC<{ looks: Looks }>) => {
	let active = false;
	let root: Root | null = null;
	let host: HTMLElement | null = null;
	let hiddenPanel: HTMLElement | null = null;

	const button = document.createElement("button");
	button.type = "button";
	button.dataset.test = `toggle-${id}`;
	button.setAttribute("aria-pressed", "false");
	button.innerHTML = `<span>${label}</span>`;

	const close = () => {
		if (!active) return;
		active = false;
		root?.unmount();
		host?.remove();
		root = host = null;
		if (hiddenPanel) hiddenPanel.style.display = "";
		hiddenPanel = null;
		setPressed(button, false);
	};

	// Our panel lives in the Credits panel's own scroll container (so it gets TIDAL's padding and scrolling at every size)
	const reattach = (panel: HTMLElement) => {
		if (!active || !host) return;
		if (hiddenPanel && hiddenPanel !== panel) hiddenPanel.style.display = "";
		hiddenPanel = panel;
		panel.style.display = "none";
		if (host.parentElement !== panel.parentElement) panel.after(host);
	};

	let opening = false; // a second click while TIDAL is still opening the panel would mount it twice
	const open = async () => {
		if (opening) return;
		opening = true;
		try {
			await doOpen();
		} finally {
			opening = false;
		}
	};
	const doOpen = async () => {
		const creditsButton = credits();
		if (!creditsButton) return;
		// Credits may already be open underneath another of our tabs; only ask TIDAL to open it when it isn't
		if (!creditsPanel()) creditsButton.click();
		let panel: HTMLElement | null = null;
		for (let i = 0; i < 40 && !(panel = creditsPanel()); i++) await new Promise((r) => setTimeout(r, 25));
		if (!panel) return;

		learnPressed();
		setPressed(creditsButton, false);
		setPressed(button, true);

		active = true;
		host = document.createElement("div");
		// Scrolls on its own: TIDAL scrolls the Credits element itself (which we hide), not the container we share
		host.style.cssText = "height:100%;overflow-y:auto;overscroll-behavior:contain;";
		reattach(panel);
		root = createRoot(host);
		const plain = button.className.split(" ").filter((c) => !pressedClasses.includes(c)).join(" ");
		root.render(<Panel looks={{ button: plain, pressed: pressedClasses.join(" "), label: button.firstElementChild!.className }} />);
	};

	button.addEventListener("click", () => {
		if (!active) return void open();
		close();
		credits()?.click(); // closes the borrowed panel
	});

	// Another tab clicked while ours is open: Lyrics/Similar and our other tabs take over the panel; Credits is already there underneath
	const onTabClick = (e: MouseEvent) => {
		if (!active) return;
		const tab = (e.target as Element).closest?.("[data-test^=toggle-]");
		if (!tab || tab === button) return;
		close();
		if (tab.getAttribute("data-test") === "toggle-credits") {
			e.stopPropagation();
			e.preventDefault();
			setPressed(tab, true);
		}
	};
	document.addEventListener("click", onTabClick, true);

	tabs.push({ button, close, isActive: () => active, reattach });
	unloads.add(() => {
		close();
		button.remove();
		document.removeEventListener("click", onTabClick, true);
		tabs.splice(tabs.findIndex((t) => t.button === button), 1);
	});
	if (tabs.length === 1) watchNowPlaying(unloads);
	else insertTabs();
};

// TIDAL's own tab buttons (Similar tracks, Credits, Lyrics); which ones show depends on the track (no lyrics, no Lyrics tab)
const THEIR_TABS = "[data-test=new-now-playing] [data-test^=toggle-]:not([data-test^=toggle-tidaleq])";

// Insert our buttons after TIDAL's last tab whenever the now-playing view renders the tab bar
const insertTabs = () => {
	const theirs = [...document.querySelectorAll(THEIR_TABS)];
	const last = theirs[theirs.length - 1];
	if (!last?.parentElement || !credits()) return; // our panels borrow Credits, so they need it
	const placed = tabs.every((t, i) => t.button.previousElementSibling === (i ? tabs[i - 1].button : last));
	if (placed) return;
	// Copy the look of a tab that isn't pressed; a re-rendered tab bar (e.g. on resize) keeps our tab open
	const plain = theirs.find((t) => t.getAttribute("aria-pressed") === "false") ?? last;
	for (const t of tabs) {
		t.button.className = plain.className;
		t.button.firstElementChild!.className = plain.firstElementChild?.className ?? "";
		if (t.isActive()) {
			setPressed(t.button, true);
			const c = credits();
			if (c) setPressed(c, false);
		}
	}
	last.after(...tabs.map((t) => t.button));
};

const watchNowPlaying = (unloads: Set<LunaUnload>) => {
	observe(unloads, THEIR_TABS, insertTabs);
	// TIDAL rebuilds the panel on some layout changes (like resizing): take it over again
	observe<HTMLElement>(unloads, "[data-test=now-playing-credits]", (panel) => tabs.forEach((t) => t.reattach(panel)));
	// observe only sees changes, so handle a now-playing view that is already open
	insertTabs();
};
