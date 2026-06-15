/**
 * Tempo (BPM) and beat-phase estimation.
 *
 * BPM: autocorrelation of the onset-strength (flux) envelope, scored over
 * 60–200 BPM with a mild prior toward 80–160 (where most popular music
 * lives). Octave errors (detecting 70 instead of 140) are the classic
 * failure mode — we compare each candidate with its double and prefer the
 * one whose half-beats also correlate well.
 *
 * Phase: given the period, slide the grid over one beat and pick the offset
 * that maximizes summed onset strength at grid points (with a small Gaussian
 * tolerance window).
 */

export interface TempoEstimate {
  bpm: number;
  /** Seconds into the audio where beat 1 falls. */
  firstBeatOffset: number;
  confidence: number;
}

export function estimateTempo(
  flux: Float32Array,
  frameDuration: number,
): TempoEstimate {
  const n = flux.length;
  // Normalize and de-mean the envelope
  const env = new Float32Array(n);
  let mean = 0;
  for (let i = 0; i < n; i++) mean += flux[i];
  mean /= n;
  for (let i = 0; i < n; i++) env[i] = Math.max(0, flux[i] - mean);

  const minBpm = 60;
  const maxBpm = 200;
  const minLag = Math.floor(60 / (maxBpm * frameDuration));
  const maxLag = Math.min(n - 1, Math.ceil(60 / (minBpm * frameDuration)));

  const score = new Float32Array(maxLag + 1);
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = 0; i < n - lag; i++) s += env[i] * env[i + lag];
    // Prior: gentle preference for 80–160 BPM
    const bpm = 60 / (lag * frameDuration);
    const prior = Math.exp(-0.5 * ((Math.log2(bpm / 120)) / 0.6) ** 2);
    score[lag] = s * (0.5 + 0.5 * prior);
  }

  let bestLag = minLag;
  for (let lag = minLag; lag <= maxLag; lag++) {
    if (score[lag] > score[bestLag]) bestLag = lag;
  }

  // Octave disambiguation: if half the lag (double tempo) is in range and
  // scores nearly as well, prefer the faster interpretation only when its
  // score is genuinely competitive; vice versa for half tempo.
  const halfLag = Math.round(bestLag / 2);
  if (halfLag >= minLag && score[halfLag] > 0.85 * score[bestLag]) {
    bestLag = halfLag;
  } else {
    const doubleLag = bestLag * 2;
    if (doubleLag <= maxLag && score[doubleLag] > 1.15 * score[bestLag]) {
      bestLag = doubleLag;
    }
  }

  const beatPeriod = bestLag * frameDuration; // seconds per beat
  const bpmRaw = 60 / beatPeriod;
  // Snap to an integer BPM if very close — most produced music has one.
  const bpm = Math.abs(bpmRaw - Math.round(bpmRaw)) < 0.35 ? Math.round(bpmRaw) : Math.round(bpmRaw * 10) / 10;

  // ---- Phase search ----
  const period = 60 / bpm; // refined period in seconds
  const steps = 64;
  let bestPhase = 0;
  let bestPhaseScore = -1;
  const sigma = 0.03; // 30 ms tolerance
  for (let s = 0; s < steps; s++) {
    const phase = (s / steps) * period;
    let total = 0;
    for (let t = phase; t < n * frameDuration; t += period) {
      const frame = Math.round(t / frameDuration);
      // Gaussian-weighted neighborhood sum
      for (let j = -3; j <= 3; j++) {
        const f = frame + j;
        if (f < 0 || f >= n) continue;
        const dt = j * frameDuration;
        total += env[f] * Math.exp(-0.5 * (dt / sigma) ** 2);
      }
    }
    if (total > bestPhaseScore) {
      bestPhaseScore = total;
      bestPhase = phase;
    }
  }

  // Confidence: peak autocorrelation vs envelope energy
  let energy = 0;
  for (let i = 0; i < n; i++) energy += env[i] * env[i];
  const confidence = energy > 0 ? Math.min(1, score[bestLag] / energy) : 0;

  return { bpm, firstBeatOffset: bestPhase, confidence };
}

/**
 * Adaptive beat tracking — the fix for tempo drift.
 *
 * Real recordings (anything played by humans, or pre-click-track tape
 * recordings) wander around their nominal tempo. A fixed bpm grid
 * accumulates that error: 0.2 BPM off ≈ a full measure of drift over a
 * five-minute song, which reads as "the notation is not synced".
 *
 * This tracker walks through the song one beat at a time: predict the next
 * beat at the current period, look for an onset-energy peak in a ±15%
 * window around the prediction (Gaussian-weighted so near-prediction peaks
 * win ties), snap to it when one exists, and let the period adapt slowly
 * (clamped to ±12% of nominal so a fill can't derail it). The resulting
 * beat-time array becomes the notation grid.
 */
export function trackBeats(
  flux: Float32Array,
  frameDuration: number,
  bpm: number,
  phase: number,
  duration: number,
): number[] {
  const n = flux.length;
  const nominal = 60 / bpm;
  if (n < 8 || nominal <= 0) return [];

  // Lightly smoothed envelope + mean for the "is there really an onset here" gate
  const env = new Float32Array(n);
  let mean = 0;
  for (let i = 0; i < n; i++) {
    env[i] = (flux[Math.max(0, i - 1)] + flux[i] + flux[Math.min(n - 1, i + 1)]) / 3;
    mean += env[i];
  }
  mean /= n;

  const beats: number[] = [];
  let period = nominal;
  let predicted = phase;

  while (predicted < duration + period / 2) {
    const win = 0.15 * period;
    const a = Math.max(0, Math.round((predicted - win) / frameDuration));
    const b = Math.min(n - 1, Math.round((predicted + win) / frameDuration));
    let bestFrame = -1;
    let bestScore = 0;
    for (let i = a; i <= b; i++) {
      const dt = i * frameDuration - predicted;
      const w = Math.exp(-0.5 * (dt / (win / 2)) ** 2);
      const s = env[i] * w;
      if (s > bestScore) {
        bestScore = s;
        bestFrame = i;
      }
    }

    let beat = predicted;
    // Snap only to genuine onsets; in silence (intro/breakdown) free-wheel
    // at the current period instead of chasing noise.
    if (bestFrame >= 0 && env[bestFrame] > mean * 0.5) {
      beat = bestFrame * frameDuration;
    }
    const prev = beats[beats.length - 1];
    if (prev !== undefined && beat <= prev + 0.4 * period) beat = prev + period;
    beats.push(beat);

    if (beats.length >= 2) {
      const interval = beat - beats[beats.length - 2];
      if (interval > 0.7 * nominal && interval < 1.3 * nominal) {
        period = 0.85 * period + 0.15 * interval;
        period = Math.min(nominal * 1.12, Math.max(nominal * 0.88, period));
      }
    }
    predicted = beat + period;
  }

  return beats;
}
