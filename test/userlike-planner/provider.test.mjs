import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordResponseUsage } from './provider.mjs';

test('synthetic response accounting includes successful siblings even if the evaluation later fails', async () => {
  const metrics={inputTokens:0,outputTokens:0,models:[],usageMissingResponses:0};
  for (let i=0;i<2;i++) await recordResponseUsage(new Response(JSON.stringify({model:'jev-fixture',usage:{input_tokens:7,output_tokens:3}})),metrics);
  await recordResponseUsage(new Response('invalid response',{status:503}),metrics);
  assert.deepEqual(metrics,{inputTokens:14,outputTokens:6,models:['jev-fixture'],usageMissingResponses:1});
});
test('usage reader preserves the original body and rejects oversized or invalid usage metadata', async () => {
  const metrics={inputTokens:0,outputTokens:0,models:[],usageMissingResponses:0};
  const body=JSON.stringify({usage:{input_tokens:-1,output_tokens:0}});
  const response=new Response(body);
  await recordResponseUsage(response,metrics);assert.equal(await response.text(),body);
  await recordResponseUsage(new Response('x'.repeat(1_048_577)),metrics);
  assert.equal(metrics.usageMissingResponses,2);assert.equal(metrics.inputTokens,0);
});
