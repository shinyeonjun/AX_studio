import { useEffect, useRef, useState } from 'react';
import type { AppState } from '../../../../../types/app-state';
import { connectionEntry, rdbTypeLabel } from '../../../../../ui/lib/connection-display';
import { confirmDisconnectConnector } from '../../../../../ui/lib/confirm-delete';
import { ipcErrorMessage } from '../../../../../ui/lib/ipc-error';

export type RdbConnectionType = 'sqlite' | 'postgres' | 'mysql';

export interface RdbConnectionFormProps {
  state: AppState | null;
  embedded?: boolean;
  onPickSqliteFile: () => Promise<{ ok: boolean; canceled?: boolean; path?: string }>;
  onDiscoverTables: (payload: { type: 'mysql' | 'postgres' | 'sqlite'; filePath?: string; connectionString?: string }) => Promise<{ tables: string[]; truncated: boolean }>;
  onConnect: (payload: {
    type: RdbConnectionType;
    connectionString?: string;
    filePath?: string;
    allowedSchemas?: string[];
    allowedTables?: string[];
    rowLimit?: number;
    label?: string;
  }) => Promise<{ warning?: string } | void>;
  onDisconnect: () => Promise<void>;
}

type RdbConnectionControllerProps = Pick<RdbConnectionFormProps, 'state' | 'onPickSqliteFile' | 'onDiscoverTables' | 'onConnect' | 'onDisconnect'>;

/** What the database showed when the person asked for its tables. */
export type DiscoveredTables =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'loaded'; tables: string[]; truncated: boolean }
  | { status: 'failed'; message: string };

