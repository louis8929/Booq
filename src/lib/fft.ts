/**
 * Minimal iterative radix-2 real FFT, returning magnitude spectrum.
 * Fast enough to analyze a full song on the main thread when work is
 * chunked (see transcribe/index.ts).
 */

const twiddleCache = new Map<number, { cos: Float32Array; sin: Float32Array }>();

function twiddles(n: number) {
  let t = twiddleCache.get(n);
  if (!t) {
    const cos = new Float32Array(n / 2);
    const sin = new Float32Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      cos[i] = Math.cos((-2 * Math.PI * i) / n);
      sin[i] = Math.sin((-2 * Math.PI * i) / n);
    }
    t = { cos, sin };
    twiddleCache.set(n, t);
  }
  return t;
}

/**
 * In-place complex FFT. `re` and `im` must have power-of-two length.
 */
export function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  if ((n & (n - 1)) !== 0) throw new Error('FFT size must be a power of two');

  // Bit reversal permutation
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }

  const { cos, sin } = twiddles(n);
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const step = n / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < half; k++) {
        const idx = k * step;
        const wRe = cos[idx];
        const wIm = sin[idx];
        const uRe = re[i + k];
        const uIm = im[i + k];
        const vRe = re[i + k + half] * wRe - im[i + k + half] * wIm;
        const vIm = re[i + k + half] * wIm + im[i + k + half] * wRe;
        re[i + k] = uRe + vRe;
        im[i + k] = uIm + vIm;
        re[i + k + half] = uRe - vRe;
        im[i + k + half] = uIm - vIm;
      }
    }
  }
}

const hannCache = new Map<number, Float32Array>();

export function hannWindow(size: number): Float32Array {
  let w = hannCache.get(size);
  if (!w) {
    w = new Float32Array(size);
    for (let i = 0; i < size; i++) {
      w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (size - 1)));
    }
    hannCache.set(size, w);
  }
  return w;
}

/**
 * Magnitude spectrum of one windowed frame. `out` must be length size/2.
 */
export function magnitudeSpectrum(
  samples: Float32Array,
  offset: number,
  size: number,
  re: Float32Array,
  im: Float32Array,
  out: Float32Array,
): void {
  const win = hannWindow(size);
  for (let i = 0; i < size; i++) {
    const s = offset + i < samples.length ? samples[offset + i] : 0;
    re[i] = s * win[i];
    im[i] = 0;
  }
  fft(re, im);
  for (let i = 0; i < size / 2; i++) {
    out[i] = Math.hypot(re[i], im[i]);
  }
}
