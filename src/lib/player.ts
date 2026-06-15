/**
 * Playback engine — two modes behind one API:
 *
 *  - 'audio': plays an uploaded recording through an <audio> element (so we
 *    get preservesPitch time-stretching at 0.5–1.5×). The element's
 *    currentTime is the clock.
 *  - 'synth': no recording — the drums are SYNTHESIZED live from the score
 *    (the "Songsterr" / MIDI-import path). There is no audio element, so a
 *    virtual clock anchored to AudioContext.currentTime drives everything,
 *    and a lookahead scheduler triggers drum voices just ahead of the
 *    playhead. This replaces the old approach of baking a full-song WAV
 *    offline, which froze the tab for minutes-long inputs.
 *
 * The metronome (both modes) uses the same lookahead idea: convert upcoming
 * beat times from song-time to AudioContext-time accounting for playbackRate.
 *
 * PracticeScreen talks to this class only through callbacks (onTick,
 * onPlayStateChange, onError) and getters — it never touches the audio
 * element directly, so both modes are interchangeable.
 */

import type { DrumHit } from '../types';
import { synthDrum } from './drumSynth';

export interface LoopRegion {
  start: number; // seconds
  end: number;
}

export interface PlayerOptions {
  /** Recording to play; null/omitted → synth mode. */
  file?: Blob | null;
  /** Hits to synthesize in synth mode (sorted by time). */
  hits?: DrumHit[];
  bpm: number;
  firstBeatOffset: number;
  beatTimes?: number[] | null;
  duration: number;
}

const LOOKAHEAD = 0.18; // song-seconds scheduled ahead of the playhead

export class Player {
  readonly mode: 'audio' | 'synth';
  readonly audio: HTMLAudioElement | null = null;

  private ctx: AudioContext | null = null;
  private gain: GainNode | null = null;
  private routingFailed = false;

  private metronomeOn = false;
  private loop: LoopRegion | null = null;
  private bpm: number;
  private firstBeatOffset: number;
  private beatTimes: number[] | null = null;
  private rateVal = 1;
  private _duration: number;

  // synth-mode state
  private hits: DrumHit[];
  private hitIndex = 0;
  private anchorCtx = 0; // ctx.currentTime when the virtual clock was last anchored
  private anchorSong = 0; // song time at that anchor
  private synthPlaying = false;

  private rafId = 0;
  private intervalId = 0;
  private lastScheduledBeat = -1;
  private objectUrl: string | null = null;

  onTick: ((time: number) => void) | null = null;
  onPlayStateChange: ((playing: boolean) => void) | null = null;
  onError: ((message: string) => void) | null = null;

  constructor(opts: PlayerOptions) {
    this.bpm = opts.bpm;
    this.firstBeatOffset = opts.firstBeatOffset;
    this.beatTimes = opts.beatTimes && opts.beatTimes.length >= 2 ? opts.beatTimes : null;
    this._duration = opts.duration;
    this.hits = opts.hits ? [...opts.hits].sort((a, b) => a.time - b.time) : [];

    if (opts.file) {
      this.mode = 'audio';
      this.objectUrl = URL.createObjectURL(opts.file);
      const audio = new Audio(this.objectUrl);
      audio.preload = 'auto';
      audio.preservesPitch = true;
      audio.addEventListener('play', () => this.onPlayStateChange?.(true));
      audio.addEventListener('pause', () => this.onPlayStateChange?.(false));
      audio.addEventListener('ended', () => {
        this.stopLoop();
        this.onPlayStateChange?.(false);
      });
      audio.addEventListener('error', () => {
        if (audio.src) this.onError?.('Could not play this audio file (decoding error).');
      });
      this.audio = audio;
    } else {
      this.mode = 'synth';
    }
  }

  // ---- unified clock ----------------------------------------------------

  get duration(): number {
    return this.mode === 'audio' ? this.audio!.duration || this._duration : this._duration;
  }

