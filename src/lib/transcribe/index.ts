/**
 * Transcription orchestrator.
 *
 * Tries the Python/librosa backend first (Option A — more accurate); falls
 * back to the pure client-side DSP pipeline (Option B) when the server is
 * not running. Both return the same Transcription JSON.
 */

import type { Transcription } from '../../types';
import { toMono } from '../decode';
import { computeSpectralFrames } from './spectral';
import { estimateTempo, trackBeats } from './tempo';
import { detectHits } from './classify';
import { analyzeOnServer, serverAvailable } from '../backendClient';

export interface AnalysisProgress {
  stage: 'decoding' | 'uploading' | 'spectral' | 'onsets' | 'tempo' | 'classify' | 'done';
  /** 0..1 overall progress. */
  progress: number;
  detail?: string;
}

export class NoDrumsDetectedError extends Error {
  constructor() {
    super(
      'No clear drum onsets were detected. The track may be too quiet, heavily compressed, or contain no percussive content.',
    );
    this.name = 'NoDrumsDetectedError';
  }
}

export async function transcribe(
  file: File | Blob,
  audioBuffer: AudioBuffer,
  onProgress: (p: AnalysisProgress) => void,
): Promise<Transcription> {
  // --- Option A: server-side librosa analysis ---
  if (await serverAvailable()) {
    try {
      onProgress({ stage: 'uploading', progress: 0.1, detail: 'Uploading to analysis server…' });
      const result = await analyzeOnServer(file, (p) =>
        onProgress({ stage: 'uploading', progress: 0.1 + p * 0.8, detail: 'Server analyzing…' }),
      );
      onProgress({ stage: 'done', progress: 1 });
      return result;
    } catch (err) {
      console.warn('Server analysis failed, falling back to client DSP:', err);
    }
  }

  // --- Option B: client-side DSP ---
  return transcribeClientSide(audioBuffer, onProgress);
}

export async function transcribeClientSide(
  audioBuffer: AudioBuffer,
  onProgress: (p: AnalysisProgress) => void,
): Promise<Transcription> {
  onProgress({ stage: 'decoding', progress: 0.02, detail: 'Preparing audio…' });
  const mono = toMono(audioBuffer);
  const sampleRate = audioBuffer.sampleRate;

  // Spectral analysis is ~85% of the work.
  const frames = await computeSpectralFrames(mono, sampleRate, (p) =>
    onProgress({ stage: 'spectral', progress: 0.05 + p * 0.75, detail: 'Analyzing spectrum…' }),
  );

  onProgress({ stage: 'onsets', progress: 0.82, detail: 'Detecting drum hits…' });
  const hits = detectHits(frames);
  if (hits.length < 4) throw new NoDrumsDetectedError();

  onProgress({ stage: 'tempo', progress: 0.88, detail: 'Estimating tempo…' });
  const tempo = estimateTempo(frames.flux, frames.frameDuration);
  // Track actual beat positions so the notation grid follows the
  // recording's tempo drift instead of assuming a perfect click track.
  const beatTimes = trackBeats(
    frames.flux,
    frames.frameDuration,
    tempo.bpm,
    tempo.firstBeatOffset,
    audioBuffer.duration,
  );

  onProgress({ stage: 'done', progress: 1 });

  return {
    bpm: tempo.bpm,
    firstBeatOffset: beatTimes[0] ?? tempo.firstBeatOffset,
    beatTimes: beatTimes.length >= 2 ? beatTimes : undefined,
    timeSignature: [4, 4],
    quantize: 16,
    duration: audioBuffer.duration,
    hits,
    source: 'client-dsp',
  };
}
