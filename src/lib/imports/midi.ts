/**
 * Standard MIDI File import — the "Songsterr path".
 *
 * Auto-transcription of a dense mix tops out well below a hand-made tab.
 * Guitar Pro tabs (Songsterr, Ultimate Guitar, MuseScore…) can be exported
 * as MIDI; importing the drum track gives an EXACT score. Combined with
 * synthesized playback (drumSynth.ts) the score and audio are perfectly in
 * sync, which is exactly how Songsterr's player works.
 *
 * Supports format 0/1, running status, full tempo maps (tempo changes are
 * folded into `beatTimes`, so the score grid follows them).
 */

import type { DrumHit, DrumType, Transcription } from '../../types';

/** GM percussion key → drum, with common aliases. */
const GM_DRUMS: Record<number, DrumType> = {
  35: 'kick', 36: 'kick',
  37: 'snare', 38: 'snare', 40: 'snare',
  41: 'tom-low', 43: 'tom-low', 45: 'tom-mid', 47: 'tom-mid',
  48: 'tom-high', 50: 'tom-high',
  42: 'hihat-closed', 44: 'hihat-closed',
  46: 'hihat-open',
  49: 'crash', 52: 'crash', 55: 'crash', 57: 'crash',
  51: 'ride', 53: 'ride', 59: 'ride',
};

class Reader {
  pos = 0;
  constructor(private view: DataView) {}
  get remaining() { return this.view.byteLength - this.pos; }
  u8() { return this.view.getUint8(this.pos++); }
  peek() { return this.view.getUint8(this.pos); }
  u16() { const v = this.view.getUint16(this.pos); this.pos += 2; return v; }
  u32() { const v = this.view.getUint32(this.pos); this.pos += 4; return v; }
  skip(n: number) { this.pos += n; }
  str(n: number) {
    let s = '';
    for (let i = 0; i < n; i++) s += String.fromCharCode(this.u8());
    return s;
  }
  vlq() {
    let v = 0;
    for (let i = 0; i < 4; i++) {
      const b = this.u8();
      v = (v << 7) | (b & 0x7f);
      if (!(b & 0x80)) break;
    }
    return v;
  }
}

export class MidiImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MidiImportError';
  }
}

export function parseMidiDrums(buffer: ArrayBuffer): Transcription {
  const r = new Reader(new DataView(buffer));
  if (r.remaining < 14 || r.str(4) !== 'MThd') {
    throw new MidiImportError('Not a MIDI file (missing MThd header).');
  }
  const headerLen = r.u32();
  r.u16(); // format
  const nTracks = r.u16();
  const division = r.u16();
  r.skip(headerLen - 6);
  if (division & 0x8000) {
    throw new MidiImportError('SMPTE-timed MIDI files are not supported.');
  }
  const tpq = division || 480;

  const tempoEvents: { tick: number; usPerQuarter: number }[] = [];
  const noteOns: { tick: number; key: number; vel: number }[] = [];
  let lastTick = 0;

  for (let t = 0; t < nTracks && r.remaining >= 8; t++) {
    if (r.str(4) !== 'MTrk') throw new MidiImportError('Malformed MIDI track.');
    const len = r.u32();
    const end = r.pos + len;
    let tick = 0;
    let status = 0;

    while (r.pos < end) {
      tick += r.vlq();
      let b = r.peek();
      if (b & 0x80) {
        status = r.u8();
        b = r.peek();
      }
      if (status === 0xff) {
        const type = r.u8();
        const mlen = r.vlq();
        if (type === 0x51 && mlen === 3) {
          const us = (r.u8() << 16) | (r.u8() << 8) | r.u8();
          tempoEvents.push({ tick, usPerQuarter: us });
        } else {
          r.skip(mlen);
        }
      } else if (status === 0xf0 || status === 0xf7) {
        r.skip(r.vlq());
      } else {
        const kind = status & 0xf0;
        const channel = status & 0x0f;
        if (kind === 0x90) {
          const key = r.u8();
          const vel = r.u8();
          if (channel === 9 && vel > 0) noteOns.push({ tick, key, vel });
        } else if (kind === 0xc0 || kind === 0xd0) {
          r.skip(1);
        } else {
          r.skip(2);
        }
      }
      lastTick = Math.max(lastTick, tick);
    }
    r.pos = end;
  }

  if (noteOns.length === 0) {
    throw new MidiImportError(
      'No drum notes found (MIDI channel 10). Export only the drum track from your tab editor.',
    );
  }

  // Tick → seconds via the tempo map
  tempoEvents.sort((a, b) => a.tick - b.tick);
  if (tempoEvents.length === 0 || tempoEvents[0].tick > 0) {
    tempoEvents.unshift({ tick: 0, usPerQuarter: 500000 });
  }
  const segStart: number[] = [0]; // seconds at each tempo event
  for (let i = 1; i < tempoEvents.length; i++) {
    const dt = tempoEvents[i].tick - tempoEvents[i - 1].tick;
    segStart.push(segStart[i - 1] + (dt / tpq) * (tempoEvents[i - 1].usPerQuarter / 1e6));
  }
  const tickToSec = (tick: number): number => {
    let i = tempoEvents.length - 1;
    while (i > 0 && tempoEvents[i].tick > tick) i--;
    return segStart[i] + ((tick - tempoEvents[i].tick) / tpq) * (tempoEvents[i].usPerQuarter / 1e6);
  };

  const hits: DrumHit[] = [];
  for (const n of noteOns) {
    const drum = GM_DRUMS[n.key];
    if (!drum) continue;
    hits.push({ time: tickToSec(n.tick), drum, velocity: Math.max(0.2, n.vel / 127) });
  }
  if (hits.length === 0) {
    throw new MidiImportError('The drum track contains no recognizable drum sounds.');
  }
  hits.sort((a, b) => a.time - b.time);

  // Beat grid: one beat per quarter note, through the tempo map (so tempo
  // changes written in the tab are honored by the score layout).
  const endTick = lastTick + tpq * 4;
  const beatTimes: number[] = [];
  for (let tick = 0; tick <= endTick; tick += tpq) beatTimes.push(tickToSec(tick));

  const bpmRaw = 60e6 / tempoEvents[0].usPerQuarter;
  const duration = tickToSec(endTick);

  return {
    bpm: Math.round(bpmRaw * 10) / 10,
    firstBeatOffset: 0,
    beatTimes,
    timeSignature: [4, 4],
    quantize: 16,
    duration,
    hits,
    source: 'midi-import',
  };
}
