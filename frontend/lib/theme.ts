'use client';
import { useEffect, useState } from 'react';

/**
 * Light / dark theme. The choice is remembered per browser; with no choice the
 * operating system's setting is followed. The attribute is set before the page
 * paints by THEME_BOOT (see layout.tsx), so there is no flash of the wrong theme.
 */

export type Theme = 'light' | 'dark';
const KEY = 'fia_theme';

export function savedTheme(): Theme | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
}

export function systemTheme(): Theme {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme);
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // Storage unavailable: the theme lasts for this page.
  }
}

export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>('light');
  useEffect(() => { setTheme(savedTheme() ?? systemTheme()); }, []);
  const toggle = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    setTheme(next);
  };
  return [theme, toggle];
}
