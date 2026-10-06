/* eslint-disable @typescript-eslint/no-require-imports */
const test=require('node:test');const assert=require('node:assert/strict');
const http=require('node:http');const crypto=require('node:crypto');
if(process.env.GCLOUD_PROJECT!=='demo-pos-payment'||process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8085')throw Error('Only loopback demo emulator is allowed');
const {db}=require('../lib/config/firebase');
const provider=require('../lib/services/payosService');
const {PayOS}=require('@payos/node');
// Synthetic key, never the account supplied by the user. SDK verify is real.
const key='local-synthetic-checksum-for-webhook-regression';
const sdk=new PayOS({clientId:'synthetic-client',apiKey:'synthetic-api',checksumKey:key});
const {payosWebhook}=require('../lib/payment/payosWebhook');
function signed(data){const canonical=Object.keys(data).sort().map(k=>`${k}=${data[k]}`).join('&');return {code:'00',desc:'success',success:true,data,signature:crypto.createHmac('sha256',key).update(canonical).digest('hex')};}
let number=0;
async function fixture(){const code=70000+(++number);const id=`ORD-${Date.now()}-${String(number).padStart(6,'0')}`;const now=new Date().toISOString();const data={code:'00',orderCode:code,amount:2000,currency:'VND',paymentLinkId:`signed-test-link-${code}`,reference:'synthetic-reference',transactionDateTime:'2026-10-06T09:00:00+07:00'};
 const ref=db.doc(`pos_orders/${id}`);await ref.set({localOrderId:id,createdBy:'signed-owner',warehouseId:'signed-warehouse',deviceId:'signed-device',orderKind:'STANDARD',status:'DRAFT',totalAmount:2000,updatedAt:now,payosOrderCodes:[code],paymentDetails:{provider:'payos',currentOrderCode:code,attempts:[{orderCode:code,amount:2000,status:'PENDING',paymentLinkId:data.paymentLinkId,createdAt:now,linkExpiresAt:new Date(Date.now()+900000).toISOString(),displayExpiresAt:new Date(Date.now()+300000).toISOString()}]}});return {ref,data,id};}
test('HTTP webhook verifies signatures and never double-applies payment',async(t)=>{
 const original=provider.getPayOS;provider.getPayOS=()=>({webhooks:sdk.webhooks,paymentRequests:{cancel:()=>{throw Error('Unexpected external cancellation');}}});
 const server=http.createServer(async(req,res)=>{try{let raw='';for await(const c of req)raw+=c;req.body=raw?JSON.parse(raw):{};res.set=(k,v)=>{res.setHeader(k,v);return res;};res.status=n=>{res.statusCode=n;return res;};res.json=v=>{res.setHeader('content-type','application/json');res.end(JSON.stringify(v));};await payosWebhook(req,res);}catch(error){res.statusCode=500;res.end(JSON.stringify({error:error.message}));}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url=`http://127.0.0.1:${server.address().port}/webhook`;
 const post=payload=>fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
 try{
  await t.test('GET returns 405 and exposes allowed POST method',async()=>{const r=await fetch(url);assert.equal(r.status,405);assert.equal(r.headers.get('allow'),'POST');});
  await t.test('missing/invalid signature and modified signed amount cannot mark paid',async()=>{const o=await fixture();const valid=signed(o.data);for(const payload of [{data:o.data},{...valid,signature:'invalid'},{...valid,data:{...o.data,amount:1}}])assert.equal((await post(payload)).status,400);assert.equal((await o.ref.get()).data().status,'DRAFT');});
  await t.test('non-success provider event is ACKed without recognizing money',async()=>{const o=await fixture();assert.equal((await post(signed({...o.data,code:'01'}))).status,200);assert.equal((await o.ref.get()).data().status,'DRAFT');});
  await t.test('signed amount or currency mismatch is rejected before revenue',async()=>{const o=await fixture();assert.equal((await post(signed({...o.data,amount:1999}))).status,400);assert.equal((await post(signed({...o.data,currency:'USD'}))).status,400);assert.equal((await o.ref.get()).data().status,'DRAFT');});
  await t.test('unknown order is ACKed without creating an order',async()=>{assert.equal((await post(signed({code:'00',orderCode:888888,amount:2000,currency:'VND',paymentLinkId:'unknown-link'}))).status,200);assert.equal((await db.collection('pos_orders').where('payosOrderCodes','array-contains',888888).get()).size,0);});
  await t.test('duplicate matching orders fail safely instead of selecting one',async()=>{const o=await fixture();const second=db.doc(`pos_orders/ORD-${Date.now()}-DUPLIC`);await second.set({...((await o.ref.get()).data()),localOrderId:second.id});assert.equal((await post(signed(o.data))).status,500);assert.equal((await o.ref.get()).data().status,'DRAFT');assert.equal((await second.get()).data().status,'DRAFT');});
  await t.test('valid webhook writes PAID and replay preserves paidAt and first source',async()=>{const o=await fixture();assert.equal((await post(signed(o.data))).status,200);const first=(await o.ref.get()).data();assert.equal(first.status,'LOCAL_PAID');assert.equal(first.paymentDetails.attempts[0].confirmationSource,'WEBHOOK');assert.ok(first.paymentDetails.attempts[0].webhookReceivedAt);assert.equal((await post(signed(o.data))).status,200);assert.deepEqual((await o.ref.get()).data(),first);});
  await t.test('WEBHOOK after a previously API-confirmed payment preserves first source',async()=>{const o=await fixture();const {markPayOSPaymentPaid}=require('../lib/payment/payosFunctions');await markPayOSPaymentPaid(o.ref,o.data.orderCode,{...o.data,confirmationSource:'API_CHECK'});const first=(await o.ref.get()).data();assert.equal((await post(signed(o.data))).status,200);assert.deepEqual((await o.ref.get()).data(),first);});
 }finally{provider.getPayOS=original;await new Promise(resolve=>server.close(resolve));}
});
