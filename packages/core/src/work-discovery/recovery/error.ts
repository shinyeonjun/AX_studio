export class DiscoveryRecoverableError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'DiscoveryRecoverableError';
    this.code = code;
  }
}
