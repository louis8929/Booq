/**
 * VexFlow drum notation rendering.
 *
 * Standard drum-set staff mapping (percussion clef):
 *   kick        f/4          normal head, low space
 *   floor tom   a/4
 *   snare       c/5
 *   mid tom     d/5
 *   high tom    e/5
 *   ride        f/5  x-head
 *   hi-hat      g/5  x-head  (open = x with 'o' annotation)
 *   crash       a/5  x-head
 *
 * Rendering strategy: one voice, stems up, 16th-note resolution. Beats with
 * no hits collapse to a quarter rest; everything else renders as 16th
 * notes/rests so the formatter never sees an invalid tick total. This keeps
 * the layout robust for arbitrary machine-generated input — the trade-off
 * is slightly denser-than-hand-engraved rests.
 *
 * Crucially, after drawing we record every note's absolute X plus each
 * measure's bounding box. The sync engine interpolates the playback cursor
 * between those positions and toggles a CSS class on the note's SVG group.
 */

import {
  Renderer,
  Stave,
  StaveNote,
  Voice,
  Formatter,
  Beam,
  Annotation,
  Dot,
  Barline,
  GhostNote,
} from 'vexflow';
import type { DrumType } from '../types';
import type { Score, Measure } from './score';

const DRUM_VEX: Record<DrumType, { key: string; xHead: boolean }> = {
  kick: { key: 'f/4', xHead: false },
  'tom-low': { key: 'a/4', xHead: false },
  snare: { key: 'c/5', xHead: false },
  'tom-mid': { key: 'd/5', xHead: false },
  'tom-high': { key: 'e/5', xHead: false },
  ride: { key: 'f/5', xHead: true },
  'hihat-closed': { key: 'g/5', xHead: true },
  'hihat-open': { key: 'g/5', xHead: true },
  crash: { key: 'a/5', xHead: true },
};

export interface NoteRef {
  /** Absolute time in seconds this note sounds. */
  time: number;
  /** Absolute X in the SVG. */
  x: number;
  /** The SVG group element for highlighting. */
  el: SVGElement | null;
  measureIndex: number;
}

export interface MeasureBox {
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
  startTime: number;
  endTime: number;
}

export interface RenderResult {
  notes: NoteRef[];
  measures: MeasureBox[];
  totalHeight: number;
}

const STAVE_HEIGHT = 110;
const TOP_PAD = 20;

export function renderScore(
  container: HTMLDivElement,
  score: Score,
  _bpm: number,
  containerWidth: number,
): RenderResult {
  container.innerHTML = '';
  const width = Math.max(320, containerWidth);
  const measuresPerLine = Math.max(1, Math.floor(width / 280));
  const measureWidth = Math.floor((width - 20) / measuresPerLine);
  const lines = Math.ceil(score.measures.length / measuresPerLine);
  const totalHeight = TOP_PAD + lines * STAVE_HEIGHT + 20;

  const renderer = new Renderer(container, Renderer.Backends.SVG);
  renderer.resize(width, totalHeight);
  const ctx = renderer.getContext();

  const noteRefs: NoteRef[] = [];
  const measureBoxes: MeasureBox[] = [];

  for (let m = 0; m < score.measures.length; m++) {
    const line = Math.floor(m / measuresPerLine);
    const col = m % measuresPerLine;
    const x = 10 + col * measureWidth;
    const y = TOP_PAD + line * STAVE_HEIGHT;
    const measure = score.measures[m];

    // Clean staff per the user's request: no clef, no time signature, no
    // tempo marking, and no begin barline (the leftmost vertical line is
    // dropped so each line opens straight onto the notes). Measures are still
    // separated by their end barlines.
    const stave = new Stave(x, y, measureWidth);
    stave.setBegBarType(Barline.type.NONE);
    // Songsterr-style measure number at the start of each line
    if (col === 0) stave.setMeasure(m + 1);
    stave.setContext(ctx).draw();

    const { tickables, timed } = buildMeasureNotes(measure, score);
    const voice = new Voice({ num_beats: 4, beat_value: 4 }).setStrict(false);
    voice.addTickables(tickables);
    new Formatter().joinVoices([voice]).format([voice], measureWidth - 30);
    const beams = Beam.generateBeams(
      tickables.filter((n): n is StaveNote => n instanceof StaveNote && !n.isRest()),
      { stem_direction: 1 },
    );
    voice.draw(ctx, stave);
    beams.forEach((b) => b.setContext(ctx).draw());

    for (const tn of timed) {
      const el = (tn.note.getSVGElement?.() ?? null) as SVGElement | null;
      el?.classList.add('vf-hit');
      noteRefs.push({
        // Exact slot time from the (possibly drift-tracked) beat grid.
        time: measure.slots[tn.slotIndex].time,
        x: tn.note.getAbsoluteX(),
        el,
        measureIndex: m,
      });
    }

    measureBoxes.push({
      index: m,
      x,
      y,
      width: measureWidth,
      height: STAVE_HEIGHT,
      startTime: measure.startTime,
      endTime: measure.endTime,
    });
  }

  return { notes: noteRefs, measures: measureBoxes, totalHeight };
}

function buildMeasureNotes(measure: Measure, score: Score) {
  // Rests are rendered as invisible GhostNotes: they keep the rhythmic
  // spacing (so notes stay horizontally aligned to their beat and the
  // playback cursor lines up) but draw no glyph, giving the clean tab-style
  // staff the user asked for.
  const tickables: (StaveNote | GhostNote)[] = [];
  const timed: { note: StaveNote; slotIndex: number }[] = [];
  const slotsPerBeat = score.slotsPerMeasure / 4;

  for (let beat = 0; beat < 4; beat++) {
    const beatSlots = measure.slots.slice(beat * slotsPerBeat, (beat + 1) * slotsPerBeat);
    const hasHits = beatSlots.some((s) => s.drums.length > 0);

    if (!hasHits) {
      tickables.push(new GhostNote({ duration: 'q' }));
      continue;
    }

    // Within an active beat, render each slot at grid resolution.
    const slotDur = durationForSlotsPerBeat(slotsPerBeat);
    for (const slot of beatSlots) {
      if (slot.drums.length === 0) {
        tickables.push(new GhostNote({ duration: slotDur }));
        continue;
      }
      const sorted = [...slot.drums].sort(
        (a, b) => keyToLine(DRUM_VEX[a.drum].key) - keyToLine(DRUM_VEX[b.drum].key),
      );
      const keys = sorted.map((d) =>
        DRUM_VEX[d.drum].xHead ? `${DRUM_VEX[d.drum].key}/x2` : DRUM_VEX[d.drum].key,
      );
      const note = new StaveNote({ keys, duration: slotDur, stem_direction: 1 });
      if (sorted.some((d) => d.drum === 'hihat-open')) {
        note.addModifier(new Annotation('o').setVerticalJustification(Annotation.VerticalJustify.TOP));
      }
      tickables.push(note);
      timed.push({ note, slotIndex: slot.index });
    }
  }
  return { tickables, timed };
}

function durationForSlotsPerBeat(slotsPerBeat: number): string {
  switch (slotsPerBeat) {
    case 1: return 'q';
    case 2: return '8';
    case 4: return '16';
    case 8: return '32';
    default: return '16';
  }
}

function keyToLine(key: string): number {
  const [letter, octave] = key.split('/');
  const order = ['c', 'd', 'e', 'f', 'g', 'a', 'b'];
  return parseInt(octave, 10) * 7 + order.indexOf(letter);
}

// Keep Dot import referenced (some bundlers tree-shake VexFlow incorrectly otherwise).
void Dot;
