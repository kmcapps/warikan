const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "..");
const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
let server;
let browser;
let baseUrl;

test.before(async () => {
  server = http.createServer((request, response) => {
    const pathname = new URL(request.url, "http://localhost").pathname;
    const requested = pathname === "/" ? "index.html" : pathname.slice(1);
    const filePath = path.join(root, requested);
    const extension = path.extname(filePath);
    const types = {
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".png": "image/png"
    };

    if (!filePath.startsWith(root) || !fs.existsSync(filePath)) {
      response.writeHead(404).end();
      return;
    }

    response.writeHead(200, { "Content-Type": types[extension] || "application/octet-stream" });
    fs.createReadStream(filePath).pipe(response);
  });

  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/`;
  browser = await chromium.launch({ headless: true, executablePath: edgePath });
});

test.after(async () => {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
});

async function newPage(options = {}) {
  const context = await browser.newContext({
    viewport: options.viewport || { width: 1280, height: 900 },
    permissions: ["clipboard-read", "clipboard-write"]
  });
  const page = await context.newPage();
  await page.route("https://www.googletagmanager.com/**", route => route.abort());
  await page.goto(baseUrl);
  return { context, page };
}

async function setReceipt(page, fileName) {
  await page.locator("#receiptInput").setInputFiles(path.join(root, fileName));
}

async function previewHash(page) {
  return page.locator("#receiptPreviewImage").evaluate(async image => {
    const bytes = await (await fetch(image.src)).arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("");
  });
}

test("10,000円÷3人の画面とコピーが同じ不足1円を示す", async () => {
  const { context, page } = await newPage();

  await page.locator("#total").fill("10000");
  await page.locator("#people").fill("3");

  assert.equal(await page.locator("#result").textContent(), "3,333");
  assert.equal(
    await page.locator("#difference").textContent(),
    "集金合計 9,999円 ／ 不足 1円"
  );

  await page.locator("#copyButton").click();
  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  assert.match(clipboard, /集金合計：9,999円/);
  assert.match(clipboard, /不足：1円/);

  await context.close();
});

test("共有画像も画面と同じ集金合計と不足を描画する", async () => {
  const { context, page } = await newPage();
  await page.evaluate(() => {
    window.__waricanFillTexts = [];
    const original = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function(text, ...args) {
      window.__waricanFillTexts.push(String(text));
      return original.call(this, text, ...args);
    };
  });

  await page.locator("#total").fill("10000");
  await page.locator("#people").fill("3");
  await setReceipt(page, "icon-192.png");
  await page.locator("#shareButton").click();
  await page.locator("#receiptPreviewButton").waitFor({ state: "visible" });

  const texts = await page.evaluate(() => window.__waricanFillTexts);
  assert.ok(texts.includes("3,333円"));
  assert.ok(texts.includes("総額 10,000円 ／ 3人"));
  assert.ok(texts.includes("集金合計 9,999円 ／ 不足 1円"));

  await context.close();
});

test("端数radioはキーボードでfocus・矢印操作できる", async () => {
  const { context, page } = await newPage();
  const radio = page.locator("#r0");

  assert.equal(
    await page.getByRole("group", { name: "1人あたりの端数処理" }).count(),
    1
  );
  assert.equal((await page.locator('label[for="r0"]').textContent()).trim(), "1円（四捨五入）");
  assert.notEqual(await radio.evaluate(element => getComputedStyle(element).display), "none");
  await radio.focus();
  assert.equal(await page.evaluate(() => document.activeElement.id), "r0");
  await page.keyboard.press("ArrowRight");
  assert.equal(await page.locator("#r100").isChecked(), true);

  await context.close();
});

test("共有dialogはopen時focus、Escape close、trigger復帰を行う", async () => {
  const { context, page } = await newPage();
  await page.locator("#total").fill("10000");
  await setReceipt(page, "icon-192.png");
  await page.locator("#shareButton").click();

  await page.locator("#receiptPreviewButton").waitFor({ state: "visible" });
  assert.equal(await page.locator("#shareSheet").evaluate(element => element.tagName), "DIALOG");
  assert.equal(await page.evaluate(() => document.activeElement.id), "closeSheetButton");

  await page.locator("#total").focus();
  assert.notEqual(await page.evaluate(() => document.activeElement.id), "total");

  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#shareSheet").evaluate(element => element.open), false);
  assert.equal(await page.evaluate(() => document.activeElement.id), "shareButton");

  await context.close();
});

test("拡大画像とprivacy dialogもEscapeとfocus復帰に対応する", async () => {
  const { context, page } = await newPage();
  await page.locator("#total").fill("1000");
  await setReceipt(page, "icon-192.png");
  await page.locator("#shareButton").click();
  await page.locator("#receiptPreviewButton").waitFor({ state: "visible" });
  await page.locator("#receiptPreviewButton").click();
  assert.equal(await page.locator("#imageLightbox").evaluate(element => element.open), true);
  assert.equal(await page.evaluate(() => document.activeElement.id), "lightboxClose");
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#imageLightbox").evaluate(element => element.open), false);
  assert.equal(await page.evaluate(() => document.activeElement.id), "receiptPreviewButton");
  await page.locator("#closeSheetButton").click();

  await page.locator("#privacyButton").click();
  assert.equal(await page.locator("#privacyDialog").evaluate(element => element.open), true);
  assert.equal(await page.evaluate(() => document.activeElement.id), "privacyCloseButton");
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#privacyDialog").evaluate(element => element.open), false);
  assert.equal(await page.evaluate(() => document.activeElement.id), "privacyButton");

  await context.close();
});

test("Analytics詳細から利用すると非表示triggerではなく総額入力へfocusする", async () => {
  const { context, page } = await newPage();

  await page.locator("#analyticsDetailsButton").click();
  await page.locator("#privacyAcceptButton").click();
  await page.waitForFunction(() =>
    !document.querySelector("#privacyDialog").open &&
    document.activeElement.id === "total"
  );

  assert.equal(await page.locator("#privacyDialog").evaluate(element => element.open), false);
  assert.equal(await page.locator("#analyticsConsent").evaluate(element => element.hidden), true);
  assert.equal(await page.evaluate(() => document.activeElement.id), "total");
  assert.notEqual(await page.evaluate(() => document.activeElement.tagName), "BODY");

  await context.close();
});

test("Analytics詳細から利用しない場合も総額入力へfocusする", async () => {
  const { context, page } = await newPage();

  await page.locator("#analyticsDetailsButton").click();
  await page.locator("#privacyRejectButton").click();
  await page.waitForFunction(() =>
    !document.querySelector("#privacyDialog").open &&
    document.activeElement.id === "total"
  );

  assert.equal(await page.locator("#privacyDialog").evaluate(element => element.open), false);
  assert.equal(await page.locator("#analyticsConsent").evaluate(element => element.hidden), true);
  assert.equal(await page.evaluate(() => document.activeElement.id), "total");
  assert.notEqual(await page.evaluate(() => document.activeElement.tagName), "BODY");

  await context.close();
});

test("プライバシーで利用しないを選んでも入力と画像を保持する", async () => {
  const { context, page } = await newPage();
  await page.locator("#total").fill("1234");
  await setReceipt(page, "icon-192.png");
  await page.locator("#privacyButton").click();
  await page.locator("#privacyRejectButton").click();

  assert.equal(await page.locator("#total").inputValue(), "1234");
  assert.equal(await page.locator("#shareButton").isEnabled(), true);
  assert.equal(await page.locator('script[data-warican-ga4]').count(), 0);

  await context.close();
});

test("同意前はGA4を読み込まず、同意後の拒否でreloadせず停止する", async () => {
  const { context, page } = await newPage();

  assert.equal(await page.locator('script[data-warican-ga4]').count(), 0);
  await page.locator("#analyticsAcceptButton").click();
  assert.equal(await page.locator('script[data-warican-ga4]').count(), 1);

  await page.locator("#total").fill("4321");
  await page.locator("#privacyButton").click();
  await page.locator("#privacyRejectButton").click();

  assert.equal(await page.locator("#total").inputValue(), "4321");
  assert.equal(await page.locator('script[data-warican-ga4]').count(), 0);
  assert.equal(
    await page.evaluate(() => window["ga-disable-G-4WK5JH7G4T"]),
    true
  );

  await context.close();
});

test("モバイルで結果が任意のレシート追加より先にある", async () => {
  const { context, page } = await newPage({ viewport: { width: 390, height: 844 } });
  const positions = await page.evaluate(() => ({
    result: document.querySelector(".result-panel").getBoundingClientRect().top,
    copy: document.querySelector("#copyButton").getBoundingClientRect().top,
    receipt: document.querySelector("#receiptButton").getBoundingClientRect().top
  }));

  assert.ok(positions.result < positions.copy);
  assert.ok(positions.copy < positions.receipt);
  assert.equal(await page.locator("#receiptButton").textContent(), "レシート画像を追加（任意）");

  await context.close();
});

test("モバイルのAnalytics選択は結果を覆わない", async () => {
  const { context, page } = await newPage({ viewport: { width: 390, height: 844 } });
  const layout = await page.evaluate(() => {
    const result = document.querySelector(".result-panel").getBoundingClientRect();
    const consent = document.querySelector("#analyticsConsent").getBoundingClientRect();
    return {
      consentPosition: getComputedStyle(document.querySelector("#analyticsConsent")).position,
      resultBottom: result.bottom,
      consentTop: consent.top
    };
  });

  assert.equal(layout.consentPosition, "static");
  assert.ok(layout.resultBottom <= layout.consentTop);

  await context.close();
});

test("遅い旧共有生成結果が新しいpreviewを上書きしない", async () => {
  const { context, page } = await newPage();
  await page.locator("#total").fill("10000");

  await setReceipt(page, "icon-512.png");
  await page.locator("#shareButton").click();
  await page.locator("#receiptPreviewButton").waitFor({ state: "visible" });
  const expectedLatestHash = await previewHash(page);
  await page.locator("#closeSheetButton").click();

  await page.evaluate(() => {
    const original = window.loadReceiptImage;
    window.loadReceiptImage = async file => {
      const loaded = await original(file);
      if (file.name === "icon-192.png") {
        await new Promise(resolve => setTimeout(resolve, 350));
      }
      return loaded;
    };
  });

  await setReceipt(page, "icon-192.png");
  await page.locator("#shareButton").click();
  await page.waitForTimeout(30);
  await page.locator("#closeSheetButton").click();
  await setReceipt(page, "icon-512.png");
  await page.locator("#shareButton").click();
  await page.locator("#receiptPreviewButton").waitFor({ state: "visible" });
  await page.waitForTimeout(450);

  assert.equal(await previewHash(page), expectedLatestHash);

  await context.close();
});

test("画像共有非対応時は共有画像を保存できる", async () => {
  const { context, page } = await newPage();
  await page.evaluate(() => {
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: undefined
    });
    Object.defineProperty(navigator, "canShare", {
      configurable: true,
      value: undefined
    });
  });
  await page.locator("#total").fill("1000");
  await setReceipt(page, "icon-192.png");
  await page.locator("#shareButton").click();
  await page.locator("#receiptPreviewButton").waitFor({ state: "visible" });

  assert.equal(await page.locator("#openShareButton").textContent(), "共有画像を保存");
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#openShareButton").click();
  const download = await downloadPromise;
  assert.equal(download.suggestedFilename(), "warican-share.png");

  await context.close();
});

test("画像共有対応時は生成済み画像をWeb Shareへ渡す", async () => {
  const { context, page } = await newPage();
  await page.evaluate(() => {
    Object.defineProperty(navigator, "canShare", {
      configurable: true,
      value: () => true
    });
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async data => {
        window.__waricanSharedFile = {
          name: data.files[0].name,
          type: data.files[0].type
        };
      }
    });
  });
  await page.locator("#total").fill("1000");
  await setReceipt(page, "icon-192.png");
  await page.locator("#shareButton").click();
  await page.locator("#receiptPreviewButton").waitFor({ state: "visible" });
  await page.locator("#openShareButton").click();

  assert.deepEqual(await page.evaluate(() => window.__waricanSharedFile), {
    name: "warican-share.png",
    type: "image/png"
  });

  await context.close();
});

test("共有APIのキャンセルと実エラーで異なる案内を示す", async () => {
  const { context, page } = await newPage();
  await page.evaluate(() => {
    Object.defineProperty(navigator, "canShare", {
      configurable: true,
      value: () => true
    });
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async () => {
        throw new DOMException("cancelled", "AbortError");
      }
    });
  });
  await page.locator("#total").fill("1000");
  await setReceipt(page, "icon-192.png");
  await page.locator("#shareButton").click();
  await page.locator("#receiptPreviewButton").waitFor({ state: "visible" });
  await page.locator("#openShareButton").click();
  assert.equal(
    await page.locator("#shareActionStatus").textContent(),
    "共有はキャンセルされました。"
  );

  await page.evaluate(() => {
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async () => {
        throw new Error("share failed");
      }
    });
  });
  await page.locator("#openShareButton").click();
  assert.equal(
    await page.locator("#shareActionStatus").textContent(),
    "共有できませんでした。時間をおいてもう一度お試しください。"
  );

  await context.close();
});
