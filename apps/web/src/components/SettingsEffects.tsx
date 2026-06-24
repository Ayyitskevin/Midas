import { useEffect } from 'react';
import { useSettings } from '@/store/useSettings';
import { rootFontPx } from '@/lib/settings';

/**
 * Applies document-level preferences that can't be expressed per-component:
 * the density type-scale (root font-size, which all rem units key off) and a
 * `reduce-motion` class on <html> that index.css uses to neutralise animation.
 * Renders nothing.
 */
export function SettingsEffects() {
  const density = useSettings((s) => s.settings.density);
  const reduceMotion = useSettings((s) => s.settings.reduceMotion);

  useEffect(() => {
    document.documentElement.style.fontSize = `${rootFontPx(density)}px`;
  }, [density]);

  useEffect(() => {
    document.documentElement.classList.toggle('reduce-motion', reduceMotion);
  }, [reduceMotion]);

  return null;
}
