import { useState } from 'react';
import type { AppState } from '../../../../types/app-state';
import { confirmRemoveLocalFolder } from '../../../../lib/confirm-delete';

export interface LocalFolderConnectionFormProps {
  state: AppState | null;
  embedded?: boolean;
  onPickFolder: () => Promise<{ ok: boolean; canceled?: boolean; path?: string }>;
  onAddFolder: (payload: { path: string; label?: string }) => Promise<void>;
  onRemoveFolder: (folderId: string) => Promise<void>;
}

type LocalFolderConnectionControllerProps = Pick<
  LocalFolderConnectionFormProps,
  'state' | 'onPickFolder' | 'onAddFolder' | 'onRemoveFolder'
>;

export function useLocalFolderConnectionForm({
  state,
  onPickFolder,
  onAddFolder,
  onRemoveFolder,
}: LocalFolderConnectionControllerProps) {
  const [labelDraft, setLabelDraft] = useState('');
  const [selectedPath, setSelectedPath] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const folders = state?.localFolders ?? [];
  const connected = folders.length > 0;

  const handlePick = async () => {
    setBusy(true);
    setMessage('');
    try {
      const result = await onPickFolder();
      if (result.canceled) return;
      if (!result.ok || !result.path) {
        setMessage('폴더 선택이 취소되었습니다.');
        return;
      }
      setSelectedPath(result.path);
      if (!labelDraft.trim()) {
        const parts = result.path.replace(/\\/g, '/').split('/');
        setLabelDraft(parts[parts.length - 1] ?? result.path);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '폴더 선택에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const handleAdd = async () => {
    if (!selectedPath) {
      setMessage('먼저 폴더를 선택해 주세요.');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      await onAddFolder({ path: selectedPath, label: labelDraft.trim() || undefined });
      setMessage('폴더가 연결되었습니다.');
      setSelectedPath('');
      setLabelDraft('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '폴더 연결에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (folderId: string) => {
    const folder = folders.find((entry) => entry.id === folderId);
    if (!folder) return;
    if (!confirmRemoveLocalFolder(folder.label, folder.path)) return;

    setBusy(true);
    setMessage('');
    try {
      await onRemoveFolder(folderId);
      setMessage('폴더 연결이 해제되었습니다.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '폴더 연결 해제에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  return {
    labelDraft,
    setLabelDraft,
    selectedPath,
    busy,
    message,
    folders,
    connected,
    handlePick,
    handleAdd,
    handleRemove,
  };
}
