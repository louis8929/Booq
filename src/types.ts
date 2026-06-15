/**
 * The structured transcription format. This is the single source of truth:
 * the notation renderer, grid editor, exporters and sync engine all derive
 * from this JSON-serializable object.
 */

export type DrumType =
  | 'kick'
  | 'snare'
  | 'hihat-closed'
  | 'hihat-open'
  | 'crash'
  | 'ride'
  | 'tom-high'
  | 'tom-mid'
  | 'tom-low';

export interface DrumHit {
  /** Onset time in seconds, relative to the start of the audio file. */
  time: number;
  drum: DrumType;
  /** 0..1 normalized loudness of the hit. */
  velocity: number;
}

export type QuantizeLevel = 4 | 8 | 16 | 32;

export interface Transcription {
  /** Estimated (or user-corrected) tempo in BPM. */
  bpm: number;
  /** Time in seconds of beat 1 of measure 1 (audio rarely starts on the beat). */
  firstBeatOffset: number;
  /**
   * Tracked beat times in seconds, when available. Real recordings drift
   * around their nominal tempo; building measures on these instead of a
   * fixed bpm grid keeps notation and audio in sync over a whole song.
   * Absent → a fixed grid from bpm/firstBeatOffset is used.
   */
  beatTimes?: number[];
  /** Only 4/4 is produced by the analyzer; the format allows others. */
  timeSignature: [number, number];
  /** Grid resolution hits are snapped to for notation (subdivisions per whole note). */
  quantize: QuantizeLevel;
  /** Audio duration in seconds. */
  duration: number;
  /** Raw (un-quantized) detected hits, sorted by time. */
  hits: DrumHit[];
  /** Where the analysis came from, for the UI badge. */
  source: 'client-dsp' | 'server-librosa' | 'demo' | 'midi-import' | 'midi-aligned';
  /** Present when an imported tab has been aligned to an original recording.
   *  Structurally `import('./lib/align').Alignment`; typed loosely here to
   *  avoid a lib→types import cycle. */
  align?: import('./lib/align').Alignment;
}

export interface AudioMeta {
  name: string;
  sizeBytes: number;
  duration: number;
  sampleRate: number;
}

/** Drum ordering used by grid editor rows and notation mapping. */
export const DRUM_ORDER: DrumType[] = [
  'crash',
  'ride',
  'hihat-open',
  'hihat-closed',
  'tom-high',
  'tom-mid',
  'snare',
  'tom-low',
  'kick',
];

export const DRUM_LABELS: Record<DrumType, string> = {
  kick: 'Kick',
  snare: 'Snare',
  'hihat-closed': 'Hi-Hat (closed)',
  'hihat-open': 'Hi-Hat (open)',
  crash: 'Crash',
  ride: 'Ride',
  'tom-high': 'High Tom',
  'tom-mid': 'Mid Tom',
  'tom-low': 'Floor Tom',
};

/** General MIDI percussion key numbers (channel 10). */
export const DRUM_MIDI: Record<DrumType, number> = {
  kick: 36,
  snare: 38,
  'hihat-closed': 42,
  'hihat-open': 46,
  crash: 49,
  ride: 51,
  'tom-high': 48,
  'tom-mid': 47,
  'tom-low': 43,
};
