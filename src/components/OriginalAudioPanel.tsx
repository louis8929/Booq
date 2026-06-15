import { useCallback, useRef, useState } from 'react';
import type { Session } from '../App';
import type { Transcription } from '../types';
import { decodeAudioFile, formatTime } from '../lib/decode';
import {
  buildAlignedTranscription,
  detectRecordingBeats,
  reapplyAlignment,
} from '../lib/align';

interface Props {
  session: Session;
  onChange: (t: Transcription) => void;
  onReplaceSession: (s: Session) => void;
}

/**
 * Attach the ORIGINAL recording to an imported MIDI tab and keep them in
 * sync. We detect the recording's real beats and remap the exact MIDI score
 * onto them (see lib/align.ts), then play the recording while the notation
 * follows. The ±1 beat / fine nudges correct intro/count-in mismatches.
 */
export default function OriginalAudioPanel({ session, onChange, onReplaceSession }: Props) {
  const t = session.transcription;
  const aligned = t.source === 'midi-aligned';
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [detail, setDetail] = useState('');
  const [error, setError] = useState<string | null>(null);

  const attach = useCallback(
    async (file: File) => {
      setError(null);
      setBusy(true);
      setProgress(0.02);
      setDetail('Decoding original audio…');
      try {
        const buffer = await decodeAudioFile(file);
        setDetail('Detecting beats to sync to…');
        const rec = await detectRecordingBeats(buffer, (p) => setProgress(0.05 + p * 0.9));
        const transcription = buildAlignedTranscription(t, rec);
        onReplaceSession({
          file,
          buffer,
          meta: {
            name: session.meta.name.replace(/ \(tab\)$/, '') + ' (synced)',
            sizeBytes: file.size,
            duration: buffer.duration,
            sampleRate: buffer.sampleRate,
          },
          transcription,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not sync this audio.');
      } finally {
        setBusy(false);
        setProgress(0);
      }
    },
    [t, session.meta.name, onReplaceSession],
  );

  const nudge = (deltaBeats: number, deltaSec: number) => onChange(reapplyAlignment(t, deltaBeats, deltaSec));

  return (
    <div className="rounded-xl border border-violet-300/60 dark:border-violet-800 bg-violet-50/60 dark:bg-violet-950/30 p-3 print:hidden">
      <input
        ref={inputRef}
        type="file"
        accept=".mp3,.wav,.m4a,.aac,.ogg,.flac,audio/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void attach(f);
          e.target.value = '';
        }}
      />

      {!aligned ? (
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex-1">
            <p className="font-semibold text-sm">🔊 Play along with the original song</p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
              Attach the original recording (MP3/WAV). I'll detect its beats and lock this exact
              tab to the real audio — tempo drift and all.
            </p>
          </div>
          <button
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            className="px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold shadow disabled:opacity-50"
          >
            Add original audio
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <div className="flex-1 min-w-40">
            <p className="font-semibold text-sm">🔊 Synced to the original recording</p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
              Off by a bar or a hair? Nudge the alignment. Current shift:{' '}
              <span className="tabular-nums">
                {t.align?.beatOffset ?? 0} beat{Math.abs(t.align?.beatOffset ?? 0) === 1 ? '' : 's'}
                {t.align?.secOffset ? `, ${(t.align.secOffset * 1000).toFixed(0)} ms` : ''}
              </span>
            </p>
          </div>
          <div className="flex items-center gap-1.5 text-sm">
            <span className="text-zinc-500 text-xs">Align</span>
            <NudgeBtn onClick={() => nudge(-1, 0)} disabled={busy}>−1 beat</NudgeBtn>
            <NudgeBtn onClick={() => nudge(1, 0)} disabled={busy}>+1 beat</NudgeBtn>
            <NudgeBtn onClick={() => nudge(0, -0.02)} disabled={busy}>−20 ms</NudgeBtn>
            <NudgeBtn onClick={() => nudge(0, 0.02)} disabled={busy}>+20 ms</NudgeBtn>
          </div>
          <button
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            className="text-xs text-violet-600 dark:text-violet-400 hover:underline"
          >
            Replace audio
          </button>
        </div>
      )}

      {busy && (
        <div className="mt-3">
          <div className="flex justify-between text-xs mb-1">
            <span className="text-zinc-600 dark:text-zinc-300">{detail}</span>
            <span className="tabular-nums text-zinc-500">{Math.round(progress * 100)}%</span>
          </div>
          <div className="h-2 rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
            <div
              className="h-full rounded-full bg-violet-500 transition-[width] duration-200"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
        </div>
      )}

      {error && (
        <div className="mt-2 text-xs text-red-600 dark:text-red-400">⚠️ {error}</div>
      )}

      {aligned && session.file && (
        <p className="text-[11px] text-zinc-400 mt-2">
          Playing: {session.meta.name} · {formatTime(session.meta.duration)} — switch to Practice to
          read the tab against the song.
        </p>
      )}
    </div>
  );
}

function NudgeBtn({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="px-2 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 hover:bg-white dark:hover:bg-zinc-800 disabled:opacity-50 tabular-nums"
    >
      {children}
    </button>
  );
}
