/* eslint-disable @typescript-eslint/no-require-imports */
// Explicit opt-in; this suite is never included in the default *.test.js run.
const test = require('node:test');
const assert = require('node:assert/strict');
if (process.env.GCLOUD_PROJECT !== 'demo-pos-payment' || process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8085') throw new Error('Only loopback demo emulator is allowed');
const { db } = require('../lib/config/firebase');
const provider = require('../lib/services/payosService');
const {
  markPayOSPaymentPaid, getPayOSPaymentStatusForUser,
  confirmPayOSPaymentManuallyForUser, createPayOSPaymentForUser,
  handlePayOSPaymentTimeoutForUser,
} = require('../lib/payment/payosFunctions');
const { createPaymentWatch } = require('../lib/payment/paymentStatusProjection');
const { withPayOSCheckLease } = require('../lib/payment/payosCheckLease');
const actor = 'safety-owner', warehouseId = 'safety-warehouse', deviceId = 'safety-device';
let number = 0;
async function order(overrides = {}) {
  const localOrderId = `ORD-${Date.now()}-${String(++number).padStart(6,'0')}`;
  const code = 50000 + number;
  const attempt = { orderCode: code, status: 'PENDING', amount: 2000, paymentLinkId: `safety-link-${code}`, qrCode: 'test-only-qr', createdAt: new Date().toISOString(), displayExpiresAt: new Date(Date.now()+300000).toISOString(), linkExpiresAt: new Date(Date.now()+900000).toISOString() };
  const value = { localOrderId, createdBy: actor, shopId: 20692, warehouseId, deviceId, orderKind: 'STANDARD', status: 'DRAFT', totalAmount: 2000, items: [{goodsId:'safety-goods',goodsName:'Safety test',price:2000,quantity:1}], updatedAt:new Date().toISOString(), paymentDetails:{provider:'payos',currentOrderCode:code,attempts:[attempt]}, ...overrides };
  const ref = db.doc(`pos_orders/${localOrderId}`); await ref.set(value);
  return { ref, value, attempt, payment:{code:'00',orderCode:code,amount:2000,currency:'VND',paymentLinkId:attempt.paymentLinkId} };
}
async function stub(run, get) {
  const original = provider.getPayOS;
  const stats = { gets:0, creates:0, options:null };
  provider.getPayOS = () => ({paymentRequests:{get:async(code,options)=>{stats.gets++;stats.options=options;return get(code);},create:async()=>{stats.creates++;throw Error('Unexpected provider CREATE');}}});
  try { await run(stats); } finally { provider.getPayOS=original; }
}
test('payment safety using real emulator transactions and a fake provider', async(t)=>{
  const batch=db.batch();
  for(const [name,data] of [
    [`users/${actor}`,{username:'safety',email:'safety@example.invalid',full_name:'SAFETY',employee_id:'SAFETY',status:'ACTIVE',is_deleted:false}],
    ['roles/safety-role',{is_deleted:false,permissions:{'pos.login':true,'pos.sales.create':true}}],
    ['user_warehouse_roles/safety-assignment',{user_id:actor,warehouse_id:warehouseId,role_id:'safety-role',assigned_by:'test',valid_from:'2026-01-01',valid_until:null,is_active:true,is_deleted:false}],
    [`warehouses/${warehouseId}`,{name:'Safety',code:'SAFETY',type:'STORE',status:'ACTIVE',is_deleted:false}],
    [`pos_devices/${deviceId}`,{status:'ACTIVE',is_deleted:false,warehouse_id:warehouseId}],
  ]) batch.set(db.doc(name),data);
  await batch.commit();
  for(const [field,values] of Object.entries({amount:[0,-1,1999,2001,2000.5],currency:['USD'],paymentLinkId:['wrong-link'],orderCode:[-1,9999],code:['01']})) {
    for(const value of values) await t.test(`rejects invalid ${field}=${value} without marking revenue`,async()=>{
      const o=await order(); const before=(await o.ref.get()).updateTime;
      assert.equal(await markPayOSPaymentPaid(o.ref,o.attempt.orderCode,{...o.payment,[field]:value}),'REJECTED');
      const after=await o.ref.get(); assert.equal(after.data().status,'DRAFT');assert.ok(after.updateTime.isEqual(before));assert.equal(after.data().paidAt,undefined);
    });
  }
  await t.test('10 concurrent confirmations commit payment once and preserve original source/time',async()=>{
    const o=await order();await createPaymentWatch(actor,{id:deviceId,warehouseId},o.value.localOrderId);
    const outcomes=await Promise.all(Array.from({length:10},(_,i)=>markPayOSPaymentPaid(o.ref,o.attempt.orderCode,{...o.payment,confirmationSource:i%2?'WEBHOOK':'API_CHECK'})));
    assert.equal(outcomes.filter(v=>v==='PAID').length,1);assert.equal(outcomes.filter(v=>v==='ALREADY_COMPLETED').length,9);
    const first=(await o.ref.get()).data();await markPayOSPaymentPaid(o.ref,o.attempt.orderCode,{...o.payment,confirmationSource:'WEBHOOK'});
    assert.deepEqual((await o.ref.get()).data(),first);
    const watch=(await db.doc(`pos_payment_status/${first.paymentWatchId}`).get()).data();assert.equal(watch.orderStatus,'LOCAL_PAID');assert.equal(watch.paidAt,first.paidAt);
  });
  await t.test('unchanged PENDING does not rewrite the order and GET has bounded request options',async()=>{
    const o=await order();const before=(await o.ref.get()).updateTime;
    await stub(async(stats)=>{const result=await getPayOSPaymentStatusForUser(actor,{localOrderId:o.value.localOrderId});assert.equal(result.nextAction,'WAIT');assert.equal(stats.gets,1);assert.deepEqual(stats.options,{timeout:4000,maxRetries:0});},()=>({status:'PENDING'}));
    assert.ok((await o.ref.get()).updateTime.isEqual(before));
  });
  for(const status of ['PROCESSING','UNDERPAID']) await t.test(`${status} never completes a payment`,async()=>{
    const o=await order();await stub(async()=>{const r=await getPayOSPaymentStatusForUser(actor,{localOrderId:o.value.localOrderId});assert.equal(r.orderStatus,'DRAFT');assert.equal(r.nextAction,'WAIT');assert.equal(r.payment.status,status);},()=>({status}));assert.equal((await o.ref.get()).data().paidAt,undefined);
  });
  await t.test('provider PAID with wrong amount is rejected; exact amount uses API_CHECK',async()=>{
    const bad=await order();await stub(async()=>{await assert.rejects(getPayOSPaymentStatusForUser(actor,{localOrderId:bad.value.localOrderId}),{code:'data-loss'});},()=>({status:'PAID',id:bad.attempt.paymentLinkId,amountPaid:1999,transactions:[]}));assert.equal((await bad.ref.get()).data().status,'DRAFT');
    const good=await order();await stub(async()=>{const r=await getPayOSPaymentStatusForUser(actor,{localOrderId:good.value.localOrderId});assert.equal(r.nextAction,'COMPLETED');},()=>({status:'PAID',id:good.attempt.paymentLinkId,amountPaid:2000,transactions:[]}));assert.equal((await good.ref.get()).data().paymentDetails.attempts[0].confirmationSource,'API_CHECK');
  });
  await t.test('a paid historical attempt completes the order without losing the active attempt',async()=>{
    const o=await order();const old={...o.attempt,orderCode:o.attempt.orderCode-1000,paymentLinkId:'safety-old-link'};await o.ref.update({paymentDetails:{...o.value.paymentDetails,attempts:[old,o.attempt]}});
    assert.equal(await markPayOSPaymentPaid(o.ref,old.orderCode,{...o.payment,orderCode:old.orderCode,paymentLinkId:old.paymentLinkId,confirmationSource:'WEBHOOK'}),'PAID');
    const value=(await o.ref.get()).data();assert.equal(value.status,'LOCAL_PAID');assert.equal(value.paymentDetails.currentOrderCode,o.attempt.orderCode);assert.equal(value.paymentDetails.attempts[0].status,'PAID');
  });
  await t.test('manual confirmation without dedicated permission cannot change the order',async()=>{
    const o=await order();await assert.rejects(confirmPayOSPaymentManuallyForUser(actor,{localOrderId:o.value.localOrderId}),{code:'permission-denied'});assert.equal((await o.ref.get()).data().status,'DRAFT');
  });
  await t.test('already-paid SYNC_FAILED order never creates another QR or asks provider for money',async()=>{
    const o=await order({status:'SYNC_FAILED',paidAt:new Date().toISOString()});await stub(async(stats)=>{const r=await createPayOSPaymentForUser(actor,{localOrderId:o.value.localOrderId});assert.equal(r.nextAction,'COMPLETED');assert.equal(stats.gets+stats.creates,0);},()=>{throw Error('Unexpected GET');});
  });
  await t.test('expired abandoned lease is recoverable and active backoff blocks final checks',async()=>{
    const o=await order();const lease=db.doc(`pos_payment_checks/${o.attempt.orderCode}`);await lease.set({leaseId:'dead',leaseUntil:Date.now()-1,nextAllowedAt:Date.now()-1});let calls=0;await withPayOSCheckLease(o.ref,o.attempt.orderCode,false,async()=>{calls++;return o.value;});assert.equal(calls,1);
    await lease.update({backoffUntil:Date.now()+30000});await assert.rejects(withPayOSCheckLease(o.ref,o.attempt.orderCode,true,async()=>{calls++;return o.value;}),{code:'resource-exhausted'});assert.equal(calls,1);
  });
  await t.test('final display timeout forces a fresh provider check without falsely expiring paid money',async()=>{
    const o=await order();await db.doc(`pos_payment_checks/${o.attempt.orderCode}`).set({nextAllowedAt:Date.now()+5000});await stub(async(stats)=>{const r=await handlePayOSPaymentTimeoutForUser(actor,{localOrderId:o.value.localOrderId});assert.equal(stats.gets,1);assert.equal(r.nextAction,'COMPLETED');},()=>({status:'PAID',id:o.attempt.paymentLinkId,amountPaid:2000,transactions:[]}));
  });
});
