import { afterEach, describe, expect, it, vi } from 'vitest';

const lookupMock = vi.hoisted(() => vi.fn());
vi.mock('node:dns', () => ({ lookup: lookupMock }));

import {
  PRIVATE_DESTINATION_ERROR_CODE,
  publicOnlyLookup,
} from './private-destination.js';

afterEach(() => {
  lookupMock.mockReset();
});

describe('publicOnlyLookup', () => {
  it('rejects a hostname with any private DNS answer', () => {
    lookupMock.mockImplementation((_hostname, _options, callback) => {
      callback(null, [
        { address: '203.0.113.10', family: 4 },
        { address: '192.168.1.10', family: 4 },
      ]);
    });
    const callback = vi.fn();

    publicOnlyLookup('api.example.com', {}, callback);

    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({ code: PRIVATE_DESTINATION_ERROR_CODE }),
      '',
      0,
    );
  });

  it('returns a public address and forces an all-address lookup', () => {
    lookupMock.mockImplementation((_hostname, options, callback) => {
      expect(options).toMatchObject({ all: true });
      callback(null, [{ address: '203.0.113.10', family: 4 }]);
    });
    const callback = vi.fn();

    publicOnlyLookup('api.example.com', { family: 4 }, callback);

    expect(callback).toHaveBeenCalledWith(null, '203.0.113.10', 4);
  });

  it('preserves the address-array callback shape when the caller requests all addresses', () => {
    const addresses = [
      { address: '203.0.113.10', family: 4 },
      { address: '2001:db8::10', family: 6 },
    ];
    lookupMock.mockImplementation((_hostname, _options, callback) => callback(null, addresses));
    const callback = vi.fn();

    publicOnlyLookup('api.example.com', { all: true }, callback);

    expect(callback).toHaveBeenCalledWith(null, addresses);
  });
});
