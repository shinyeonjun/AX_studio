import { useCallback, useEffect, useRef, useState } from 'react';

const STORAGE_KEY = 'ax-studio.workflow-panel-width';
export const WORKFLOW_PANEL_MIN_WIDTH = 220;
export const WORKFLOW_PANEL_MAX_WIDTH = 560;
export const WORKFLOW_PANEL_DEFAULT_WIDTH = 300;

type ResizeSession = {
  pointerId: number;
  startX: number;
  startWidth: number;
  handle: HTMLDivElement;
  onWidthChange: (width: number) => void;
  onResizingChange: (resizing: boolean) => void;
};

function clampWidth(value: number): number {
  return Math.min(WORKFLOW_PANEL_MAX_WIDTH, Math.max(WORKFLOW_PANEL_MIN_WIDTH, Math.round(value)));
}

function readStoredWidth(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return WORKFLOW_PANEL_DEFAULT_WIDTH;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? clampWidth(parsed) : WORKFLOW_PANEL_DEFAULT_WIDTH;
  } catch {
    return WORKFLOW_PANEL_DEFAULT_WIDTH;
  }
}

export function startWorkflowPanelResize({
  pointerId,
  startX,
  startWidth,
  handle,
  onWidthChange,
  onResizingChange,
}: ResizeSession): () => void {
  let finished = false;

  const cleanup = () => {
    if (finished) return;
    finished = true;
    if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', onUp);
    document.body.classList.remove('work-resizing');
    onResizingChange(false);
  };

  const onMove = (event: PointerEvent) => {
    if (event.pointerId !== pointerId) return;
    onWidthChange(clampWidth(startWidth + (startX - event.clientX)));
  };

  const onUp = (event: PointerEvent) => {
    if (event.pointerId === pointerId) cleanup();
  };

  handle.setPointerCapture(pointerId);
  document.body.classList.add('work-resizing');
  onResizingChange(true);
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
  document.addEventListener('pointercancel', onUp);
  return cleanup;
}

export function useWorkflowPanelWidth() {
  const [width, setWidth] = useState(readStoredWidth);
  const [isResizing, setIsResizing] = useState(false);
  const widthRef = useRef(width);
  const resizeCleanupRef = useRef<(() => void) | null>(null);
  widthRef.current = width;

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(width));
    } catch {
      /* ignore quota / private mode */
    }
  }, [width]);

  useEffect(() => () => resizeCleanupRef.current?.(), []);

  const onSplitterPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    resizeCleanupRef.current?.();
    resizeCleanupRef.current = startWorkflowPanelResize({
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: widthRef.current,
      handle: event.currentTarget,
      onWidthChange: setWidth,
      onResizingChange: setIsResizing,
    });
  }, []);

  const resetWidth = useCallback(() => {
    setWidth(WORKFLOW_PANEL_DEFAULT_WIDTH);
  }, []);

  return { width, isResizing, onSplitterPointerDown, resetWidth };
}
