import { JevDecisionError } from '../../../contracts/decision-errors.js';

export { JevDecisionError, decisionServiceFailure } from '../../../contracts/decision-errors.js';
export type { DecisionServiceFailure } from '../../../contracts/decision-errors.js';

const JEV_MAX_API_KEY_LENGTH = 8_192;
const JEV_API_KEY_PATTERN = /^[A-Za-z0-9._~+\/-]+=*$/u;

/** Validate without trimming or otherwise changing the credential. */
export function validateJevApiKey(apiKey: string): void {
  if (!apiKey) throw new JevDecisionError('A TypeSafe API key is required.');
  if (apiKey.length > JEV_MAX_API_KEY_LENGTH || !JEV_API_KEY_PATTERN.test(apiKey)) {
    throw new JevDecisionError(
      'TypeSafe API keys must be ASCII bearer tokens with no whitespace. Re-enter the key exactly as issued.',
    );
  }
}
