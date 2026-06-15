/**
 * Drum hit detection — per-band onset detection on the HPSS percussive
 * component.
 *
 * Earlier versions detected onsets on ONE global novelty curve and then
 * classified each onset. On dense mixes that misses most of the quiet
 * hits: a hi-hat under distorted guitars never wins against a global
 * adaptive threshold dominated by snare/kick/guitar energy. Detecting
 * independently per band fixes recall:
 *
 *   fluxLow   (30–130 Hz)  → kick
 *   fluxMid+High           → snare (wires present) or tom (no wires)
 *   fluxBrill (6–16 kHz)   → hi-hat / ride / crash, split by decay time
 *                            measured on the RAW brilliance energy
 *                            (HPSS truncates cymbal tails)
 *
 * State of the art uses NMF or neural nets (see README / server notes);
 * these heuristics are deliberately isolated here so a model can replace
 * them without touching the rest of the app.
 */

import type { DrumHit, DrumType } from '../../types';
import type { SpectralFrames } from './spectral';
import { detectOnsets, type Onset } from './onsets';

function decaySeconds(arr: Float32Array, start: number, frameDuration: number): number {
  const look = Math.round(0.6 / frameDuration);
  const end = Math.min(arr.length, start + look);
  let peak = 0;
  let peakI = start;
  for (let i = start; i < end; i++) {
    if (arr[i] > peak) {
      peak = arr[i];
      peakI = i;
    }
  }
  if (peak <= 0) return 0;
  for (let j = peakI; j < end; j++) {
    if (arr[j] < peak * 0.3) return (j - peakI) * frameDuration;
  }
  return (end - peakI) * frameDuration;
}

function pct95At(arr: Float32Array, onsets: Onset[]): number {
  if (!onsets.length) return 1e-9;
  const vals = onsets.map((o) => peek(arr, o.frame, arr.length)).sort((a, b) => a - b);
  return vals[Math.floor(vals.length * 0.95)] || 1e-9;
}

/** Peak value in a tiny window around a frame (transients land ±1 frame). */
function peek(arr: Float32Array, f: number, count: number): number {
  let m = 0;
  for (let j = Math.max(0, f - 1); j <= Math.min(count - 1, f + 2); j++) {
    m = Math.max(m, arr[j]);
  }
  return m;
}

export function detectHits(frames: SpectralFrames): DrumHit[] {
  const fd = frames.frameDuration;
  const n = frames.count;
  const hits: DrumHit[] = [];

  // Snare novelty = mid + high together (shell resonance + wire noise)
  const snareFlux = new Float32Array(n);
  for (let i = 0; i < n; i++) snareFlux[i] = frames.fluxMid[i] + frames.fluxHigh[i];

  const kickOnsets = detectOnsets(frames.fluxLow, fd, { minGapSeconds: 0.08, sensitivity: 1.15 });
  const snareOnsets = detectOnsets(snareFlux, fd, { minGapSeconds: 0.08, sensitivity: 1.1 });
  const hatOnsets = detectOnsets(frames.fluxBrill, fd, { minGapSeconds: 0.045, sensitivity: 1.15 });

  const refKick = pct95At(frames.fluxLow, kickOnsets);
  const refSnare = pct95At(snareFlux, snareOnsets);
  const refHigh = pct95At(frames.fluxHigh, snareOnsets);
  const refMid = pct95At(frames.fluxMid, snareOnsets);
  const refBrill = pct95At(frames.fluxBrill, hatOnsets);

  const vel = (v: number) => Math.min(1, Math.max(0.2, v));

  // --- Kick ---
  for (const o of kickOnsets) {
    const strength = peek(frames.fluxLow, o.frame, n) / refKick;
    // Picked bass-guitar attacks live in the same band but are several times
    // weaker than a kick thump; gate on relative strength.
    if (strength < 0.28) continue;
    hits.push({ time: o.time, drum: 'kick', velocity: vel(strength) });
  }

  // --- Snare / toms ---
  const snareTimes: number[] = [];
  for (const o of snareOnsets) {
    const strength = peek(snareFlux, o.frame, n) / refSnare;
    if (strength < 0.22) continue; // weak mid transients: guitar bleed
    const hi = peek(frames.fluxHigh, o.frame, n) / refHigh;
    const md = peek(frames.fluxMid, o.frame, n) / refMid;
    let drum: DrumType;
    if (hi > 0.18 && hi > md * 0.3) {
      drum = 'snare';
      snareTimes.push(o.time);
    } else if (md > 0.5 && hi < 0.12) {
      // Strong mid energy with almost no wire noise → tom; pitch from the
      // percussive mid-band centroid.
      const c = frames.midCentroid[o.frame];
      drum = c < 250 ? 'tom-low' : c < 400 ? 'tom-mid' : 'tom-high';
    } else {
      // Ambiguous mid-band transient — almost always palm-muted guitar
      // chugs surviving HPSS. Emitting them floods the score with ghost
      // toms; skip instead.
      continue;
    }
    hits.push({ time: o.time, drum, velocity: vel(peek(snareFlux, o.frame, n) / refSnare) });
  }

  // --- Cymbal family ---
  for (const o of hatOnsets) {
    const br = peek(frames.fluxBrill, o.frame, n) / refBrill;
    // Snare wires bleed into the brilliance band: drop hat hits that
    // coincide with a snare AND are weak — keep them when clearly present
    // (snare + hat together is the most common groove element).
    const nearSnare = snareTimes.some((t) => Math.abs(t - o.time) < 0.035);
    if (nearSnare && br < 0.3) continue;

    const decay = decaySeconds(frames.brill, o.frame, fd); // RAW energy decay
    let drum: DrumType;
    if (br > 0.75 && decay > 0.4) drum = 'crash';
    else if (br > 0.4 && decay > 0.3) drum = 'ride';
    else if (decay > 0.16 && br > 0.35) drum = 'hihat-open';
    else drum = 'hihat-closed';
    hits.push({ time: o.time, drum, velocity: vel(br) });
  }

  hits.sort((a, b) => a.time - b.time);
  return hits;
}
