# 🥁 DrumScribe

Upload a song → get editable drum sheet music → practice along with a real-time
scrolling score.

React + TypeScript + Tailwind + VexFlow on the front, with **two interchangeable
transcription engines**: a pure client-side DSP pipeline (works with zero setup)
and an optional Python/FastAPI + librosa backend (more accurate). Both produce
the same structured JSON, and the frontend auto-detects the server and falls
back gracefully.

## Quick start

```bash
npm install
npm run dev          # → http://localhost:5173
```

That's it — the client-side engine needs no server. Try the three built-in demo
beats (rock / funk / metal, synthesized in-browser) or drop in any MP3/WAV/M4A.

### Optional: higher-accuracy Python backend

```bash
cd server
python -m venv .venv
.venv\Scripts\activate          # Windows  (Linux/macOS: source .venv/bin/activate)
pip install -r requirements.txt
uvicorn main:app --host 127.0.0.1 --port 8000
```

The Vite dev server proxies `/api` → `127.0.0.1:8000` (see `vite.config.ts`).
When `/api/health` responds, uploads are analyzed server-side (badge shows
"librosa (server)"); otherwise the client DSP engine runs (badge shows
"client DSP"). **No API keys or external services are required anywhere.**

> MP3/M4A decoding on the server needs ffmpeg on PATH if soundfile can't read
> the codec: `winget install ffmpeg` / `brew install ffmpeg` / `apt install ffmpeg`.

## Project structure

```
src/
  App.tsx                       Screen state machine (upload → edit → practice)
  types.ts                      Transcription JSON schema + drum/MIDI mappings
  components/
    UploadScreen.tsx            Drag & drop, file info, progress, demo beats
    EditScreen.tsx              Tempo/quantize/offset controls + exports
    PracticeScreen.tsx          Transport, loop, speed, metronome, shortcuts
    Notation.tsx                VexFlow host + imperative cursor API
    GridEditor.tsx              Drum-machine step editor (add/remove hits)
  lib/
    fft.ts                      Radix-2 FFT (no dependencies)
    decode.ts                   Audio decoding + mono downmix
    transcribe/
      spectral.ts               STFT → band energies + spectral flux
      onsets.ts                 Adaptive-threshold peak picking
      tempo.ts                  Autocorrelation BPM + beat-phase search
      classify.ts               Band-energy drum classification heuristics
      index.ts                  Orchestrator (server-first, client fallback)
    score.ts                    Quantized measure/slot model (single source of truth)
    notation.ts                 VexFlow engraving + note-position capture for sync
    player.ts                   Audio element + metronome lookahead scheduler
    demoBeats.ts                OfflineAudioContext beat synthesizer
    exports/                    MIDI (SMF), MusicXML, PDF (print), JSON
server/
  main.py                       FastAPI + librosa analysis (HPSS, beat track, classify)
  requirements.txt
```

## Exact scores: import a MIDI tab (the "Songsterr workflow")

Auto-transcription of a dense mix is approximate by nature. For a
Songsterr-grade experience — exact notation, perfectly synced playback —
import the drum track of an existing tab:

1. Get the song's tab in Guitar Pro format (Songsterr's catalog, Ultimate
   Guitar, etc.) and open it in MuseScore / TuxGuitar / Guitar Pro.
2. Export the **drum track** as MIDI (`.mid`).
3. On the upload screen, use **"Import .mid"**.

The score is read note-for-note from the file (tempo changes included, via
the MIDI tempo map → `beatTimes`), and playback audio is **synthesized from
the score itself** (`drumSynth.ts`) — cursor and sound are sample-locked,
which is exactly how Songsterr's player achieves its sync (it never plays
the original recording).

## The transcription JSON

Everything (notation, editor, exports, sync) derives from one serializable object:

```jsonc
{
  "bpm": 110,
  "firstBeatOffset": 0.05,        // seconds: where beat 1 of measure 1 falls
  "timeSignature": [4, 4],
  "quantize": 16,                  // grid resolution (subdivisions per whole note)
  "duration": 187.3,
  "source": "client-dsp",          // or "server-librosa" / "demo"
  "hits": [
    { "time": 0.052, "drum": "kick", "velocity": 0.9 },
    { "time": 0.331, "drum": "hihat-closed", "velocity": 0.6 }
  ]
}
```

Raw hit times are kept un-quantized; snapping to the grid happens at render
time (`score.ts`), so changing tempo/quantize/offset is non-destructive.

## The hardest parts, honestly

### 1. Accurate drum transcription

Polyphonic drum transcription from a full mix is an open research problem.
What ships here, in increasing accuracy:

