// @vitest-environment jsdom
// Render-level pins for the provenance badge/honesty banner. (.ts not .tsx
// because vitest's include glob is src/**/*.test.ts — JSX is avoided via
// createElement so no vitest.config change is needed.)
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import type { BoardMeta } from '@midas/shared';
import { BoardMetaBadge, BoardMetaNote } from './BoardMeta';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(cleanup);

function meta(overrides: Partial<BoardMeta>): BoardMeta {
  return {
    provenance: 'live',
    source: 'binance',
    asOf: Date.now(),
    cachedAt: null,
    partial: false,
    note: null,
    ...overrides,
  };
}

describe('BoardMetaBadge', () => {
  it('labels a fresh live board as live with the green dot', () => {
    const { container } = render(createElement(BoardMetaBadge, { meta: meta({}) }));
    expect(screen.getByText('binance')).toBeTruthy();
    expect(screen.getByText('· live')).toBeTruthy();
    expect(container.querySelector('.bg-term-up')).toBeTruthy();
  });

  it('labels a cached board as cached, visually distinct from live', () => {
    const { container } = render(
      createElement(BoardMetaBadge, { meta: meta({ cachedAt: Date.now() - 1_000 }) }),
    );
    expect(screen.getByText('· cached')).toBeTruthy();
    expect(screen.queryByText('· live')).toBeNull();
    expect(container.querySelector('.bg-term-amber')).toBeTruthy();
    expect(container.querySelector('.bg-term-up')).toBeNull();
  });

  it('labels synthetic provenance as synthetic, never live', () => {
    const { container } = render(
      createElement(BoardMetaBadge, { meta: meta({ provenance: 'synthetic', source: 'mock' }) }),
    );
    expect(screen.getByText('mock')).toBeTruthy();
    expect(screen.getByText('· synthetic')).toBeTruthy();
    expect(container.querySelector('.bg-term-up')).toBeNull();
  });
});

describe('BoardMetaNote', () => {
  it('renders the honesty banner with the server caveat', () => {
    const { container } = render(
      createElement(BoardMetaNote, {
        meta: meta({ partial: true, note: 'Partial coverage: 2 venues failed.' }),
      }),
    );
    expect(screen.getByText(/Partial coverage: 2 venues failed\./)).toBeTruthy();
    expect(container.querySelector('.text-term-amber')).toBeTruthy();
  });

  it('renders the dropped-rows caveat for a partial board with no note', () => {
    render(createElement(BoardMetaNote, { meta: meta({ partial: true }) }));
    expect(screen.getByText(/rows were dropped/)).toBeTruthy();
  });

  it('renders nothing when the board is fully live with no caveat', () => {
    const { container } = render(createElement(BoardMetaNote, { meta: meta({}) }));
    expect(container.firstChild).toBeNull();
  });
});
