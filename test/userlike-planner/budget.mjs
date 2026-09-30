import { existsSync, readFileSync, writeFileSync, openSync, closeSync, unlinkSync } from 'node:fs';

/** Cross-process exclusion keeps the cap effective for concurrent accidental invocations. */
export function openProviderBudget(path, batchLimit) {
  if (!Number.isSafeInteger(batchLimit) || batchLimit < 1 || batchLimit > 29) throw new Error('invalid_batch_limit');
  const lockPath=path+'.lock';
  const lock=openSync(lockPath,'wx',0o600);
  let closed=false;
  const close=()=>{ if(!closed){closed=true;closeSync(lock);unlinkSync(lockPath);} };
  try {
    const state=existsSync(path)?JSON.parse(readFileSync(path,'utf8')):{used:1,authBlocked:false};
    if(!Number.isSafeInteger(state.used)||state.used<1||state.used>30||state.authBlocked) throw new Error('provider_budget_or_auth_blocked');
    let batch=0;
    const save=()=>writeFileSync(path,JSON.stringify(state),{mode:0o600});
    return {state,close,reserve(){
      if(closed||state.authBlocked||state.used>=30||batch>=batchLimit) throw new Error('provider_request_blocked');
      state.used++;batch++;save();
    },blockAuth(){state.authBlocked=true;save();}};
  }catch(error){close();throw error;}
}
