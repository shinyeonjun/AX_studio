import { useCallback, useEffect, useRef, useState } from 'react';

const STORAGE_KEY = 'ax-studio.workflow-panel-width';
export const WORKFLOW_PANEL_MIN_WIDTH = 220;
export const WORKFLOW_PANEL_MAX_WIDTH = 560;
export const WORKFLOW_PANEL_DEFAULT_WIDTH = 300;

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

export function useWorkflowPanelWidth() {
  const [width, setWidth] = useState(readStoredWidth);
  const [isResizing, setIsResizing] = useState(false);
  const widthRef = useRef(width);
  widthRef.current = width;

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(width));
    } catch {
      /* ignore quota / private mode */
    }
  }, [width]);

  const onSplitterPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const handle = event.currentTarget;
    const startX = event.clientX;
    const startWidth = widthRef.current;

    handle.setPointerCapture(event.pointerId);
    setIsResizing(true);
    document.body.classList.add('work-resizing');

    const finish = (pointerId: number) => {
      handle.releasePointerCapture(pointerId);
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
      document.body.classList.remove('work-resizing');
      setIsResizing(false);
    };

    const onMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== event.pointerId) return;
      setWidth(clampWidth(startWidth + (startX - moveEvent.clientX)));
    };

    const onUp = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== event.pointerId) return;
      finish(upEvent.pointerId);
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
  }, []);

  const resetWidth = useCallback(() => {
    setWidth(WORKFLOW_PANEL_DEFAULT_WIDTH);
  }, []);

  return { width, isResizing, onSplitterPointerDown, resetWidth };
}
