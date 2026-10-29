import { LunaSettings, LunaSwitchSetting, LunaTextSetting, LunaSelectSetting, LunaSelectItem } from "@luna/ui";

import { ReactiveStore } from "@luna/core";

import React from "react";
import { updateActivity } from "./presence";
import { getAvailablePipes } from "./getAvailablePipes.native";
import { t } from "./i18n";
import { applyStyle, type LyricStyle } from "./styles";

export type SmallIcon = "artist" | "quality" | "none";
export type TimeMode = "bar" | "elapsed" | "none";

const defaultCustomStatusText = "{track} by {artist}";
const defaultCustomDetailsText = "{track}";
const defaultCustomStateText = "{artist}";
const defaultCustomCoverText = "{album} · {quality}";

export const settings = await ReactiveStore.getPluginStorage("TidalPresence", {
	displayOnPause: true,
	// Legacy toggle, only read to migrate into smallIcon
	displayArtistIcon: true,
	// Left undefined so the migration below can decide it for existing users
	smallIcon: undefined as SmallIcon | undefined,
	displayPlaylistButton: true,
	displayAlbumButton: true,
	privateMode: false,
	timeMode: "bar" as TimeMode,
	lyricLeadMs: 300,
	lyricStyle: "normal" as LyricStyle,
	hiddenArtists: "",
	customStatusText: defaultCustomStatusText,
	customDetailsText: defaultCustomDetailsText,
	customStateText: defaultCustomStateText,
	customCoverText: defaultCustomCoverText,
	pipeId: -1,
});

settings.customStatusText ||= defaultCustomStatusText;
settings.customDetailsText ||= defaultCustomDetailsText;
settings.customStateText ||= defaultCustomStateText;
settings.customCoverText ||= defaultCustomCoverText;
settings.displayAlbumButton ??= true;
settings.smallIcon ??= settings.displayArtistIcon === false ? "none" : "artist";
if (settings.pipeId === undefined) settings.pipeId = -1;

const presets = {
	minimal: { label: "presetMinimal", status: "{track}", details: "{track}", state: "{artist}", cover: "{album}" },
	detailed: { label: "presetDetailed", status: "{track} by {artist}", details: "{track}", state: "{artist} · {album} ({year})", cover: "{album} · {quality}" },
	audiophile: { label: "presetAudiophile", status: "{track} · {quality}", details: "{track}", state: "{artist}", cover: "{album} · {year} · {quality}" },
	karaoke: { label: "presetKaraoke", status: "{track} by {artist}", details: "{track}", state: "{lyric}", cover: "{album}" },
	karaoke2: { label: "presetKaraoke2", status: "{track} by {artist}", details: "{lyric}", state: "{nextLyric}", cover: "{album}" },
	karaoke3: { label: "presetKaraoke3", status: "{track} by {artist}", details: "{lyric}", state: "{nextLyric}", cover: "{nextLyric2}" },
} as const;

const TagList = () => (
	<ul>
		<li>{`{track}`}</li>
		<li>{`{artist}`}</li>
		<li>{`{album}`}</li>
		<li>{`{year}`}</li>
		<li>{`{duration}`}</li>
		<li>{`{trackNumber}`}</li>
		<li>{`{quality}`} ({t("tagQuality")})</li>
		<li>{`{lyric}`} ({t("tagLyric")})</li>
		<li>{`{nextLyric}`} ({t("tagNextLyric")})</li>
		<li>{`{nextLyric2}`} ({t("tagNextLyric2")})</li>
		<li>{`{playlist}`} ({t("tagPlaylist")})</li>
	</ul>
);

