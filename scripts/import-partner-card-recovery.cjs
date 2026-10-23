// One-time, create-only seed from the audited removal records. Never enables a member.
const fs=require('node:fs'),path=require('node:path'),{createRequire}=require('node:module');
process.loadEnvFile('.env.local');
const {ImportFirestore}=require('../functions/lib/services/memberImportFirestore');
const {POS_COLLECTIONS}=require('../functions/lib/config/collections');
const {recoveryId}=require('../functions/lib/services/partnerCardRecoveryPolicy');
const base='.firebase/member-import/jw-system-f2104-20692/';
const source=JSON.parse(fs.readFileSync(base+'local-before-apply.json','utf8'));
const cache=JSON.parse(fs.readFileSync(base+'cache.json','utf8'));
const removed=JSON.parse(fs.readFileSync('.firebase/card-return-remaining-599/report.json','utf8'));
const first=JSON.parse(fs.readFileSync('.firebase/disabled-card-return-270826001/report.json','utf8'));
const disable=[...JSON.parse(fs.readFileSync('.firebase/member-disable-270826001-270826500/report.json')).results,...JSON.parse(fs.readFileSync('.firebase/member-disable-270826501-270826600/report.json')).results];
if(process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!=='jw-system-f2104'||Number(process.env.NEXT_PUBLIC_SHOP_ID)!==20692)throw Error('Wrong target');
const rows=Array.from({length:600},(_,i)=>{
 const phone=String(270826001+i),matches=cache.rows.filter(r=>r.phone===phone&&r.shopId===20692);
 if(matches.length!==1||matches[0].memberCardList.length!==1)throw Error('Missing or duplicate original card');
 const r=matches[0],c=r.memberCardList[0],local=source.local.find(d=>d.id===r.memberAcctId);
 const disabled=disable.find(d=>d.uid===r.memberAcctId&&d.success),removal=removed.targets.find(t=>t.uid===r.memberAcctId&&t.state==='COMPLETED');
 if(!local||!disabled||(!removal&&!(phone==='270826001'&&first.summary.cardStillLinked===false)))throw Error('Missing removal evidence');
 return {schemaVersion:1,shopId:20692,memberCode:c.memberCode,cardUuid:c.icCard.toUpperCase(),uid:r.memberAcctId,mid:r.memberId,phone,fullName:r.realName,creationWarehouseId:local.data.warehouseId,
  history:[{label:'Tạo thành viên',at:local.data.createdAt},{label:'Ghi nhận thẻ trên POS',at:local.data.lastRemoteSyncAt},{label:'Tắt thành viên',at:disabled.completedAt},{label:'Gỡ liên kết thẻ',at:removal?removed.completedAt:first.completedAt}],state:'AVAILABLE',error:null};
});
if(new Set(rows.map(r=>r.memberCode)).size!==600||new Set(rows.map(r=>r.cardUuid)).size!==600)throw Error('Duplicate card');
fs.mkdirSync('.firebase/partner-card-recovery',{recursive:true});
fs.writeFileSync('.firebase/partner-card-recovery/seed.json',JSON.stringify(rows,null,2));
if(!process.argv.includes('--apply')){console.log(JSON.stringify({ready:rows.length,firestoreReads:0,firestoreWrites:0}));process.exit(0);}
if(fs.existsSync('.firebase/partner-card-recovery/import-result.json'))throw Error('Already imported; inspect journal');
(async()=>{
 const cli=createRequire(path.join(process.env.APPDATA,'npm/node_modules/firebase-tools/package.json'));
 const t=await cli('./lib/auth').getAccessToken(cli('./lib/configstore').configstore.get('tokens').refresh_token,['https://www.googleapis.com/auth/cloud-platform']);
 const store=new ImportFirestore('jw-system-f2104',async()=>t.access_token);
 for(let i=0;i<rows.length;i+=300){await store.commit(rows.slice(i,i+300).map(r=>store.write(POS_COLLECTIONS.partnerCardRecoveries,recoveryId(r.shopId,r.memberCode),r,null)));console.log(JSON.stringify({imported:i+300,reads:store.reads,writes:store.writes}));}
 fs.writeFileSync('.firebase/partner-card-recovery/import-result.json',JSON.stringify({at:new Date().toISOString(),reads:store.reads,writes:store.writes}));
})().catch(e=>{console.error(e.message);process.exitCode=1});
