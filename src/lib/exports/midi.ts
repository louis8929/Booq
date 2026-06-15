/**
 * Standard MIDI File (format 0) export of the drum transcription.
 * Hand-rolled SMF writer — drums go on channel 10 (index 9) using GM
 * percussion key numbers.
 */

import { DRUM_MIDI, type Transcription } from '../../types';
import { buildScore } from '../score';

const TPQ = 480; // ticks per quarter note

function vlq(value: number): number[] {
  // Variable-length quantity encoding
  const bytes = [value & 0x7f];
  value >>= 7;
  while (value > 0) {
    bytes.unshift((value & 0x7f) | 0x80);
    value >>= 7;
  }
  return bytes;
}

export function transcriptionToMidi(t: Transcription): Blob {
  const score = buildScore(t);
  const events: { tick: number; bytes: number[] }[] = [];

  // Tempo meta event at tick 0
  const usPerQuarter = Math.round(60_000_000 / t.bpm);
  events.push({
    tick: 0,
    bytes: [0xff, 0x51, 0x03, (usPerQuarter >> 16) & 0xff, (usPerQuarter >> 8) & 0xff, usPerQuarter & 0xff],
  });
  // 4/4 time signature
  events.push({ tick: 0, bytes: [0xff, 0x58, 0x04, 4, 2, 24, 8] });

  const ticksPerSlot = (TPQ * 4) / t.quantize;
  for (const measure of score.measures) {
    for (const slot of measure.slots) {
      const tick = Math.round(
        (measure.index * score.slotsPerMeasure + slot.index) * ticksPerSlot,
      );
      for (const d of slot.drums) {
        const key = DRUM_MIDI[d.drum];
        const vel = Math.max(1, Math.min(127, Math.round(d.velocity * 127)));
        events.push({ tick, bytes: [0x99, key, vel] }); // note on, ch 10
        events.push({ tick: tick + ticksPerSlot / 2, bytes: [0x89, key, 0] }); // note off
      }
    }
  }

  events.sort((a, b) => a.tick - b.tick);

  const track: number[] = [];
  let lastTick = 0;
  for (const ev of events) {
    track.push(...vlq(Math.round(ev.tick - lastTick)), ...ev.bytes);
    lastTick = ev.tick;
  }
  track.push(0x00, 0xff, 0x2f, 0x00); // end of track

  const header = [
    0x4d, 0x54, 0x68, 0x64, // MThd
    0, 0, 0, 6,
    0, 0, // format 0
    0, 1, // one track
    (TPQ >> 8) & 0xff, TPQ & 0xff,
  ];
  const trackHeader = [
    0x4d, 0x54, 0x72, 0x6b, // MTrk
    (track.length >> 24) & 0xff,
    (track.length >> 16) & 0xff,
    (track.length >> 8) & 0xff,
    track.length & 0xff,
  ];

  return new Blob([new Uint8Array([...header, ...trackHeader, ...track])], {
    type: 'audio/midi',
  });
}
