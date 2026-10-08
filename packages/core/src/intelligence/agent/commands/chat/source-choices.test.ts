import { describe, expect, it } from 'vitest';
import { mergeSourceChoices } from '../../../../contracts/source-choices.js';
import { readSourceChooser, sourceChoiceFromReply } from './read-source-chooser.js';
import { createDatabaseAsync } from '../../../../persistence/db.js';
import { WorkflowStore } from '../../../../persistence/workflow-store.js';

const hint = (key: string, sourceLabel: string) => ({ key, capabilityId: 'rdb.query.read', connector: 'rdb', label: key, description: key, params: {}, sourceLabel });

describe('remembering where the person said a request should read from', () => {
  it('reads the pick from the chooser button just answered, and nothing else', () => {
    const chooser = readSourceChooser([hint('a', '쇼핑몰 DB'), hint('b', '물류 DB')], '주문 목록 보여줘')!;
    const transcript = [
      { role: 'user', content: '주문 목록 보여줘' },
      { role: 'assistant', content: chooser.message, presentations: [chooser.presentation] },
      { role: 'user', content: '물류 DB에서 주문 목록 보여줘' },
    ];
    expect(sourceChoiceFromReply(transcript, '물류 DB에서 주문 목록 보여줘')).toEqual({ request: '주문 목록 보여줘', place: '물류 DB' });
    expect(sourceChoiceFromReply(transcript, '물류 DB에서 다른 거 보여줘')).toBeUndefined();
    expect(sourceChoiceFromReply([transcript[0]!, transcript[2]!], '물류 DB에서 주문 목록 보여줘')).toBeUndefined();
  });

  it('keeps the latest place per request, bounded', async () => {
    let choices = mergeSourceChoices([], { request: '주문 목록 보여줘', place: '쇼핑몰 DB' });
    choices = mergeSourceChoices(choices, { request: ' 주문  목록 보여줘 ', place: '물류 DB' });
    expect(choices).toEqual([{ request: '주문  목록 보여줘', place: '물류 DB' }]);
    const store = new WorkflowStore(await createDatabaseAsync(':memory:'));
    store.rememberSourceChoice({ request: '주문 목록 보여줘', place: '물류 DB' });
    store.rememberSourceChoice({ request: '', place: 'x' });
    expect(store.getSourceChoices()).toEqual([{ request: '주문 목록 보여줘', place: '물류 DB' }]);
  });
});
