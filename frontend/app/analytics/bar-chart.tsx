'use client';
import { useState } from 'react';
import { periodLabel } from '@/lib/analytics-format';

/**
 * Single-series bar chart (one hue, so no legend: the title names it).
 * Thin bars with rounded data-ends on a zero baseline, a recessive axis,
 * a hover/focus tooltip with a hit target taller than the bar, and a table
 * view for screen readers and exact values.
 */
export function BarChart({ title, points, format }: { title: string; points: Array<{ period: string; value: number }>; format: (v: number) => string }) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const width = 560;
  const height = 160;
  const pad = { top: 16, bottom: 22, left: 4, right: 4 };
  const max = Math.max(1, ...points.map((p) => p.value));
  const slot = (width - pad.left - pad.right) / Math.max(points.length, 1);
  const bar = Math.min(28, slot * 0.6);
  const plot = height - pad.top - pad.bottom;
  const allZero = points.every((p) => p.value === 0);

  return (
    <figure className="chart">
      <figcaption className="row between">
        <b>{title}</b>
        <button type="button" className="link" aria-pressed={table} onClick={() => setTable((t) => !t)}>{table ? 'Show chart' : 'Show table'}</button>
      </figcaption>
      {allZero && <p className="muted small">Nothing recorded in this period yet.</p>}
      {table ? (
        <table>
          <thead><tr><th scope="col">Period</th><th scope="col">{title}</th></tr></thead>
          <tbody>{points.map((p) => <tr key={p.period}><td>{periodLabel(p.period)}</td><td>{format(p.value)}</td></tr>)}</tbody>
        </table>
      ) : (
        <div className="chart-plot">
          <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${title}: ${points.map((p) => `${periodLabel(p.period)} ${format(p.value)}`).join(', ')}`}>
            <line x1={pad.left} x2={width - pad.right} y1={height - pad.bottom} y2={height - pad.bottom} className="chart-axis" />
            {points.map((p, i) => {
              const h = p.value > 0 ? Math.max(2, (p.value / max) * plot) : 0;
              const x = pad.left + i * slot + (slot - bar) / 2;
              const y = height - pad.bottom - h;
              const r = Math.min(4, h / 2, bar / 2);
              return (
                <g key={p.period}>
                  {h > 0 && <path className={`chart-bar${hover === i ? ' on' : ''}`} d={`M${x},${height - pad.bottom} V${y + r} Q${x},${y} ${x + r},${y} H${x + bar - r} Q${x + bar},${y} ${x + bar},${y + r} V${height - pad.bottom} Z`} />}
                  <text x={x + bar / 2} y={height - 6} textAnchor="middle" className="chart-tick">{periodLabel(p.period)}</text>
                  <rect
                    x={pad.left + i * slot} y={0} width={slot} height={height - pad.bottom} fill="transparent" tabIndex={0}
                    aria-label={`${periodLabel(p.period)}: ${format(p.value)}`}
                    onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}
                  />
                </g>
              );
            })}
          </svg>
          {hover !== null && points[hover] && (
            <div className="chart-tip" role="status" style={{ left: `${((pad.left + hover * slot + slot / 2) / width) * 100}%` }}>
              <b>{format(points[hover].value)}</b> <span className="muted">{periodLabel(points[hover].period)}</span>
            </div>
          )}
        </div>
      )}
    </figure>
  );
}