export function useRdbConnectionForm({
  state,
  onPickSqliteFile,
  onDiscoverTables,
  onConnect,
  onDisconnect,
}: RdbConnectionControllerProps) {
  const rdbEntry = connectionEntry(state, 'rdb');
  const connected = Boolean(rdbEntry?.connected);
  const formRef = useRef<HTMLDivElement>(null);
  const [type, setType] = useState<RdbConnectionType>('sqlite');
  const [filePath, setFilePath] = useState('');
  const [connectionString, setConnectionString] = useState('');
  const [allowedSchemas, setAllowedSchemas] = useState('');
  const [allowedTables, setAllowedTables] = useState<string[]>([]);
  const [discovered, setDiscovered] = useState<DiscoveredTables>({ status: 'idle' });
  const [rowLimit, setRowLimit] = useState('1000');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  /** Non-blocking advice from the main process (e.g. a remote DB without TLS). */
  const [warning, setWarning] = useState('');
  // Only the latest request may show its tables: an older one finishing late (a slow database,
  // or the type or SQLite file changed meanwhile) must not replace the newer list.
  const tablesRequestRef = useRef(0);

  const loadFromConnection = (scroll = true) => {
    if (!rdbEntry?.connected || !rdbEntry.dbType) return;
    setType(rdbEntry.dbType);
    setLabel(rdbEntry.label ?? '');
    setAllowedSchemas((rdbEntry.allowedSchemas ?? []).join(', '));
    setAllowedTables([...(rdbEntry.allowedTables ?? [])]);
    tablesRequestRef.current += 1;
    setDiscovered({ status: 'idle' });
    setRowLimit(rdbEntry.rowLimit != null ? String(rdbEntry.rowLimit) : '1000');
    if (rdbEntry.dbType === 'sqlite') {
      setFilePath(rdbEntry.target ?? '');
      setConnectionString('');
      void loadTables({ type: 'sqlite', filePath: rdbEntry.target ?? '' });
    } else {
      setConnectionString('');
      setFilePath('');
    }
    setMessage('');
    setWarning('');
    if (scroll) formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // Opening the page of a connected database shows that connection, ready to change.
  const prefilled = useRef(false);
  useEffect(() => {
    if (prefilled.current || !connected) return;
    prefilled.current = true;
    loadFromConnection(false);
  });

  const connectedItems =
    connected && rdbEntry?.dbType
      ? [
          {
            id: 'rdb',
            title: rdbEntry.label?.trim() || rdbTypeLabel(rdbEntry.dbType),
            subtitle: rdbEntry.target,
            meta: [
              rdbTypeLabel(rdbEntry.dbType),
              rdbEntry.allowedTables?.length ? `테이블 ${rdbEntry.allowedTables.length}개` : undefined,
              rdbEntry.rowLimit != null ? `행 제한 ${rdbEntry.rowLimit}` : undefined,
            ]
              .filter(Boolean)
              .join(' · '),
          },
        ]
      : [];

  const loadTables = async (target: Parameters<typeof onDiscoverTables>[0]) => {
    const request = ++tablesRequestRef.current;
    setDiscovered({ status: 'loading' });
    try {
      const { tables, truncated } = await onDiscoverTables(target);
      if (request === tablesRequestRef.current) setDiscovered({ status: 'loaded', tables, truncated });
    } catch (error) {
      if (request === tablesRequestRef.current) {
        setDiscovered({ status: 'failed', message: ipcErrorMessage(error, '테이블 목록을 불러오지 못했습니다.') });
      }
    }
  };

  const discoverTables = () => loadTables(type === 'sqlite'
    ? { type, filePath }
    : { type, connectionString: connectionString.trim() || undefined });

  const changeType = (next: RdbConnectionType) => {
    tablesRequestRef.current += 1;
    setType(next);
    setDiscovered({ status: 'idle' });
  };

  // Editing the target makes a list still loading for the old one meaningless.
  const dropLoadingTables = () => {
    tablesRequestRef.current += 1;
    setDiscovered((current) => (current.status === 'loading' ? { status: 'idle' } : current));
  };
  const changeFilePath = (next: string) => {
    dropLoadingTables();
    setFilePath(next);
  };
  const changeConnectionString = (next: string) => {
    dropLoadingTables();
    setConnectionString(next);
  };

  const handlePickFile = async () => {
    try {
      const result = await onPickSqliteFile();
      if (result.ok && result.path) {
        setFilePath(result.path);
        void loadTables({ type: 'sqlite', filePath: result.path });
      }
    } catch (error) {
      setMessage(ipcErrorMessage(error, 'SQLite 파일을 선택하지 못했습니다.'));
    }
  };

  const handleConnect = async () => {
    setBusy(true);
    setMessage('');
    setWarning('');
    try {
      const result = await onConnect({
        type,
        filePath: type === 'sqlite' ? filePath : undefined,
        connectionString: type === 'postgres' || type === 'mysql' ? connectionString : undefined,
        allowedSchemas:
          type === 'sqlite'
            ? undefined
            : allowedSchemas
                .split(',')
                .map((entry) => entry.trim())
                .filter(Boolean),
        allowedTables,
        rowLimit: Number(rowLimit) || undefined,
        label: label.trim() || undefined,
      });
      setMessage('데이터베이스가 연결되었습니다.');
      if (result?.warning) setWarning(result.warning);
    } catch (error) {
      setMessage(ipcErrorMessage(error, 'DB 연결에 실패했습니다.'));
    } finally {
      setBusy(false);
    }
  };

  const handleDisconnect = async () => {
    if (!await confirmDisconnectConnector('데이터베이스')) return;
    setBusy(true);
    setMessage('');
    setWarning('');
    try {
      await onDisconnect();
      setMessage('DB 연결이 해제되었습니다.');
    } catch (error) {
      setMessage(ipcErrorMessage(error, '연결 해제에 실패했습니다.'));
    } finally {
      setBusy(false);
    }
  };

  return {
    formRef,
    connected,
    type,
    setType: changeType,
    filePath,
    setFilePath: changeFilePath,
    connectionString,
    setConnectionString: changeConnectionString,
    allowedSchemas,
    setAllowedSchemas,
    allowedTables,
    setAllowedTables,
    discovered,
    discoverTables,
    rowLimit,
    setRowLimit,
    label,
    setLabel,
    busy,
    message,
    warning,
    connectedItems,
    loadFromConnection,
    handlePickFile,
    handleConnect,
    handleDisconnect,
  };
}
