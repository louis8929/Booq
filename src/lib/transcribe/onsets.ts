/**
 * Onset detection: adaptive peak picking on a spectral-flux novelty curve.
 *
 * A frame is an onset when its flux exceeds a moving median + a fraction of
 * the moving max (adaptive threshold), is a local maximum in a small window,
 * and is at least `minGap` after the previous onset (drums can't physically
 * re-trigger faster than ~50 ms in a meaningful way for notation).
 */

export interface Onset {
  /** Frame index into the SpectralFrames arrays. */
  frame: number;
  time: number;
  /** Novelty strength, useful for velocity. */
  strength: number;
}

export function detectOnsets(
  flux: Float32Array,
  frameDuration: number,
  opts: { minGapSeconds?: number; sensitivity?: number } = {},
): Onset[] {
  const minGap = Math.max(1, Math.round((opts.minGapSeconds ?? 0.05) / frameDuration));
  const sensitivity = opts.sensitivity ?? 1.0;
  const n = flux.length;
  if (n < 8) return [];

  // Smooth slightly to suppress jitter
  const smooth = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    smooth[i] = (flux[Math.max(0, i - 1)] + flux[i] + flux[Math.min(n - 1, i + 1)]) / 3;
  }

  // Moving median (approximated by sorting a sliding window — window is
  // small so this is fine) over ~0.7 s for the adaptive threshold.
  const half = Math.round(0.35 / frameDuration);
  const window: number[] = [];
  const threshold = new Float32Array(n);
  let globalMax = 0;
  for (let i = 0; i < n; i++) globalMax = Math.max(globalMax, smooth[i]);
  if (globalMax <= 0) return [];

  for (let i = 0; i < n; i++) {
    window.length = 0;
    const a = Math.max(0, i - half);
    const b = Math.min(n - 1, i + half);
    for (let j = a; j <= b; j++) window.push(smooth[j]);
    window.sort((x, y) => x - y);
    const median = window[Math.floor(window.length / 2)];
    threshold[i] = median * (1.3 / sensitivity) + globalMax * (0.02 / sensitivity);
  }

  const onsets: Onset[] = [];
  let lastOnset = -minGap;
  const local = 3; // local-max window in frames (~35 ms)
  for (let i = 1; i < n - 1; i++) {
    if (smooth[i] <= threshold[i]) continue;
    let isMax = true;
    for (let j = Math.max(0, i - local); j <= Math.min(n - 1, i + local); j++) {
      if (smooth[j] > smooth[i]) { isMax = false; break; }
    }
    if (!isMax) continue;
    if (i - lastOnset < minGap) {
      // Keep the stronger of the two colliding onsets
      const prev = onsets[onsets.length - 1];
      if (prev && smooth[i] > prev.strength) {
        prev.frame = i;
        prev.time = i * frameDuration;
        prev.strength = smooth[i];
        lastOnset = i;
      }
      continue;
    }
    onsets.push({ frame: i, time: i * frameDuration, strength: smooth[i] });
    lastOnset = i;
  }
  return onsets;
}
