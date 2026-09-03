import { registerDiscoveryArtifactHandlers } from './discovery-handlers/artifacts.js';
import { registerDiscoveryCommandHandlers } from './discovery-handlers/commands.js';
import { registerDiscoveryFixtureHandlers } from './discovery-handlers/fixtures.js';

export function registerDiscoveryHandlers(): void {
  registerDiscoveryArtifactHandlers();
  registerDiscoveryCommandHandlers();
  registerDiscoveryFixtureHandlers();
}
