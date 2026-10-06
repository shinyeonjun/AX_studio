import { describe, expect, it } from 'vitest';
import { discoverySourceLabel } from './DiscoveryReviewCard';

describe('discoverySourceLabel', () => {
  it('shows the file name of an encoded sheet source', () => {
    expect(discoverySourceLabel('sheet:e2e-discovery-folder:D%3A%5CAX%5Cinput%5C%EC%A3%BC%EB%AC%B8%EB%82%B4%EC%97%AD_2026-08.xlsx'))
      .toBe('주문내역_2026-08.xlsx');
    expect(discoverySourceLabel('sheet:folder:%2Fhome%2Fme%2Fsales.csv')).toBe('sales.csv');
  });

  it('keeps other source ids readable without their scheme', () => {
    expect(discoverySourceLabel('rdb:orders')).toBe('orders');
    expect(discoverySourceLabel('sheet:%E0%A4%A')).toBe('%E0%A4%A');
  });
});
