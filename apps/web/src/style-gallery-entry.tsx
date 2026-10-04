/**
 * Standalone entry that renders the component gallery ONCE PER ACCENT, side by
 * side, purely so the accent can be chosen by looking at it.
 *
 * This works because the accent tokens in `styles/tokens.css` are scoped to a
 * `[data-accent='...']` attribute selector rather than to `:root` — so the
 * custom properties cascade from any wrapper element, and two different
 * accents can coexist on one page. That was not an accident in the token
 * design; it is what makes a live comparison possible.
 *
 * Not part of the app. Built separately via `vite.gallery.config.ts`.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { StyleGallery } from './pages/StyleGallery';
import './styles/index.css';

function Column({ accent, label }: { accent: 'bronze' | 'teal'; label: string }): JSX.Element {
  return (
    <div data-accent={accent} className="bg-paper">
      <div className="border-b border-line px-roomy py-base">
        <p className="eyebrow">Accent option</p>
        <h2 className="font-display text-display-sm">{label}</h2>
      </div>
      <StyleGallery />
    </div>
  );
}

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <div className="grid grid-cols-2 divide-x divide-line">
        <Column accent="bronze" label="Bronze" />
        <Column accent="teal" label="Deep teal" />
      </div>
    </StrictMode>,
  );
}
