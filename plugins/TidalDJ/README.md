# TidalDJ

An endless DJ for TIDAL. When your queue runs out, it keeps the music going with songs from TIDAL's radio for the current track, picked to fit the moment. With [TidalEQ](../TidalEQ/README.md) it also mixes songs into each other like a DJ, on the beat.

## Install

From the store: see the [main README](../../README.md#install).

## Features

- **DJ button** in the player bar, next to the play queue. Click it to drop the songs queued after this one and let the DJ pick from here. It shows a circle while the DJ is choosing the next songs.
- **Modes:**
  - **Flow:** keeps the current tempo.
  - **Chill:** slower songs.
  - **Party:** faster songs.
  - **Discover:** avoids artists you just heard.
  - **Club:** leaves each song early (after 60% of it) and only for a song it can beat-match.
- **Your taste:** songs and artists in your favorites come first; an artist you skip in the first 30 seconds is avoided for the rest of the session.
- Never repeats a song in a session, and remembers songs TIDAL refused to play (region locks) so it doesn't pick them again.
- **Mix** (needs TidalEQ with its equalizer on): each song blends into the next.
  - When the tempos are close (within 8%, half or double time counts), the next song is sped up or slowed down to match (pitch kept), starts on a bar line, and the two play together for 16 bars; halfway, the bass swaps from one to the other.
  - Otherwise a short fade, still starting on a bar line.
  - Songs your own queue brings get mixed too; the DJ only picks songs once the queue runs out (or you click the DJ button).

## How it works

TidalDJ asks TIDAL for the radio of the playing song and scores each candidate by mode, tempo, artists you just heard, your favorites and your skips. For mixing, TidalEQ decodes each song on the side and finds its tempo, beats, bars, and where the intro ends and the outro starts; TidalDJ uses that to choose when the mix starts.

## License

AGPL-3.0
