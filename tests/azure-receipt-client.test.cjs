const {test}=require('node:test');
const assert=require('node:assert/strict');
const endpoint='https://example.azurewebsites.net/api/receipt-total';
test('helper returns Total without extra receipt fields or auth',async()=>{const {analyzeReceiptTotal}=await import('../azure-receipt-client.mjs');let count=0;const r=await analyzeReceiptTotal(new Blob(['fixture'],{type:'image/png'}),{endpoint,fetchImpl:async(url,options)=>{count++;assert.equal(options.credentials,'omit');assert.deepEqual(Object.keys(options.headers),['Content-Type']);return Response.json({ok:true,total:42,confidence:0.9,merchant:'private'});}});assert.deepEqual(r,{ok:true,total:42,confidence:0.9});assert.equal(count,1);});
test('helper failure does not retry or expose exception',async()=>{const {analyzeReceiptTotal}=await import('../azure-receipt-client.mjs');let count=0;const r=await analyzeReceiptTotal(new Blob(['fixture'],{type:'image/png'}),{endpoint,fetchImpl:async()=>{count++;throw new Error('synthetic-secret-only');}});assert.deepEqual(r,{ok:false,reason:'request_failed'});assert.equal(count,1);});
test('helper timeout',async()=>{const {analyzeReceiptTotal}=await import('../azure-receipt-client.mjs');const r=await analyzeReceiptTotal(new Blob(['fixture'],{type:'image/png'}),{endpoint,timeoutMs:5,fetchImpl:(_,options)=>new Promise((_,reject)=>options.signal.addEventListener('abort',()=>reject(new Error())))});assert.equal(r.reason,'timeout');});
test('helper rejects malformed success',async()=>{const {analyzeReceiptTotal}=await import('../azure-receipt-client.mjs');const r=await analyzeReceiptTotal(new Blob(['fixture'],{type:'image/png'}),{endpoint,fetchImpl:async()=>Response.json({ok:true,total:'42',confidence:1})});assert.equal(r.ok,false);});

test('already cancelled image never starts a POST',async()=>{
  const {analyzeReceiptTotal}=await import('../azure-receipt-client.mjs');
  const controller=new AbortController();controller.abort();let count=0;
  const result=await analyzeReceiptTotal(new Blob(['fixture'],{type:'image/png'}),{
    endpoint,signal:controller.signal,fetchImpl:async()=>{count++;return Response.json({ok:true,total:42,confidence:1});}
  });
  assert.equal(result.ok,false);assert.equal(count,0);
});

test('caller cancellation aborts the single in-flight POST without leaking error',async()=>{
  const {analyzeReceiptTotal}=await import('../azure-receipt-client.mjs');
  const controller=new AbortController();let count=0;
  const pending=analyzeReceiptTotal(new Blob(['fixture'],{type:'image/png'}),{
    endpoint,signal:controller.signal,fetchImpl:async(_,options)=>{
      count++;return new Promise((_,reject)=>options.signal.addEventListener('abort',()=>reject(new Error('synthetic-secret-only'))));
    }
  });
  controller.abort();const result=await pending;
  assert.equal(result.ok,false);assert.equal(count,1);
  assert.equal(JSON.stringify(result).includes('synthetic-secret-only'),false);
});
