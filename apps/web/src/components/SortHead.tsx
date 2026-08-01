export function SortHead<T extends string>({
  col,
  label,
  align,
  sort,
  onSort,
}: {
  col: T;
  label: string;
  align: 'left' | 'right';
  sort: T;
  onSort: (c: T) => void;
}) {
  return (
    <th className={`px-2 py-1 font-normal ${align === 'right' ? 'text-right' : 'text-left'}`}>
      <button
        onClick={() => onSort(col)}
        className={`no-drag hover:text-term-amber ${sort === col ? 'text-term-amber' : 'text-term-muted'}`}
      >
        {label}
      </button>
    </th>
  );
}
