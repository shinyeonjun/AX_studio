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

  it('is not offered when the reads come from one connection', () => {
    expect(readSourceChooser([hint('a', 'rdb', '쇼핑몰 DB'), hint('b', 'rdb', '쇼핑몰 DB')], '주문과 고객')).toBeUndefined();
  });
});
