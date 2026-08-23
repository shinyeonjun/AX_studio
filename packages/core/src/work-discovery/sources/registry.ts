import type { DiscoverySourceProvider } from './types.js';

export class DiscoverySourceRegistry {
  constructor(private readonly providers: DiscoverySourceProvider[]) {}

  list(): DiscoverySourceProvider[] {
    return [...this.providers];
  }

  forConnector(connector: string): DiscoverySourceProvider | undefined {
    return this.providers.find((provider) => provider.connector === connector);
  }
}
