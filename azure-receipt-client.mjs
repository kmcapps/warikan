// Independent helper only: caller must ask the user to confirm or edit the Total.
export async function analyzeReceiptTotal(image,{endpoint,timeoutMs=70000,fetchImpl=globalThis.fetch,signal}={}) {
  const controller=new AbortController();
  const cancel=()=>controller.abort();
  signal?.addEventListener('abort',cancel,{once:true});
  if(signal?.aborted) controller.abort();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try {
    if(controller.signal.aborted) return {ok:false,reason:'request_failed'};
    const url=new URL(endpoint);
    if(url.username || url.password || url.search || url.hash || (url.protocol!=='https:' && !(url.protocol==='http:' && ['localhost','127.0.0.1'].includes(url.hostname)))) throw new Error();
    if(!(image instanceof Blob) || !['image/jpeg','image/png'].includes(image.type) || !image.size || image.size>4*1024*1024) return {ok:false,reason:'invalid_image'};
    const response=await fetchImpl(url.href,{method:'POST',mode:'cors',credentials:'omit',redirect:'error',headers:{'Content-Type':image.type},body:image,signal:controller.signal});
    if(!response.ok) return {ok:false,reason:'request_failed'};
    const data=await response.json();
    if(data.ok===false) return {ok:false,reason:['total_not_found','provider_failure','timeout'].includes(data.reason)?data.reason:'request_failed'};
    if(data.ok!==true || typeof data.total!=='number' || !Number.isFinite(data.total) || data.total<0 || !(data.confidence===null || (typeof data.confidence==='number' && Number.isFinite(data.confidence) && data.confidence>=0 && data.confidence<=1))) throw new Error();
    return {ok:true,total:data.total,confidence:data.confidence};
  } catch {return {ok:false,reason:controller.signal.aborted?'timeout':'request_failed'};}
  finally {clearTimeout(timer);signal?.removeEventListener('abort',cancel);}
}
