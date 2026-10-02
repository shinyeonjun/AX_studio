import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openProviderBudget} from './budget.mjs';
test('budget reserves every attempted request, persists total, excludes concurrent runs and stops on auth failure',()=>{
  const root=mkdtempSync(join(tmpdir(),'ax-budget-'));const path=join(root,'budget.json');
  try {
    const budget=openProviderBudget(path,2);
    assert.throws(()=>openProviderBudget(path,2));
    budget.reserve();budget.reserve();assert.equal(budget.state.used,3);assert.throws(()=>budget.reserve());budget.close();
    const rest=openProviderBudget(path,29);for(let i=0;i<27;i++)rest.reserve();assert.equal(rest.state.used,30);assert.throws(()=>rest.reserve());rest.close();
    writeFileSync(path,JSON.stringify({used:1,authBlocked:false}));
    const auth=openProviderBudget(path,2);auth.reserve();auth.blockAuth();assert.throws(()=>auth.reserve());auth.close();assert.throws(()=>openProviderBudget(path,2));
  }finally{rmSync(root,{recursive:true,force:true});}
});
test('nonfinite and invalid budgets are rejected before opening a ledger',()=>{
  for(const limit of [NaN,Infinity,0,-1,30,1.5])assert.throws(()=>openProviderBudget('/unused-budget',limit));
});
