import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  WORKFLOW_PANEL_MAX_WIDTH,
  startWorkflowPanelResize,
} from './useWorkflowPanelWidth';

type Listener = (event: { pointerId: number; clientX: number }) => void;

function installDocumentStub() {
  const listeners = new Map<string, Set<Listener>>();
  const classes = new Set<string>();
  const documentStub = {
    body: {
      classList: {
        add: (value: string) => classes.add(value),
        remove: (value: string) => classes.delete(value),
        contains: (value: string) => classes.has(value),
      },
    },
    addEventListener: (type: string, listener: Listener) => {
      const registered = listeners.get(type) ?? new Set<Listener>();
      registered.add(listener);
      listeners.set(type, registered);
    },
    removeEventListener: (type: string, listener: Listener) => listeners.get(type)?.delete(listener),
  };
  vi.stubGlobal('document', documentStub);

  return {
    classes,
    dispatch(type: string, event: { pointerId: number; clientX: number }) {
      for (const listener of listeners.get(type) ?? []) listener(event);
    },
    listenerCount(type: string) {
      return listeners.get(type)?.size ?? 0;
    },
  };
}

describe('workflow panel resize session', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('releases capture and listeners when the active pointer ends', () => {
    const environment = installDocumentStub();
    let captured = false;
    const handle = {
      setPointerCapture: () => {
        captured = true;
      },
      hasPointerCapture: () => captured,
      releasePointerCapture: () => {
        captured = false;
      },
    } as unknown as HTMLDivElement;
    const onWidthChange = vi.fn();
    const onResizingChange = vi.fn();

    startWorkflowPanelResize({
      pointerId: 7,
      startX: 500,
      startWidth: 300,
      handle,
      onWidthChange,
      onResizingChange,
    });
    environment.dispatch('pointermove', { pointerId: 7, clientX: 100 });
    environment.dispatch('pointerup', { pointerId: 7, clientX: 100 });

    expect(onWidthChange).toHaveBeenCalledWith(WORKFLOW_PANEL_MAX_WIDTH);
    expect(onResizingChange.mock.calls).toEqual([[true], [false]]);
    expect(captured).toBe(false);
    expect(environment.classes.has('work-resizing')).toBe(false);
    expect(environment.listenerCount('pointermove')).toBe(0);
  });

  it('cleans up safely after pointer capture was already lost', () => {
    const environment = installDocumentStub();
    const releasePointerCapture = vi.fn();
    const cleanup = startWorkflowPanelResize({
      pointerId: 3,
      startX: 200,
      startWidth: 300,
      handle: {
        setPointerCapture: vi.fn(),
        hasPointerCapture: () => false,
        releasePointerCapture,
      } as unknown as HTMLDivElement,
      onWidthChange: vi.fn(),
      onResizingChange: vi.fn(),
    });

    cleanup();
    cleanup();

    expect(releasePointerCapture).not.toHaveBeenCalled();
    expect(environment.classes.has('work-resizing')).toBe(false);
    expect(environment.listenerCount('pointercancel')).toBe(0);
  });
});
