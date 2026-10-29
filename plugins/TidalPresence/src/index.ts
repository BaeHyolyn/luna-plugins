import { Tracer, type LunaUnload } from "@luna/core";
import { MediaItem, redux } from "@luna/lib";

import { cleanupRPC } from "./discord.native";
import { stopPresence, updateActivity } from "./presence";

export const unloads = new Set<LunaUnload>();
export const { trace, errSignal } = Tracer("[TidalPresence]");
export { Settings } from "./Settings";

redux.intercept(["playbackControls/SEEK", "playbackControls/SET_PLAYBACK_STATE"], unloads, () => {
	updateActivity();
});
MediaItem.onMediaTransition(unloads, (mediaItem) => {
	updateActivity(mediaItem);
});
unloads.add(stopPresence);
unloads.add(cleanupRPC.bind(cleanupRPC));

setTimeout(updateActivity);
