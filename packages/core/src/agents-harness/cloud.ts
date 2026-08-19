const LOCAL_PROVIDER_NAMES = new Set(['mock', 'scripted', 'openai-compatible']);

export function isCloudProvider(providerName: string): boolean {
  if (LOCAL_PROVIDER_NAMES.has(providerName)) return false;
  if (providerName.includes('ollama')) return false;
  return true;
}
