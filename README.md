# warikan

## Azure Receipt OCR（試験統合）

画像の追加・共有だけでは外部へ送信しません。「画像から合計金額を読み取る」→送信説明を確認→「同意して読み取る」で、Cloudflare Worker経由のAzure OCRを1回呼びます。キー入力は不要です。

成功しても金額は自動反映しません。画像と金額を確認し「この金額を使う」で採用、「修正する」で既存の総額欄を手入力してください。失敗・キャンセル時も元の金額と画像を保持します。GA4の同意とは独立しています。

対応画像: JPEG / PNG。4MiB以下は元のまま送信し、超過画像は同意後にブラウザ内でJPEGへ再エンコードして3.5MiB以下へ調整します。画質0.92→0.85→0.75→0.65の順で試し、必要なら寸法を80%ずつ縮小します（最大8段階、長辺1280px未満には縮小しない）。PNGの透明部分は白になります。再エンコード時に元のEXIF/GPS等のmetadataはコピーしません。小さい画像のmetadataは変更しません。元画像・プレビュー・共有用画像は上書きしません。

サイズ調整に失敗した場合は外部送信せず、別画像または手入力をご案内します。読み取った金額が正しいことを確認してから使用してください。円のTotalは正の安全な整数のみ。POST自動retryなし、client timeout 70秒。キャンセル後も送信済みのAzure処理を取り消せるとは限りません。

Endpoint: `https://warican-azure-receipt.kmcapps-dev.workers.dev/api/receipt-total`

### ローカルで1枚だけ本人確認する

PowerShellから以下でローカル静的サーバーを開始してください（Node.jsのみ、追加インストールなし）。このコマンド自体は外部通信しません。

```powershell
Set-Location -LiteralPath 'C:\Users\heheh\Desktop\ChatGPTツール作成用\files\warikan'
@'
const http=require("node:http"),fs=require("node:fs"),path=require("node:path"),root=process.cwd();http.createServer((q,s)=>{try{const p=new URL(q.url,"http://localhost").pathname;const f=path.resolve(root,"."+(p==="/"?"/index.html":p));if(q.method!=="GET"||!f.startsWith(root+path.sep)||!/^\.(html|js|mjs|png|json)$/.test(path.extname(f)))throw Error();s.setHeader("Content-Type",({".html":"text/html; charset=utf-8",".js":"text/javascript",".mjs":"text/javascript",".png":"image/png",".json":"application/json"})[path.extname(f)]);s.end(fs.readFileSync(f));}catch{s.writeHead(404).end();}}).listen(8000,"127.0.0.1",()=>console.log("http://127.0.0.1:8000"));
'@ | node
```

1. `http://127.0.0.1:8000` を開く（`file://`や別portは使用しない）。
2. 個人情報を除いたJPEG / PNG画像を1枚追加する。4MiB超の場合も送信前に自動調整される。
3. OCRボタン→説明確認→同意。ここで初めて実画像が外部送信されます。
4. 金額が確認待ちになり、採用前に総額が変わらないことを確認。採用または手入力修正後、計算・コピー・共有を確認する。

スマホ実機では、GitHub Pagesの更新版（https://kmcapps.github.io/warikan/）で確認してください。まだ公開していない変更はローカルで確認してください。

### オフライン検証

`npm test` はAzure UI・helper・既存計算・共有・privacy・静的検査を実行します。新しいOCR UIテストはfixture画像とmockレスポンスを使い、非loopback通信を遮断します。`npm run test:azure-ui` で追加UIテストのみ実行できます。
