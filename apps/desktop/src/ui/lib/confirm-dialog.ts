import { useSyncExternalStore } from 'react';

export interface ConfirmRequest {
  title: string;
  message?: string;
  confirmLabel: string;
  /** A destructive confirmation gets the warning colour. */
  danger?: boolean;
  /** One extra choice shown as a checkbox (e.g. "실행 기록도 함께 지우기"). */
  option?: { label: string; checked?: boolean };
}

export interface ConfirmAnswer {
  confirmed: boolean;
  optionChecked: boolean;
}

interface Pending {
  request: ConfirmRequest;
  resolve: (answer: ConfirmAnswer) => void;
}

let pending: Pending | undefined;
const listeners = new Set<() => void>();

function publish(next: Pending | undefined): void {
  pending = next;
  for (const listener of listeners) listener();
}

/**
 * Asks in the app's own dialog (see ConfirmDialogHost) instead of the browser's confirm(): it
 * follows the theme, reads as plain Korean buttons, and can carry one extra checkbox. A second
 * request while one is open answers the first as cancelled.
 */
export function requestConfirm(request: ConfirmRequest): Promise<ConfirmAnswer> {
  pending?.resolve({ confirmed: false, optionChecked: false });
  return new Promise((resolve) => {
    publish({
      request,
      resolve: (answer) => {
        publish(undefined);
        resolve(answer);
      },
    });
  });
}

export async function confirmed(request: ConfirmRequest): Promise<boolean> {
  return (await requestConfirm(request)).confirmed;
}

/** The confirmation waiting for an answer, if any. */
export function pendingConfirm(): Pending | undefined {
  return pending;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePendingConfirm(): Pending | undefined {
  return useSyncExternalStore(subscribe, pendingConfirm, pendingConfirm);
}
