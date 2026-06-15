import { useMemo } from 'react';
import type { Session } from '../App';
import type { QuantizeLevel, Transcription } from '../types';
import { buildScore, toggleHit } from '../lib/score';
import Notation from './Notation';
import GridEditor from './GridEditor';
import OriginalAudioPanel from './OriginalAudioPanel';
import { transcriptionToMidi } from '../lib/exports/midi';
import { transcriptionToMusicXML } from '../lib/exports/musicxml';
import { downloadBlob, exportPdf } from '../lib/exports/download';

interface Props {
  session: Session;
  onChange: (t: Transcription) => void;
  onReplaceSession: (s: Session) => void;
  onPractice: () => void;
}

export default function EditScreen({ session, onChange, onReplaceSession, onPractice }: Props) {
  const t = session.transcription;
  const score = useMemo(() => buildScore(t), [t]);
  const baseName = session.meta.name.replace(/\.[^.]+$/, '');

  const sourceBadge =
    t.source === 'server-librosa'
      ? { label: 'librosa (server)', cls: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' }
      : t.source === 'demo'
        ? { label: 'demo', cls: 'bg-sky-500/15 text-sky-600 dark:text-sky-400' }
        : t.source === 'midi-import'
          ? { label: 'MIDI tab (exact)', cls: 'bg-violet-500/15 text-violet-600 dark:text-violet-400' }
          : t.source === 'midi-aligned'
            ? { label: 'MIDI tab + original audio', cls: 'bg-violet-500/15 text-violet-600 dark:text-violet-400' }
            : { label: 'client DSP', cls: 'bg-amber-500/15 text-amber-600 dark:text-amber-400' };

  return (
    <div className="flex-1 px-4 sm:px-6 py-4 flex flex-col gap-4 max-w-7xl w-full mx-auto">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3 print:hidden">
        <div className="min-w-0">
          <h2 className="font-bold truncate max-w-60">{session.meta.name}</h2>
          <span className={`inline-block text-[11px] px-2 py-0.5 rounded-full font-medium ${sourceBadge.cls}`}>
            {sourceBadge.label} · {t.hits.length} hits · {score.measures.length} measures
          </span>
        </div>

        {/* When synced to a recording, tempo/offset/bar-start are owned by the
            alignment (the panel below); editing them here would fight it. */}
        {t.source === 'midi-aligned' ? (
          <span className="text-sm text-zinc-500">{Math.round(t.bpm)} BPM (from audio)</span>
        ) : (
        <label
          className="flex items-center gap-2 text-sm"
          title={
            t.beatTimes
              ? 'The grid follows the beats detected in the recording. Setting a tempo manually switches to a fixed grid.'
              : undefined
          }
        >
          <span className="text-zinc-500">Tempo</span>
          <input
            type="number"
            min={30}
            max={300}
            step={0.5}
            value={t.bpm}
            onChange={(e) => {
              const bpm = parseFloat(e.target.value);
              // A manual tempo replaces the tracked-beat grid with a fixed one.
              if (bpm >= 30 && bpm <= 300) onChange({ ...t, bpm, beatTimes: undefined });
            }}
            className="w-20 px-2 py-1.5 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 tabular-nums"
          />
          <span className="text-zinc-400">BPM{t.beatTimes ? ' (tracked)' : ''}</span>
        </label>
        )}

        <label className="flex items-center gap-2 text-sm">
          <span className="text-zinc-500">Quantize</span>
          <select
            value={t.quantize}
            onChange={(e) => onChange({ ...t, quantize: Number(e.target.value) as QuantizeLevel })}
            className="px-2 py-1.5 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700"
          >
            <option value={4}>1/4 notes</option>
            <option value={8}>1/8 notes</option>
            <option value={16}>1/16 notes</option>
            <option value={32}>1/32 notes</option>
          </select>
        </label>

        {t.source !== 'midi-aligned' && (
          <label className="flex items-center gap-2 text-sm" title="Shift where beat 1 falls in the audio">
            <span className="text-zinc-500">Beat 1 offset</span>
            <input
              type="number"
              step={0.01}
              value={Math.round(t.firstBeatOffset * 100) / 100}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                if (Number.isNaN(v) || v < 0) return;
                // Shift the tracked beat grid by the same amount so the whole
                // score slides together.
                const delta = v - t.firstBeatOffset;
                onChange({
                  ...t,
                  firstBeatOffset: v,
                  beatTimes: t.beatTimes?.map((b) => b + delta),
                });
              }}
              className="w-20 px-2 py-1.5 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 tabular-nums"
            />
            <span className="text-zinc-400">s</span>
          </label>
        )}

        {t.source !== 'midi-aligned' && (
          <div
            className="flex items-center gap-1.5 text-sm"
            title="Shift which beat starts the measure — fixes a score that is consistently one beat early or late"
          >
            <span className="text-zinc-500">Bar start</span>
            <button
              onClick={() => shiftBarStart(t, onChange, -1)}
              className="px-2 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              −1 beat
            </button>
            <button
              onClick={() => shiftBarStart(t, onChange, 1)}
              className="px-2 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              +1 beat
            </button>
          </div>
        )}

        <div className="flex items-center gap-2 ml-auto">
          <ExportButton onClick={() => downloadBlob(transcriptionToMidi(t), `${baseName}.mid`)}>
            MIDI
          </ExportButton>
          <ExportButton
            onClick={() => downloadBlob(transcriptionToMusicXML(t, baseName), `${baseName}.musicxml`)}
          >
            MusicXML
          </ExportButton>
          <ExportButton onClick={exportPdf}>PDF</ExportButton>
          <ExportButton
            onClick={() =>
              downloadBlob(
                new Blob([JSON.stringify(t, null, 2)], { type: 'application/json' }),
                `${baseName}.drumscribe.json`,
              )
            }
          >
            JSON
          </ExportButton>
          <button
            onClick={onPractice}
            className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-white font-semibold text-sm shadow"
          >
            ▶ Practice
          </button>
        </div>
      </div>

      {(t.source === 'midi-import' || t.source === 'midi-aligned') && (
        <OriginalAudioPanel session={session} onChange={onChange} onReplaceSession={onReplaceSession} />
      )}

      <Notation score={score} bpm={t.bpm} className="max-h-[48vh]" />

      <div className="print:hidden">
        <GridEditor
          score={score}
          onToggle={(m, s, drum) => onChange(toggleHit(t, score, m, s, drum))}
        />
      </div>
    </div>
  );
}

/** Rotate the grid by one beat: +1 = measures start one beat later. */
function shiftBarStart(t: Transcription, onChange: (t: Transcription) => void, dir: 1 | -1) {
  if (t.beatTimes && t.beatTimes.length >= 3) {
    const bts =
      dir === 1
        ? t.beatTimes.slice(1)
        : [Math.max(0, t.beatTimes[0] - (t.beatTimes[1] - t.beatTimes[0])), ...t.beatTimes];
    onChange({ ...t, beatTimes: bts, firstBeatOffset: bts[0] });
  } else {
    const beatDur = 60 / t.bpm;
    onChange({ ...t, firstBeatOffset: Math.max(0, t.firstBeatOffset + dir * beatDur) });
  }
}

function ExportButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="px-3 py-2 rounded-xl border border-zinc-300 dark:border-zinc-700 text-sm font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
    >
      {children}
    </button>
  );
}
