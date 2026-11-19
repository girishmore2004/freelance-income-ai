'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api-client';

/**
 * F7 Delivery Planner (U24): hours a week already booked on hourly contracts
 * against the hours on the profile, and deadlines in the next four weeks.
 * Matching uses the free hours, so a fully booked freelancer is not pushed to clients.
 */
type Capacity = {
  available_hours: number; booked_hours: number; free_hours: number; status: 'open' | 'full' | 'over' | 'unknown';
  weeks: Array<{ week_start: string; deadlines: number; items: Array<{ date: string; title: string; kind: string }> }>;
  warnings: string[]; note: string;
};

const STATUS: Record<Capacity['status'], string> = { open: 'Taking work', full: 'Nearly full', over: 'Over-booked', unknown: 'Hours not set' };

export function CapacityCard() {
  const [data, setData] = useState<Capacity | null>(null);
  useEffect(() => {
    api<Capacity>('/api/v1/me/capacity').then((c) => setData(c && Array.isArray(c.weeks) ? c : null)).catch(() => setData(null));
  }, []);
  if (!data) return null;
  const pct = data.available_hours ? Math.min(100, Math.round((data.booked_hours / data.available_hours) * 100)) : 0;
  return (
    <section className="card" aria-labelledby="capacity-heading">
      <div className="row between"><h2 id="capacity-heading">My capacity</h2><span className={data.status === 'over' ? 'badge danger' : 'badge'}>{STATUS[data.status]}</span></div>
      {data.available_hours > 0 ? (
        <>
          <p>{data.booked_hours} of {data.available_hours} hours a week booked on hourly contracts · {Math.max(0, data.free_hours)} free</p>
          <div className="meter" role="meter" aria-label="Weekly hours booked" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}><span style={{ width: `${pct}%` }} /></div>
        </>
      ) : <p className="muted">Set your weekly hours on your profile.</p>}
      <ul aria-label="Deadlines by week">
        {data.weeks.map((w) => <li key={w.week_start} className="small">Week of {w.week_start}: {w.deadlines ? `${w.deadlines} deadline${w.deadlines === 1 ? '' : 's'}` : 'no deadlines'}</li>)}
      </ul>
      {data.warnings.map((w) => <p key={w} className="notice small">{w}</p>)}
      <p className="muted small">{data.note}</p>
    </section>
  );
}
