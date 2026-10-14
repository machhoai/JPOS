// Real lookup UI + debounce hook; synthetic directory boundary and no live HK writes.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {createRequire}=require('node:module');
const root=path.resolve(__dirname,'..');
const dep=createRequire(path.join(root,'.firebase/payment-qa/package.json'));
const esbuild=dep('esbuild'),{chromium}=dep('playwright');
const output=path.join(root,'.firebase/member-phone-search-qa');fs.mkdirSync(output,{recursive:true});
const entry=`import React,{useState} from 'react';import{createRoot}from'react-dom/client';
import MemberLookupPanel from '@/components/members/MemberLookupPanel';
import{useMemberPhoneSuggestions}from'@/lib/hooks/useMemberPhoneSuggestions';
window.__qa={searches:[],lookups:[],failNext:false};
function App(){const[query,setQuery]=useState(''),[mode,setMode]=useState('PHONE'),[selected,setSelected]=useState(null),[scope,setScope]=useState('store');
const search=useMemberPhoneSuggestions(query,1,scope,'qa-user',mode==='PHONE');window.__scope=setScope;
const select=item=>{setQuery(item.phone);setSelected(item);window.__qa.lookups.push({phone:item.phone,uid:item.uid});};
return <main className='mx-auto max-w-lg p-6'><MemberLookupPanel mode={mode} query={query} isLookingUp={false} cardReaderStatus='IDLE' cardReaderError={null} onModeChange={next=>{setMode(next);setQuery('');setSelected(null);}} onQueryChange={value=>{setQuery(value);setSelected(null);}} onReadCard={()=>{}} onCancelCardRead={()=>{}} onSubmit={()=>{if(mode==='CARD'||selected?.phone===query)window.__qa.lookups.push({phone:query,uid:selected?.uid});}} phoneSearch={search} phoneSelected={selected?.phone===query} onSuggestionSelect={select} onSearchRetry={search.retry}/></main>;}
createRoot(document.getElementById('root')).render(<App/>);`;
const mock=`export async function fetchMemberPhoneSuggestions(input){const q=window.__qa;q.searches.push(input);const failed=q.failNext;q.failNext=false;await new Promise(r=>setTimeout(r,input.prefix==='093'?650:25));if(failed)throw Error('Không thể tìm số điện thoại. Vui lòng thử lại.');return [{uid:input.warehouseId+'-'+input.prefix,phone:input.prefix+'0000000',fullName:'Khách '+input.prefix,state:'READY'}];}`;
(async()=>{
  await esbuild.build({stdin:{contents:entry,resolveDir:root,loader:'tsx'},outfile:path.join(output,'app.js'),bundle:true,platform:'browser',format:'iife',jsx:'automatic',nodePaths:[path.join(root,'node_modules')],define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'synthetic-directory',setup(build){
    build.onResolve({filter:/^@\//},args=>args.path==='@/lib/services/memberPhoneSearchService'?{path:args.path,namespace:'qa'}:{path:path.join(root,'src',args.path.slice(2))+(fs.existsSync(path.join(root,'src',args.path.slice(2))+'.tsx')?'.tsx':'.ts')});
    build.onLoad({filter:/.*/,namespace:'qa'},()=>({contents:mock,loader:'ts',resolveDir:root}));
  }}]});
  const postcss=require(path.join(root,'node_modules/postcss')),tailwind=createRequire(path.join(root,'package.json'))('@tailwindcss/postcss');
  const css=await postcss([tailwind()]).process(fs.readFileSync(path.join(root,'src/app/globals.css'),'utf8'),{from:path.join(root,'src/app/globals.css')});fs.writeFileSync(path.join(output,'styles.css'),css.css);
  const server=http.createServer((req,res)=>{if(['/app.js','/styles.css'].includes(req.url)){res.setHeader('Content-Type',req.url.endsWith('.js')?'text/javascript':'text/css');res.end(fs.readFileSync(path.join(output,req.url.slice(1))));}else res.end('<!doctype html><html lang="vi"><head><meta charset="utf-8"><link rel="stylesheet" href="/styles.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>');});
  await new Promise(resolve=>server.listen(8878,'127.0.0.1',resolve));const browser=await chromium.launch({headless:true,channel:'chrome'});
  try{
    const page=await browser.newPage({viewport:{width:1100,height:850}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*',route=>route.request().url().startsWith('http://127.0.0.1:8878/')?route.continue():route.abort());await page.goto('http://127.0.0.1:8878/');
    const input=page.locator('#member-lookup');const submit=page.getByRole('button',{name:'Tra cứu thành viên',exact:true});
    await input.fill('09');await page.waitForTimeout(450);if(await page.evaluate(()=>window.__qa.searches.length)!==0)throw Error('Short prefix queried');
    await input.fill('090');await page.waitForTimeout(100);await input.fill('0901');await page.waitForTimeout(100);await input.fill('09012');await page.waitForTimeout(450);
    if(await page.evaluate(()=>window.__qa.searches.length)!==1)throw Error('Debounce failed');if(!(await submit.isDisabled()))throw Error('Typed phone can submit before selection');
    if(await page.evaluate(()=>window.__qa.lookups.length)!==0)throw Error('Typing triggered lookup');
    await page.getByRole('button',{name:/090120000000.*Tra cứu/}).click();if(await page.evaluate(()=>window.__qa.lookups.length)!==1)throw Error('Selection did not lookup');
    await input.fill('093');await page.waitForTimeout(400);await input.fill('094');await page.waitForTimeout(1000);
    if(!(await page.getByRole('button',{name:/0940000000.*Tra cứu/}).isVisible()))throw Error('New response missing');if(await page.getByRole('button',{name:/0930000000.*Tra cứu/}).count())throw Error('Stale response shown');
    await page.evaluate(()=>{window.__qa.failNext=true;});await input.fill('095');await page.getByRole('button',{name:'Thử lại tìm kiếm'}).waitFor();await page.getByRole('button',{name:'Thử lại tìm kiếm'}).click();await page.getByRole('button',{name:/0950000000.*Tra cứu/}).waitFor();
    await page.evaluate(()=>window.__scope('other-store'));await page.waitForTimeout(450);if(await page.evaluate(()=>window.__qa.searches.at(-1).warehouseId)!=='other-store')throw Error('Scope cache reused');
    await page.screenshot({path:path.join(output,'phone-suggestions.png'),fullPage:true});
    await page.getByRole('tab',{name:'Mã thẻ'}).click();await input.fill('CARD-TEST');await submit.click();if(await page.evaluate(()=>window.__qa.lookups.length)!==2)throw Error('Card regression');
    if(errors.length)throw Error(errors.join('\n'));
    fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({passed:true,debounce:true,localOnlyWhileTyping:true,selectionRequired:true,staleResponseIgnored:true,searchRetry:true,scopeIsolation:true,cardUnchanged:true,browserErrors:errors},null,2));console.log('PASS: debounce, local suggestions, selection gate, stale response, retry, scope, card.');
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
