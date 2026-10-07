import { useId, useMemo, useState } from 'react';
import type { DiscoveredTables } from './use-rdb-connection-form';

/** Below this many tables a search box is clutter. */
const SEARCH_FROM = 8;

interface RdbTablePickerProps {
  selected: readonly string[];
  discovered: DiscoveredTables;
  canDiscover: boolean;
  busy: boolean;
  onChange: (tables: string[]) => void;
  onDiscover: () => void;
}

/**
 * Which tables AX Studio may read, picked from what the database shows. Nothing is readable
 * until it is checked here, so a typo can no longer leave a connection silently empty.
 */
export function RdbTablePicker({ selected, discovered, canDiscover, busy, onChange, onDiscover }: RdbTablePickerProps) {
  const [query, setQuery] = useState('');
  const headingId = useId();
  const found = discovered.status === 'loaded' ? discovered.tables : [];
  // A table saved earlier that the database no longer shows stays visible so it can be removed.
  const options = useMemo(() => [...new Set([...found, ...selected])], [found, selected]);
  const missing = new Set(selected.filter((table) => discovered.status === 'loaded' && !found.includes(table)));
  const needle = query.trim().toLowerCase();
  const visible = needle ? options.filter((table) => table.toLowerCase().includes(needle)) : options;
  const chosen = new Set(selected);
  const allVisibleChosen = visible.length > 0 && visible.every((table) => chosen.has(table));

  const toggle = (table: string) => onChange(chosen.has(table)
    ? selected.filter((entry) => entry !== table)
    : [...selected, table]);
  const toggleVisible = () => onChange(allVisibleChosen
    ? selected.filter((table) => !visible.includes(table))
    : [...new Set([...selected, ...visible])]);

  return (
    <section className="rdb-table-picker" aria-labelledby={headingId}>
      <div className="rdb-table-picker-header">
        <span id={headingId} className="rdb-table-picker-title">읽어도 되는 테이블</span>
        <span className="rdb-table-picker-count">{selected.length}개 선택</span>
        <button type="button" className="btn btn-sm btn-secondary" onClick={onDiscover}
          disabled={busy || !canDiscover || discovered.status === 'loading'}>
          {discovered.status === 'loading' ? '불러오는 중…' : discovered.status === 'loaded' ? '다시 불러오기' : '테이블 불러오기'}
        </button>
      </div>

      {discovered.status === 'idle' && options.length === 0 && (
        <p className="rdb-table-picker-note">
          {canDiscover ? 'DB의 테이블 목록을 불러와 고르세요.' : 'DB 파일이나 접속 주소를 먼저 정하면 테이블을 고를 수 있어요.'}
        </p>
      )}
      {discovered.status === 'failed' && <p className="rdb-table-picker-note warning" role="alert">{discovered.message}</p>}
      {discovered.status === 'loaded' && found.length === 0 && <p className="rdb-table-picker-note">이 DB에는 테이블이 없습니다.</p>}
      {discovered.status === 'loaded' && found.length > 0 && selected.length === 0 && (
        <p className="rdb-table-picker-note">하나 이상 골라야 연결할 수 있어요.</p>
      )}

      {options.length >= SEARCH_FROM && (
        <input type="search" className="rdb-table-picker-search" value={query} placeholder="테이블 이름으로 찾기"
          aria-label="테이블 찾기" onChange={(event) => setQuery(event.target.value)} />
      )}
      {visible.length > 1 && (
        <label className="rdb-table-picker-option rdb-table-picker-all">
          <input type="checkbox" checked={allVisibleChosen} onChange={toggleVisible} />
          {needle ? '찾은 테이블 모두' : '모두'}
        </label>
      )}
      {visible.length > 0 && (
        <ul className="rdb-table-picker-list">
          {visible.map((table) => (
            <li key={table}>
              <label className="rdb-table-picker-option">
                <input type="checkbox" checked={chosen.has(table)} onChange={() => toggle(table)} />
                <span className="rdb-table-picker-name">{table}</span>
                {missing.has(table) && <span className="rdb-table-picker-missing">DB에 없음</span>}
              </label>
            </li>
          ))}
        </ul>
      )}
      {needle && visible.length === 0 && <p className="rdb-table-picker-note">“{query.trim()}”와 맞는 테이블이 없습니다.</p>}
      {discovered.status === 'loaded' && discovered.truncated && (
        <p className="rdb-table-picker-note">테이블이 너무 많아 앞의 {found.length}개만 보여요.</p>
      )}
    </section>
  );
}
