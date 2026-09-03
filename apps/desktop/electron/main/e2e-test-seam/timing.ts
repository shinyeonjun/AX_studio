function delayMs(): number {
  const value = Number.parseInt(process.env.AX_E2E_AGENT_DELAY_MS ?? '0', 10);
  return Number.isFinite(value) ? Math.max(0, Math.min(value, 5_000)) : 0;
}

function documentEngineDelayMs(): number {
  const value = Number.parseInt(process.env.AX_E2E_DOCUMENT_ENGINE_DELAY_MS ?? '0', 10);
  return Number.isFinite(value) ? Math.max(0, Math.min(value, 5_000)) : 0;
}

export async function pauseForDocumentEngineCheck(): Promise<void> {
  const duration = documentEngineDelayMs();
  if (duration === 0) return;
  await new Promise<void>((resolve) => setTimeout(resolve, duration));
}

export async function pauseForDeterministicBusyCheck(): Promise<void> {
  const duration = delayMs();
  if (duration === 0) return;
  await new Promise<void>((resolve) => setTimeout(resolve, duration));
}
