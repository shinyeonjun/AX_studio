import { ipcErrorMessage } from '../../../../../ui/lib/ipc-error';

/** Loading a stored send request failed: nothing was prepared yet, so this is not a send failure. */
export function toolDraftLoadError(error: unknown, fallback = '전송 내용을 불러오지 못했습니다. 다시 불러오기를 눌러 주세요.'): string {
  return ipcErrorMessage(error, fallback);
}
