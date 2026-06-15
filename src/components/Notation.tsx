import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react';
import type { Score } from '../lib/score';
import { renderScore, type RenderResult } from '../lib/notation';

export interface NotationHandle {
  /**
   * Move the playback cursor to an audio time. Called every animation frame
   * by the practice screen — works imperatively on the DOM so React never
   * re-renders during playback.
   */
  setTime(time: number | null): void;
}

interface Props {
  score: Score;
  bpm: number;
  /** Click on a measure seeks playback there. */
  onSeek?: (time: number) => void;
  /** Auto-scroll to keep cursor visible (practice mode). */
  followCursor?: boolean;
  className?: string;
}

const Notation = forwardRef<NotationHandle, Props>(function Notation(
  { score, bpm, onSeek, followCursor = false, className = '' },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const renderResult = useRef<RenderResult | null>(null);
  const activeNotes = useRef<Set<SVGElement>>(new Set());
  const lastScrollY = useRef(-1);

  // (Re)render notation when score or container width changes
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let frame = 0;
    const doRender = () => {
      renderResult.current = renderScore(host, score, bpm, host.clientWidth);
    };
    doRender();
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(doRender);
    });
    ro.observe(host);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [score, bpm]);

  useImperativeHandle(ref, () => ({
    setTime(time: number | null) {
      const cursor = cursorRef.current;
      const result = renderResult.current;
      const wrap = wrapRef.current;
      if (!cursor || !result || !wrap) return;

      if (time === null) {
        cursor.style.display = 'none';
        for (const el of activeNotes.current) el.classList.remove('vf-hit-active');
        activeNotes.current.clear();
        return;
      }

      const measure = result.measures.find((m) => time >= m.startTime && time < m.endTime);
      if (!measure) {
        cursor.style.display = 'none';
        return;
      }

      // Interpolate X linearly across the measure (notes inside a measure are
      // formatted near-proportionally; linear interpolation is visually smooth
      // and never jumps backwards).
      const frac = (time - measure.startTime) / (measure.endTime - measure.startTime);
      const pad = 14;
      const x = measure.x + pad + frac * (measure.width - pad * 2);
      cursor.style.display = 'block';
      cursor.style.left = `${x}px`;
      cursor.style.top = `${measure.y}px`;
      cursor.style.height = `${measure.height}px`;

      // Highlight notes within a small window around "now"
      const windowSec = 0.09;
      const next = new Set<SVGElement>();
      for (const n of result.notes) {
        if (n.el && time >= n.time - 0.02 && time <= n.time + windowSec) {
          next.add(n.el);
        }
      }
      for (const el of activeNotes.current) {
        if (!next.has(el)) el.classList.remove('vf-hit-active');
      }
      for (const el of next) {
        if (!activeNotes.current.has(el)) el.classList.add('vf-hit-active');
      }
      activeNotes.current = next;

      // Auto-scroll: keep the active line in the middle of the viewport
      if (followCursor && measure.y !== lastScrollY.current) {
        lastScrollY.current = measure.y;
        wrap.scrollTo({
          top: Math.max(0, measure.y - wrap.clientHeight / 2 + measure.height / 2),
          behavior: 'smooth',
        });
      }
    },
  }), [followCursor]);

  return (
    <div
      ref={wrapRef}
      className={`relative overflow-y-auto rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 ${className}`}
      onClick={(e) => {
        if (!onSeek || !renderResult.current || !hostRef.current) return;
        const rect = hostRef.current.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const m = renderResult.current.measures.find(
          (b) => x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height,
        );
        if (m) {
          const frac = Math.max(0, Math.min(1, (x - m.x) / m.width));
          onSeek(m.startTime + frac * (m.endTime - m.startTime));
        }
      }}
    >
      <div className="relative">
        {/* The SVG host is cleared on every render pass, so the cursor lives
            beside it (same origin) rather than inside it. */}
        <div ref={hostRef} className="notation-host print-area relative min-h-[140px]" />
        <div ref={cursorRef} className="playback-cursor" style={{ display: 'none' }} />
      </div>
    </div>
  );
});

export default Notation;
