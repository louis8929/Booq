/**
 * STFT analysis with harmonic/percussive separation (HPSS).
 *
 * The naive approach — spectral flux on the full mix — fails on dense
 * productions: distorted guitars keep the flux envelope high everywhere, the
 * adaptive threshold rises with it, and quiet hi-hats vanish ("missing
 * notes"). The fix, same idea as librosa's `effects.percussive`:
 *
 *   1. Project each FFT frame onto ~96 log-spaced bands (cheap, compact).
 *   2. Median-filter the band spectrogram along TIME (enhances harmonic,
 *      sustained content) and along FREQUENCY (enhances percussive,
 *      broadband transients).
 *   3. Soft-mask: P = S · medF² / (medF² + medT² + ε). Guitars/vocals/bass
 *      are mostly removed from P; drum transients survive.
 *
 * All flux outputs (used for onset detection and beat tracking) come from
 * the percussive component. Band ENERGIES and the centroid stay raw — HPSS
 * truncates cymbal tails, and the crash/ride/hat disambiguation needs real
 * decay times.
 *
 * Bands tracked for classification:
 *   low   (30–130 Hz)   — kick fundamental
 *   mid   (150–900 Hz)  — snare body, toms
 *   high  (2–6 kHz)     — snare wires, attack transients
 *   brill (6–16 kHz)    — hi-hats and cymbals
 */

import { magnitudeSpectrum } from '../fft';

export const FFT_SIZE = 2048;
export const HOP_SIZE = 512;

const N_BANDS = 96;
const F_MIN = 30;
const K_TIME = 21; // median kernel along time (~220 ms at 48 kHz)
const K_FREQ = 13; // median kernel along frequency

export interface SpectralFrames {
  /** Frame count. */
  count: number;
  /** Seconds per frame hop. */
  frameDuration: number;
  /** RAW band energies (for decay measurements). */
  low: Float32Array;
  mid: Float32Array;
  high: Float32Array;
  brill: Float32Array;
  total: Float32Array;
  centroid: Float32Array;
  /** Centroid of the PERCUSSIVE mid band (150–900 Hz) — tom pitch estimate.
   *  The full-mix centroid is dominated by guitars and useless for that. */
  midCentroid: Float32Array;
  /** PERCUSSIVE-component spectral flux (onset/beat detection). */
  flux: Float32Array;
  fluxLow: Float32Array;
  fluxMid: Float32Array;
  fluxHigh: Float32Array;
  fluxBrill: Float32Array;
}

/** Yield to the event loop WITHOUT setTimeout: background tabs clamp timers
 *  to ≥1 s; MessageChannel macrotasks are not throttled. */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => resolve();
    ch.port2.postMessage(null);
  });
}

/** Median by insertion sort on a scratch window (kernels are small). */
function median(win: Float32Array, n: number): number {
  for (let i = 1; i < n; i++) {
    const v = win[i];
    let j = i - 1;
    while (j >= 0 && win[j] > v) {
      win[j + 1] = win[j];
      j--;
    }
    win[j + 1] = v;
  }
  return win[n >> 1];
}

