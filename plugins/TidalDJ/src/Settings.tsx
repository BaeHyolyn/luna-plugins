import { ReactiveStore } from "@luna/core";
import { LunaSelectItem, LunaSelectSetting, LunaSettings, LunaSwitchSetting } from "@luna/ui";
import React from "react";

import type { Mode } from "./pick";

export const settings = await ReactiveStore.getPluginStorage("TidalDJ", {
	enabled: true,
	mode: "flow" as Mode,
	mix: true,
	mixBars: 16, // longest beat mix
	bassSwap: true,
	blocked: [] as string[], // radio songs TIDAL refused to play here (region locks)
});

export const Settings = () => {
	const [enabled, setEnabled] = React.useState(settings.enabled);
	const [mode, setMode] = React.useState(settings.mode);
	const [mix, setMix] = React.useState(settings.mix);
	const [mixBars, setMixBars] = React.useState(settings.mixBars);
	const [bassSwap, setBassSwap] = React.useState(settings.bassSwap);
	return (
		<LunaSettings>
			<LunaSwitchSetting
				title="DJ"
				desc="When the queue runs out, keep playing songs picked from TIDAL's radio for the current track"
				checked={enabled}
				onChange={(_, checked) => setEnabled((settings.enabled = checked))}
			/>
			<LunaSelectSetting title="Mode" desc="What kind of songs the DJ picks" value={mode} onChange={(e) => setMode((settings.mode = e.target.value as Mode))}>
				<LunaSelectItem value="flow">Flow: keep the current tempo</LunaSelectItem>
				<LunaSelectItem value="chill">Chill: slower songs</LunaSelectItem>
				<LunaSelectItem value="party">Party: faster songs</LunaSelectItem>
				<LunaSelectItem value="discover">Discover: avoid artists you just heard</LunaSelectItem>
				<LunaSelectItem value="club">Club: shorter plays, beat-matched mixes</LunaSelectItem>
			</LunaSelectSetting>
			<LunaSwitchSetting
				title="Mix"
				desc="Blend each song into the next on the beat, like a DJ. Needs TidalEQ with its equalizer on"
				checked={mix}
				onChange={(_, checked) => setMix((settings.mix = checked))}
			/>
			<LunaSelectSetting title="Mix length" desc="Longest blend when the beats match (songs without a clear beat get a fade instead)" value={mixBars} onChange={(e) => setMixBars((settings.mixBars = Number(e.target.value)))}>
				<LunaSelectItem value={8}>Short: 8 bars</LunaSelectItem>
				<LunaSelectItem value={16}>Normal: 16 bars</LunaSelectItem>
				<LunaSelectItem value={32}>Long: 32 bars</LunaSelectItem>
			</LunaSelectSetting>
			<LunaSwitchSetting
				title="Bass swap"
				desc="Halfway through a beat mix, hand the bass from one song to the other so the kicks don't pile up"
				checked={bassSwap}
				onChange={(_, checked) => setBassSwap((settings.bassSwap = checked))}
			/>
		</LunaSettings>
	);
};
