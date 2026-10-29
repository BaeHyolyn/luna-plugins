# BaeHyolyn's Luna plugins

Plugins for [TidaLuna](https://github.com/Inrixia/TidaLuna), all in one store.

| Plugin | What it does |
| --- | --- |
| [TidalPresence](plugins/TidalPresence/README.md) | Your TIDAL music in Discord, your way: custom text, audio quality, karaoke lyrics and more. |
| [TidalEQ](plugins/TidalEQ/README.md) | A real equalizer and visualizer inside TIDAL. Needs mpv, Windows only for now. |
| [TidalDJ](plugins/TidalDJ/README.md) | An endless DJ: keeps the music going with radio picks, and with TidalEQ mixes songs on the beat. |

## Install

1. Install [TidaLuna](https://github.com/Inrixia/TidaLuna).
2. In TIDAL, open **Settings → Luna → Plugin Store**.
3. Paste this into **Install from URL**:

   ```
   https://github.com/BaeHyolyn/luna-plugins/releases/latest/download/store.json
   ```

4. Install the plugins you want from the store that appears.

## Develop

```
pnpm install
pnpm run watch   # serves dist/ on http://127.0.0.1:3000
pnpm test
```

## License

AGPL-3.0. TidalPresence started from Inrixia's DiscordRPC plugin.
