import { useMemo, useState } from 'react';
import './DataTable.css';

export interface Column<T> {
  key: string;
  label: string;
  render?: (row: T) => React.ReactNode;
  sortValue?: (row: T) => string | number;
  align?: 'right' | 'left' | 'center';
}

export function DataTable<T>({
  columns,
  rows,
  emptyLabel = 'داده‌ای موجود نیست',
  rowKey,
  onRowClick,
}: {
  columns: Column<T>[];
  rows: T[];
  emptyLabel?: string;
  rowKey: (row: T) => string | number;
  onRowClick?: (row: T) => void;
}) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<1 | -1>(1);

  const sorted = useMemo(() => {
    if (!sortKey) return rows;
    const col = columns.find((c) => c.key === sortKey);
    if (!col?.sortValue) return rows;
    return [...rows].sort((a, b) => {
      const va = col.sortValue!(a);
      const vb = col.sortValue!(b);
      if (va < vb) return -1 * sortDir;
      if (va > vb) return 1 * sortDir;
      return 0;
    });
  }, [rows, sortKey, sortDir, columns]);

  function toggleSort(col: Column<T>) {
    if (!col.sortValue) return;
    if (sortKey === col.key) {
      setSortDir((d) => (d === 1 ? -1 : 1));
    } else {
      setSortKey(col.key);
      setSortDir(1);
    }
  }

  return (
    <div className="datatable-wrap">
      <table className="datatable">
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                className={c.sortValue ? 'sortable' : ''}
                style={{ textAlign: c.align ?? 'right' }}
                onClick={() => toggleSort(c)}
              >
                {c.label}
                {sortKey === c.key && <span className="sort-arrow">{sortDir === 1 ? ' ▲' : ' ▼'}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="empty-cell">
                {emptyLabel}
              </td>
            </tr>
          )}
          {sorted.map((row) => (
            <tr key={rowKey(row)} onClick={() => onRowClick?.(row)} className={onRowClick ? 'clickable' : ''}>
              {columns.map((c) => (
                <td key={c.key} style={{ textAlign: c.align ?? 'right' }}>
                  {c.render ? c.render(row) : String((row as any)[c.key] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
