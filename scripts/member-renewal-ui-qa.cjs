// Isolated browser QA of the real renewal panel; no requests to Firebase/HK.
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const assert = require("node:assert/strict");
const { createRequire } = require("node:module");
const root = path.resolve(__dirname, "..");
const deps = createRequire(path.join(root, ".firebase/payment-qa/package.json"));
const output = path.join(root, ".firebase/member-renewal-qa");
fs.mkdirSync(output, { recursive: true });
const serviceSource = fs.readFileSync(path.join(root, "src/lib/services/memberRenewalService.ts"), "utf8");
const categories = serviceSource.slice(serviceSource.indexOf("export const renewalCategories"), serviceSource.indexOf("export interface MemberRenewalScope"));
const virtuals = {
  "@/lib/services/memberRenewalService": `${categories}
    export async function fetchMemberRenewalBatches(input){window.__qa.searches??=[];window.__qa.searches.push(input);await new Promise(r=>setTimeout(r,50));return {batches:window.__qa.batches,categories:[101,106],...(new URLSearchParams(location.search).has('legacy')?{}:{page:input.page||1,hasMore:true,totalRecords:null}),pending:window.__qa.pending,fetchedAt:new Date().toISOString()};}
    export async function renewMemberStoredValue(input){const q=window.__qa;q.calls.push(input);await new Promise(r=>setTimeout(r,350));if(q.timeout){q.timeout=false;q.pending={input,batch:q.batches[0]};const e=new Error('Chưa rõ kết quả trên HK');e.code='functions/unavailable';throw e;}q.pending=null;q.batches[0]={...q.batches[0],expiresAt:input.delayDate+' 23:59:59',expired:false};return {operationId:input.operationId,completedAt:new Date().toISOString()};}`,
  "@/lib/services/memberService": "export const toMemberServiceError=e=>({message:e.message,code:e.code||'unknown'});",
  "@/lib/utils/toast": "export const showSuccess=(...args)=>{window.__qa.success=args;};export const showWarning=()=>{};",
};
const entry = `import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import Panel from '@/components/members/MemberRenewalPanel';
window.__qa={calls:[],pending:null,batches:[{id:'expired',shopId:1,shopName:'Điểm bán QA',expiresAt:'2026-09-14 23:59:59',expired:true,permanent:false,amount:50,remark:'Gói tiền 30 ngày'},{id:'unlimited',shopId:1,shopName:'Điểm bán QA',expiresAt:'2150-01-01 23:59:59',expired:false,permanent:true,amount:100,remark:''},{id:'other',shopId:2,shopName:'Cửa hàng khác',expiresAt:'2026-09-14 23:59:59',expired:true,permanent:false,amount:10,remark:''},{id:'empty',shopId:1,expiresAt:'2026-09-14 23:59:59',expired:true,permanent:false,amount:0,remark:''}]};
function App(){const [open,setOpen]=useState(true),[busy,setBusy]=useState(false);return <main style={{maxWidth:850,margin:'24px auto',padding:16}}><button disabled={busy} onClick={()=>setOpen(!open)}>{open?'Đóng tab':'Mở tab'}</button>{open&&<Panel member={{uid:'qa',fullName:'Khách QA',phone:'0900000000'}} shopId={1} warehouseId='qa-store' onBusyChange={setBusy} onSucceeded={async()=>{window.__qa.refreshed=true;}}/>}</main>;}
createRoot(document.getElementById('root')).render(<App/>);`;