  get currentTime(): number {
    if (this.mode === 'audio') return this.audio!.currentTime;
    if (!this.synthPlaying || !this.ctx) return this.anchorSong;
    const t = this.anchorSong + (this.ctx.currentTime - this.anchorCtx) * this.rateVal;
    return Math.min(this._duration, Math.max(0, t));
  }

  get playing(): boolean {
    return this.mode === 'audio' ? !this.audio!.paused : this.synthPlaying;
  }

  // ---- context ----------------------------------------------------------

  private ensureContext() {
    if (this.routingFailed && this.mode === 'audio') return;
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
        this.gain = this.ctx.createGain();
        this.gain.connect(this.ctx.destination);
        if (this.mode === 'audio') {
          const src = this.ctx.createMediaElementSource(this.audio!);
          src.connect(this.gain);
        }
      } catch (err) {
        console.warn('Web Audio routing unavailable:', err);
        this.routingFailed = true;
      }
    }
  }

  setTiming(bpm: number, firstBeatOffset: number, beatTimes?: number[] | null) {
    this.bpm = bpm;
    this.firstBeatOffset = firstBeatOffset;
    this.beatTimes = beatTimes && beatTimes.length >= 2 ? beatTimes : null;
    this.lastScheduledBeat = -1;
  }

  /** Replace the synthesized hits (e.g. after editing) without recreating. */
  setHits(hits: DrumHit[]) {
    this.hits = [...hits].sort((a, b) => a.time - b.time);
    this.resyncHitIndex(this.currentTime);
  }

  // ---- transport --------------------------------------------------------

  async play() {
    this.ensureContext();
    if (this.ctx && this.ctx.state === 'suspended') {
      try {
        await this.ctx.resume();
      } catch {
        /* direct output still works in audio mode */
      }
    }
    this.lastScheduledBeat = -1;
    if (this.mode === 'audio') {
      await this.audio!.play();
    } else {
      this.anchorCtx = this.ctx ? this.ctx.currentTime : 0;
      // anchorSong stays where it was (resume from paused position)
      this.resyncHitIndex(this.anchorSong);
      this.synthPlaying = true;
      this.onPlayStateChange?.(true);
    }
    this.startLoop();
  }

  pause() {
    if (this.mode === 'audio') {
      this.audio!.pause();
    } else {
      this.anchorSong = this.currentTime; // freeze
      this.synthPlaying = false;
      this.onPlayStateChange?.(false);
    }
    this.stopLoop();
  }

  seek(time: number) {
    const clamped = Math.max(0, Math.min(time, this.duration || time));
    if (this.mode === 'audio') {
      this.audio!.currentTime = clamped;
    } else {
      this.anchorSong = clamped;
      this.anchorCtx = this.ctx ? this.ctx.currentTime : 0;
      this.resyncHitIndex(clamped);
    }
    this.lastScheduledBeat = -1;
    this.onTick?.(this.currentTime);
  }

  setRate(rate: number) {
    if (this.mode === 'synth' && this.synthPlaying && this.ctx) {
      // Re-anchor so the clock stays continuous across the rate change.
      this.anchorSong = this.currentTime;
      this.anchorCtx = this.ctx.currentTime;
    }
    this.rateVal = rate;
    if (this.audio) this.audio.playbackRate = rate;
    this.lastScheduledBeat = -1;
  }

  setLoop(region: LoopRegion | null) {
    this.loop = region;
  }

  setMetronome(on: boolean) {
    this.metronomeOn = on;
    this.lastScheduledBeat = -1;
  }

  // ---- scheduling loop --------------------------------------------------

  private tick = () => {
    if (!this.playing) return;
    const t = this.currentTime;

    if (this.loop && t >= this.loop.end) {
      this.seek(this.loop.start);
      return;
    }
    if (this.mode === 'synth' && t >= this._duration) {
      this.anchorSong = this._duration;
      this.synthPlaying = false;
      this.stopLoop();
      this.onTick?.(this._duration);
      this.onPlayStateChange?.(false);
      return;
    }

    this.onTick?.(t);
    if (this.mode === 'synth') this.scheduleHits(t);
    if (this.metronomeOn) this.scheduleClicks(t);
  };

  private startLoop() {
    this.stopLoop();
    // setInterval survives rAF throttling (background tab / webview); rAF
    // gives 60 fps smoothness when visible.
    this.intervalId = window.setInterval(this.tick, 40);
    const rafLoop = () => {
      if (!this.playing) return;
      this.tick();
      this.rafId = requestAnimationFrame(rafLoop);
    };
    this.rafId = requestAnimationFrame(rafLoop);
  }

  private stopLoop() {
    cancelAnimationFrame(this.rafId);
    window.clearInterval(this.intervalId);
    this.intervalId = 0;
  }

  private resyncHitIndex(songTime: number) {
    // First hit at or after songTime (binary search).
    let lo = 0;
    let hi = this.hits.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.hits[mid].time < songTime) lo = mid + 1;
      else hi = mid;
    }
    this.hitIndex = lo;
  }

  /** Synth mode: trigger drum voices falling in [songTime, +lookahead]. */
  private scheduleHits(songTime: number) {
    if (!this.ctx || !this.gain) return;
    const horizon = songTime + LOOKAHEAD * this.rateVal;
    // Skip any hits we've already passed (e.g. after a coarse seek).
    while (this.hitIndex < this.hits.length && this.hits[this.hitIndex].time < songTime - 0.05) {
      this.hitIndex++;
    }
    while (this.hitIndex < this.hits.length && this.hits[this.hitIndex].time <= horizon) {
      const hit = this.hits[this.hitIndex];
      const delay = (hit.time - songTime) / this.rateVal;
      const when = this.ctx.currentTime + Math.max(0, delay);
      synthDrum(this.ctx, this.gain, hit.drum, when, Math.max(0.15, hit.velocity));
      this.hitIndex++;
    }
  }

  /** Lookahead click scheduler (both modes). */
  private scheduleClicks(songTime: number) {
    if (!this.ctx || !this.gain) return;
    const rate = this.rateVal;
    const lookahead = LOOKAHEAD * rate;

    if (this.beatTimes) {
      const bts = this.beatTimes;
      let i = Math.max(0, this.lastScheduledBeat + 1);
      while (i < bts.length && bts[i] < songTime - 0.01) i++;
      while (i < bts.length && bts[i] <= songTime + lookahead) {
        const delay = (bts[i] - songTime) / rate;
        this.click(this.ctx.currentTime + Math.max(0, delay), i % 4 === 0);
        this.lastScheduledBeat = i;
        i++;
      }
      return;
    }

    const beatDur = 60 / this.bpm;
    const firstBeat = Math.max(
      this.lastScheduledBeat + 1,
      Math.ceil((songTime - this.firstBeatOffset) / beatDur),
    );
    const lastBeat = Math.floor((songTime + lookahead - this.firstBeatOffset) / beatDur);
    for (let b = firstBeat; b <= lastBeat; b++) {
      const beatSongTime = this.firstBeatOffset + b * beatDur;
      if (beatSongTime < songTime - 0.01) continue;
      const delay = (beatSongTime - songTime) / rate;
      this.click(this.ctx.currentTime + Math.max(0, delay), b % 4 === 0);
      this.lastScheduledBeat = b;
    }
  }

  private click(when: number, accent: boolean) {
    if (!this.ctx || !this.gain) return;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.frequency.value = accent ? 1500 : 1000;
    g.gain.setValueAtTime(accent ? 0.35 : 0.22, when);
    g.gain.exponentialRampToValueAtTime(0.001, when + 0.05);
    osc.connect(g).connect(this.gain);
    osc.start(when);
    osc.stop(when + 0.06);
  }

  dispose() {
    this.pause();
    this.stopLoop();
    if (this.audio) {
      this.audio.removeAttribute('src');
      this.audio.load();
    }
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    void this.ctx?.close();
    this.ctx = null;
  }
}
