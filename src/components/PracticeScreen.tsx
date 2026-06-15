import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Session } from '../App';
import { buildScore, timeToPosition } from '../lib/score';
import { Player, type LoopRegion } from '../lib/player';
import { formatTime } from '../lib/decode';
import Notation, { type NotationHandle } from './Notation';

const SPEEDS = [0.5, 0.6, 0.7, 0.75, 0.8, 0.9, 1.0, 1.1, 1.25, 1.5];

export default function PracticeScreen({ session, onBack }: { session: Session; onBack: () => void }) {
  const t = session.transcription;
  const score = useMemo(() => buildScore(t), [t]);
  const notationRef = useRef<NotationHandle>(null);
  const playerRef = useRef<Player | null>(null);

  const [playing, setPlaying] = useState(false);
  const [playError, setPlayError] = useState<string | null>(null);
  const [time, setTime] = useState(0);
  const [rate, setRate] = useState(1);
  const [metronome, setMetronome] = useState(false);
  const [loop, setLoop] = useState<LoopRegion | null>(null);
  const [loopStart, setLoopStart] = useState<number | null>(null);

  // Throttled position state for the counters (cursor itself is imperative)
  const lastUiUpdate = useRef(0);

  useEffect(() => {
    const player = new Player({
      file: session.file,
      hits: t.hits,
      bpm: t.bpm,
      firstBeatOffset: t.firstBeatOffset,
      beatTimes: t.beatTimes ?? null,
      duration: session.meta.duration,
    });
    player.onTick = (audioTime) => {
      notationRef.current?.setTime(audioTime);
      const now = performance.now();
      if (now - lastUiUpdate.current > 100) {
        lastUiUpdate.current = now;
        setTime(audioTime);
      }
    };
    // Mode-agnostic state mirroring (covers 'ended', OS media keys, etc.).
    player.onPlayStateChange = setPlaying;
    player.onError = setPlayError;
    playerRef.current = player;
    return () => {
      player.dispose();
      playerRef.current = null;
    };
    // The player is recreated only when the source file changes; timing and
    // hits are pushed via the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.file]);

  useEffect(() => {
    playerRef.current?.setTiming(t.bpm, t.firstBeatOffset, t.beatTimes ?? null);
  }, [t.bpm, t.firstBeatOffset, t.beatTimes]);

  useEffect(() => {
    playerRef.current?.setHits(t.hits);
  }, [t.hits]);

  const togglePlay = useCallback(async () => {
    const p = playerRef.current;
    if (!p) return;
    setPlayError(null);
    if (p.playing) {
      p.pause();
    } else {
      try {
        await p.play();
      } catch (err) {
        setPlayError(
          err instanceof Error && err.name === 'NotAllowedError'
            ? 'The browser blocked playback — click the play button directly to start.'
            : 'Playback failed: ' + (err instanceof Error ? err.message : String(err)),
        );
      }
    }
  }, []);

  const seek = useCallback((to: number) => {
    const p = playerRef.current;
    if (!p) return;
    p.seek(to);
    setTime(to);
    notationRef.current?.setTime(to);
  }, []);

  const changeRate = useCallback((r: number) => {
    setRate(r);
    playerRef.current?.setRate(r);
  }, []);

  const toggleMetronome = useCallback(() => {
    setMetronome((m) => {
      playerRef.current?.setMetronome(!m);
      return !m;
    });
  }, []);

  const handleLoopButton = useCallback(() => {
    const p = playerRef.current;
    if (!p) return;
    if (loop) {
      // Clear loop
      setLoop(null);
      setLoopStart(null);
      p.setLoop(null);
    } else if (loopStart === null) {
      setLoopStart(p.currentTime);
    } else {
      const start = Math.min(loopStart, p.currentTime);
      const end = Math.max(loopStart, p.currentTime);
      if (end - start > 0.5) {
        const region = { start, end };
        setLoop(region);
        p.setLoop(region);
      }
      setLoopStart(null);
    }
  }, [loop, loopStart]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      switch (e.key) {
        case ' ':
          e.preventDefault();
          void togglePlay();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          seek(Math.max(0, (playerRef.current?.currentTime ?? 0) - (e.shiftKey ? score.secondsPerMeasure : 5)));
          break;
        case 'ArrowRight':
          e.preventDefault();
          seek((playerRef.current?.currentTime ?? 0) + (e.shiftKey ? score.secondsPerMeasure : 5));
          break;
        case 'l':
        case 'L':
          handleLoopButton();
          break;
        case 'm':
        case 'M':
          toggleMetronome();
          break;
        case 'ArrowUp':
          e.preventDefault();
          changeRate(SPEEDS[Math.min(SPEEDS.length - 1, SPEEDS.indexOf(rate) + 1)]);
          break;
        case 'ArrowDown':
          e.preventDefault();
          changeRate(SPEEDS[Math.max(0, SPEEDS.indexOf(rate) - 1)]);
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [togglePlay, seek, handleLoopButton, toggleMetronome, changeRate, rate, score.secondsPerMeasure]);

  const pos = timeToPosition(t, score, time);
  const measureDisplay = Math.max(1, Math.min(score.measures.length, pos.measure + 1));
  const beatDisplay = Math.max(1, Math.min(4, pos.beat + 1));
  const duration = session.meta.duration;

  return (
    <div className="flex-1 flex flex-col px-4 sm:px-6 py-4 gap-4 max-w-7xl w-full mx-auto">
      {/* Status bar */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 print:hidden">
        <button onClick={onBack} className="text-sm text-zinc-500 hover:text-amber-500">
          ← Back to editor
        </button>
        <div className="flex items-center gap-4 tabular-nums">
          <Stat label="Measure" value={`${measureDisplay}`} />
          <Stat label="Beat" value={`${beatDisplay}`} />
          <Stat label="Tempo" value={`${Math.round(t.bpm * rate)} BPM`} />
          <Stat label="Time" value={`${formatTime(time)} / ${formatTime(duration)}`} />
        </div>
        <span className="text-xs text-zinc-400 ml-auto hidden md:block">
          Space play/pause · ←→ seek · ↑↓ speed · L loop · M metronome · Esc back
        </span>
      </div>

      {/* Score */}
      <Notation
        ref={notationRef}
        score={score}
        bpm={t.bpm}
        followCursor
        onSeek={seek}
        className="flex-1 min-h-0"
      />

      {playError && (
        <div className="rounded-xl border border-red-300 dark:border-red-900 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 px-4 py-2.5 text-sm print:hidden">
          ⚠️ {playError}
        </div>
      )}

      {/* Transport */}
      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3 sm:p-4 flex flex-col gap-3 print:hidden shadow-sm">
        {/* Seek bar */}
        <div className="flex items-center gap-3">
          <span className="text-xs tabular-nums w-10 text-right text-zinc-500">{formatTime(time)}</span>
          <div className="relative flex-1">
            <input
              type="range"
              min={0}
              max={duration}
              step={0.01}
              value={Math.min(time, duration)}
              onChange={(e) => seek(parseFloat(e.target.value))}
              className="w-full accent-amber-500"
            />
            {loop && (
              <div
                className="absolute top-1/2 -translate-y-1/2 h-1.5 bg-amber-500/40 rounded pointer-events-none"
                style={{
                  left: `${(loop.start / duration) * 100}%`,
                  width: `${((loop.end - loop.start) / duration) * 100}%`,
                }}
              />
            )}
          </div>
          <span className="text-xs tabular-nums w-10 text-zinc-500">{formatTime(duration)}</span>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-3">
          <button
            onClick={() => seek(Math.max(0, time - score.secondsPerMeasure))}
            className="px-3 py-2 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-800"
            title="Previous measure (Shift+←)"
          >
            ⏮
          </button>
          <button
            onClick={() => void togglePlay()}
            className="w-14 h-14 rounded-full bg-amber-500 hover:bg-amber-400 text-white text-xl font-bold shadow-lg flex items-center justify-center"
            title="Play / Pause (Space)"
          >
            {playing ? '⏸' : '▶'}
          </button>
          <button
            onClick={() => seek(time + score.secondsPerMeasure)}
            className="px-3 py-2 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-800"
            title="Next measure (Shift+→)"
          >
            ⏭
          </button>

          <div className="w-px h-8 bg-zinc-200 dark:bg-zinc-800 mx-1 hidden sm:block" />

          <label className="flex items-center gap-1.5 text-sm">
            <span className="text-zinc-500 hidden sm:inline">Speed</span>
            <select
              value={rate}
              onChange={(e) => changeRate(parseFloat(e.target.value))}
              className="px-2 py-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 tabular-nums"
            >
              {SPEEDS.map((s) => (
                <option key={s} value={s}>
                  {s.toFixed(2)}×
                </option>
              ))}
            </select>
          </label>

          <button
            onClick={handleLoopButton}
            className={`px-3 py-2 rounded-xl text-sm font-medium transition-colors ${
              loop
                ? 'bg-amber-500 text-white'
                : loopStart !== null
                  ? 'bg-amber-500/30 text-amber-600 dark:text-amber-300 animate-pulse'
                  : 'hover:bg-zinc-100 dark:hover:bg-zinc-800'
            }`}
            title="Loop section (L): press once at loop start, again at loop end"
          >
            🔁 {loop ? 'Loop on' : loopStart !== null ? 'Set end…' : 'Loop'}
          </button>

          <button
            onClick={toggleMetronome}
            className={`px-3 py-2 rounded-xl text-sm font-medium transition-colors ${
              metronome ? 'bg-amber-500 text-white' : 'hover:bg-zinc-100 dark:hover:bg-zinc-800'
            }`}
            title="Metronome (M)"
          >
            🎯 Click
          </button>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-sm">
      <span className="text-zinc-400 text-xs uppercase tracking-wide mr-1.5">{label}</span>
      <span className="font-semibold">{value}</span>
    </div>
  );
}
