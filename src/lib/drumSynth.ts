/**
 * Drum kit synthesizer (OfflineAudioContext).
 *
 * Renders any list of DrumHits to a WAV blob. Used for the demo beats and
 * for the "Songsterr mode": when a transcription comes from an imported
 * MIDI tab, playing synthesized drums instead of the original recording
 * gives perfect score/audio sync (a written tab at a fixed BPM never matches
 * a real recording's tempo drift, but it matches its own synthesis exactly).
 */

import type { DrumHit, DrumType } from '../types';

/**
 * Schedule one drum voice on `ctx`, routed to `dest`. Works with both an
 * OfflineAudioContext (used to bake demo WAVs) and a live AudioContext
 * (used by the real-time scheduler in player.ts for synthesized playback).
 */
export function synthDrum(
  ctx: BaseAudioContext,
  dest: AudioNode,
  drum: DrumType,
  when: number,
  velocity = 0.9,
) {
  const out = dest;
  switch (drum) {
    case 'kick': {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.frequency.setValueAtTime(120, when);
      osc.frequency.exponentialRampToValueAtTime(45, when + 0.12);
      g.gain.setValueAtTime(velocity, when);
      g.gain.exponentialRampToValueAtTime(0.001, when + 0.25);
      osc.connect(g).connect(out);
      osc.start(when);
      osc.stop(when + 0.3);
      break;
    }
    case 'snare': {
      const osc = ctx.createOscillator();
      const og = ctx.createGain();
      osc.frequency.setValueAtTime(190, when);
      og.gain.setValueAtTime(velocity * 0.5, when);
      og.gain.exponentialRampToValueAtTime(0.001, when + 0.12);
      osc.connect(og).connect(out);
      osc.start(when);
      osc.stop(when + 0.15);
      noiseBurst(ctx, out, when, 0.18, velocity * 0.6, 1800, 'highpass');
      break;
    }
    case 'hihat-closed':
      noiseBurst(ctx, out, when, 0.05, velocity * 0.3, 7000, 'highpass');
      break;
    case 'hihat-open':
      noiseBurst(ctx, out, when, 0.3, velocity * 0.3, 7000, 'highpass');
      break;
    case 'ride':
      noiseBurst(ctx, out, when, 0.5, velocity * 0.25, 6000, 'highpass');
      break;
    case 'crash':
      noiseBurst(ctx, out, when, 1.2, velocity * 0.5, 5000, 'highpass');
      break;
    default: {
      // toms
      const f = drum === 'tom-high' ? 300 : drum === 'tom-mid' ? 220 : 140;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.frequency.setValueAtTime(f, when);
      osc.frequency.exponentialRampToValueAtTime(f * 0.7, when + 0.2);
      g.gain.setValueAtTime(velocity * 0.7, when);
      g.gain.exponentialRampToValueAtTime(0.001, when + 0.3);
      osc.connect(g).connect(out);
      osc.start(when);
      osc.stop(when + 0.35);
    }
  }
}

function noiseBurst(
  ctx: BaseAudioContext,
  dest: AudioNode,
  when: number,
  duration: number,
  gainVal: number,
  freq: number,
  type: BiquadFilterType,
) {
  const len = Math.ceil(duration * ctx.sampleRate);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gainVal, when);
  g.gain.exponentialRampToValueAtTime(0.001, when + duration);
  src.connect(filter).connect(g).connect(dest);
  src.start(when);
}

/**
 * Render a hit list to a 16-bit WAV blob (offline). Suitable only for SHORT
 * clips — the demo beats. Full songs must use the real-time scheduler in
 * player.ts; baking minutes of audio with thousands of nodes offline freezes
 * the tab.
 */
export async function renderHitsToWav(hits: DrumHit[], duration: number): Promise<Blob> {
  const sampleRate = 44100;
  const total = Math.max(1, duration + 1.5);
  const ctx = new OfflineAudioContext(1, Math.ceil(total * sampleRate), sampleRate);
  for (const hit of hits) {
    synthDrum(ctx, ctx.destination, hit.drum, Math.max(0, hit.time), Math.max(0.15, hit.velocity));
  }
  const rendered = await ctx.startRendering();
  return audioBufferToWav(rendered);
}

/** Encode an AudioBuffer as a 16-bit PCM WAV blob. */
export function audioBufferToWav(buffer: AudioBuffer): Blob {
  const numCh = buffer.numberOfChannels;
  const length = buffer.length * numCh * 2;
  const out = new ArrayBuffer(44 + length);
  const view = new DataView(out);
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + length, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numCh, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * numCh * 2, true);
  view.setUint16(32, numCh * 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, length, true);
  let offset = 44;
  for (let i = 0; i < buffer.length; i++) {
    for (let ch = 0; ch < numCh; ch++) {
      const s = Math.max(-1, Math.min(1, buffer.getChannelData(ch)[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([out], { type: 'audio/wav' });
}
