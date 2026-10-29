# Changelog

## 1.5.0

### New
- **DJ mixing** for the new TidalDJ plugin: two players, so one song can blend into the next. When the tempos are close the next song is matched to the playing one's tempo (pitch kept), starts on a bar line and takes over the bass halfway through; otherwise a short fade.
- **Beat analysis:** each song is decoded on the side to find its tempo, beats, bars, and where the intro ends and the outro starts.

## 1.4.1

### Fixed
- Visualizer setting changes sometimes weren't saved: the database refused values still tied to the store (#15).
- The Visualizer tab now says when a music video is playing, since the visualizer only works with audio tracks.

## 1.4.0

### Visualizer
- New **Layers** style: stacked waves, each one a step behind and bigger than the one inside it, in rainbow, cover, gradient or solid colors.
- **Particles:** sparks drifting out from the ring, more on bass hits (works with every style).
- **Four-way** mirror: the bands go round the ring four times, so the bass opens at both sides (or top and bottom) at once.
- **Round cover:** shows the cover as a circle; the ring then hugs it instead of going round its corners.
- New **Rainbow layers** preset putting it all together: a round cover, a thin white ring at rest, and wings that open left and right on the bass with rainbow rims.

### Improved
- The visualizer only downloads and decodes a track once its cover is on screen, so tracks nobody looks at cost nothing.
- Long tracks (DJ mixes, hours long) no longer pile up in memory: past 400 MB the download is passed straight through instead of kept.
- Keyboard control for equalizer bands and color points.
- Screenshots in the README.

## 1.3.1

### Fixed
- The Visualizer and Equalizer tabs couldn't be scrolled, so the last sections (Response, Performance, Share) were cut off below the window (#14).

## 1.3.0

### Visualizer
- Works with the equalizer off: TIDAL plays with its own player, untouched, and the bars show the original sound in sync with it. With the equalizer on, both still share one download.

## 1.2.2

### Improved
- The visualizer is now part of the cover itself: it lives inside the cover's box, so the cover and the ring move, tilt and beat as one piece and can't drift apart.

## 1.2.1

### Fixed
- Visualizer not showing on albums with an animated cover, which TIDAL plays as a video (#11).
- Visualizer off-center (up to ~35 px) while the cover beats, more so the further right the cover sits (#13).
- If mpv crashes or is closed, TIDAL takes the sound back instead of staying muted, with a notice (#12).
- A track whose download fails plays through TIDAL instead of staying silent, without retrying in a loop (#12).
- Changing the equalizer while mpv is still starting no longer launches extra mpv processes (#12).
- Clicking a tab several times quickly no longer mounts its panel twice (#12).
- The settings page and the Equalizer tab no longer undo each other's changes (#12).
- The volume slider no longer briefly mutes videos (#12).
- Visualizer: samples could be read twice or carried over from the previous track; the cover color could come from the previous cover (#12).
- The preamp list shows every preset's value; Reset in the settings page also resets the preamp; scrolling only changes a band's width over its dot.

### Improved
- Less work per frame in the visualizer, and none at all while it's off; sample reads only fetch what's new.
- mpv runs without user scripts or online lookups; leftover temp files from a crash are cleaned up.
- Consistent "color" spelling, readable labels for screen readers, and a note that TidalEQ is Windows-only.

## 1.2.0

### Visualizer
- **Colors from the cover:** up to 24 color points, picked automatically from every new cover (the most vivid and different colors, blended around the ring in hue order). Switch to **Manual** to place your own: drag, click to add, double-click to remove.
- Dark cover colors are brightened so they show on TIDAL's tinted background; the glow uses the lightest color in use.
- **Resets:** ↺ next to any changed setting, double-click a slider, a reset per section, and **Reset all** with a confirmation.
- Click a value to type it exactly (out-of-range values are clamped).
- **Presets:** Default, Minimal, Neon ring, Aura, Club, Pearls, Inner glow; save your own looks and delete them.
- **Copy / Paste settings** to share a look. Pasted settings are checked: unknown keys dropped, values clamped.
- Animated preview while the music is paused and the Visualizer tab is open.
- Options that don't apply to the chosen style are hidden, and size labels follow the style.
- The ring follows TIDAL's 3D tilt of the cover, and the cover beat scales the whole cover with the bars.
- Stays clear of TIDAL's tab bar, player bar and side panel; bar thickness is capped.

### Fixed
- Visualizer shifted off the cover when TIDAL moves the artwork (#2).
- White square around the cover when hovering it (#3).
- **Inside** placement hidden under the cover; wave fill tinting the cover (#4).
- Bars running over TIDAL's tabs and player bar; few bars turning into blobs (#5).
- Equalizer curve cut off at 1 kHz (#6).
- Cover beat leaving TIDAL's border inside the cover (#7).
- Equalizer and Visualizer tabs missing on tracks without lyrics (#8).
- Presets losing color points, Auto picking one color, Copy/Paste blocked (#9).
- Temp files named "undefined" (#10).

## 1.1.0

- **Visualizer** tab: the real spectrum of what you hear (after the equalizer) around the now-playing cover. Bars, wave or dots; following the cover or in a circle; outside, inside or both ways; colors, glow, motion, response and frame rate are all adjustable.
- Fixed: the start of a song repeating briefly on a track change (#1).

## 1.0.0

- First release in its own repository.
- **Equalizer** tab in TIDAL's now-playing view, in TIDAL's own style, centred on the cover and usable at every window size.
- 10 parametric bands on a draggable frequency response graph, Bass/Voice/Treble controls and 19 presets.
- Preamp, smart volume and limiter. Plays through mpv; TIDAL's own player stays in sync, muted.
