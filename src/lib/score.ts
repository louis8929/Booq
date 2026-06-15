/**
 * Score model: turns the raw Transcription (hits at arbitrary times) into a
 * quantized grid of measures/slots. Everything downstream — VexFlow
 * rendering, the grid editor, MIDI/MusicXML export, and the playback sync
 * engine — consumes this model, so edits stay consistent everywhere.
 *
 * The grid is built on the *tracked beat times* when the analyzer provides
 * them (t.beatTimes), so measures follow the recording's natural tempo
 * drift and the cursor stays glued to the audio over a whole song. Without
 * beatTimes a fixed bpm grid is generated — same code path either way.
 */

import type { DrumType, Transcription } from '../types';

export interface Slot {
  /** Slot index within the measure (0 .. slotsPerMeasure-1). */
  index: number;
  /** Absolute time in seconds where this slot falls in the audio. */
  time: number;
  drums: { drum: DrumType; velocity: number }[];
}

export interface Measure {
  index: number;
  startTime: number;
  endTime: number;
  slots: Slot[];
}

export interface Score {
  measures: Measure[];
  slotsPerMeasure: number;
  /** Average — exact slot times live on the slots themselves. */
  slotDuration: number;
  /** Average — used for seek-by-measure amounts. */
  secondsPerMeasure: number;
  /** The beat grid the measures were built on. */
  beats: number[];
}

/** Beat-time array covering the whole audio: tracked beats when available,
 *  fixed bpm grid otherwise, extrapolated past the end as needed. */
function expandBeats(t: Transcription, beatsNeeded: number): number[] {
  const secondsPerBeat = 60 / t.bpm;
  const lastHit = t.hits.length ? t.hits[t.hits.length - 1].time : 0;
  const target = Math.max(t.duration, lastHit) + secondsPerBeat / 2;

  let beats: number[];
  if (t.beatTimes && t.beatTimes.length >= 2) {
    beats = [...t.beatTimes];
  } else {
    beats = [];
    for (let time = t.firstBeatOffset; time < target; time += secondsPerBeat) {
      beats.push(time);
    }
  }
  if (beats.length < 2) beats = [t.firstBeatOffset, t.firstBeatOffset + secondsPerBeat];

  // Extrapolate at the recent local tempo to cover the audio tail and
  // complete the final measure.
  const tail = beats.slice(-5);
  let avg = (tail[tail.length - 1] - tail[0]) / (tail.length - 1);
  if (!(avg > 0.05)) avg = secondsPerBeat;
  while (beats[beats.length - 1] < target || beats.length < beatsNeeded) {
    beats.push(beats[beats.length - 1] + avg);
  }
  return beats;
}

/** Index i such that beats[i] <= time < beats[i+1] (clamped). */
function beatIndexAt(beats: number[], time: number): number {
  let lo = 0;
  let hi = beats.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (beats[mid] <= time) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export function buildScore(t: Transcription): Score {
  const [beatsPerMeasure] = t.timeSignature;
  const slotsPerBeat = t.quantize / 4; // quantize is subdivisions per whole note
  const slotsPerMeasure = beatsPerMeasure * slotsPerBeat;

  let beats = expandBeats(t, beatsPerMeasure + 1);
  const measureCount = Math.max(1, Math.ceil((beats.length - 1) / beatsPerMeasure));
  beats = expandBeats(t, measureCount * beatsPerMeasure + 1);

  const measures: Measure[] = [];
  for (let m = 0; m < measureCount; m++) {
    const b0 = m * beatsPerMeasure;
    const slots: Slot[] = [];
    for (let beat = 0; beat < beatsPerMeasure; beat++) {
      const t0 = beats[b0 + beat];
      const t1 = beats[b0 + beat + 1];
      for (let s = 0; s < slotsPerBeat; s++) {
        slots.push({
          index: beat * slotsPerBeat + s,
          time: t0 + (s / slotsPerBeat) * (t1 - t0),
          drums: [],
        });
      }
    }
    measures.push({
      index: m,
      startTime: beats[b0],
      endTime: beats[b0 + beatsPerMeasure],
      slots,
    });
  }

  // Snap each hit to its nearest slot *on the local beat grid*. Hits before
  // the first beat snap to slot 0.
  for (const hit of t.hits) {
    let globalSlot = 0;
    if (hit.time >= beats[0]) {
      const i = Math.min(beatIndexAt(beats, hit.time), beats.length - 2);
      const span = Math.max(beats[i + 1] - beats[i], 1e-3);
      const frac = (hit.time - beats[i]) / span;
      globalSlot = i * slotsPerBeat + Math.round(frac * slotsPerBeat);
    }
    const m = Math.floor(globalSlot / slotsPerMeasure);
    if (m >= measures.length) continue;
    const slot = measures[m].slots[globalSlot % slotsPerMeasure];
    if (!slot.drums.some((d) => d.drum === hit.drum)) {
      slot.drums.push({ drum: hit.drum, velocity: hit.velocity });
    }
  }

  const totalSpan = beats[measureCount * beatsPerMeasure] - beats[0];
  const secondsPerMeasure = totalSpan / measureCount;
  return {
    measures,
    slotsPerMeasure,
    slotDuration: secondsPerMeasure / slotsPerMeasure,
    secondsPerMeasure,
    beats,
  };
}

/**
 * Toggle a hit at a given measure/slot/drum — used by the grid editor.
 * Operates on the Transcription (source of truth) so the score can be rebuilt.
 */
export function toggleHit(
  t: Transcription,
  score: Score,
  measureIndex: number,
  slotIndex: number,
  drum: DrumType,
): Transcription {
  const slotTime = score.measures[measureIndex].slots[slotIndex].time;
  const tolerance = score.slotDuration / 2;
  const existing = t.hits.findIndex(
    (h) => h.drum === drum && Math.abs(h.time - slotTime) < tolerance,
  );
  const hits = [...t.hits];
  if (existing >= 0) {
    hits.splice(existing, 1);
  } else {
    hits.push({ time: slotTime, drum, velocity: 0.8 });
    hits.sort((a, b) => a.time - b.time);
  }
  return { ...t, hits };
}

/** Map an audio time to measure/beat position (for the HUD counters). */
export function timeToPosition(
  t: Transcription,
  score: Score,
  time: number,
): { measure: number; beat: number } {
  const ms = score.measures;
  if (!ms.length || time <= ms[0].startTime) return { measure: 0, beat: 0 };

  let lo = 0;
  let hi = ms.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ms[mid].startTime <= time) lo = mid;
    else hi = mid - 1;
  }
  const measure = lo;
  const slots = ms[measure].slots;
  const slotsPerBeat = score.slotsPerMeasure / t.timeSignature[0];
  let slot = 0;
  while (slot + 1 < slots.length && slots[slot + 1].time <= time) slot++;
  return { measure, beat: Math.floor(slot / slotsPerBeat) };
}
