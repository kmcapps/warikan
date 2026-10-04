const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');
const root = path.resolve(__dirname, '..');
const endpoint = 'https://warican-azure-receipt.kmcapps-dev.workers.dev/api/receipt-total';
let browser, server, baseUrl;
test.before(async () => {
  server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return res.writeHead(404).end();
    const type = {'.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript', '.png':'image/png'}[path.extname(file)];
    res.writeHead(200, {'Content-Type':type || 'application/octet-stream'});
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/`;
  browser = await chromium.launch({headless:true, executablePath:'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'});
});
test.after(async () => {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
});
async function setup(t, reply = {ok:true,total:2492,confidence:0.966}, viewport) {
  const context = await browser.newContext({viewport:viewport || {width:1280,height:900}});
  t.after(() => context.close());
  const page = await context.newPage();
  const requests = [], errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', async route => {
    if (route.request().url() === endpoint) {
      requests.push(route.request());
      if (typeof reply === 'function') return reply(route);
      return route.fulfill({json:reply, headers:{'Access-Control-Allow-Origin':new URL(baseUrl).origin}});
    }
    if (route.request().url().startsWith(baseUrl)) return route.continue();
    return route.abort(); // All non-loopback requests are blocked; OCR only gets fixtures.
  });
  await page.goto(baseUrl);
  await page.locator('#analyticsRejectButton').click();
  await page.locator('#total').fill('1000');
  await page.locator('#receiptInput').setInputFiles(path.join(root, 'icon-192.png'));
  assert.equal(await page.locator('#receiptOcrButton').count(), 1);
  return {page,requests,errors};
}
async function start(page) {
  await page.locator('#receiptOcrButton').click();
  await page.locator('#ocrConsentButton').click();
}
test('Azure success requires explicit confirmation; acceptance alone applies Total', async t => {
  const {page,requests,errors} = await setup(t);
  await start(page);
  await page.locator('#ocrAcceptButton').waitFor({state:'visible'});
  assert.match(await page.locator('#ocrMessage').textContent(), /2,492/);
  assert.equal(await page.locator('#total').inputValue(), '1000');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].method(), 'POST');
  assert.deepEqual(requests[0].postDataBuffer(),fs.readFileSync(path.join(root,'icon-192.png')));
  assert.equal(requests[0].headers()['authorization'], undefined);
  await page.locator('#ocrAcceptButton').click();
  assert.equal(await page.locator('#total').inputValue(), '2492');
  assert.equal(await page.locator('#result').textContent(), '1,246');
  assert.deepEqual(errors, []);
});
test('Correction uses existing manual input, without adopting OCR amount', async t => {
  const {page} = await setup(t);
  await start(page);
  await page.locator('#ocrAcceptButton').waitFor({state:'visible'});
  await page.locator('#ocrManualButton').click();
  assert.equal(await page.locator('#total').inputValue(), '1000');
  await page.locator('#total').fill('2600');
  assert.equal(await page.locator('#result').textContent(), '1,300');
});
test('No upload before consent; refusal retains receipt and calculation state', async t => {
  const {page,requests} = await setup(t);
  await page.locator('#receiptOcrButton').click();
  assert.equal(requests.length, 0);
  await page.locator('#ocrManualButton').click();
  assert.equal(requests.length, 0);
  assert.equal(await page.locator('#total').inputValue(), '1000');
  assert.equal(await page.locator('#shareButton').isEnabled(), true);
  await page.locator('#privacyButton').click();
  await page.locator('#privacyRejectButton').click();
  assert.equal(await page.locator('#shareButton').isEnabled(), true);
  assert.equal(await page.locator('#total').inputValue(), '1000');
});
for (const [name,reply] of [
  ['total_not_found',{ok:false,reason:'total_not_found'}],
  ['provider_failure',{ok:false,reason:'provider_failure'}],
  ['timeout',{ok:false,reason:'timeout'}],
  ['malformed response',{unexpected:true}],
  ['invalid Total',{ok:true,total:-1,confidence:0.99}],
  ['fractional yen',{ok:true,total:2.5,confidence:0.99}],
  ['unsafe integer',{ok:true,total:Number.MAX_SAFE_INTEGER+1,confidence:0.99}],
  ['zero yen',{ok:true,total:0,confidence:0.99}],
  ['network error',route => route.abort('failed')]
]) test(`${name} falls back to manual input, preserving amount and receipt`, async t => {
  const {page,requests} = await setup(t,reply);
  await start(page);
  await page.locator('#ocrStatus').filter({hasText:'手入力してください'}).waitFor();
  assert.equal(await page.locator('#ocrDialog').evaluate(dialog => dialog.open), false);
  assert.equal(await page.locator('#total').inputValue(), '1000');
  assert.equal(await page.locator('#shareButton').isEnabled(), true);
  assert.equal(requests.length, 1);
  assert.equal(await page.locator('#receiptOcrButton').isEnabled(), true);
  await page.locator('#total').fill('3000');
  assert.equal(await page.locator('#result').textContent(), '1,500');
});
for (const action of ['replace','reset','manual','cancel','background']) test(`Stale result after ${action} cannot reopen confirmation or overwrite state`, async t => {
  let release;
  const pending = new Promise(resolve => release = resolve);
  const {page,requests} = await setup(t,async route => {
    await pending;
    await route.fulfill({json:{ok:true,total:9999,confidence:1},headers:{'Access-Control-Allow-Origin':new URL(baseUrl).origin}}).catch(() => {});
  });
  // Simulate a transport that finishes despite abort, so the stale guard itself is tested.
  await page.evaluate(() => {
    const fetchOriginal = window.fetch;
    window.__ocrBodyRead = false;
    window.fetch = async (url, options) => {
      const response = await fetchOriginal(url, {...options,signal:undefined});
      const json = response.json.bind(response);
      response.json = async () => {const body = await json();window.__ocrBodyRead = true;return body;};
      return response;
    };
  });
  await start(page);
  await page.waitForFunction(() => document.querySelector('#ocrMessage').textContent.includes('読み取り中'));
  if (!requests.length) await page.waitForRequest(endpoint);
  if (action === 'replace') await page.locator('#receiptInput').setInputFiles(path.join(root,'icon-512.png'));
  if (action === 'reset') await page.evaluate(() => document.querySelector('#resetButton').click());
  if (action === 'manual') await page.evaluate(() => {
    const input = document.querySelector('#total'); input.value='3200'; input.dispatchEvent(new Event('input'));
  });
  if (action === 'cancel') await page.keyboard.press('Escape');
  if (action === 'background') await page.locator('#ocrDialog').click({position:{x:5,y:5}});
  release();
  // Wait for the actual helper completion, not a fixed stale-result sleep.
  await page.waitForFunction(() => window.__ocrBodyRead && document.querySelector('#receiptOcrButton').getAttribute('aria-busy') === 'false');
  assert.equal(await page.locator('#ocrDialog').evaluate(dialog => dialog.open), false);
  assert.equal(await page.locator('#total').inputValue(), action==='reset'?'0':action==='manual'?'3200':'1000');
});
test('Client timeout aborts without retry and returns to manual input', async t => {
  const {page,requests} = await setup(t,route => route.abort('timedout'));
  await page.evaluate(() => {
    const original = window.setTimeout;
    window.setTimeout = (fn,ms,...args) => original(fn,ms===70000?1:ms,...args);
  });
  await start(page);
  await page.locator('#ocrStatus').filter({hasText:'手入力してください'}).waitFor();
  assert.ok(requests.length <= 1);
  assert.equal(await page.locator('#total').inputValue(), '1000');
});
test('Mobile confirmation is visible, usable, and does not overflow', async t => {
  const {page,errors} = await setup(t,undefined,{width:390,height:844});
  await start(page);
  await page.locator('#ocrAcceptButton').waitFor({state:'visible'});
  assert.match(await page.title(), /WARICAN|WARIKAN|割り勘/i);
  assert.equal(await page.locator('#ocrThumbnail').isVisible(), true);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  const box = await page.locator('#ocrAcceptButton').boundingBox();
  assert.ok(box.x >= 0 && box.x+box.width <= 390 && box.y+box.height <=844);
  assert.deepEqual(errors, []);
  const screenshots = 'C:/Users/heheh/.codex/visualizations/2026/09/20/01a0be98-cfb7-7383-82ca-2f4ed97c2e68';
  await page.screenshot({path:path.join(screenshots,'warican-azure-confirm-mobile.png')});
  await page.setViewportSize({width:1280,height:900});
  await page.screenshot({path:path.join(screenshots,'warican-azure-confirm-desktop.png')});
});

test('Rapid cancel and reopen keeps the new consent and candidate valid', async t => {
  const {page,requests} = await setup(t);
  await page.locator('#receiptOcrButton').click();
  await page.evaluate(() => {
    document.querySelector('#ocrManualButton').click();
    document.querySelector('#receiptOcrButton').click();
    document.querySelector('#ocrConsentButton').click();
  });
  await page.locator('#ocrAcceptButton').waitFor({state:'visible',timeout:2500});
  await page.locator('#ocrAcceptButton').click();
  assert.equal(await page.locator('#total').inputValue(),'2492');
  assert.equal(requests.length,1);
});

test('Repeated consent clicks start one request only', async t => {
  const {page,requests} = await setup(t);
  await page.locator('#receiptOcrButton').click();
  await page.evaluate(() => {
    const button = document.querySelector('#ocrConsentButton');
    button.click(); button.click(); button.click();
  });
  await page.locator('#ocrAcceptButton').waitFor({state:'visible'});
  assert.equal(requests.length,1);
});

for (const type of ['image/png','image/jpeg']) test(`Oversized ${type} is adjusted only after consent and sent as JPEG under 3.5MiB`, async t => {
  const {page,requests} = await setup(t);
  const originalSize = await page.evaluate(async type => {
    const canvas = document.createElement('canvas');canvas.width=1200;canvas.height=1600;
    const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,1200,1600);
    ctx.fillStyle='black';ctx.font='60px sans-serif';ctx.fillText('TOTAL 2492',100,200);
    const original=await new Promise(resolve=>canvas.toBlob(resolve,type));
    const file=new File([original,new Uint8Array(4*1024*1024)],'synthetic-receipt', {type});
    const transfer=new DataTransfer();transfer.items.add(file);
    const input=document.querySelector('#receiptInput');input.files=transfer.files;input.dispatchEvent(new Event('change'));
    window.__originalReceipt=file;
    window.__decodeCount=0;
    const decode=window.createImageBitmap;
    window.createImageBitmap=(...args)=>{window.__decodeCount++;return decode(...args);};
    return file.size;
  },type);
  await page.locator('#receiptOcrButton').click();
  assert.equal(requests.length,0);
  assert.equal(await page.evaluate(()=>window.__decodeCount),0);
  await page.locator('#ocrConsentButton').click();
  await page.locator('#ocrAcceptButton').waitFor({state:'visible',timeout:8000});
  assert.equal(requests.length,1);
  assert.equal(requests[0].headers()['content-type'],'image/jpeg');
  assert.ok(requests[0].postDataBuffer().length<=3.5*1024*1024);
  assert.equal(await page.evaluate(()=>window.__originalReceipt.size),originalSize);
  assert.equal(await page.locator('#total').inputValue(),'1000');
  assert.equal(await page.locator('#shareButton').isEnabled(),true);
});

test('Undecodable oversized image fails locally with no upload and retains state', async t => {
  const {page,requests} = await setup(t);
  await page.locator('#receiptInput').setInputFiles({name:'invalid.png',mimeType:'image/png',buffer:Buffer.alloc(4*1024*1024+1)});
  await start(page);
  await page.locator('#ocrStatus').filter({hasText:'画像サイズを調整できませんでした'}).waitFor({timeout:5000});
  assert.equal(requests.length,0);
  assert.equal(await page.locator('#total').inputValue(),'1000');
  assert.equal(await page.locator('#shareButton').isEnabled(),true);
});

test('Cancelled image decoding never sends or overrides new receipt', async t => {
  const {page,requests} = await setup(t);
  await page.locator('#receiptInput').setInputFiles({name:'large.png',mimeType:'image/png',buffer:Buffer.alloc(4*1024*1024+1)});
  await page.evaluate(()=>{
    window.__decoding=false;
    window.createImageBitmap=()=>{window.__decoding=true;return new Promise(resolve=>window.__releaseDecode=()=>resolve({width:100,height:100,close(){}}));};
  });
  await start(page);
  await page.waitForFunction(()=>window.__decoding,{},{timeout:3000});
  await page.locator('#receiptInput').setInputFiles(path.join(root,'icon-192.png'));
  await page.evaluate(()=>window.__releaseDecode());
  assert.equal(requests.length,0);
  assert.equal(await page.locator('#ocrDialog').evaluate(dialog=>dialog.open),false);
  assert.equal(await page.locator('#total').inputValue(),'1000');
});

test('JPEG/PNG at or below 4MiB stay byte-identical without decoding', async t => {
  const {page} = await setup(t);
  const result=await page.evaluate(async()=>{
    const {prepareReceiptImage}=await import('./receipt-image.mjs');
    window.createImageBitmap=()=>{throw Error('should not decode');};
    const results=[];
    for(const type of ['image/png','image/jpeg']) for(const size of [100,4*1024*1024]) {
      const source=new Blob([new Uint8Array(size)],{type});
      results.push(await prepareReceiptImage(source)===source);
    }
    return results;
  });
  assert.deepEqual(result,[true,true,true,true]);
});

for(const scenario of ['quality','resize','exhausted','null-blob','cancel-encode']) test(`Compression ${scenario} is bounded, cleans up, and never uploads unsafe bytes`,async t=>{
  const {page,requests}=await setup(t);
  const result=await page.evaluate(async scenario=>{
    const {prepareReceiptImage}=await import('./receipt-image.mjs');
    let closed=false, calls=[],testCanvas;
    window.createImageBitmap=async()=>({width:1600,height:2000,close(){closed=true;}});
    const controller=new AbortController();
    const create=document.createElement.bind(document);
    document.createElement=name=>name==='canvas'?(testCanvas={
      width:0,height:0,
      getContext:()=>({fillRect(){},drawImage(){}}),
      toBlob(callback,type,quality){
        calls.push({width:this.width,height:this.height,type,quality});
        if(scenario==='null-blob') return callback(null);
        if(scenario==='cancel-encode') controller.abort();
        const small=scenario==='quality'?quality<=0.85:scenario==='resize'?this.width<1600:false;
        callback(new Blob([new Uint8Array(small?3*1024*1024:4*1024*1024)],{type}));
      }
    }):create(name);
    let output,failed=false;
    try {output=await prepareReceiptImage(new Blob([new Uint8Array(4*1024*1024+1)],{type:'image/png'}),{signal:controller.signal});}
    catch {failed=true;}
    return {failed,size:output?.size,closed,calls,canvasWidth:testCanvas?.width,canvasHeight:testCanvas?.height};
  },scenario);
  assert.equal(requests.length,0);
  assert.equal(result.closed,true);
  assert.equal(result.canvasWidth,0);
  assert.equal(result.canvasHeight,0);
  assert.ok(result.calls.length<=36);
  assert.ok(result.calls.every(call=>call.type==='image/jpeg'));
  if(scenario==='quality') {
    assert.equal(result.failed,false);assert.equal(result.size,3*1024*1024);
    assert.deepEqual(result.calls.map(c=>c.quality),[0.92,0.85]);
    assert.ok(result.calls.every(c=>c.width===1600&&c.height===2000));
  } else if(scenario==='resize') {
    assert.equal(result.failed,false);assert.equal(result.size,3*1024*1024);
    assert.deepEqual(result.calls.slice(0,4).map(c=>c.quality),[0.92,0.85,0.75,0.65]);
    assert.equal(result.calls[4].width,1280);assert.equal(result.calls[4].height,1600);
  } else assert.equal(result.failed,true);
});

test('Consent explains external transmission, personal information, and user confirmation concisely',async t=>{
  const {page,requests,errors}=await setup(t,undefined,{width:390,height:844});
  await page.locator('#receiptOcrButton').click();
  assert.equal(await page.locator('#ocrMessage').textContent(),'画像をCloudflare経由でMicrosoft Azureへ送信します。個人情報が写っていないか確認してください。読み取った金額は使用前に確認してください。');
  await page.locator('#ocrThumbnail').evaluate(image=>image.decode());
  const screenshots='C:/Users/heheh/.codex/visualizations/2026/09/20/01a0be98-cfb7-7383-82ca-2f4ed97c2e68';
  await page.screenshot({path:path.join(screenshots,'warican-compression-consent-mobile.png')});
  const button=await page.locator('#ocrConsentButton').boundingBox();
  assert.ok(button.y+button.height<=844);
  await page.setViewportSize({width:1280,height:900});
  await page.screenshot({path:path.join(screenshots,'warican-compression-consent-desktop.png')});
  assert.deepEqual(errors,[]);
  assert.equal(requests.length,0);
  await page.locator('#ocrManualButton').click();
  assert.equal(await page.locator('#total').inputValue(),'1000');
});

for (const width of [320,390,1280]) test(`Confirmation stays centered on one line with prominent amount at ${width}px`,async t=>{
  const {page,errors}=await setup(t,{ok:true,total:140,confidence:0.966},{width,height:900});
  await start(page);
  await page.locator('#ocrAcceptButton').waitFor({state:'visible'});
  const layout=await page.locator('#ocrMessage').evaluate(message=>{
    const range=document.createRange();range.selectNodeContents(message);
    const boxes=[...range.getClientRects()];
    const amount=message.querySelector('.ocr-amount');
    return {align:getComputedStyle(message).textAlign,amountSize:amount&&parseFloat(getComputedStyle(amount).fontSize),weight:amount&&getComputedStyle(amount).fontWeight,
      left:Math.min(...boxes.map(b=>b.left)),right:Math.max(...boxes.map(b=>b.right)),center:message.getBoundingClientRect().x+message.clientWidth/2,
      height:message.getBoundingClientRect().height};
  });
  assert.equal(layout.align,'center');assert.ok(layout.amountSize>=28);assert.ok(Number(layout.weight)>=700);
  assert.ok(Math.abs((layout.left+layout.right)/2-layout.center)<2);
  assert.ok(layout.height<70,'confirmation must not become three lines');
  assert.equal(await page.locator('#total').inputValue(),'1000');
  await page.locator('#ocrMessage').click();
  assert.equal(await page.locator('#ocrDialog').evaluate(d=>d.open),true);
  await page.locator('#ocrDialog').click({position:{x:5,y:5}});
  assert.equal(await page.locator('#ocrDialog').evaluate(d=>d.open),false);
  assert.equal(await page.locator('#total').inputValue(),'1000');
  await page.locator('#receiptOcrButton').click();
  assert.equal(await page.locator('#ocrConsentButton').isVisible(),true);
  assert.deepEqual(errors,[]);
});

test('Background dismissal before consent retains receipt and makes no upload',async t=>{
  const {page,requests}=await setup(t);
  await page.locator('#receiptOcrButton').click();
  await page.locator('#ocrThumbnail').click();
  assert.equal(await page.locator('#ocrDialog').evaluate(d=>d.open),true);
  await page.locator('#ocrDialog').click({position:{x:5,y:5}});
  assert.equal(await page.locator('#ocrDialog').evaluate(d=>d.open),false);
  assert.equal(requests.length,0);
  assert.equal(await page.locator('#shareButton').isEnabled(),true);
  assert.equal(await page.locator('#total').inputValue(),'1000');
});
