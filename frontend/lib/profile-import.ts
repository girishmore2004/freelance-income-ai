/**
 * Pure helpers for the profile page (U17): turning the resume reader's
 * suggestions into form values. Nothing here saves anything — the person
 * ticks what is right and presses Save.
 */

export type ResumeProject = { title: string; description: string; skills: string[]; link: string; year: string };
export type ResumeSuggestions = { headline: string; summary: string; skills: string[]; services: string[]; projects: ResumeProject[]; links: string[] };
export type Picks = { headline: boolean; summary: boolean; skills: string[]; services: string[]; projects: number[]; links: string[] };

/** Comma- or newline-separated text to a clean list. */
export function splitList(text: string, sep: RegExp = /[,\n]/): string[] {
  return text.split(sep).map((s) => s.trim()).filter(Boolean);
}

/** Adds items that are not already there (case and punctuation ignored), keeping order. */
export function mergeUnique(current: string[], add: string[]): string[] {
  const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9+#]/g, '');
  const out = [...current];
  for (const a of add) if (a.trim() && !out.some((c) => key(c) === key(a))) out.push(a.trim());
  return out;
}

/** Everything ticked by default: the person unticks what is wrong. */
export function defaultPicks(s: ResumeSuggestions): Picks {
  return { headline: !!s.headline, summary: !!s.summary, skills: [...s.skills], services: [...s.services], projects: s.projects.map((_, i) => i), links: [...s.links] };
}

export type ProfileForm = { headline: string; bio: string; skills: string; services: string; links: string };

/**
 * Applies the ticked suggestions to the form. Headline and summary fill only
 * empty fields unless `replaceText` is set; lists are merged, never replaced.
 */
export function applyPicks(form: ProfileForm, projects: ResumeProject[], s: ResumeSuggestions, picks: Picks, replaceText = false): { form: ProfileForm; projects: ResumeProject[]; added: number } {
  let added = 0;
  const next = { ...form };
  if (picks.headline && s.headline && (replaceText || !form.headline.trim())) { next.headline = s.headline; added += 1; }
  if (picks.summary && s.summary && (replaceText || !form.bio.trim())) { next.bio = s.summary; added += 1; }
  const skills = mergeUnique(splitList(form.skills, /,/), picks.skills);
  added += skills.length - splitList(form.skills, /,/).length;
  next.skills = skills.join(', ');
  const services = mergeUnique(splitList(form.services, /,/), picks.services);
  added += services.length - splitList(form.services, /,/).length;
  next.services = services.join(', ');
  const links = mergeUnique(splitList(form.links, /\n/), picks.links);
  added += links.length - splitList(form.links, /\n/).length;
  next.links = links.join('\n');
  const outProjects = [...projects];
  for (const i of picks.projects) {
    const p = s.projects[i];
    if (p && !outProjects.some((q) => q.title.toLowerCase() === p.title.toLowerCase()) && outProjects.length < 20) { outProjects.push({ ...p }); added += 1; }
  }
  return { form: next, projects: outProjects, added };
}

/** Plain-language label for a 0–100 match score. */
export function scoreLabel(score: number): string {
  if (score >= 80) return 'Strong match';
  if (score >= 60) return 'Good match';
  if (score >= 40) return 'Possible match';
  return 'Weak match';
}
