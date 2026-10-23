const test = require("node:test");
const assert = require("node:assert/strict");
const { db } = require("../lib/config/firebase");
const hk = require("../lib/services/hkApiService");
const auth = require("../lib/services/posAuthService");
const { createRegistrationIntent, processRegistration, registrationId } = require("../lib/services/memberRegistrationService");
const { searchMemberPhonesForUser } = require("../lib/services/memberPhoneSearchService");
const { lookupPosMemberForUser, resumePosMemberRegistrationForUser } = require("../lib/member/functions");
const { Filter } = require("firebase-admin/firestore");
process.env.HK_API_SHOP_ID = "1";
let documents, calls, failure, behavior, readCount, authorized;
let chain = Promise.resolve();
class Reference {
  constructor(path) { this.path=path; this.id=path.split("/").pop(); }
  collection(name) { return new Query(`${this.path}/${name}`); }
  get() { return Promise.resolve(snapshot(this.path)); }
}
function snapshot(path) { return { id:path.split("/").pop(), ref:new Reference(path), exists:documents.has(path), data:()=>structuredClone(documents.get(path)) }; }
Filter.where=(field,op,value)=>({field,op,value});
Filter.or=(...or)=>({or});
function matches(data, filter) {
  if(filter.or)return filter.or.some(f=>matches(data,f));
  return filter.op==="in" ? filter.value.includes(data[filter.field]) : data[filter.field]===filter.value;
}
class Query {
  constructor(path,filters=[],prefix="",end="\uffff",limit=Infinity,fields=null){Object.assign(this,{path,filters,prefix,end,max:limit,fields});}
  doc(id){return new Reference(`${this.path}/${id}`);}
  where(field,op,value){return new Query(this.path,[...this.filters,typeof field==="object"?field:{field,op,value}],this.prefix,this.end,this.max,this.fields);}
  orderBy(){return this;}
  startAt(prefix){return new Query(this.path,this.filters,prefix,this.end,this.max,this.fields);}
  endAt(end){return new Query(this.path,this.filters,this.prefix,end,this.max,this.fields);}
  limit(max){return new Query(this.path,this.filters,this.prefix,this.end,max,this.fields);}
  select(...fields){return new Query(this.path,this.filters,this.prefix,this.end,this.max,fields);}
  async get(){readCount++;const docs=[...documents.keys()].filter(path=>path.startsWith(`${this.path}/`)&&path.split("/").length===this.path.split("/").length+1).map(snapshot).filter(doc=>this.filters.every(f=>matches(doc.data(),f))&&(doc.data().phone||"")>=this.prefix&&(doc.data().phone||"")<=this.end).sort((a,b)=>a.data().phone.localeCompare(b.data().phone)).slice(0,this.max);return {docs,empty:!docs.length,size:docs.length};}
}
db.collection=path=>new Query(path);
db.runTransaction=callback=>{
  const work=chain.then(async()=>{
    const writes=[];
    const tx={get:ref=>ref.get(),create:(ref,data)=>{assert.equal(documents.has(ref.path),false);writes.push([ref.path,data,false]);},update:(ref,data)=>{assert.ok(documents.has(ref.path));writes.push([ref.path,data,true]);},set:(ref,data)=>writes.push([ref.path,data,false])};
    const result=await callback(tx);
    if(failure==="all")throw Error("Firestore unavailable");
    if(failure==="member"&&writes.some(([path])=>path.startsWith("pos_members/"))){failure=null;throw Error("Cannot save member");}
    if(failure==="confirmation"&&writes.some(([,data])=>data.state==="HK_CONFIRMED")){failure=null;throw Error("Cannot checkpoint UID");}
    for(const[path,data,merge]of writes)documents.set(path,structuredClone(merge?{...documents.get(path),...data}:data));
    return result;
  });
  chain=work.catch(()=>{});return work;
};
const input={shopId:1,warehouseId:"store",fullName:"Khách thử",phone:"0900000000",memberCode:null,gender:"MALE",birthDate:null,email:"test@example.com"};
const op="11111111-1111-4111-8111-111111111111";
const path=`pos_member_registration_requests/${registrationId(1,input.phone)}`;
function reset(){documents=new Map();calls=[];failure=null;behavior="success";readCount=0;authorized=true;}
auth.getPosAuthSession=async()=>({warehouses:authorized?[{id:"store"}]:[]});
hk.registerRemoteMember=async()=>{calls.push("join");assert.ok(documents.has(path));assert.equal(documents.get(path).state,"HK_IN_FLIGHT");if(behavior==="timeout")throw Error("HK timeout after create");return{success:true,data:{uid:"account",mid:"mid"}};};
hk.fetchRemoteMemberByPhone=async()=>{calls.push("read");return behavior==="missing"?{success:false,data:null}:{success:true,data:{phone:input.phone,mid:"mid",items:[{shopId:1,uid:"account"}]}};};
const create=()=>createRegistrationIntent(input,"user","device",op);
test("intent must persist before any HK write; local failure prevents join",async()=>{reset();failure="all";await assert.rejects(create);assert.deepEqual(calls,[]);assert.equal(documents.size,0);});
test("an existing local phone blocks a new registration before HK, even in another warehouse",async()=>{reset();documents.set("pos_members/existing",{shopId:1,warehouseId:"other",phone:input.phone});await assert.rejects(create,error=>error.code==="already-exists");assert.deepEqual(calls,[]);assert.equal(documents.has(path),false);});
test("normal registration completes member and intent atomically and replays without HK",async()=>{reset();const id=await create();const first=await processRegistration(id);assert.equal(first.profile.email,input.email);assert.equal(documents.get(path).state,"COMPLETED");await processRegistration(id);assert.deepEqual(calls,["join"]);});
test("HK success / member write failure resumes known UID without another join",async()=>{reset();const id=await create();failure="member";await assert.rejects(()=>processRegistration(id));assert.equal(documents.get(path).remoteUid,"account");assert.equal(documents.has("pos_members/account"),false);await processRegistration(id);assert.deepEqual(calls,["join"]);assert.equal(documents.get(path).state,"COMPLETED");});
test("HK response lost is recovered using phone/shop verification, never a second join",async()=>{reset();const id=await create();behavior="timeout";await assert.rejects(()=>processRegistration(id));behavior="success";await processRegistration(id);assert.deepEqual(calls,["join","read"]);});
test("UID checkpoint failure recovers through HK reads",async()=>{reset();const id=await create();failure="confirmation";await assert.rejects(()=>processRegistration(id));await processRegistration(id);assert.deepEqual(calls,["join","read"]);});
test("ambiguous registration cannot adopt a remote UID whose phone changed locally",async()=>{reset();const id=await create();documents.set(path,{...documents.get(path),state:"HK_IN_FLIGHT"});documents.set("pos_members/account",{shopId:1,warehouseId:"store",phone:"0900000001"});await assert.rejects(()=>processRegistration(id));assert.equal(documents.get(path).remoteUid,null);assert.equal(documents.get(path).state,"HK_IN_FLIGHT");assert.deepEqual(calls,["read"]);assert.equal(documents.get("pos_members/account").phone,"0900000001");});
test("resume after a client restart uses durable original input and denies a different scope",async()=>{reset();const id=await create();failure="member";await assert.rejects(()=>processRegistration(id));await assert.rejects(()=>resumePosMemberRegistrationForUser("user",{registrationId:id,shopId:1,warehouseId:"other"}));const result=await resumePosMemberRegistrationForUser("user",{registrationId:id,shopId:1,warehouseId:"store"});assert.equal(result.member.email,input.email);assert.deepEqual(calls,["join"]);});
test("recovery preserves an existing edited profile instead of restoring an old registration draft",async()=>{reset();const id=await create();const now=new Date().toISOString();const existing={...input,remoteUid:"account",mid:"mid",schemaVersion:1,createdBy:"user",updatedBy:"editor",createdAt:now,updatedAt:now,lastRemoteSyncAt:now,fullName:"Tên mới",email:"new@example.com",profileRevision:2,remoteConfirmedRevision:1,syncStatus:"PENDING"};documents.set("pos_members/account",existing);documents.set(path,{...documents.get(path),state:"HK_CONFIRMED",remoteUid:"account"});await processRegistration(id);assert.deepEqual(documents.get("pos_members/account"),existing);assert.deepEqual(calls,[]);assert.equal(documents.get(path).state,"COMPLETED");});
test("concurrent foreground/background delivery makes at most one create request",async()=>{reset();const id=await create();const results=await Promise.allSettled([processRegistration(id),processRegistration(id,true)]);assert.equal(results.filter(r=>r.status==="fulfilled").length,1);assert.deepEqual(calls,["join"]);});
test("expired in-flight lease reconciles instead of repeating create",async()=>{reset();const id=await create();documents.set(path,{...documents.get(path),state:"HK_IN_FLIGHT",lease:{token:"dead",expiresAt:0}});await processRegistration(id);assert.deepEqual(calls,["read"]);});
test("retry payload drift and warehouse drift cannot replace durable original intent",async()=>{reset();await create();await assert.rejects(()=>createRegistrationIntent({...input,email:"other@example.com"},"user","device",op));await assert.rejects(()=>createRegistrationIntent({...input,warehouseId:"other"},"user","device",op));assert.equal(documents.get(path).input.email,input.email);});
test("unresolved remote outcome stops automatic recovery after bounded attempts",async()=>{reset();const id=await create();documents.set(path,{...documents.get(path),state:"HK_IN_FLIGHT"});behavior="missing";for(let i=0;i<6;i++)await assert.rejects(()=>processRegistration(id,true));assert.equal(documents.get(path).state,"NEEDS_REVIEW");await assert.rejects(()=>processRegistration(id,true));assert.equal(calls.filter(c=>c==="read").length,6);assert.equal(calls.includes("join"),false);});
test("registration attempt history retains failures after later success",async()=>{reset();const id=await create();failure="member";await assert.rejects(()=>processRegistration(id));await processRegistration(id);const attempts=[...documents.entries()].filter(([p])=>p.includes("/attempts/"));assert.equal(attempts.length,2);assert.ok(attempts.some(([,d])=>d.lastError));assert.ok(attempts.some(([,d])=>d.status==="COMPLETED"));});
test("phone suggestions share members across stores while keeping pending registration scoped",async()=>{reset();documents.set("pos_members/a",{phone:"0901111111",fullName:"A",shopId:1,warehouseId:"store"});documents.set("pos_members/b",{phone:"0902222222",fullName:"B",shopId:1,warehouseId:"staging",hkImportUnassigned:true});documents.set("pos_members/c",{phone:"0903333333",fullName:"C",shopId:1,warehouseId:"other"});documents.set("pos_members/d",{phone:"0904444444",shopId:2,warehouseId:"store"});await create();const result=await searchMemberPhonesForUser("user",{shopId:1,warehouseId:"store",prefix:"090"});assert.deepEqual(result.suggestions.map(x=>x.uid),[registrationId(1,input.phone),"a","b","c"]);assert.equal(result.suggestions[0].state,"PENDING");assert.deepEqual(calls,[]);});
test("suggestions are capped and invalid/unauthorized requests read no directory",async()=>{reset();for(let i=0;i<30;i++)documents.set(`pos_members/a${i}`,{phone:`09000000${String(i).padStart(2,"0")}`,shopId:1,warehouseId:"store"});assert.equal((await searchMemberPhonesForUser("user",{shopId:1,warehouseId:"store",prefix:"090"})).suggestions.length,10);const before=readCount;await assert.rejects(()=>searchMemberPhonesForUser("user",{shopId:1,warehouseId:"store",prefix:"09"}));authorized=false;await assert.rejects(()=>searchMemberPhonesForUser("user",{shopId:1,warehouseId:"store",prefix:"090"}));assert.equal(readCount,before);assert.deepEqual(calls,[]);});
test("selected UID cannot bypass phone or scope validation and never calls HK on mismatch",async()=>{reset();documents.set("pos_members/account",{phone:"0900000001",shopId:1,warehouseId:"store"});await assert.rejects(()=>lookupPosMemberForUser("user",{shopId:1,warehouseId:"store",mode:"PHONE",query:input.phone,selectedUid:"account"}));assert.deepEqual(calls,[]);});
test("phone suggestions include disabled members with status without extra queries",async()=>{
  reset();
  documents.set("pos_members/disabled",{phone:"270826001",fullName:"Khách đang tắt",shopId:1,warehouseId:"store",hkSnapshot:{isEnabled:false}});
  documents.set("pos_members/enabled",{phone:"270826002",fullName:"Khách đang bật",shopId:1,warehouseId:"store",hkSnapshot:{isEnabled:true}});
  const result=await searchMemberPhonesForUser("user",{shopId:1,warehouseId:"store",prefix:"270826"});
  assert.deepEqual(result.suggestions.map(x=>[x.uid,x.isEnabled,x.state]),[["disabled",false,"READY"],["enabled",true,"READY"]]);
  assert.equal(readCount,2);assert.deepEqual(calls,[]);
});
test("selecting a disabled phone suggestion loads the full profile and disabled status",async()=>{
  reset();await processRegistration(await create());
  const cashier=require('../lib/services/joyworldMemberCardService');
  const originalUid=hk.fetchRemoteMemberByUid,originalCashier=cashier.cashierRequest;
  hk.fetchRemoteMemberByUid=async()=>({success:true,data:{uid:'account',phone:input.phone,realName:'Khách đang tắt',storedValues:[{category:104,value:5}]}});
  cashier.cashierRequest=async request=>{assert.equal(request.path,'/member/cashier/member/getdetails');return{success:true,data:{shopId:1,isEnabled:false}};};
  try{
    const result=await lookupPosMemberForUser('user',{shopId:1,warehouseId:'store',mode:'PHONE',query:input.phone,selectedUid:'account'});
    assert.equal(result.member.uid,'account');assert.equal(result.member.isEnabled,false);assert.equal(result.member.balances.points,5);
  }finally{hk.fetchRemoteMemberByUid=originalUid;cashier.cashierRequest=originalCashier;}
});
test("selected and exact-phone lookup read other-store members without changing their creation store",async()=>{
  const cashier=require('../lib/services/joyworldMemberCardService');
  const originalUid=hk.fetchRemoteMemberByUid,originalCashier=cashier.cashierRequest;
  hk.fetchRemoteMemberByUid=async()=>({success:true,data:{uid:'account',phone:input.phone,realName:'Khách dùng chung',storedValues:[]}});
  cashier.cashierRequest=async()=>({success:true,data:{shopId:1,isEnabled:false}});
  try{for(const selectedUid of ['account',undefined]){
    reset();await processRegistration(await create());
    const profile=documents.get('pos_members/account');
    documents.set('pos_members/account',{...profile,warehouseId:'creation-store'});
    const result=await lookupPosMemberForUser('user',{shopId:1,warehouseId:'store',mode:'PHONE',query:input.phone,...(selectedUid?{selectedUid}:{})});
    assert.equal(result.member.uid,'account');assert.equal(result.member.isEnabled,false);
    assert.equal(documents.get('pos_members/account').warehouseId,'creation-store');
  }}finally{hk.fetchRemoteMemberByUid=originalUid;cashier.cashierRequest=originalCashier;}
});
test("shared lookup does not permit selected UIDs from another HK system",async()=>{
  reset();documents.set('pos_members/other-shop',{phone:input.phone,warehouseId:'other',shopId:2});
  await assert.rejects(()=>lookupPosMemberForUser('user',{shopId:1,warehouseId:'store',mode:'PHONE',query:input.phone,selectedUid:'other-shop'}));
  assert.deepEqual(calls,[]);
});
