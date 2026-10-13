import test from 'node:test';
import assert from 'node:assert/strict';
import {createDemo,analyzeArticle,csvString} from '../engine.mjs';
import {createAnalyzer} from '../services/analyzer.mjs';
import {createAnalysisRequest,normalizeAnalysisResponse} from '../services/analysis-contract.mjs';
import {createAnalyzeHandler} from '../server/analyze-handler.mjs';
const doc=createDemo(),article=doc.articles[0];
const config={description:'平台功能 Agent 更名为 Skills',old:'Agent',next:'Skills',scope:'平台功能名称',exceptions:'通用技术概念、链接地址和代码参数保持不变'};
const input={article,blocks:doc.blocks,config,document:doc};
const request=createAnalysisRequest({...input,requestId:'test-request-1'});
const finding={blockId:'B003',status:'change',reason:'本段描述平台功能名称。',suggestion:'进入 Skills 功能页面，点击「创建 Skills」按钮，即可开始配置。'};
const reply=(req=request)=>({schemaVersion:'1.0',requestId:req.requestId,articleId:req.article.id,complete:true,checkedBlockIds:req.article.blocks.map(b=>b.id),findings:[{...finding}]});
const api=(fetchImpl,timeoutMs=500)=>createAnalyzer({mode:'api',endpoint:'/api/analyze-article',timeoutMs},{fetchImpl,makeRequestId:()=>request.requestId});

test('default local adapter is async, preserves existing output, and never calls fetch',async()=>{
 const service=createAnalyzer({mode:'local'},{fetchImpl:()=>{throw Error('must not send data');}});
 const result=await service.analyzeArticle(input);
 assert.deepEqual(result.map(({analysisSource,...r})=>r),analyzeArticle(article,doc.blocks,config));
 assert(result.every(r=>r.analysisSource==='local'));
});
test('API receives whole article including nonmatching context, outline and scope',async()=>{
 let sent;
 const rows=await api(async(url,options)=>{assert.equal(url,'/api/analyze-article');assert.equal(options.method,'POST');assert.equal(options.credentials,'same-origin');sent=JSON.parse(options.body);return new Response(JSON.stringify(reply(sent)));}).analyzeArticle(input);
 assert.equal(sent.article.blocks.length,5);assert(sent.article.blocks.some(b=>b.text==='开始使用'));
 assert.equal(sent.document.outline.length,6);assert.equal(sent.change.exceptions,config.exceptions);
 assert(!sent.article.blocks.some(b=>b.id==='B008'));
 assert.equal(rows[0].text,doc.blocks[2].text);assert.equal(rows[0].location,doc.blocks[2].location);assert.equal(rows[0].analysisSource,'api');
});
test('results may match a context paragraph without the old keyword',()=>{
 const response=reply();response.findings=[{blockId:'B002',status:'confirm',reason:'章节可能受到流程调整影响。',suggestion:'请确认此章节的流程是否也已调整。'}];
 assert.equal(normalizeAnalysisResponse(response,request,article)[0].text,'开始使用');
});
for(const [name,change] of [
 ['foreign request',r=>{r.requestId='another';}],['foreign article',r=>{r.articleId='T-999';}],
 ['incomplete processing',r=>{r.complete=false;}],['missing block coverage',r=>{r.checkedBlockIds.pop();}],
 ['duplicate coverage',r=>{r.checkedBlockIds[0]=r.checkedBlockIds[1];}],
 ['invented block',r=>{r.findings[0].blockId='B999';}],['duplicate findings',r=>{r.findings.push({...r.findings[0]});}],
 ['invented quote',r=>{r.findings[0].originalText='not in the document';}],
 ['invalid status',r=>{r.findings[0].status='approved';}],['empty reason',r=>{r.findings[0].reason='';}],
 ['empty rewrite',r=>{r.findings[0].suggestion='';}],['unchanged rewrite',r=>{r.findings[0].suggestion=doc.blocks[2].text;}],
 ['rewrite on keep',r=>{r.findings[0].status='keep';}],
])test('rejects '+name,()=>{const response=reply();change(response);assert.throws(()=>normalizeAnalysisResponse(response,request,article),e=>e.code==='INVALID_RESPONSE');});
test('AI cannot override canonical quote or position metadata',()=>{
 const response=reply();Object.assign(response.findings[0],{text:'fake',location:'fake',articleTitle:'fake'});
 const row=normalizeAnalysisResponse(response,request,article)[0];assert.equal(row.text,doc.blocks[2].text);assert.equal(row.location,doc.blocks[2].location);assert.equal(row.articleTitle,article.title);
});
test('empty findings are valid only with full coverage; keep uses original',()=>{
 const response=reply();response.findings=[];assert.deepEqual(normalizeAnalysisResponse(response,request,article),[]);
 response.findings=[{...finding,status:'keep',suggestion:null}];assert.equal(normalizeAnalysisResponse(response,request,article)[0].suggestion,doc.blocks[2].text);
});
for(const status of [401,413,429,501,503])test('HTTP '+status+' is a failure, never a local fallback',async()=>{
 await assert.rejects(api(async()=>new Response('{}',{status})).analyzeArticle(input),e=>e.code==='HTTP_'+status);
});
test('invalid JSON, network failure and timeout produce explicit errors',async()=>{
 await assert.rejects(api(async()=>new Response('<html>')).analyzeArticle(input),e=>e.code==='INVALID_RESPONSE');
 await assert.rejects(api(async()=>{throw Error('offline');}).analyzeArticle(input),e=>e.code==='NETWORK_ERROR');
 await assert.rejects(api(async(url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('abort')))),20).analyzeArticle(input),e=>e.code==='TIMEOUT');
});
test('already-cancelled calls do not send document text',async()=>{
 const controller=new AbortController();controller.abort();
 await assert.rejects(api(()=>{throw Error('must not be called');}).analyzeArticle({...input,signal:controller.signal}),e=>e.code==='CANCELLED');
});
test('reference backend handles unconfigured, unauthorized, malformed, invalid AI and valid AI responses',async()=>{
 const req=()=>new Request('http://local/api/analyze-article',{method:'POST',body:JSON.stringify(request)});
 assert.equal((await createAnalyzeHandler()(req())).status,501);
 assert.equal((await createAnalyzeHandler({authorize:()=>false,analyzeWithModel:()=>{throw Error('must not be called');}})(req())).status,401);
 const ok=createAnalyzeHandler({authorize:()=>true,analyzeWithModel:async p=>reply(p)});
 assert.equal((await ok(new Request('http://local/api',{method:'POST',body:'invalid json'}))).status,400);
 const bad=createAnalyzeHandler({authorize:()=>true,analyzeWithModel:async p=>({...reply(p),complete:false})});
 assert.equal((await bad(req())).status,502);
 const response=await ok(req());assert.equal(response.status,200);assert.deepEqual(await response.json(),reply());
});
test('CSV records analysis source',()=>{
 const rows=normalizeAnalysisResponse(reply(),request,article);assert(csvString(rows,doc.name,config).includes('AI 服务分析'));
});
