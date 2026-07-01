import { RELEASES } from '@/lib/whatsNew';

/**
 * WN — What's New: the curated changelog, in-terminal. Static bundle data by
 * design (no network): the panel always answers instantly, and the version
 * nudge (WhatsNewNudge) is what compares against the live server.
 */
export function WhatsNewModule() {
  return (
    <div className="no-drag scroll-term h-full overflow-y-auto p-3">
      <div className="mb-2 text-2xs text-term-muted">
        Release highlights. Full details in{' '}
        <a
          href="https://github.com/ayyitskevin/midas/blob/main/CHANGELOG.md"
          target="_blank"
          rel="noreferrer"
          className="text-term-amber hover:underline"
        >
          CHANGELOG.md
        </a>
        .
      </div>
      <div className="space-y-3">
        {RELEASES.map((r, i) => (
          <section key={r.version} className="rounded-sm border border-term-border bg-term-panel/50 p-2">
            <div className="mb-1 flex items-baseline justify-between">
              <h3 className="font-mono text-xs font-semibold text-term-amber">
                v{r.version}
                {i === 0 && (
                  <span className="ml-2 rounded-sm bg-term-up/15 px-1.5 py-0.5 text-2xs font-semibold text-term-up">
                    LATEST
                  </span>
                )}
              </h3>
              <span className="text-2xs text-term-dim">{r.date}</span>
            </div>
            <div className="mb-1 text-2xs font-semibold uppercase tracking-wide text-term-text">{r.title}</div>
            <ul className="list-disc space-y-0.5 pl-4 text-2xs text-term-muted">
              {r.highlights.map((h) => (
                <li key={h}>{h}</li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
