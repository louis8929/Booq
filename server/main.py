"""
DrumScribe analysis backend (Option A — higher accuracy).

FastAPI service that analyzes an uploaded audio file with librosa and returns
the same Transcription JSON the client-side engine produces, so the frontend
can use either interchangeably.

Pipeline:
  1. Load audio (librosa handles MP3/WAV/M4A via soundfile/audioread/ffmpeg).
  2. HPSS (harmonic-percussive source separation) to isolate the percussive
     component — this is the big accuracy win over the client-side engine,
     since melodic/harmonic content stops polluting the onset bands.
  3. Tempo + beat tracking (librosa.beat.beat_track on the percussive part).
  4. Onset detection on the percussive component.
  5. Per-onset band-energy classification (same heuristic family as the
     client, but computed on the *separated* percussive spectrogram).

For production-grade accuracy, swap step 5 for a trained model — see the
notes at the bottom of this file and the README ("Hardest parts").

Run:
  pip install -r requirements.txt
  uvicorn main:app --host 127.0.0.1 --port 8000
"""

from __future__ import annotations

import io
import tempfile
import os
from typing import Literal

import numpy as np
import librosa
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="DrumScribe Analysis API")

# Vite dev server proxies /api → here, but allow direct calls too.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

MAX_FILE_BYTES = 50 * 1024 * 1024  # 50 MB
ANALYSIS_SR = 22050  # downsample for speed; plenty for drum bands

DrumType = Literal[
    "kick", "snare", "hihat-closed", "hihat-open",
    "crash", "ride", "tom-high", "tom-mid", "tom-low",
]


class DrumHit(BaseModel):
    time: float
    drum: DrumType
    velocity: float


class Transcription(BaseModel):
    bpm: float
    firstBeatOffset: float
    # Tracked beat times: the frontend builds its measure grid on these so
    # notation stays in sync with recordings whose tempo drifts.
    beatTimes: list[float] | None = None
    timeSignature: tuple[int, int] = (4, 4)
    quantize: int = 16
    duration: float
    hits: list[DrumHit]
    source: str = "server-librosa"


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "engine": "librosa"}


@app.post("/api/analyze", response_model=Transcription)
async def analyze(file: UploadFile = File(...)) -> Transcription:
    raw = await file.read()
    if len(raw) > MAX_FILE_BYTES:
        raise HTTPException(413, "File too large (max 50 MB)")
    if len(raw) < 1000:
        raise HTTPException(400, "File too small to be valid audio")

    # librosa.load accepts file-like objects for most formats; fall back to a
    # temp file for codecs that need a real path (m4a via audioread/ffmpeg).
    try:
        y, sr = librosa.load(io.BytesIO(raw), sr=ANALYSIS_SR, mono=True)
    except Exception:
        suffix = os.path.splitext(file.filename or "audio.mp3")[1] or ".mp3"
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(raw)
            path = tmp.name
        try:
            y, sr = librosa.load(path, sr=ANALYSIS_SR, mono=True)
        except Exception as exc:
            raise HTTPException(400, f"Could not decode audio: {exc}") from exc
        finally:
            os.unlink(path)

    duration = float(len(y) / sr)
    if duration < 2:
        raise HTTPException(400, "Audio too short (need at least 2 seconds)")

    return _transcribe(y, sr, duration)


