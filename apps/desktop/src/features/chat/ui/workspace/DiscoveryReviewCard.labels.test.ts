import { describe, expect, it } from 'vitest';
import { confidenceLabel, discoverySourceLabel } from './DiscoveryReviewCard';

describe('discoverySourceLabel', () => {
  it('shows the file name of an encoded sheet source', () => {
    expect(discoverySourceLabel('sheet:e2e-discovery-folder:D%3A%5CAX%5Cinput%5C%EC%A3%BC%EB%AC%B8%EB%82%B4%EC%97%AD_2026-08.xlsx'))
      .toBe("파일 '주문내역_2026-08.xlsx'");
    expect(discoverySourceLabel('sheet:folder:%2Fhome%2Fme%2Fsales.csv')).toBe("파일 'sales.csv'");
  });

  it('names database tables and files in plain words', () => {
    expect(discoverySourceLabel('rdb:orders')).toBe("DB 표 'orders'");
    expect(discoverySourceLabel('sheet:%E0%A4%A')).toBe("파일 '%E0%A4%A'");
  });
});

describe('confidenceLabel', () => {
  it('turns a score into plain words', () => {
    expect(confidenceLabel(0.87)).toBe('높음');
    expect(confidenceLabel(0.6)).toBe('보통');
    expect(confidenceLabel(0.2)).toBe('낮음');
  });
});
