const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

test("inline JavaScriptに構文エラーがない", () => {
  const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)];
  assert.ok(scripts.length > 0);
  scripts.forEach(script => new Function(script[1]));
});

test("HTML内のidが重複していない", () => {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  assert.deepEqual([...new Set(duplicates)], []);
});

test("HTMLの開始・終了タグが対応している", () => {
  const voidElements = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
  const stack = [];
  const tags = html.matchAll(/<\/?([a-z][a-z0-9-]*)\b[^>]*>/gi);

  for (const match of tags) {
    const full = match[0];
    const name = match[1].toLowerCase();
    if (voidElements.has(name) || full.endsWith("/>") || full.startsWith("<!")) continue;
    if (!full.startsWith("</")) {
      stack.push(name);
      continue;
    }
    assert.equal(name, stack.pop(), `終了タグ </${name}>`);
  }

  assert.deepEqual(stack, []);
});

test("アプリが参照するcore・manifest・iconが存在する", () => {
  const required = [
    "warican-core.js",
    "manifest.json",
    "favicon-32.png",
    "apple-touch-icon.png",
    "icon-192.png"
  ];
  required.forEach(file => assert.equal(fs.existsSync(path.join(root, file)), true, file));
});