export async function computeSpectralFrames(
  mono: Float32Array,
  sampleRate: number,
  onProgress?: (p: number) => void,
): Promise<SpectralFrames> {
  const count = Math.max(1, Math.floor((mono.length - FFT_SIZE) / HOP_SIZE) + 1);
  const frameDuration = HOP_SIZE / sampleRate;
  const fMax = Math.min(16000, sampleRate / 2 - 100);

  // Band edges in FFT bins: log-spaced targets but guaranteed ≥1 bin per
  // band. Purely log-spaced bands are narrower than the FFT resolution in
  // the bass, leaving most low bands EMPTY — their zero values then drive
  // the frequency median to zero and the HPSS mask deletes the kick drum.
  const hzPerBin = sampleRate / FFT_SIZE;
  const edges: number[] = [1]; // start at bin 1 (~23 Hz at 48 kHz)
  for (let k = 1; k <= N_BANDS; k++) {
    const f = F_MIN * Math.pow(fMax / F_MIN, k / N_BANDS);
    const e = Math.max(edges[edges.length - 1] + 1, Math.round(f / hzPerBin));
    if (e >= FFT_SIZE / 2) break;
    edges.push(e);
  }
  const nBands = edges.length - 1;
  const bandOfBin = new Int16Array(FFT_SIZE / 2).fill(-1);
  const bandCenter = new Float32Array(nBands);
  for (let b = 0; b < nBands; b++) {
    bandCenter[b] = Math.sqrt(edges[b] * edges[b + 1]) * hzPerBin;
    for (let i = edges[b]; i < edges[b + 1]; i++) bandOfBin[i] = b;
  }
  const bandRange = (lo: number, hi: number): [number, number] => {
    let a = nBands - 1;
    let b = 0;
    for (let i = 0; i < nBands; i++) {
      if (bandCenter[i] >= lo && bandCenter[i] <= hi) {
        a = Math.min(a, i);
        b = Math.max(b, i);
      }
    }
    return [a, b];
  };
  const [lowA, lowB] = bandRange(30, 130);
  const [midA, midB] = bandRange(150, 900);
  const [hiA, hiB] = bandRange(2000, 6000);
  const [brA, brB] = bandRange(6000, fMax);

  const frames: SpectralFrames = {
    count,
    frameDuration,
    low: new Float32Array(count),
    mid: new Float32Array(count),
    high: new Float32Array(count),
    brill: new Float32Array(count),
    total: new Float32Array(count),
    centroid: new Float32Array(count),
    midCentroid: new Float32Array(count),
    flux: new Float32Array(count),
    fluxLow: new Float32Array(count),
    fluxMid: new Float32Array(count),
    fluxHigh: new Float32Array(count),
    fluxBrill: new Float32Array(count),
  };

  // ---- Stage 1: STFT → raw band spectrogram (band-major layout) ----
  const spec = new Float32Array(nBands * count);
  const re = new Float32Array(FFT_SIZE);
  const im = new Float32Array(FFT_SIZE);
  const mag = new Float32Array(FFT_SIZE / 2);
  const col = new Float32Array(nBands);
  const CHUNK = 256;

  for (let f = 0; f < count; f++) {
    magnitudeSpectrum(mono, f * HOP_SIZE, FFT_SIZE, re, im, mag);
    col.fill(0);
    let total = 0;
    let weighted = 0;
    for (let i = 1; i < mag.length; i++) {
      const b = bandOfBin[i];
      if (b >= 0) col[b] += mag[i];
      total += mag[i];
      weighted += mag[i] * i * hzPerBin;
    }
    for (let b = 0; b < nBands; b++) spec[b * count + f] = col[b];

    let e = 0;
    for (let b = lowA; b <= lowB; b++) e += col[b];
    frames.low[f] = e;
    e = 0;
    for (let b = midA; b <= midB; b++) e += col[b];
    frames.mid[f] = e;
    e = 0;
    for (let b = hiA; b <= hiB; b++) e += col[b];
    frames.high[f] = e;
    e = 0;
    for (let b = brA; b <= brB; b++) e += col[b];
    frames.brill[f] = e;
    frames.total[f] = total;
    frames.centroid[f] = total > 1e-9 ? weighted / total : 0;

    if (f % CHUNK === CHUNK - 1) {
      onProgress?.(0.6 * (f / count));
      await yieldToEventLoop();
    }
  }

  // ---- Stage 2: HPSS soft mask → percussive spectrogram (in place) ----
  // 2a. Median along time per band → medT
  const medT = new Float32Array(nBands * count);
  const winT = new Float32Array(K_TIME);
  const halfT = K_TIME >> 1;
  for (let b = 0; b < nBands; b++) {
    const row = b * count;
    for (let f = 0; f < count; f++) {
      const a = Math.max(0, f - halfT);
      const z = Math.min(count - 1, f + halfT);
      let n = 0;
      for (let j = a; j <= z; j++) winT[n++] = spec[row + j];
      medT[row + f] = median(winT, n);
    }
    if (b % 12 === 11) {
      onProgress?.(0.6 + 0.2 * (b / nBands));
      await yieldToEventLoop();
    }
  }

  // 2b. Median along frequency per frame, mask, overwrite spec with percussive
  const winF = new Float32Array(K_FREQ);
  const halfF = K_FREQ >> 1;
  const colS = new Float32Array(nBands);
  for (let f = 0; f < count; f++) {
    for (let b = 0; b < nBands; b++) colS[b] = spec[b * count + f];
    for (let b = 0; b < nBands; b++) {
      const a = Math.max(0, b - halfF);
      const z = Math.min(nBands - 1, b + halfF);
      let n = 0;
      for (let j = a; j <= z; j++) winF[n++] = colS[j];
      const mF = median(winF, n);
      const mT = medT[b * count + f];
      const num = mF * mF;
      const den = num + mT * mT + 1e-12;
      spec[b * count + f] = colS[b] * (num / den);
    }
    if (f % 1024 === 1023) {
      onProgress?.(0.8 + 0.15 * (f / count));
      await yieldToEventLoop();
    }
  }

  // ---- Stage 3: per-band percussive flux ----
  for (let f = 1; f < count; f++) {
    let fluxAll = 0;
    let fl = 0,
      fm = 0,
      fh = 0,
      fb = 0;
    for (let b = 0; b < nBands; b++) {
      const d = spec[b * count + f] - spec[b * count + f - 1];
      if (d > 0) {
        fluxAll += d;
        if (b >= lowA && b <= lowB) fl += d;
        else if (b >= midA && b <= midB) fm += d;
        else if (b >= hiA && b <= hiB) fh += d;
        else if (b >= brA && b <= brB) fb += d;
      }
    }
    frames.flux[f] = fluxAll;
    frames.fluxLow[f] = fl;
    frames.fluxMid[f] = fm;
    frames.fluxHigh[f] = fh;
    frames.fluxBrill[f] = fb;

    // Percussive mid-band centroid for tom pitch
    let mSum = 0;
    let mWeighted = 0;
    for (let b = midA; b <= midB; b++) {
      const v = spec[b * count + f];
      mSum += v;
      mWeighted += v * bandCenter[b];
    }
    frames.midCentroid[f] = mSum > 1e-9 ? mWeighted / mSum : 0;
  }

  onProgress?.(1);
  return frames;
}
