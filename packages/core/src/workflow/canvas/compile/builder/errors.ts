export class UnknownCapabilityError extends Error {
  readonly capability: string;

  constructor(capability: string) {
    super('지원하지 않는 capability입니다: ' + capability);
    this.name = 'UnknownCapabilityError';
    this.capability = capability;
  }
}
