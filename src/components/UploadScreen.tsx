import { useCallback, useRef, useState } from 'react';
import type { Session } from '../App';
import type { AudioMeta } from '../types';
import { decodeAudioFile, formatBytes, formatTime } from '../lib/decode';
import { transcribe, transcribeClientSide, type AnalysisProgress } from '../lib/transcribe';
import { DEMO_BEATS, renderDemoBeat, type DemoBeat } from '../lib/demoBeats';
import { parseMidiDrums } from '../lib/imports/midi';

const ACCEPTED = ['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac', '.webm'];

interface Loaded {
  file: File | Blob;
  name: string;
  buffer: AudioBuffer;
  meta: AudioMeta;
}

export default function UploadScreen({ onAnalyzed }: { onAnalyzed: (s: Session) => void }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [decoding, setDecoding] = useState(false);
  const [analysis, setAnalysis] = useState<AnalysisProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const midiInputRef = useRef<HTMLInputElement>(null);

  const loadFile = useCallback(async (file: File) => {
    setError(null);
    const ext = '.' + (file.name.split('.').pop() ?? '').toLowerCase();
    if (!ACCEPTED.includes(ext) && !file.type.startsWith('audio/')) {
      setError(`Unsupported file type. Please upload one of: ${ACCEPTED.join(', ')}`);
      return;
    }
    setDecoding(true);
    try {
      const buffer = await decodeAudioFile(file);
      if (buffer.duration < 2) {
        setError('Audio is too short to analyze (need at least 2 seconds).');
        return;
      }
      setLoaded({
        file,
        name: file.name,
        buffer,
        meta: {
          name: file.name,
          sizeBytes: file.size,
          duration: buffer.duration,
          sampleRate: buffer.sampleRate,
        },
      });
    } catch {
      setError('Could not decode this audio file. It may be corrupt or use an unsupported codec.');
    } finally {
      setDecoding(false);
    }
  }, []);

  const analyze = useCallback(async () => {
    if (!loaded) return;
    setError(null);
    setAnalysis({ stage: 'decoding', progress: 0 });
    try {
      const transcription = await transcribe(loaded.file, loaded.buffer, setAnalysis);
      onAnalyzed({
        file: loaded.file,
        meta: loaded.meta,
        buffer: loaded.buffer,
        transcription,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Analysis failed unexpectedly.');
      setAnalysis(null);
    }
  }, [loaded, onAnalyzed]);

  /**
   * "Songsterr mode": import the drum track of a tab exported as MIDI
   * (Guitar Pro / Songsterr / MuseScore / TuxGuitar all export .mid).
   * The score is exact, and playback is synthesized from the score itself,
   * so cursor and audio are sample-locked — like Songsterr's player.
   */
  const importMidi = useCallback(
    async (file: File) => {
      setError(null);
      setAnalysis({ stage: 'decoding', progress: 0.2, detail: 'Reading MIDI…' });
      try {
        const transcription = parseMidiDrums(await file.arrayBuffer());
        // No audio file: the drums are synthesized live during playback
        // (player.ts synth mode). Baking a full-song WAV here froze the tab.
        onAnalyzed({
          file: null,
          meta: {
            name: file.name.replace(/\.midi?$/i, '') + ' (tab)',
            sizeBytes: file.size,
            duration: transcription.duration,
            sampleRate: 44100,
          },
          transcription,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'MIDI import failed.');
        setAnalysis(null);
      }
    },
    [onAnalyzed],
  );

  const loadDemo = useCallback(
    async (beat: DemoBeat) => {
      setError(null);
      setAnalysis({ stage: 'decoding', progress: 0.02, detail: `Synthesizing "${beat.name}"…` });
      try {
        const blob = await renderDemoBeat(beat);
        const buffer = await decodeAudioFile(blob);
        const meta: AudioMeta = {
          name: `${beat.name}.wav`,
          sizeBytes: blob.size,
          duration: buffer.duration,
          sampleRate: buffer.sampleRate,
        };
        const transcription = await transcribeClientSide(buffer, setAnalysis);
        onAnalyzed({ file: blob, meta, buffer, transcription: { ...transcription, source: 'demo' } });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Demo generation failed.');
        setAnalysis(null);
      }
    },
    [onAnalyzed],
  );

  const busy = decoding || analysis !== null;

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-4 py-10 gap-8">
      <div className="text-center max-w-xl">
        <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight">
          Turn any song into <span className="text-amber-500">drum sheet music</span>
        </h2>
        <p className="mt-3 text-zinc-500 dark:text-zinc-400">
          Upload a track, get an editable drum transcription, then practice along with a
          real-time scrolling score.
        </p>
      </div>

      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const f = e.dataTransfer.files[0];
          if (f) void loadFile(f);
        }}
        onClick={() => !busy && inputRef.current?.click()}
        className={`w-full max-w-xl rounded-2xl border-2 border-dashed p-10 text-center cursor-pointer transition-colors ${
          dragOver
            ? 'border-amber-500 bg-amber-500/10'
            : 'border-zinc-300 dark:border-zinc-700 hover:border-amber-400 dark:hover:border-amber-500'
        } ${busy ? 'opacity-60 pointer-events-none' : ''}`}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED.join(',') + ',audio/*'}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void loadFile(f);
            e.target.value = '';
          }}
        />
        <div className="text-5xl mb-3">🎵</div>
        <p className="font-semibold">
          {decoding ? 'Decoding audio…' : 'Drag & drop an audio file here'}
        </p>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
          or click to browse — MP3, WAV, M4A, OGG, FLAC
        </p>
      </div>

      {/* File info + analyze */}
      {loaded && !analysis && (
        <div className="w-full max-w-xl rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-4 flex flex-col sm:flex-row sm:items-center gap-4 shadow-sm">
          <div className="flex-1 min-w-0">
            <p className="font-semibold truncate">{loaded.name}</p>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {formatTime(loaded.meta.duration)} · {formatBytes(loaded.meta.sizeBytes)} ·{' '}
              {(loaded.meta.sampleRate / 1000).toFixed(1)} kHz
            </p>
          </div>
          <button
            onClick={() => void analyze()}
            className="px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-white font-semibold shadow transition-colors"
          >
            🥁 Analyze Drums
          </button>
        </div>
      )}

      {/* Analysis progress */}
      {analysis && (
        <div className="w-full max-w-xl">
          <div className="flex justify-between text-sm mb-1.5">
            <span className="text-zinc-600 dark:text-zinc-300">
              {analysis.detail ?? 'Analyzing…'}
            </span>
            <span className="tabular-nums text-zinc-500">{Math.round(analysis.progress * 100)}%</span>
          </div>
          <div className="h-2.5 rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
            <div
              className="h-full rounded-full bg-amber-500 transition-[width] duration-200"
              style={{ width: `${analysis.progress * 100}%` }}
            />
          </div>
        </div>
      )}

      {error && (
        <div className="w-full max-w-xl rounded-xl border border-red-300 dark:border-red-900 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 px-4 py-3 text-sm">
          ⚠️ {error}
        </div>
      )}

      {/* MIDI tab import — the "Songsterr" path */}
      <div className="w-full max-w-xl rounded-xl border border-violet-300/60 dark:border-violet-800 bg-violet-50/60 dark:bg-violet-950/30 p-4">
        <input
          ref={midiInputRef}
          type="file"
          accept=".mid,.midi,audio/midi"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void importMidi(f);
            e.target.value = '';
          }}
        />
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex-1">
            <p className="font-semibold text-sm">🎼 Have the tab already? Import a drum MIDI</p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
              Export the drum track of any Guitar Pro tab (Songsterr, MuseScore, TuxGuitar…) as
              .mid — you get the exact score with perfectly synced playback.
            </p>
          </div>
          <button
            disabled={busy}
            onClick={() => midiInputRef.current?.click()}
            className="px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold shadow disabled:opacity-50"
          >
            Import .mid
          </button>
        </div>
      </div>

      {/* Demo beats */}
      <div className="w-full max-w-xl">
        <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400 mb-2 text-center">
          …or try a demo beat
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {DEMO_BEATS.map((beat) => (
            <button
              key={beat.id}
              disabled={busy}
              onClick={() => void loadDemo(beat)}
              className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3 text-left hover:border-amber-400 dark:hover:border-amber-500 transition-colors disabled:opacity-50"
            >
              <p className="font-semibold text-sm">{beat.name}</p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">{beat.description}</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
