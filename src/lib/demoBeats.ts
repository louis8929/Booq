/**
 * Demo beats synthesized in the browser — no MP3 assets to ship, and they
 * exercise the full pipeline (the synthesized WAV is fed through the same
 * decode → analyze path as an uploaded file).
 */

import type { DrumHit, DrumType } from '../types';
import { renderHitsToWav } from './drumSynth';

export interface DemoBeat {
  id: string;
  name: string;
  description: string;
  bpm: number;
  bars: number;
  /** pattern[drum] = 16-char string per bar, 'x' = hit, '-' = rest. */
  pattern: Partial<Record<DrumType, string>>;
}

export const DEMO_BEATS: DemoBeat[] = [
  {
    id: 'rock',
    name: 'Classic Rock',
    description: 'Straight 8ths, kick on 1 & 3, snare backbeat — 110 BPM',
    bpm: 110,
    bars: 8,
    pattern: {
      'hihat-closed': 'x-x-x-x-x-x-x-x-',
      snare: '----x-------x---',
      kick: 'x------x--x-----',
      crash: 'x---------------',
    },
  },
  {
    id: 'funk',
    name: 'Funk Groove',
    description: '16th-note hats with syncopated kick — 96 BPM',
    bpm: 96,
    bars: 8,
    pattern: {
      'hihat-closed': 'xxxxxxxxxxxxxxxx',
      snare: '----x--x----x---',
      kick: 'x--x-----x--x--x',
    },
  },
  {
    id: 'metal',
    name: 'Metal Double-Kick',
    description: 'Driving double kick under a ride pattern — 140 BPM',
    bpm: 140,
    bars: 8,
    pattern: {
      ride: 'x-x-x-x-x-x-x-x-',
      snare: '----x-------x---',
      kick: 'xx-xxx-xxx-xxx-x',
      crash: 'x---------------',
    },
  },
];

export async function renderDemoBeat(beat: DemoBeat): Promise<Blob> {
  const beatDur = 60 / beat.bpm;
  const slotDur = beatDur / 4;
  const hits: DrumHit[] = [];
  for (let bar = 0; bar < beat.bars; bar++) {
    for (const [drum, patternStr] of Object.entries(beat.pattern)) {
      for (let slot = 0; slot < 16; slot++) {
        if (patternStr[slot] === 'x') {
          hits.push({
            time: 0.05 + bar * 16 * slotDur + slot * slotDur,
            drum: drum as DrumType,
            velocity: 0.9,
          });
        }
      }
    }
  }
  return renderHitsToWav(hits, beat.bars * 4 * beatDur);
}
