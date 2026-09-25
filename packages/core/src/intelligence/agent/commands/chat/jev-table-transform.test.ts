import { describe, expect, it } from 'vitest';
import type { DecisionAnswer, DecisionEngine, DecisionQuestion } from '../../../../contracts/decision.js';
import { buildTableArtifact } from '../../../../contracts/artifacts/table-build.js';
import { JevDecisionEngine } from '../../../decision/jev.js';
import { applyJevTableTransform } from './jev-table-transform.js';

describe('applyJevTableTransform', () => {
  it('lets Jev choose schema-bound filter and sort options, then evaluates locally', async () => {
    let requestState: unknown;
    let questions: Record<string, DecisionQuestion> | undefined;
    const engine: DecisionEngine = {
      evaluate: async (request) => {
        requestState = request.state;
        questions = request.questions;
        const valueChoice = Object.entries(request.questions.filter_value?.type === 'choice'
          ? request.questions.filter_value.criteria
          : {}).find(([, description]) => Boolean(description && typeof description === 'object'
            && 'value' in description && description.value === 30))?.[0];
        return {
          answers: {
            filter_column: { type: 'choice', choice: 'column_1', probabilities: { column_1: 0.99 }, confidence: 0.99 },
            filter_operator: { type: 'choice', choice: 'lt', probabilities: { lt: 0.99 }, confidence: 0.99 },
            filter_value: { type: 'choice', choice: valueChoice ?? 'none', probabilities: { [valueChoice ?? 'none']: 0.99 }, confidence: 0.99 },
            sort_column: { type: 'choice', choice: 'column_2', probabilities: { column_2: 0.99 }, confidence: 0.99 },
            sort_direction: { type: 'choice', choice: 'asc', probabilities: { asc: 0.99 }, confidence: 0.99 },
          },
        };
      },
    };
    const input = buildTableArtifact({
      id: 'products',
      headers: ['title', 'stock', 'price'],
      matrix: [['A', 40, 1], ['B', 20, 2], ['C', 10, 0.5]],
    });

    const output = await applyJevTableTransform({
      decisionEngine: engine,
      table: input,
      userMessage: '재고가 30개 미만인 상품을 가격 오름차순으로 보여줘.',
      mode: 'filter_sort',
    });

    expect(output).toMatchObject({ status: 'transformed' });
    if (output?.status !== 'transformed') return;
    expect(output.table.rows.map((row) => row.values.title)).toEqual(['C', 'B']);
    expect(output.table.profile).toMatchObject({ rowCount: 2, columnCount: 3 });
    expect(JSON.stringify(requestState)).not.toContain('"title":"A"');
    expect(requestState).not.toHaveProperty('table_schema');
    const filterColumn = questions?.filter_column;
    const filterValue = questions?.filter_value;
    expect(filterColumn?.type).toBe('choice');
    expect(filterValue?.type).toBe('choice');
    if (filterColumn?.type === 'choice' && filterValue?.type === 'choice') {
      expect(filterColumn.criteria.column_1).toMatchObject({ field: 'stock', label: 'stock', type: 'integer' });
      expect(filterColumn.criteria.column_1).not.toHaveProperty('instruction');
      expect(filterColumn.instructions).toMatchObject({
        focus: expect.stringContaining('schema column'),
      });
      expect(filterValue.criteria.value_0).toMatchObject({ value: 30 });
      expect(filterValue.criteria.value_0).not.toHaveProperty('instruction');
      expect(filterValue.instructions).toMatchObject({
        focus: expect.stringContaining('Never invent a value'),
      });
    }
  });

  it('projects dynamically requested schema fields without field-name aliases or sending row values to Jev', async () => {
    let requestState: unknown;
    let questionIds: string[] = [];
    const table = buildTableArtifact({
      id: 'custom',
      headers: ['customer_external_ref', 'renewal_cycle', 'private_note'],
      matrix: [['cus-123', 'annual', 'never-send-this-to-jev']],
    });
    const output = await applyJevTableTransform({
      decisionEngine: {
        evaluate: async (request) => {
          requestState = request.state;
          questionIds = Object.keys(request.questions);
          return {
            answers: Object.fromEntries(questionIds.map((id) => [id, {
              type: 'choice' as const,
              choice: id === 'display_column_0' || id === 'display_column_1' ? 'include' : 'exclude',
              probabilities: { [id === 'display_column_0' || id === 'display_column_1' ? 'include' : 'exclude']: 0.4 },
              confidence: 0.4,
            }])),
          };
        },
      },
      table,
      userMessage: '고객 외부 참조값과 갱신 주기만 보여줘.',
      mode: 'none',
      selectRequestedColumns: true,
    });

    expect(output).toMatchObject({ status: 'transformed' });
    if (output.status === 'transformed') {
      expect(output.table.columns.map(({ name }) => name)).toEqual(['customer_external_ref', 'renewal_cycle']);
      expect(output.table.rows[0]?.values).toEqual({ customer_external_ref: 'cus-123', renewal_cycle: 'annual' });
    }
    expect(questionIds).toEqual(['display_column_0', 'display_column_1', 'display_column_2']);
    expect(JSON.stringify(requestState)).not.toContain('never-send-this-to-jev');
  });

  it('reuses an explicit HTTP select list instead of making a second Jev projection call', async () => {
    let evaluations = 0;
    const table = buildTableArtifact({
      id: 'products',
      headers: ['title', 'price', 'category', 'stock', 'description'],
      matrix: [['Widget', 12.5, 'tools', 8, 'not requested']],
    });

    const output = await applyJevTableTransform({
      decisionEngine: {
        evaluate: async () => {
          evaluations += 1;
          throw new Error('An exact HTTP select list should not need another Jev call.');
        },
      },
      table,
      userMessage: 'GET products?limit=10&select=title,price,category,stock 를 표로 보여줘.',
      mode: 'none',
      selectRequestedColumns: true,
      httpSelectedColumns: ['title', 'price', 'category', 'stock'],
    });

    expect(output).toMatchObject({ status: 'transformed', providerRequestCount: 0 });
    if (output.status === 'transformed') {
      expect(output.table.columns.map(({ name }) => name)).toEqual(['title', 'price', 'category', 'stock']);
      expect(output.table.rows[0]?.values).toEqual({ title: 'Widget', price: 12.5, category: 'tools', stock: 8 });
    }
    expect(evaluations).toBe(0);
  });

  it('keeps wide-table projection questions compact without dropping candidate columns', async () => {
    const headers = Array.from({ length: 24 }, (_, index) => `field_${index}`);
    const table = buildTableArtifact({
      id: 'wide-projection',
      headers,
      matrix: [headers.map((_, index) => `private-row-value-${index}`)],
    });
    let requestBody = '';
    let requestBytes = 0;
    let questionCount = 0;
    const decisionEngine = new JevDecisionEngine({
      apiKey: 'test-key',
      fetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as {
          state: unknown;
          questions: Record<string, unknown>;
        };
        requestBytes = new TextEncoder().encode(String(init?.body)).byteLength;
        requestBody = String(init?.body);
        questionCount = Object.keys(body.questions).length;
        const answers = Object.fromEntries(Object.keys(body.questions).map((id, index) => {
          const choice = index < 2 ? 'include' : 'exclude';
          return [id, { type: 'choice', choice, probabilities: { [choice]: 0.99 } }];
        }));
        return new Response(JSON.stringify({ model: 'jev-test', answers }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
    });
    const output = await applyJevTableTransform({
      decisionEngine,
      table,
      userMessage: 'field_0과 field_1만 보여줘.',
      mode: 'none',
      selectRequestedColumns: true,
    });

    expect(output).toMatchObject({ status: 'transformed' });
    if (output.status === 'transformed') {
      expect(output.table.columns.map(({ name }) => name)).toEqual(['field_0', 'field_1']);
    }
    expect(questionCount).toBe(headers.length);
    expect(requestBytes).toBeLessThan(5_000);
    const wireRequest = JSON.parse(requestBody) as {
      state: { task?: string; policy?: string };
      questions: Record<string, { instructions: string }>;
    };
    expect(wireRequest.state).toMatchObject({ task: expect.any(String), policy: expect.any(String) });
    expect(Object.values(wireRequest.questions).map(({ instructions }) => instructions)).toEqual(
      headers.map((name) => `Should "${name}" (field "${name}", type string) be shown?`),
    );
    expect(requestBody).not.toContain('private-row-value-');
  });

  it('keeps every schema column selectable when the table exceeds one Jev choice group', async () => {
    const requests: Array<{ state: unknown; questions: Record<string, DecisionQuestion> }> = [];
    const headers = ['title', ...Array.from({ length: 256 }, (_, index) => `column_${index}`)];
    const row = (title: string, selectedValue: number) => [
      title,
      ...Array.from({ length: 256 }, (_, index) => index === 255 ? selectedValue : 0),
    ];
    const table = buildTableArtifact({
      id: 'wide',
      headers,
      matrix: [row('small', 3), row('large', 8)],
    });
    const output = await applyJevTableTransform({
      decisionEngine: {
        evaluate: async (request) => {
          requests.push({ state: request.state, questions: request.questions });
          const answers: Record<string, DecisionAnswer> = {};
          for (const [id, question] of Object.entries(request.questions)) {
            if (question.type !== 'choice') continue;
            let choice = 'none';
            const prompt = typeof question.instructions === 'object' && question.instructions !== null
              ? question.instructions.question
              : '';
            const columnOptions = Object.entries(question.criteria).filter(([, criterion]) =>
              typeof criterion === 'object' && criterion !== null && 'field' in criterion,
            );
            if (columnOptions.length > 0) {
              const targetField = prompt === 'Which result column is constrained by the requested comparison?'
                ? 'column_255'
                : 'column_254';
              const target = columnOptions.find(([, criterion]) =>
                typeof criterion === 'object' && criterion !== null && criterion.field === targetField,
              );
              choice = (target ?? columnOptions.find(([key]) => key !== 'none'))?.[0] ?? 'none';
            } else if (id === 'filter_operator') choice = 'lt';
            else if (id === 'filter_value') {
              choice = Object.entries(question.criteria).find(([, criterion]) =>
                typeof criterion === 'object' && criterion !== null && 'value' in criterion
                  && criterion.value === 5)?.[0] ?? 'none';
            } else if (id === 'sort_direction') choice = 'asc';
            answers[id] = { type: 'choice', choice, probabilities: { [choice]: 0.99 }, confidence: 0.99 };
          }
          return {
            answers,
            providerRequestCount: 1,
            usage: { inputTokens: requests.length === 1 ? 100 : 20, outputTokens: 1 },
          };
        },
      },
      table,
      userMessage: 'column_255 값이 5보다 작은 행만 골라 column_254 오름차순으로 보여줘.',
      mode: 'filter_sort',
    });

    expect(output).toMatchObject({ status: 'transformed' });
    if (output.status === 'transformed') {
      expect(output.table.rows.map((entry) => entry.values.title)).toEqual(['small']);
      expect(output).toMatchObject({ providerRequestCount: 2, usage: { inputTokens: 120, outputTokens: 2 } });
    }
    expect(requests).toHaveLength(2);
    const offeredColumns = new Set(Object.values(requests[0]!.questions).flatMap((question) =>
      question.type === 'choice'
        ? Object.values(question.criteria).flatMap((criterion) =>
          typeof criterion === 'object' && criterion !== null && 'field' in criterion
            ? [String(criterion.field)]
            : [],
        )
        : [],
    ));
    expect(offeredColumns.size).toBe(257);
    expect(offeredColumns).toContain('column_255');
    const tournamentPrompts = Object.values(requests[1]!.questions).map((question) =>
      question.type === 'choice' && typeof question.instructions === 'object'
        ? question.instructions.question
        : '',
    );
    expect(tournamentPrompts).toContain('Which result column is constrained by the requested comparison?');
    expect(tournamentPrompts).toContain('Which result column should determine row order?');
    expect(requests[1]!.state).not.toHaveProperty('table_schema');
  });

  it('keeps a schema field named none distinct from the no-match option', async () => {
    let columnCriteria: Record<string, unknown> | undefined;
    const output = await applyJevTableTransform({
      decisionEngine: {
        evaluate: async ({ questions }) => {
          const question = questions.filter_column;
          if (question?.type === 'choice') columnCriteria = question.criteria;
          return { answers: {
            filter_column: { type: 'choice', choice: 'column_0', probabilities: { column_0: 0.99 }, confidence: 0.99 },
            filter_operator: { type: 'choice', choice: 'lt', probabilities: { lt: 0.99 }, confidence: 0.99 },
            filter_value: { type: 'choice', choice: 'value_0', probabilities: { value_0: 0.99 }, confidence: 0.99 },
          } };
        },
      },
      table: buildTableArtifact({ id: 'reserved-name', headers: ['none'], matrix: [[3], [8]] }),
      userMessage: 'none 값이 5보다 작은 행만 보여줘.',
      mode: 'filter',
    });

    expect(columnCriteria?.none).toBe('No available column matches the requested operation.');
    expect(columnCriteria?.column_0).toMatchObject({ field: 'none' });
    expect(output).toMatchObject({ status: 'transformed' });
    if (output.status === 'transformed') expect(output.table.rows).toHaveLength(1);
  });

  it('applies a Jev-selected transform for natural wording outside the code phrase list', async () => {
    const table = buildTableArtifact({
      id: 'products',
      headers: ['title', 'stock'],
      matrix: [['A', 40], ['B', 10], ['C', 20]],
    });
    const output = await applyJevTableTransform({
      decisionEngine: {
        evaluate: async ({ questions }) => {
          expect(questions.sort_column?.type).toBe('choice');
          return {
            answers: {
              sort_column: { type: 'choice', choice: 'column_1', probabilities: { column_1: 0.99 }, confidence: 0.99 },
              sort_direction: { type: 'choice', choice: 'asc', probabilities: { asc: 0.99 }, confidence: 0.99 },
            },
          };
        },
      },
      table,
      userMessage: '재고가 가장 적은 상품이 맨 처음 보이게 해줘.',
      mode: 'sort',
    });

    expect(output).toMatchObject({ status: 'transformed' });
    if (output.status === 'transformed') {
      expect(output.table.rows.map((row) => row.values.title)).toEqual(['B', 'C', 'A']);
    }
  });

  it('lets Jev leave a plain table display unchanged', async () => {
    let calls = 0;
    const engine: DecisionEngine = {
      evaluate: async () => {
        calls += 1;
        return {
          answers: {
            table_transform: {
              type: 'choice', choice: 'none', probabilities: { none: 0.99 }, confidence: 0.99,
            },
          },
        };
      },
    };
    const table = buildTableArtifact({ id: 'products', headers: ['title'], matrix: [['A']] });

    await expect(applyJevTableTransform({
      decisionEngine: engine,
      table,
      userMessage: '상품을 표로 보여줘.',
      mode: 'auto',
    })).resolves.toMatchObject({ status: 'not_applicable', providerRequestCount: 1 });
    expect(calls).toBe(1);
  });

  it('applies Jev’s exact allowed selection even when its confidence score is low', async () => {
    const engine: DecisionEngine = {
      evaluate: async () => ({
        answers: {
          filter_column: { type: 'choice', choice: 'column_1', probabilities: { column_1: 0.4 }, confidence: 0.4 },
          filter_operator: { type: 'choice', choice: 'lt', probabilities: { lt: 0.99 }, confidence: 0.99 },
          filter_value: { type: 'choice', choice: 'value_0', probabilities: { value_0: 0.99 }, confidence: 0.99 },
        },
      }),
    };
    const table = buildTableArtifact({ id: 'products', headers: ['title', 'stock'], matrix: [['A', 20], ['B', 40]] });
    const before = JSON.stringify(table);

    const output = await applyJevTableTransform({
      decisionEngine: engine,
      table,
      userMessage: '재고 30개 미만인 상품을 보여줘.',
      mode: 'filter',
    });

    expect(output).toMatchObject({ status: 'transformed' });
    if (output.status === 'transformed') {
      expect(output.table.rows.map((row) => row.values.title)).toEqual(['A']);
    }
    expect(JSON.stringify(table)).toBe(before);
  });

  it('rejects a Jev choice that was not offered by the host', async () => {
    const output = await applyJevTableTransform({
      decisionEngine: {
        evaluate: async () => ({ answers: {
          filter_column: { type: 'choice', choice: 'unlisted_column', probabilities: { unlisted_column: 0.99 } },
          filter_operator: { type: 'choice', choice: 'lt', probabilities: { lt: 0.99 } },
          filter_value: { type: 'choice', choice: 'value_0', probabilities: { value_0: 0.99 } },
        } }),
      },
      table: buildTableArtifact({ id: 'products', headers: ['stock'], matrix: [[20]] }),
      userMessage: '재고 30개 미만인 상품을 보여줘.',
      mode: 'filter',
    });

    expect(output).toMatchObject({ status: 'clarify' });
  });

  it('asks for clarification when a requested display column is explicitly unclear', async () => {
    const output = await applyJevTableTransform({
      decisionEngine: {
        evaluate: async () => ({ answers: {
          display_column_0: { type: 'choice', choice: 'include', probabilities: { include: 0.99 } },
          display_column_1: { type: 'choice', choice: 'unclear', probabilities: { unclear: 0.99 } },
        } }),
      },
      table: buildTableArtifact({ id: 'products', headers: ['title', 'stock'], matrix: [['A', 20]] }),
      userMessage: '필요한 열만 보여줘.',
      mode: 'none',
      selectRequestedColumns: true,
    });

    expect(output).toMatchObject({ status: 'clarify' });
  });

  it('lets Jev interpret comparison wording that is not enumerated in code', async () => {
    const engine: DecisionEngine = {
      evaluate: async () => ({
        answers: {
          filter_column: { type: 'choice', choice: 'column_0', probabilities: { column_0: 0.99 }, confidence: 0.99 },
          filter_operator: { type: 'choice', choice: 'gt', probabilities: { gt: 0.99 }, confidence: 0.99 },
          filter_value: { type: 'choice', choice: 'value_0', probabilities: { value_0: 0.99 }, confidence: 0.99 },
        },
      }),
    };
    const table = buildTableArtifact({ id: 'products', headers: ['stock'], matrix: [[20], [35]] });

    const output = await applyJevTableTransform({
      decisionEngine: engine,
      table,
      userMessage: '재고가 30을 넘어서는 상품만 남겨줘.',
      mode: 'filter',
    });

    expect(output).toMatchObject({ status: 'transformed' });
    if (output.status === 'transformed') expect(output.table.rows.map((row) => row.values.stock)).toEqual([35]);
  });

  it('asks for clarification when Jev marks a multi-condition transform unsupported', async () => {
    let calls = 0;
    const engine: DecisionEngine = {
      evaluate: async () => {
        calls += 1;
        return { answers: {
          table_transform: { type: 'choice', choice: 'filter_sort', probabilities: { filter_sort: 0.99 }, confidence: 0.99 },
          filter_column: { type: 'choice', choice: 'column_0', probabilities: { column_0: 0.99 }, confidence: 0.99 },
          filter_operator: { type: 'choice', choice: 'none', probabilities: { none: 0.99 }, confidence: 0.99 },
          filter_value: { type: 'choice', choice: 'value_0', probabilities: { value_0: 0.99 }, confidence: 0.99 },
          sort_column: { type: 'choice', choice: 'column_1', probabilities: { column_1: 0.99 }, confidence: 0.99 },
          sort_direction: { type: 'choice', choice: 'asc', probabilities: { asc: 0.99 }, confidence: 0.99 },
        } };
      },
    };
    const table = buildTableArtifact({ id: 'products', headers: ['stock', 'price'], matrix: [[20, 10]] });

    await expect(applyJevTableTransform({
      decisionEngine: engine,
      table,
      userMessage: '재고 30개 미만이고 가격 20달러 초과인 상품을 보여줘.',
      mode: 'auto',
    })).resolves.toMatchObject({ status: 'clarify' });
    expect(calls).toBe(1);
  });

  it('fails closed when Jev is unavailable', async () => {
    const engine: DecisionEngine = { evaluate: async () => { throw new Error('jev unavailable'); } };
    const table = buildTableArtifact({ id: 'products', headers: ['stock'], matrix: [[20]] });

    await expect(applyJevTableTransform({
      decisionEngine: engine,
      table,
      userMessage: '재고 30개 미만인 상품을 보여줘.',
    })).resolves.toEqual({ status: 'unavailable' });
  });

  it('preserves provider request counts when Jev fails during table interpretation', async () => {
    const failure = Object.assign(new Error('provider unavailable'), { providerRequestCount: 2 });
    const engine: DecisionEngine = { evaluate: async () => { throw failure; } };
    const table = buildTableArtifact({ id: 'products', headers: ['stock'], matrix: [[20]] });

    await expect(applyJevTableTransform({
      decisionEngine: engine,
      table,
      userMessage: '재고 30개 미만인 상품을 보여줘.',
    })).resolves.toEqual({ status: 'unavailable', providerRequestCount: 2 });
  });

  it('propagates cancellation instead of returning an ordinary Jev failure', async () => {
    const engine: DecisionEngine = { evaluate: async () => ({ answers: {} }) };
    const controller = new AbortController();
    controller.abort();
    const table = buildTableArtifact({ id: 'products', headers: ['stock'], matrix: [[20]] });

    await expect(applyJevTableTransform({
      decisionEngine: engine,
      table,
      userMessage: '재고 30개 미만인 상품을 보여줘.',
      abortSignal: controller.signal,
    })).rejects.toThrow('ax_command_chat_timeout');
  });
});
