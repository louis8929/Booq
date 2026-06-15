import { useState } from 'react';
import { DRUM_LABELS, DRUM_ORDER, type DrumType } from '../types';
import type { Score } from '../lib/score';

interface Props {
  score: Score;
  onToggle: (measureIndex: number, slotIndex: number, drum: DrumType) => void;
}

/**
 * Drum-machine style step editor: rows are drums, columns are grid slots of
 * one measure. Clicking a cell adds/removes a hit — far more reliable than
 * hit-testing engraved SVG notation, and instantly re-renders the score.
 */
export default function GridEditor({ score, onToggle }: Props) {
  const [measureIndex, setMeasureIndex] = useState(0);
  const clamped = Math.min(measureIndex, score.measures.length - 1);
  const measure = score.measures[clamped];
  const slotsPerBeat = score.slotsPerMeasure / 4;

  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-sm">Hit Editor</h3>
        <div className="flex items-center gap-2 text-sm">
          <button
            className="px-2 py-1 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-800 disabled:opacity-40"
            disabled={clamped === 0}
            onClick={() => setMeasureIndex(clamped - 1)}
          >
            ◀
          </button>
          <span className="tabular-nums font-medium">
            Measure {clamped + 1} / {score.measures.length}
          </span>
          <button
            className="px-2 py-1 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-800 disabled:opacity-40"
            disabled={clamped >= score.measures.length - 1}
            onClick={() => setMeasureIndex(clamped + 1)}
          >
            ▶
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="border-separate border-spacing-0.5 w-full">
          <thead>
            <tr>
              <th className="w-28" />
              {measure.slots.map((s) => (
                <th
                  key={s.index}
                  className={`text-[10px] font-normal text-zinc-400 pb-1 ${
                    s.index % slotsPerBeat === 0 ? 'text-zinc-600 dark:text-zinc-300 font-bold' : ''
                  }`}
                >
                  {s.index % slotsPerBeat === 0 ? s.index / slotsPerBeat + 1 : '·'}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {DRUM_ORDER.map((drum) => (
              <tr key={drum}>
                <td className="text-xs pr-2 whitespace-nowrap text-zinc-600 dark:text-zinc-300">
                  {DRUM_LABELS[drum]}
                </td>
                {measure.slots.map((slot) => {
                  const active = slot.drums.some((d) => d.drum === drum);
                  const beatStart = slot.index % slotsPerBeat === 0;
                  return (
                    <td key={slot.index} className="p-0">
                      <button
                        onClick={() => onToggle(clamped, slot.index, drum)}
                        title={`${DRUM_LABELS[drum]} — beat ${Math.floor(slot.index / slotsPerBeat) + 1}`}
                        className={`w-full h-7 min-w-5 rounded transition-colors ${
                          active
                            ? 'bg-amber-500 hover:bg-amber-400'
                            : beatStart
                              ? 'bg-zinc-200 dark:bg-zinc-700/70 hover:bg-amber-300 dark:hover:bg-amber-700'
                              : 'bg-zinc-100 dark:bg-zinc-800 hover:bg-amber-200 dark:hover:bg-amber-800'
                        }`}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-zinc-400 mt-2">
        Click cells to add or remove hits. Changes update the notation immediately.
      </p>
    </div>
  );
}