- **Client DSP (Option B)**: spectral flux onset detection + per-band energy
  heuristics (kick = 30–120 Hz, snare = mid+high together, cymbals =
  6–14 kHz with decay-time disambiguating closed hat / open hat / ride /
  crash). Works well on drum-forward mixes and the demo beats; bass guitar
  and vocals will cause false kicks/snares on dense mixes.
- **Server librosa (Option A)**: adds **HPSS percussive separation** before
  onset detection, which removes most harmonic bleed, plus librosa's
  dynamic-programming beat tracker. Noticeably better on real songs.
- **Upgrade path** (documented in `server/main.py`): madmom downbeat tracking
  → NMF decomposition against drum templates → a trained CRNN (E-GMD dataset,
  or off-the-shelf ADTLib/Omnizart). The classification heuristics are
  deliberately isolated in one function on each side so a model can be
  swapped in without touching anything else.

Mitigation in the product: the **grid editor** makes fixing classification
mistakes a one-click operation, and tempo/offset are user-adjustable — a
90 %-right transcription plus 30 seconds of editing beats a black box.

### 2. Real-time notation sync

Three problems hide in "the score follows the audio":

- **Clock**: `audio.currentTime` is the ground truth (it survives
  seeks, rate changes, and buffering). A `requestAnimationFrame` loop reads
  it and drives everything; nothing keeps its own clock.
- **Time → pixels**: after VexFlow draws, we record each measure's bounding
  box and each note's absolute X (`notation.ts`). The cursor interpolates
  linearly within the current measure — visually smooth, never jumps
  backwards, and immune to VexFlow's non-linear note spacing. Notes within
  ±90 ms of "now" get a CSS class for the highlight.
- **React**: the cursor moves 60×/s; routing that through state would re-render
  the world. `Notation` exposes an imperative `setTime()` handle that mutates
  only the cursor div and note classes; React state updates are throttled to
  10 Hz for the measure/beat counters.

The metronome uses the standard lookahead pattern: convert upcoming beat times
(song time) to `AudioContext` time accounting for `playbackRate`, schedule
oscillator clicks ~150 ms ahead. Sample-accurate even at 0.5× speed.

### 3. Tempo estimation pitfalls

Octave errors (70 vs 140 BPM) are the classic failure: the autocorrelation
scorer compares each candidate with its half/double before committing, with a
log-normal prior centered on 120 BPM. Phase (where beat 1 falls) is found by
sliding a Gaussian-tolerant grid over one beat period.

**Tempo drift** is handled by adaptive beat tracking (`trackBeats` in
`tempo.ts`, `beatTimes` in the JSON): real recordings wander around their
nominal tempo, and a fixed grid accumulates the error — on a 1991 tape-era
metal track we measured ~2 s (≈3 beats) of cumulative drift over 5½ minutes,
which reads as "the notation is not synced". The score grid, playback cursor
and metronome are all built on the tracked beat times instead; measures have
variable lengths that follow the recording. Which beat of the bar is beat 1
remains ambiguous (downbeat tracking, e.g. madmom, would resolve it) — the
"Bar start ±1 beat" control in the editor fixes it in one click.

## Features checklist

- Drag & drop upload (MP3/WAV/M4A/OGG/FLAC), file info, decode + analysis progress
- Onset detection, BPM + beat-phase estimation, drum classification, grid quantization
- VexFlow percussion-staff engraving (x-heads for cymbals, open-hat "o" annotation)
- Editing: tempo, quantize level (1/4–1/32), beat-1 offset, per-hit add/remove grid
- Practice mode: scrolling highlighted score, click-to-seek, measure/beat/tempo HUD
- Loop sections (press L at start, L at end), 0.5–1.5× speed without pitch change,
  metronome click with downbeat accent
- Keyboard shortcuts: Space play/pause, ←/→ seek (Shift = one measure), ↑/↓ speed,
  L loop, M metronome, Esc back
- Exports: MIDI (GM channel 10), MusicXML 4.0 (imports into MuseScore), PDF (print
  pipeline), raw JSON
- Dark/light mode, responsive/mobile-friendly, demo beats, robust error states
  (bad codec, too short, no drums detected, server down → client fallback)

## Performance notes

- Analysis runs at 2048/512 STFT on the main thread but yields to the event
  loop every ~200 frames, keeping the UI at 60 fps; a 4-minute song analyzes in
  a few seconds. Moving `transcribe/` into a Web Worker is a mechanical change
  (the modules are DOM-free by design) if you need it.
- The server downsamples to 22.05 kHz mono before analysis and caps uploads at
  50 MB. For very long files, chunked HPSS would bound memory; not needed below
  ~15 minutes of audio.
- Playback streams from an object URL — the full file is never held in JS
  memory for playback (only the decode-for-analysis pass touches raw samples).
