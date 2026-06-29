import { useMemo, useState } from 'react';
import { COMMANDS } from '@/commands/registry';
import { openModule } from '@/commands/execute';
import { boardCatalog, boardCount, pinnedBoards, type BoardEntry } from '@/lib/boardCatalog';
import { useBoardFavorites } from '@/store/useBoardFavorites';
import { EmptyState } from '@/components/Feedback';

function BoardRow({ b, fav, onToggle }: { b: BoardEntry; fav: boolean; onToggle: (code: string) => void }) {
  return (
    <tr className="border-b border-term-border/20 hover:bg-term-header/40">
      <td className="w-5 px-1 py-0.5 align-top text-center">
        <button
          onClick={() => onToggle(b.code)}
          className={`no-drag ${fav ? 'text-term-amber' : 'text-term-dim hover:text-term-amber'}`}
          title={fav ? 'Unpin from favorites' : 'Pin to favorites'}
        >
          {fav ? '★' : '☆'}
        </button>
      </td>
      <td className="w-16 px-1 py-0.5 align-top">
        <button
          onClick={() => openModule(b.code, null)}
          className="no-drag font-semibold text-term-text hover:text-term-amber"
          title={`Open ${b.code}`}
        >
          {b.code}
        </button>
      </td>
      <td className="px-2 py-0.5 align-top">
        <button
          onClick={() => openModule(b.code, null)}
          className="no-drag text-left text-term-muted hover:text-term-text"
        >
          <span className="text-term-text">{b.title}</span>
          <span className="text-term-dim"> — {b.description.split(' — ')[1]?.split('.')[0] ?? ''}</span>
        </button>
      </td>
    </tr>
  );
}

export function ScreenerCatalogModule() {
  const [query, setQuery] = useState('');
  const favCodes = useBoardFavorites((s) => s.favorites);
  const isFav = useBoardFavorites((s) => s.isFavorite);
  const toggleFav = useBoardFavorites((s) => s.toggle);

  const total = useMemo(() => boardCount(COMMANDS), []);
  const groups = useMemo(() => boardCatalog(COMMANDS, query), [query]);
  const shown = useMemo(() => groups.reduce((n, g) => n + g.boards.length, 0), [groups]);
  const favs = useMemo(() => pinnedBoards(COMMANDS, favCodes), [favCodes]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1 text-2xs">
        <span className="text-term-dim">
          Screener catalog · <span className="text-term-text">{shown}</span>
          {query ? `/${total}` : ''} boards
        </span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="filter boards…"
          className="no-drag ml-auto w-40 rounded-sm border border-term-border bg-term-panel px-1.5 py-0.5 text-2xs text-term-text outline-none focus:border-term-amber"
        />
      </div>

      <div className="scroll-term min-h-0 flex-1 overflow-auto">
        {/* Pinned favorites strip — quick access, only when not searching. */}
        {favs.length > 0 && !query && (
          <div>
            <div className="sticky top-0 bg-term-header px-2 py-0.5 text-2xs font-semibold text-term-amber">
              ★ Favorites <span className="text-term-dim">· {favs.length}</span>
            </div>
            <table className="w-full text-2xs">
              <tbody>
                {favs.map((b) => (
                  <BoardRow key={`fav-${b.code}`} b={b} fav onToggle={toggleFav} />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {shown === 0 ? (
          <EmptyState>No boards match “{query}”.</EmptyState>
        ) : (
          groups.map((g) => (
            <div key={g.category}>
              <div className="sticky top-0 bg-term-header px-2 py-0.5 text-2xs font-semibold text-term-amber">
                {g.category} <span className="text-term-dim">· {g.boards.length}</span>
              </div>
              <table className="w-full text-2xs">
                <tbody>
                  {g.boards.map((b) => (
                    <BoardRow key={b.code} b={b} fav={isFav(b.code)} onToggle={toggleFav} />
                  ))}
                </tbody>
              </table>
            </div>
          ))
        )}
      </div>

      <div className="border-t border-term-border px-2 py-1 text-2xs text-term-dim">
        Every indicator/analytics board in one place — type to filter, ★ to pin, click a code to open.
      </div>
    </div>
  );
}