export const Settings = () => {
	const [privateMode, setPrivateMode] = React.useState(settings.privateMode);
	const [hiddenArtists, setHiddenArtists] = React.useState(settings.hiddenArtists);
	const [displayOnPause, setDisplayOnPause] = React.useState(settings.displayOnPause);
	const [smallIcon, setSmallIcon] = React.useState(settings.smallIcon);
	const [timeMode, setTimeMode] = React.useState(settings.timeMode);
	const [lyricLeadMs, setLyricLeadMs] = React.useState(settings.lyricLeadMs);
	const [lyricStyle, setLyricStyle] = React.useState(settings.lyricStyle);
	const [displayPlaylistButton, setDisplayPlaylistButton] = React.useState(settings.displayPlaylistButton);
	const [displayAlbumButton, setDisplayAlbumButton] = React.useState(settings.displayAlbumButton);
	const [customStatusText, setCustomStatusText] = React.useState(settings.customStatusText);
	const [customDetailsText, setCustomDetailsText] = React.useState(settings.customDetailsText);
	const [customStateText, setCustomStateText] = React.useState(settings.customStateText);
	const [customCoverText, setCustomCoverText] = React.useState(settings.customCoverText);

	const [pipeId, setPipeId] = React.useState(settings.pipeId);
	const [availablePipes, setAvailablePipes] = React.useState<number[]>([]);

	React.useEffect(() => {
		getAvailablePipes().then((pipes) => {
			setAvailablePipes(pipes);
			if (pipes.length > 0 && !pipes.includes(settings.pipeId)) {
				setPipeId((settings.pipeId = pipes[0]));
				updateActivity();
			}
		});
	}, []);

	return (
		<LunaSettings>
			{availablePipes.length > 1 && (
				<LunaSelectSetting
					title={t("pipeTitle")}
					desc={t("pipeDesc")}
					value={pipeId.toString()}
					onChange={(e) => {
						setPipeId((settings.pipeId = parseInt(e.target.value, 10)));
						updateActivity();
					}}
				>
					{availablePipes.map((pipe) => (
						<LunaSelectItem key={pipe} value={pipe.toString()}>
							Pipe {pipe}
						</LunaSelectItem>
					))}
				</LunaSelectSetting>
			)}

			<LunaSwitchSetting
				title={t("privateTitle")}
				desc={t("privateDesc")}
				tooltip={t("privateTitle")}
				checked={privateMode}
				onChange={(_, checked) => {
					setPrivateMode((settings.privateMode = checked));
					updateActivity();
				}}
			/>
			<LunaTextSetting
				title={t("hiddenTitle")}
				desc={t("hiddenDesc")}
				value={hiddenArtists}
				onChange={(e) => {
					setHiddenArtists((settings.hiddenArtists = e.target.value));
					updateActivity();
				}}
			/>
			<LunaSwitchSetting
				title={t("pausedTitle")}
				desc={t("pausedDesc")}
				tooltip={t("pausedTitle")}
				checked={displayOnPause}
				onChange={(_, checked) => {
					setDisplayOnPause((settings.displayOnPause = checked));
					updateActivity();
				}}
			/>

			<LunaSelectSetting
				title={t("smallIconTitle")}
				desc={t("smallIconDesc")}
				value={smallIcon}
				onChange={(e) => {
					setSmallIcon((settings.smallIcon = e.target.value as SmallIcon));
					updateActivity();
				}}
			>
				<LunaSelectItem value="artist">{t("smallIconArtist")}</LunaSelectItem>
				<LunaSelectItem value="quality">{t("smallIconQuality")}</LunaSelectItem>
				<LunaSelectItem value="none">{t("none")}</LunaSelectItem>
			</LunaSelectSetting>
			<LunaSelectSetting
				title={t("timeTitle")}
				desc={t("timeDesc")}
				value={timeMode}
				onChange={(e) => {
					setTimeMode((settings.timeMode = e.target.value as TimeMode));
					updateActivity();
				}}
			>
				<LunaSelectItem value="bar">{t("timeBar")}</LunaSelectItem>
				<LunaSelectItem value="elapsed">{t("timeElapsed")}</LunaSelectItem>
				<LunaSelectItem value="none">{t("timeHidden")}</LunaSelectItem>
			</LunaSelectSetting>
			<LunaSwitchSetting
				title={t("playlistBtnTitle")}
				desc={t("playlistBtnDesc")}
				tooltip={t("playlistBtnTitle")}
				checked={displayPlaylistButton}
				onChange={(_, checked) => {
					setDisplayPlaylistButton((settings.displayPlaylistButton = checked));
					updateActivity();
				}}
			/>
			<LunaSwitchSetting
				title={t("albumBtnTitle")}
				desc={t("albumBtnDesc")}
				tooltip={t("albumBtnTitle")}
				checked={displayAlbumButton}
				onChange={(_, checked) => {
					setDisplayAlbumButton((settings.displayAlbumButton = checked));
					updateActivity();
				}}
			/>

			<LunaSelectSetting
				title={t("leadTitle")}
				desc={t("leadDesc")}
				value={lyricLeadMs.toString()}
				onChange={(e) => {
					setLyricLeadMs((settings.lyricLeadMs = parseInt(e.target.value, 10)));
					updateActivity();
				}}
			>
				{[0, 300, 600, 900, 1200].map((ms) => (
					<LunaSelectItem key={ms} value={ms.toString()}>
						{ms === 0 ? t("leadNone") : `${ms} ms`}
					</LunaSelectItem>
				))}
			</LunaSelectSetting>
			<LunaSelectSetting
				title={t("lyricStyleTitle")}
				desc={t("lyricStyleDesc")}
				value={lyricStyle}
				onChange={(e) => {
					setLyricStyle((settings.lyricStyle = e.target.value as LyricStyle));
					updateActivity();
				}}
			>
				{(["normal", "bold", "italic", "smallCaps"] as const).map((style) => (
					<LunaSelectItem key={style} value={style}>
						{applyStyle(t("lyricStyleSample"), style)}
					</LunaSelectItem>
				))}
			</LunaSelectSetting>
			<LunaSelectSetting
				title={t("presetsTitle")}
				desc={t("presetsDesc")}
				value=""
				displayEmpty
				onChange={(e) => {
					const preset = presets[e.target.value as keyof typeof presets];
					if (!preset) return;
					setCustomStatusText((settings.customStatusText = preset.status));
					setCustomDetailsText((settings.customDetailsText = preset.details));
					setCustomStateText((settings.customStateText = preset.state));
					setCustomCoverText((settings.customCoverText = preset.cover));
					updateActivity();
				}}
			>
				<LunaSelectItem value="" disabled>
					{t("presetsPlaceholder")}
				</LunaSelectItem>
				{Object.entries(presets).map(([key, preset]) => (
					<LunaSelectItem key={key} value={key}>
						{t(preset.label)}
					</LunaSelectItem>
				))}
			</LunaSelectSetting>
			<LunaTextSetting
				title={t("statusTitle")}
				desc={
					<>
						{t("statusDesc")}
						<TagList />
						{t("default")}: <b>{defaultCustomStatusText}</b>
					</>
				}
				value={customStatusText}
				onChange={(e) => {
					setCustomStatusText((settings.customStatusText = e.target.value || defaultCustomStatusText));
					updateActivity();
				}}
			/>
			<LunaTextSetting
				title={t("detailsTitle")}
				desc={
					<>
						{t("detailsDesc")}
						<br />
						{t("default")}: <b>{defaultCustomDetailsText}</b>
					</>
				}
				value={customDetailsText}
				onChange={(e) => {
					setCustomDetailsText((settings.customDetailsText = e.target.value || defaultCustomDetailsText));
					updateActivity();
				}}
			/>
			<LunaTextSetting
				title={t("stateTitle")}
				desc={
					<>
						{t("stateDesc")}
						<br />
						{t("default")}: <b>{defaultCustomStateText}</b>
					</>
				}
				value={customStateText}
				onChange={(e) => {
					setCustomStateText((settings.customStateText = e.target.value || defaultCustomStateText));
					updateActivity();
				}}
			/>
			<LunaTextSetting
				title={t("coverTitle")}
				desc={
					<>
						{t("coverDesc")}
						<br />
						{t("default")}: <b>{defaultCustomCoverText}</b>
					</>
				}
				value={customCoverText}
				onChange={(e) => {
					setCustomCoverText((settings.customCoverText = e.target.value || defaultCustomCoverText));
					updateActivity();
				}}
			/>
			<p style={{ opacity: 0.6, fontSize: 12 }}>TidalPresence by BaeHyolyn · AGPL-3.0 · originally derived from DiscordRPC (Inrixia)</p>
		</LunaSettings>
	);
};
