const test=require('node:test'),assert=require('node:assert/strict');
const cashier=require('../lib/services/joyworldMemberCardService'),hk=require('../lib/services/hkApiService');
const {fetchCardReturnOwner,returnVerifiedCashierCard,verifyReturnedCard}=require('../lib/services/memberCardReturnRemote');
let level=1,shop=1,mode='normal',requests=[],enabled=true;
cashier.cashierRequest=async request=>{requests.push(request);if(request.path.endsWith('/getmember/list')){if(mode==='missing')throw new cashier.MemberCardIssueError('HK_OPERATION_REJECTED','Không tìm thấy thông tin thành viên');if(mode==='network')throw new cashier.MemberCardIssueError('HK_UNAVAILABLE','Connection failed');return{success:true,data:[{memberAcctId:'account',shopId:1}]};}if(request.path.endsWith('/getdetails'))return{success:true,data:{memberId:'member',memberLevelType:level,shopId:shop,isEnabled:enabled,memberCardOutputs:[{id:'link',memberCode:'CARD',icCard:'0011223344556677'}]}};return{success:true,data:null};};
test('fresh HK details determine normal member type and stable link identity',async()=>{requests=[];level=1;shop=1;mode='normal';const owner=await fetchCardReturnOwner(1,'CARD');assert.equal(owner.memberCardId,'link');assert.equal(owner.uid,'account');});
test('disabled regular members can return cards without enabling the member',async()=>{
  enabled=false;requests=[];
  try {
    const owner=await fetchCardReturnOwner(1,'CARD');
    assert.equal(owner.uid,'account');
    await returnVerifiedCashierCard(1,owner,'disabled-return');
    assert.deepEqual(requests.filter(r=>r.method==='POST').map(r=>r.path),[
      '/member/cashier/member/getmember/list','/member/cashier/MemberCard/return/confirm'
    ]);
    assert.equal(requests.at(-1).body.isReturnDeposit,false);
    for(const value of [2,3,4,0]){level=value;await assert.rejects(()=>fetchCardReturnOwner(1,'CARD'));}
  } finally {enabled=true;level=1;}
});
test('guest, machine/public and unknown member types are rejected',async()=>{for(const value of [2,3,4,0,undefined]){level=value;await assert.rejects(()=>fetchCardReturnOwner(1,'CARD'));}level=1;});
test('wrong shop is rejected',async()=>{shop=2;await assert.rejects(()=>fetchCardReturnOwner(1,'CARD'));shop=1;});
test('known not-found is treated as absent; transport failures are not treated as a free card',async()=>{mode='missing';assert.equal(await fetchCardReturnOwner(1,'CARD'),null);mode='network';await assert.rejects(()=>fetchCardReturnOwner(1,'CARD'));mode='normal';});
test('mutation forces no-deposit and a fixed business ID',async()=>{requests=[];const owner=await fetchCardReturnOwner(1,'CARD');await returnVerifiedCashierCard(1,owner,'fixed-id');const request=requests.at(-1);assert.equal(request.body.isReturnDeposit,false);assert.equal(request.bizCode,'fixed-id');assert.equal(request.body.memberId,'member');});
test('reusable status requires both absence from old member and an availability check',async()=>{mode='missing';requests=[];hk.fetchRemoteMemberCards=async()=>({success:true,data:[{memberCode:'SPARE'}]});assert.equal(await verifyReturnedCard(1,{uid:'account',memberCode:'CARD'}),'SPARE');assert.ok(requests.some(r=>r.path.endsWith('/take/check')));hk.fetchRemoteMemberCards=async()=>({success:true,data:[{memberCode:'CARD'}]});await assert.rejects(()=>verifyReturnedCard(1,{uid:'account',memberCode:'CARD'}));mode='normal';});
