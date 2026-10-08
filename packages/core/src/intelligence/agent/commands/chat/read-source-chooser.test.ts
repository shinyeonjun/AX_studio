import { describe, expect, it } from 'vitest';
import type { JevReadOperationHint } from '../../../decision/read-operation-catalog.js';
import { readSourceChooser } from './read-source-chooser.js';

const hint = (key: string, connector: string, sourceLabel?: string): JevReadOperationHint => ({
  key, capabilityId: connector === 'rdb' ? 'rdb.query.read' : 'http.request', connector, label: key, description: key, params: {},
  ...(sourceLabel ? { sourceLabel } : {}),
});

describe('asking which connection a request means', () => {
  it('offers each source as a button that resends the request naming it', () => {
    const chooser = readSourceChooser([hint('a', 'rdb', '쇼핑몰 DB'), hint('b', 'http', 'DummyJSON')], '화장품 평점 4.5 넘는 것');
    expect(chooser?.presentation.actions.map((action) => [action.label, action.value, action.purpose])).toEqual([
      ['쇼핑몰 DB에서 찾기', '쇼핑몰 DB에서 화장품 평점 4.5 넘는 것', 'reply'],
      ['DummyJSON에서 찾기', 'DummyJSON에서 화장품 평점 4.5 넘는 것', 'reply'],
    ]);
    expect(chooser?.message).toContain('아직 아무것도 실행하지 않았습니다');
  });

  it('offers the reads themselves when one connection has several that fit', () => {
    const tables = [hint('DB 조회: shop_orders', 'rdb', '회사 DB'), hint('DB 조회: logistics_orders', 'rdb', '회사 DB')];
    expect(readSourceChooser(tables, '주문 목록')?.presentation.actions.map((action) => action.label))
      .toEqual(['회사 DB의 shop_orders에서 찾기', '회사 DB의 logistics_orders에서 찾기']);
    expect(readSourceChooser([hint('a', 'rdb', '쇼핑몰 DB')], '주문')).toBeUndefined();
  });

  it('offers the four most relevant of many places and says another can be named', () => {
    const many = ['A', 'B', 'C', 'D', 'E', 'F'].map((name) => hint(name, 'http', `${name} API`));
    const chooser = readSourceChooser(many, '고객 목록');
    expect(chooser?.presentation.actions).toHaveLength(4);
    expect(chooser?.message).toContain('A API, B API, C API, D API 등 6곳');
    expect(chooser?.message).toContain('목록에 없는 곳이면');
  });
});
