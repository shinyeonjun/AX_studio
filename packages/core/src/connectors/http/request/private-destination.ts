import { lookup, type LookupAddress, type LookupOptions } from 'node:dns';
import type { Agent } from 'undici';
import { isPrivateHttpHostname } from '../url-security.js';

export const PRIVATE_DESTINATION_ERROR_CODE = 'EPRIVATEDESTINATION';

type LookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;

/** Resolve all addresses before connecting so a DNS answer cannot switch to a private target mid-request. */
export function publicOnlyLookup(
  hostname: string,
  options: LookupOptions,
  callback: LookupCallback,
): void {
  lookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) {
      callback(error, '', 0);
      return;
    }
    if (addresses.length === 0 || addresses.some(({ address }) => isPrivateHttpHostname(address))) {
      const privateDestinationError = Object.assign(new Error('private_dns_destination'), {
        code: PRIVATE_DESTINATION_ERROR_CODE,
      }) as NodeJS.ErrnoException;
      callback(privateDestinationError, '', 0);
      return;
    }
    if (options.all) {
      callback(null, addresses);
      return;
    }
    const selected = addresses[0]!;
    callback(null, selected.address, selected.family);
  });
}

export async function createPrivateDestinationAgent(): Promise<Agent> {
  const { Agent } = await import('undici');
  return new Agent({
    connections: 1,
    pipelining: 0,
    connect: { lookup: publicOnlyLookup },
  });
}