def _transcribe(y: np.ndarray, sr: int, duration: float) -> Transcription:
    hop = 512

    # 1. Percussive separation — the main accuracy advantage of the server.
    y_perc = librosa.effects.percussive(y, margin=3.0)

    # 2. Tempo & beats
    tempo, beat_frames = librosa.beat.beat_track(y=y_perc, sr=sr, hop_length=hop)
    bpm = float(np.atleast_1d(tempo)[0])
    if bpm <= 0:
        bpm = 120.0
    # Fold into a sane range and snap near-integers
    while bpm < 60:
        bpm *= 2
    while bpm > 200:
        bpm /= 2
    if abs(bpm - round(bpm)) < 0.35:
        bpm = float(round(bpm))

    beat_times = librosa.frames_to_time(beat_frames, sr=sr, hop_length=hop)
    # Beat 1 of measure 1: the first tracked beat. Which beat of the bar it
    # is remains ambiguous without downbeat tracking (see notes below) — the
    # frontend has a "Bar start ±1 beat" control for that.
    first_beat_offset = float(beat_times[0]) if len(beat_times) else 0.0

    # 3. Per-band onset detection on the percussive STFT.
    # Detecting on ONE global novelty curve misses quiet hits (hi-hats under
    # walls of guitar); each drum family gets its own envelope + threshold.
    S = np.abs(librosa.stft(y_perc, n_fft=2048, hop_length=hop))
    S_raw = np.abs(librosa.stft(y, n_fft=2048, hop_length=hop))
    freqs = librosa.fft_frequencies(sr=sr, n_fft=2048)
    n_frames = S.shape[1]
    f_max = min(16000, sr / 2 - 100)

    def band_flux(spec: np.ndarray, lo: float, hi: float) -> np.ndarray:
        seg = spec[(freqs >= lo) & (freqs < hi), :]
        d = np.diff(seg, axis=1, prepend=seg[:, :1])
        return np.maximum(d, 0.0).sum(axis=0)

    kick_env = band_flux(S, 30, 130)
    mid_env = band_flux(S, 150, 900)
    high_env = band_flux(S, 2000, 6000)
    snare_env = mid_env + high_env
    hat_env = band_flux(S, 6000, f_max)
    # RAW brilliance energy for decay: HPSS truncates cymbal tails.
    brill_energy = S_raw[(freqs >= 6000) & (freqs < f_max), :].sum(axis=0)

    def onsets_of(env: np.ndarray, wait: int) -> np.ndarray:
        return librosa.onset.onset_detect(
            onset_envelope=env, sr=sr, hop_length=hop,
            backtrack=False, delta=0.03, wait=wait,
        )

    kick_frames = onsets_of(kick_env, wait=6)
    snare_frames = onsets_of(snare_env, wait=6)
    hat_frames = onsets_of(hat_env, wait=3)
    if len(kick_frames) + len(snare_frames) + len(hat_frames) < 4:
        raise HTTPException(422, "No clear drum onsets detected in this track")

    def peak(arr: np.ndarray, f: int) -> float:
        return float(arr[max(0, f - 1): min(n_frames, f + 3)].max(initial=0.0))

    def ref(arr: np.ndarray, frames_idx: np.ndarray) -> float:
        if len(frames_idx) == 0:
            return 1e-9
        vals = [peak(arr, int(f)) for f in frames_idx]
        return float(np.percentile(vals, 95)) or 1e-9

    r_kick = ref(kick_env, kick_frames)
    r_snare = ref(snare_env, snare_frames)
    r_high = ref(high_env, snare_frames)
    r_mid = ref(mid_env, snare_frames)
    r_hat = ref(hat_env, hat_frames)

    def decay_seconds(arr: np.ndarray, f: int, window_s: float = 0.6) -> float:
        end = min(n_frames, f + int(window_s * sr / hop))
        seg = arr[f:end]
        if len(seg) == 0 or seg.max() <= 0:
            return 0.0
        peak_i = int(seg.argmax())
        below = np.where(seg[peak_i:] < seg.max() * 0.3)[0]
        frames_to_decay = int(below[0]) if len(below) else len(seg) - peak_i
        return frames_to_decay * hop / sr

    def to_time(f: int) -> float:
        return float(librosa.frames_to_time(f, sr=sr, hop_length=hop))

    def vel(v: float) -> float:
        return float(np.clip(v, 0.2, 1.0))

    hits: list[DrumHit] = []

    for f in kick_frames:
        fi = int(f)
        strength = peak(kick_env, fi) / r_kick
        if strength < 0.28:  # picked-bass attacks share the band, several × weaker
            continue
        hits.append(DrumHit(time=to_time(fi), drum="kick", velocity=vel(strength)))

    snare_times: list[float] = []
    for f in snare_frames:
        fi = int(f)
        if peak(snare_env, fi) / r_snare < 0.22:  # weak mid transients: guitar bleed
            continue
        hi = peak(high_env, fi) / r_high
        md = peak(mid_env, fi) / r_mid
        if hi > 0.18 and hi > md * 0.3:
            drum = "snare"
            snare_times.append(to_time(fi))
        elif md > 0.5 and hi < 0.12:
            # Strong mid, no wire noise → tom; pitch from the percussive
            # mid-band centroid (the full-spectrum centroid is guitar-dominated).
            rows = (freqs >= 150) & (freqs < 900)
            col = S[rows, fi: fi + 1]
            centroid = float((freqs[rows][:, None] * col).sum() / (col.sum() + 1e-9))
            drum = "tom-low" if centroid < 250 else "tom-mid" if centroid < 400 else "tom-high"
        else:
            # Ambiguous mid transient — usually palm-muted guitar chugs
            # surviving HPSS; emitting them floods the score with ghost toms.
            continue
        hits.append(DrumHit(time=to_time(fi), drum=drum, velocity=vel(peak(snare_env, fi) / r_snare)))  # type: ignore[arg-type]

    snare_arr = np.array(snare_times) if snare_times else np.empty(0)
    for f in hat_frames:
        fi = int(f)
        t = to_time(fi)
        br = peak(hat_env, fi) / r_hat
        # Snare-wire bleed into the brilliance band: drop weak coincident hits,
        # keep clear ones (snare + hat together is the most common groove).
        if len(snare_arr) and float(np.abs(snare_arr - t).min()) < 0.035 and br < 0.3:
            continue
        dec = decay_seconds(brill_energy, fi)
        if br > 0.75 and dec > 0.4:
            drum = "crash"
        elif br > 0.4 and dec > 0.3:
            drum = "ride"
        elif dec > 0.16 and br > 0.35:
            drum = "hihat-open"
        else:
            drum = "hihat-closed"
        hits.append(DrumHit(time=t, drum=drum, velocity=vel(br)))  # type: ignore[arg-type]

    hits.sort(key=lambda h: h.time)
    return Transcription(
        bpm=bpm,
        firstBeatOffset=first_beat_offset,
        beatTimes=[float(b) for b in beat_times] if len(beat_times) >= 2 else None,
        duration=duration,
        hits=hits,
    )


# ---------------------------------------------------------------------------
# Accuracy upgrade path (in increasing order of effort):
#
# 1. madmom downbeat tracking (RNNDownBeatProcessor) — fixes the "which beat
#    is beat 1" ambiguity that this file approximates with a modulo.
# 2. NMF drum decomposition: factorize the percussive spectrogram against
#    fixed kick/snare/hat templates (librosa.decompose.decompose with fixed W)
#    and threshold the activation curves — substantially better than band
#    heuristics for dense mixes.
# 3. A trained model: ADTLib, or Omnizart's drum module, or a custom CRNN on
#    log-mel patches around each onset (train on E-GMD). This is what
#    commercial tools effectively do.
# ---------------------------------------------------------------------------
