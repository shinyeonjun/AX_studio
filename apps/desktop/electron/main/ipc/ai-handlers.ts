import { registerAiEnvironmentHandlers } from './ai-handlers/environment.js';
import { registerAiInspectionHandlers } from './ai-handlers/inspection.js';
import { registerAiProviderHandlers } from './ai-handlers/provider.js';
import { registerAiTestingHandlers } from './ai-handlers/testing.js';

export function registerAiHandlers(): void {
  registerAiInspectionHandlers();
  registerAiProviderHandlers();
  registerAiTestingHandlers();
  registerAiEnvironmentHandlers();
}
