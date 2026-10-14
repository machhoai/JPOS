// Isolated UI QA: real components/hooks/bridge, synthetic service responses only.
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { createRequire } = require("node:module");
const root = path.resolve(__dirname, "..");
const dependency = createRequire(path.join(root, ".firebase/payment-qa/package.json"));
const esbuild = dependency("esbuild");
const { chromium } = dependency("playwright");
const output = path.join(root, ".firebase/member-profile-qa");
fs.mkdirSync(output, { recursive: true });
const memberService = fs.readFileSync(path.join(root, "src/lib/services/memberService.ts"), "utf8");
const validation = memberService.slice(memberService.indexOf("function normalizedBirthDate"), memberService.indexOf("export async function lookupMember"));
const editService = fs.readFileSync(path.join(root, "src/lib/services/memberProfileEditService.ts"), "utf8");
const editValidation = editService.slice(editService.indexOf("export function validateMemberProfileDraft"), editService.indexOf("export async function updateMemberProfile"));
const mockService = `import {validateMemberRegistrationDraft} from '@/lib/services/memberService';
${editValidation}
export async function fetchMemberProfileHistory(){return {profile:window.__qa.profile,changes:[...window.__qa.changes].reverse(),nextCursor:null};}
export async function updateMemberProfile(input){const q=window.__qa;q.receivedIds??=[];q.receivedIds.push(input.operationId);const previous=q.changes.find(c=>c.operationId===input.operationId);if(previous)return {profile:q.profile,revision:previous.revision,operationId:input.operationId};await new Promise(r=>setTimeout(r,800));const before={...q.profile};q.profile={...q.profile,...input,profileRevision:q.profile.profileRevision+1,syncStatus:'PENDING'};q.changes.push({operationId:input.operationId,memberUid:input.uid,revision:q.profile.profileRevision,before,after:{...q.profile},changedFields:['fullName'],status:'PENDING',phoneStep:'DONE',profileStep:'PENDING',attemptCount:0,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),createdByName:'Nhân viên QA',lastError:null});if(q.timeoutNext){q.timeoutNext=false;const error=new Error('Chưa xác định kết quả lưu');error.code='functions/unavailable';throw error;}return {profile:q.profile,revision:q.profile.profileRevision,operationId:input.operationId};}
export async function updateMemberProfileSyncRetry(){return {};}`;
const cart = `import {create} from 'zustand';export const useCartStore=create(set=>({items:[],paymentMethod:'CASH',member:null,isPaymentLocked:false,setMember:member=>set({member})}));`;
const virtuals = {
  "@/lib/services/memberProfileEditService": mockService,
  "@/lib/services/memberService": validation,
  "@/lib/stores/useCartStore": cart,
  "@/lib/utils/toast": "export const showError=()=>{};export const showPromise=(p,opts)=>{window.__retryToast=opts.onRetry;return p;};",
};
for (const component of ["MemberPackageCatalog", "MemberPassTicketList", "MemberStoredValueHistory", "MemberCardList"]) {
  virtuals[`@/components/members/${component}`] = "export default function Stub(){return null;}";
}
const entry = `import React from 'react';import {createRoot} from 'react-dom/client';
import MemberDetailsPanel from '@/components/members/MemberDetailsPanel';
import MemberRegistrationDisplay from '@/components/display/MemberRegistrationDisplay';
import {useMemberProfileEditController} from '@/lib/hooks/useMemberProfileEditController';
import {useMemberCustomerDisplayPublisher} from '@/lib/hooks/useMemberCustomerDisplayPublisher';
import {useCustomerDisplayState} from '@/lib/hooks/useCustomerDisplayState';
import {useMemberStore} from '@/lib/stores/useMemberStore';
const profile={uid:'qa',mid:'qa-mid',memberCode:'QA-CARD',fullName:'Tên A',phone:'0900000000',nickName:'Tên riêng',gender:'MALE',birthDate:'1995-01-01',email:'original@example.com',levelName:'Thành viên',shopId:1,shopName:'QA',balances:{principalVnd:50,bonus:0,totalAvailable:50,turns:5,integral:0,points:0,other:{}},profileRevision:0,remoteConfirmedRevision:0,syncStatus:'SYNCED'};
window.__qa={profile:{...profile},changes:[]};useMemberStore.getState().completeLookup(profile);
window.__finishFirst=()=>{window.__qa.changes[0].status='SYNCED';window.__qa.profile.remoteConfirmedRevision=1;};
function Customer(){const state=useCustomerDisplayState();return <div id='customer'>{state.mode==='MEMBER_REVIEW'||state.mode==='MEMBER_SUCCESS'?<MemberRegistrationDisplay state={state} language='vi'/>:null}</div>;}
function App(){const member=useMemberStore(s=>s.currentMember);const edit=useMemberProfileEditController(member,1,'qa-store',true);window.__refreshHistory=edit.loadHistory;
useMemberCustomerDisplayPublisher({enabled:true,showLookupBalances:true,draft:useMemberStore(s=>s.registrationDraft),mutationStatus:'IDLE',member,editDraft:edit.draft,editSaved:edit.saved});
return <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:24,padding:24}}><div id='cashier'><MemberDetailsPanel member={member} shopId={1} warehouseId='qa-store' fetchedAt={null} activity={{}} packageSale={{}} profileEdit={edit} canEdit canHistory canRetry paymentLocked={false}/></div><Customer/></div>;}
createRoot(document.getElementById('root')).render(<App/>);`;
(async () => {
  await esbuild.build({ stdin: { contents: entry, resolveDir: root, loader: "tsx" }, outfile: path.join(output, "app.js"), bundle: true, platform: "browser", format: "iife", jsx: "automatic", nodePaths: [path.join(root, "node_modules")], define: { "process.env.NODE_ENV": '"production"' }, plugins: [{ name: "synthetic-services", setup(build) {
    build.onResolve({ filter: /^@\// }, args => args.path in virtuals ? { path: args.path, namespace: "qa" } : { path: path.join(root, "src", args.path.slice(2)) + (fs.existsSync(path.join(root, "src", args.path.slice(2)) + ".tsx") ? ".tsx" : ".ts") });
    build.onLoad({ filter: /.*/, namespace: "qa" }, args => ({ contents: virtuals[args.path], loader: "ts", resolveDir: root }));
  } }] });
  const cssPath = path.join(output, "styles.css");

  const postcss = require(path.join(root, "node_modules/postcss"));
  const tailwind = createRequire(path.join(root, "package.json"))("@tailwindcss/postcss");
  const css = await postcss([tailwind()]).process(fs.readFileSync(path.join(root, "src/app/globals.css"), "utf8"), { from: path.join(root, "src/app/globals.css"), to: cssPath });
  fs.writeFileSync(cssPath, css.css);
  const server = http.createServer((req, res) => {
    if (req.url === "/app.js" || req.url === "/styles.css") { res.setHeader("Content-Type", req.url.endsWith("js") ? "text/javascript" : "text/css"); res.end(fs.readFileSync(path.join(output, req.url.slice(1)))); }
    else res.end('<!doctype html><html lang="vi"><head><meta charset="utf-8"><link rel="stylesheet" href="/styles.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>');
  });
  await new Promise(resolve => server.listen(8877, "127.0.0.1", resolve));
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    // A network trap ensures this synthetic test cannot reach a real service.
    await page.route("**/*", route => route.request().url().startsWith("http://127.0.0.1:8877/") ? route.continue() : route.abort());
    await page.goto("http://127.0.0.1:8877/");
    const cashier = page.locator("#cashier"), customer = page.locator("#customer");
    await cashier.getByRole("button", { name: "Chỉnh sửa thông tin" }).click();
    await cashier.getByLabel("Họ tên *", { exact: true }).fill("");
    if (!(await cashier.getByRole("button", { name: "Lưu thay đổi" }).isDisabled())) throw Error("Empty name allowed");
    await page.waitForFunction(() => document.querySelector('#customer .break-words')?.textContent === '');
    const customerName = customer.locator(".break-words").first();
    if ((await customerName.textContent()) !== "") throw Error("Old name masks the empty draft");
    await cashier.getByLabel("Họ tên *", { exact: true }).fill("Tên B");
    await cashier.getByLabel("Số điện thoại *", { exact: true }).fill("");
    if (!(await cashier.getByRole("button", { name: "Lưu thay đổi" }).isDisabled())) throw Error("Empty phone allowed");
    await cashier.getByLabel("Số điện thoại *", { exact: true }).fill("0900000000");
    await cashier.getByRole("button", { name: "Lưu thay đổi" }).click();
    if (!(await cashier.getByLabel("Họ tên *", { exact: true }).isDisabled())) throw Error("Input not frozen during save");
    await cashier.getByRole("button", { name: "Chỉnh sửa thông tin" }).waitFor();
    await customer.getByRole("heading", { name: "Đã cập nhật thông tin" }).waitFor();
    await cashier.getByRole("button", { name: "Chỉnh sửa thông tin" }).click();
    await cashier.getByLabel("Họ tên *", { exact: true }).fill("Tên C");
    await page.evaluate(async () => { window.__finishFirst(); await window.__refreshHistory(); });
    await page.waitForFunction(() => document.querySelector('#customer .break-words')?.textContent === 'Tên C');
    if ((await cashier.getByLabel("Họ tên *", { exact: true }).inputValue()) !== "Tên C") throw Error("Late completion replaced second draft");
    await page.screenshot({ path: path.join(output, "edit-live-preview.png"), fullPage: true });
    await cashier.getByRole("button", { name: "Lưu thay đổi" }).click();
    await cashier.getByRole("button", { name: "Chỉnh sửa thông tin" }).waitFor();
    const revisions = await page.evaluate(() => window.__qa.changes.map(c => [c.revision, c.after.fullName]));
    if (JSON.stringify(revisions) !== JSON.stringify([[1, "Tên B"], [2, "Tên C"]])) throw Error("Second save lost immutable history");
    await cashier.getByRole("tab", { name: "Lịch sử chỉnh sửa" }).click();
    await cashier.getByText(/Phiên bản 2/).waitFor();
    await cashier.locator("details").first().locator("summary").click();
    await page.screenshot({ path: path.join(output, "edit-history.png"), fullPage: true });
    await cashier.getByRole("tab", { name: "Hồ sơ", exact: true }).click();
    await cashier.getByRole("button", { name: "Chỉnh sửa thông tin" }).click();
    await cashier.getByLabel("Họ tên *", { exact: true }).fill("Tên D");
    await page.evaluate(() => { window.__qa.timeoutNext = true; });
    await cashier.getByRole("button", { name: "Lưu thay đổi" }).click();
    await cashier.getByRole("button", { name: "Kiểm tra kết quả lưu" }).waitFor();
    await page.evaluate(() => window.__retryToast());
    await cashier.getByRole("button", { name: "Chỉnh sửa thông tin" }).waitFor();
    const retryIds = await page.evaluate(() => window.__qa.receivedIds.slice(-2));
    if (retryIds[0] !== retryIds[1]) throw Error("Old toast retry generated a new operationId");
    if ((await page.evaluate(() => window.__qa.changes.length)) !== 3) throw Error("Timeout retry duplicated history");
    if (errors.length) throw Error(errors.join("\n"));
    fs.writeFileSync(path.join(output, "result.json"), JSON.stringify({ passed: true, revisions, timeoutRetryIdempotent: true, browserErrors: errors, screenshots: ["edit-live-preview.png", "edit-history.png"] }, null, 2));
    console.log("UI QA passed: required fields, live preview, Firestore save lock, second revision, history, customer confirmation, timeout retry idempotency.");
  } catch (error) { await browser.contexts()[0]?.pages()[0]?.screenshot({path:path.join(output,"failure.png"),fullPage:true}); throw error; } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
