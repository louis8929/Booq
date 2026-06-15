/**
 * Align an imported MIDI tab (exact score, written tempo) to the ORIGINAL
 * recording (real, drifting tempo) so the user can read the precise notation
 * while hearing the actual song.
 *
 * The notation comes from the MIDI; the timing comes from the recording.
 * We detect the recording's real beat positions (reusing the analysis
 * pipeline) and remap every MIDI note onto them: a note written on beat 12.5
 * of the tab is placed at the recording's beat 12.5. Because the recording's
 * own beats carry its tempo drift, the score stays glued to the audio over a
 * whole song — far better than scaling by a single average tempo.
 *
 * `beatOffset` (whole beats) lines up the tab's beat 1 with the recording's
 * beat 1 when one has a count-in/intro the other lacks; `secOffset` is a fine
 * nudge in seconds. Both are adjustable after the fact (reapplyAlignment) so
 * the user can correct a one-bar or few-ms misalignment without re-analyzing.
 */

import type { DrumHit, Transcription } from '../types';
import { toMono } from './decode';
import { computeSpectralFrames } from './transcribe/spectral';
import { estimateTempo, trackBeats } from './transcribe/tempo';

export interface Alignment {
  /** Original MIDI notes (absolute times in the tab's own timeline). */
  midiHits: DrumHit[];
  /** The tab's beat grid (one entry per quarter note). */
  midiBeatTimes: number[];
  /** The recording's detected beat grid. */
  recBeatTimes: number[];
  /** Whole-beat shift: tab beat k ↔ recording beat k + beatOffset. */
  beatOffset: number;
  /** Fine offset in seconds applied to the recording grid. */
  secOffset: number;
  /** Recording duration in seconds. */
  recDuration: number;
}

export interface BeatAnalysis {
  beatTimes: number[];
  bpm: number;
  duration: number;
}

/** Detect the recording's beat grid (no drum classification needed). */
export async function detectRecordingBeats(
  buffer: AudioBuffer,
  onProgress?: (p: number) => void,
): Promise<BeatAnalysis> {
  const mono = toMono(buffer);
  const frames = await computeSpectralFrames(mono, buffer.sampleRate, (p) => onProgress?.(p * 0.9));
  const tempo = estimateTempo(frames.flux, frames.frameDuration);
  const beatTimes = trackBeats(
    frames.flux,
    frames.frameDuration,
    tempo.bpm,
    tempo.firstBeatOffset,
    buffer.duration,
  );
  onProgress?.(1);
  if (beatTimes.length < 2) {
    throw new Error('Could not detect a steady beat in the recording to sync to.');
  }
  return { beatTimes, bpm: tempo.bpm, duration: buffer.duration };
}

/** Time → fractional beat index on a beat grid (e.g. 12.5 = halfway to beat 13). */
function timeToFractionalBeat(beats: number[], t: number): number {
  if (t <= beats[0]) {
    const span = beats[1] - beats[0] || 1;
    return (t - beats[0]) / span;
  }
  if (t >= beats[beats.length - 1]) {
    const span = beats[beats.length - 1] - beats[beats.length - 2] || 1;
    return beats.length - 1 + (t - beats[beats.length - 1]) / span;
  }
  // binary search for the bracketing beat
  let lo = 0;
  let hi = beats.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (beats[mid] <= t) lo = mid;
    else hi = mid - 1;
  }
  const span = beats[lo + 1] - beats[lo] || 1;
  return lo + (t - beats[lo]) / span;
}

/** Fractional beat index → time, extrapolating past either end. */
function fractionalBeatToTime(beats: number[], fb: number): number {
  if (fb <= 0) {
    const span = beats[1] - beats[0] || 1;
    return beats[0] + fb * span;
  }
  const last = beats.length - 1;
  if (fb >= last) {
    const span = beats[last] - beats[last - 1] || 1;
    return beats[last] + (fb - last) * span;
  }
  const i = Math.floor(fb);
  const span = beats[i + 1] - beats[i] || 1;
  return beats[i] + (fb - i) * span;
}

/** Remap MIDI hits onto the recording's beat grid. */
function remapHits(
  midiHits: DrumHit[],
  midiBeats: number[],
  recBeats: number[],
  beatOffset: number,
): DrumHit[] {
  return midiHits
    .map((h) => {
      const fb = timeToFractionalBeat(midiBeats, h.time) + beatOffset;
      return { ...h, time: fractionalBeatToTime(recBeats, fb) };
    })
    .filter((h) => h.time >= 0)
    .sort((a, b) => a.time - b.time);
}

/** Build an aligned transcription from an imported MIDI tab + recording beats. */
export function buildAlignedTranscription(
  midi: Transcription,
  rec: BeatAnalysis,
  beatOffset = 0,
  secOffset = 0,
): Transcription {
  const alignment: Alignment = {
    midiHits: midi.align ? midi.align.midiHits : midi.hits,
    midiBeatTimes: midi.align ? midi.align.midiBeatTimes : midi.beatTimes ?? [],
    recBeatTimes: rec.beatTimes,
    beatOffset,
    secOffset,
    recDuration: rec.duration,
  };
  return applyAlignment({ ...midi, bpm: rec.bpm, duration: rec.duration }, alignment);
}

/** Recompute hits + grid for a given alignment. Cheap; safe to call on every nudge. */
export function applyAlignment(t: Transcription, a: Alignment): Transcription {
  const recBeats = a.recBeatTimes.map((b) => b + a.secOffset);
  const hits = remapHits(a.midiHits, a.midiBeatTimes, recBeats, a.beatOffset);
  // Grid starts at the tab's beat 1 = recording beat `beatOffset`, so measure
  // boundaries match the tab's bars rather than the raw recording phase.
  const gridStart = Math.max(0, a.beatOffset);
  const beatTimes = recBeats.slice(gridStart);
  return {
    ...t,
    hits,
    beatTimes: beatTimes.length >= 2 ? beatTimes : recBeats,
    firstBeatOffset: beatTimes[0] ?? 0,
    duration: a.recDuration,
    source: 'midi-aligned',
    align: a,
  };
}

/** Nudge an already-aligned transcription. */
export function reapplyAlignment(
  t: Transcription,
  deltaBeats: number,
  deltaSec: number,
): Transcription {
  if (!t.align) return t;
  return applyAlignment(t, {
    ...t.align,
    beatOffset: t.align.beatOffset + deltaBeats,
    secOffset: t.align.secOffset + deltaSec,
  });
}