(async () => {
  await deps("esbuild").build({ stdin: { contents: entry, resolveDir: root, loader: "tsx" }, outfile: path.join(output, "app.js"), bundle: true, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' }, plugins: [{ name: "qa-services", setup(build) {
    build.onResolve({ filter: /^@\// }, args => args.path in virtuals ? { path: args.path, namespace: "qa" } : { path: path.join(root, "src", args.path.slice(2)) + (fs.existsSync(path.join(root, "src", args.path.slice(2)) + ".tsx") ? ".tsx" : ".ts") });
    build.onLoad({ filter: /.*/, namespace: "qa" }, args => ({ contents: virtuals[args.path], loader: "ts", resolveDir: root }));
  } }] });
  const postcss = require(path.join(root, "node_modules/postcss"));
  const tailwind = createRequire(path.join(root, "package.json"))("@tailwindcss/postcss");
  const css = await postcss([tailwind()]).process(fs.readFileSync(path.join(root, "src/app/globals.css"), "utf8"), { from: path.join(root, "src/app/globals.css") });
  fs.writeFileSync(path.join(output, "styles.css"), css.css);
  const server = http.createServer((req, res) => {
    if (["/app.js", "/styles.css"].includes(req.url)) { res.setHeader("Content-Type", req.url.endsWith("js") ? "text/javascript" : "text/css"); res.end(fs.readFileSync(path.join(output, req.url.slice(1)))); }
    else res.end('<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/styles.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>');
  });
  await new Promise(resolve => server.listen(8893, "127.0.0.1", resolve));
  const browser = await deps("playwright").chromium.launch({ headless: true, channel: "chrome" });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1100 } });
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", route => route.request().url().startsWith("http://127.0.0.1:8893/") ? route.continue() : route.abort());
    await page.goto("http://127.0.0.1:8893/");
    const expired = page.getByRole("button", { name: /50 tiền/ });
    await expired.waitFor();
    assert.equal(await page.getByRole("button", { name: /100 tiền/ }).isDisabled(), true);
    assert.equal(await page.getByRole("button", { name: /10 tiền/ }).isDisabled(), true);
    assert.equal(await page.getByRole("button", { name: /0 tiền/ }).last().isDisabled(), true);
    const categories = page.getByRole("group", { name: "Loại giá trị", exact: true });
    assert.equal(await categories.getByRole("button").count(), 2);
    assert.equal(await categories.getByRole("button", { name: "Tiền", exact: true }).getAttribute("aria-pressed"), "true");
    assert.ok((await categories.getByRole("button", { name: "Tiền", exact: true }).boundingBox()).height >= 48);
    await categories.getByRole("button", { name: "Lượt", exact: true }).click();
    await page.waitForFunction(() => window.__qa.searches.at(-1)?.category === 106);
    assert.equal(await categories.getByRole("button", { name: "Lượt", exact: true }).getAttribute("aria-pressed"), "true");
    await categories.getByRole("button", { name: "Tiền", exact: true }).click();
    await expired.waitFor();
    assert.equal(await page.getByText(/Jingjian có thể chỉ hiển thị/).count(), 0);
    await page.getByLabel("Hết hạn từ ngày").fill("01/01/2015");
    await page.getByLabel("Hết hạn đến ngày").fill("31/12/2015");
    await page.getByRole("button", { name: "Tìm kiếm", exact: true }).click();
    await page.waitForFunction(() => window.__qa.searches.at(-1)?.startDate === '2015-01-01');
    await page.getByRole("button", { name: "Trang sau", exact: true }).click();
    await page.waitForFunction(() => window.__qa.searches.at(-1)?.page === 2);
    assert.equal(await page.evaluate(() => window.__qa.searches.at(-1).endDate), "2015-12-31");
    await page.getByRole("button", { name: "Xóa bộ lọc", exact: true }).click();
    await page.waitForFunction(() => window.__qa.searches.at(-1)?.startDate === '' && window.__qa.searches.at(-1)?.page === 1);
    await page.getByRole("button", { name: "Tải lại", exact: true }).waitFor();
    await expired.click();
    await page.getByLabel("Hạn sử dụng mới", { exact: true }).fill("31/02/2027");
    assert.equal(await page.getByRole("button", { name: "Tiếp tục", exact: true }).isDisabled(), true);
    await page.getByLabel("Hạn sử dụng mới", { exact: true }).fill("31/10/2027");
    await page.getByLabel("Lý do gia hạn").fill("Khôi phục gói đã hết hạn");
    await page.getByRole("button", { name: "Tiếp tục", exact: true }).click();
    await page.screenshot({ path: path.join(output, "confirmation-desktop.png"), fullPage: true });
    await page.evaluate(() => { window.__qa.timeout = true; });
    await page.getByRole("button", { name: "Xác nhận gia hạn", exact: true }).click();
    assert.equal(await page.getByRole("button", { name: "Đóng tab", exact: true }).isDisabled(), true);
    await page.getByRole("button", { name: "Kiểm tra kết quả / thử lại", exact: true }).waitFor();
    assert.equal(await categories.getByRole("button", { name: "Lượt", exact: true }).isDisabled(), true);
    await page.getByRole("button", { name: "Đóng tab", exact: true }).click();
    await page.getByRole("button", { name: "Mở tab", exact: true }).click();
    await page.getByRole("button", { name: "Kiểm tra kết quả / thử lại", exact: true }).waitFor();
    assert.equal(await page.getByLabel("Hạn sử dụng mới", { exact: true }).inputValue(), "31/10/2027");
    assert.equal(await page.getByLabel("Hạn sử dụng mới", { exact: true }).isDisabled(), true);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(output, "pending-mobile.png"), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
    await page.getByRole("button", { name: "Kiểm tra kết quả / thử lại", exact: true }).click();
    await page.waitForFunction(() => window.__qa.refreshed === true);
    const calls = await page.evaluate(() => window.__qa.calls);
    assert.equal(calls.length, 2); assert.deepEqual(calls[0], calls[1]);
    assert.equal(calls[0].delayDate, "2027-10-31");
    // Reproduce the deployed legacy response that triggered toLocaleString on
    // undefined: it omits page, hasMore and totalRecords entirely.
    await page.goto("http://127.0.0.1:8893/?legacy=1");
    await page.getByRole("button", { name: /50 tiền/ }).waitFor();
    assert.equal(await page.getByText("Trang 1", { exact: true }).count(), 1);
    assert.equal(await page.getByRole("button", { name: "Trang sau", exact: true }).isDisabled(), true);
    assert.equal(await page.getByText(/undefined|NaN/).count(), 0);
    await page.getByRole("button", { name: "Tải lại", exact: true }).click();
    await page.getByRole("button", { name: /50 tiền/ }).waitFor();
    assert.deepEqual(errors, []);
    console.log("PASS: legacy response without pagination fields, historical date search, pagination, clear filters, removed 3-month text, eligibility, fixed date input, confirmation, busy lock, recovery, identical retry, refresh, mobile layout; no external requests.");
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
