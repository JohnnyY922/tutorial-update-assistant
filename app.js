import {STATUS,escapeHTML as h,termRegex,inferTerms,analyzeArticle,groupBlocks,csvString,createDemo} from './engine.mjs';
import {parseDocx} from './parser.js';
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const icon=(name,cls='')=>`<svg class="icon ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const badge=status=>`<span class="badge ${status}"><span class="dot"></span>${STATUS[status]}</span>`;
const clone=v=>structuredClone(v);
const pause=ms=>new Promise(r=>setTimeout(r,ms));
let doc=null,stage='upload',results=[],snapshot=null,selected=null,filter='actionable',busy=false,stale=false,history=[],failed=[],processed=0,simulateFailure=false,dialogArticle=0,dialogFocus=null,toastTimer;
function config(){return {description:$('#description').value.trim(),old:$('#oldText').value.trim(),next:$('#newText').value.trim(),scope:$('#scope').value.trim(),exceptions:$('#exceptions').value.trim()};}
function setConfig(c){for(const [key,id] of Object.entries({description:'description',old:'oldText',next:'newText',scope:'scope',exceptions:'exceptions'}))$('#'+id).value=c[key]||'';updateAdvancedSummary();}
function toast(message){$('#toast').textContent=message;$('#toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('show'),3200);}
function markStale(){if(snapshot){stale=true;$('#staleBanner').classList.remove('hidden');}updateSteps();}
function updateSteps(){
 const order=['upload','configure','results'],index=order.indexOf(stage);
 $$('.step').forEach((step,i)=>{step.classList.toggle('current',i===index);step.classList.toggle('complete',i<index);step.setAttribute('aria-current',i===index?'step':'false');step.disabled=busy||i===1&&!doc||i===2&&!snapshot;});
}
function updatePageHeading(){
 const labels={upload:['从这里开始','这次变更，哪些教程需要更新？','上传教程文档，我们帮你找到需要修改的地方。'],configure:['描述这一次更新','告诉我们，这次改了什么','说明新旧内容，剩下的交给我们逐篇定位。'],results:['定位已就绪',busy?'正在定位相关内容…':failed.length?'还有部分教程需要重试':`找到 ${counts().change+counts().confirm} 处需要关注的内容`,'先浏览清单，点击具体内容查看原文与修改建议。']};
 const [eyebrow,title,subtitle]=labels[stage];$('#pageEyebrow').textContent=eyebrow;$('#pageTitle').textContent=title;$('#pageSubtitle').textContent=subtitle;
}
function setStage(next,route=true){
 if(busy&&next!=='results')return;
 if(next==='configure'&&!doc)next='upload';if(next==='results'&&!snapshot)next=doc?'configure':'upload';
 stage=next;document.body.dataset.stage=stage;
 $$('[data-view]').forEach(view=>view.classList.toggle('hidden',view.dataset.view!==stage));
 if(route&&location.hash!=='#'+stage)window.history.pushState({stage},'', '#'+stage);
 updateSteps();updatePageHeading();window.scrollTo({top:0,behavior:'instant'});
}
function showAdvanced(){
 const c=config();openDialog('检查范围与例外','按需补充',`<div class="dialog-pad advanced-form"><p class="dialog-intro">限定这次检查的内容，或告诉我们哪些内容需要保留。</p><label class="field-label" for="scopeEdit">适用范围</label><input id="scopeEdit" value="${h(c.scope)}" placeholder="例如：仅检查平台功能名称"><label class="field-label" for="exceptionsEdit">不需要修改的情况</label><textarea id="exceptionsEdit" rows="4" placeholder="例如：通用技术概念、网址和代码参数保持不变">${h(c.exceptions)}</textarea><p class="quiet-note">可以留空。复杂范围与例外仍需人工核对。</p></div><div class="dialog-footer"><button class="btn ghost" data-action="close-dialog">取消</button><button class="btn primary" data-action="save-advanced">保存设置</button></div>`);
}
function updateAdvancedSummary(){const c=config();$('#advancedSummary').textContent=c.scope||c.exceptions?'已补充检查条件 · 点击查看或修改':'有些内容需要保留？在这里补充说明。';}
function showDetail(){
 renderDetail();const rows=visibleRows(),i=rows.findIndex(r=>r.id===selected);$('#detailPosition').textContent=`${i+1} / ${rows.length}`;$('#previousResult').disabled=i<=0;$('#nextResult').disabled=i>=rows.length-1;
 if(!$('#resultDialog').open)$('#resultDialog').showModal();
}
function startDemo(){
 doc=createDemo();setConfig(demoConfig);results=[];snapshot=null;selected=null;processed=0;failed=[];stale=false;simulateFailure=false;$('#staleBanner').classList.add('hidden');$('#fileError').classList.add('hidden');renderDocument();renderFilters();renderResults();closeDialog();setStage('configure');
}
function counts(){return {all:results.length,change:results.filter(r=>r.status==='change').length,confirm:results.filter(r=>r.status==='confirm').length,keep:results.filter(r=>r.status==='keep').length};}
function renderDocument(){
 $('#uploadedContent').classList.toggle('hidden',!doc);$('#dropzone').classList.toggle('hidden',!!doc);$('#previewDoc').disabled=!doc||busy;$('#continueButton').disabled=!doc||busy;
 $('#configDocument').innerHTML=doc?`<span class="word-icon">W</span><div><strong>${h(doc.name)}</strong><span>${doc.articles.length} 篇教程 · ${doc.demo?'示例文档':doc.confirmed?'目录已确认':'目录待确认'}</span></div><button class="text-button" data-nav="document">查看目录</button>`:'';
 if(!doc)return;
 $('#fileCard').innerHTML=`<span class="word-icon">W</span><div class="min-w-0 flex-1"><div class="file-name" title="${h(doc.name)}">${h(doc.name)}</div><div class="file-sub">${doc.demo?'内置示例':(doc.size/1024).toFixed(1)+' KB'} · <span class="check">已解析</span></div></div><button class="icon-btn" data-action="remove-file" aria-label="移除文档" ${busy?'disabled':''}>${icon('close')}</button>`;
 $('#docMetrics').innerHTML=`<span><b>${doc.articles.length}</b>篇教程</span><span><b>${doc.blocks.length}</b>个段落</span><span><b>${new Set(doc.blocks.filter(b=>b.table).map(b=>b.table)).size}</b>个表格</span>`;
 $('#previewDoc').innerHTML=`${icon('book')}查看与调整目录`;
}
function visibleRows(){const search=$('#search').value.trim().toLowerCase(),article=$('#articleFilter').value;return results.filter(r=>(filter==='all'||filter==='actionable'&&r.status!=='keep'||r.status===filter)&&(article==='all'||r.articleId===article)&&(!search||[r.text,r.suggestion,r.articleTitle,r.location,r.id].some(t=>t.toLowerCase().includes(search))));}
function renderStats(){const n=counts();
 $('#statusTabs').innerHTML=[['actionable','需要关注',n.change+n.confirm],['change','建议修改',n.change],['confirm','待确认',n.confirm],['keep','无需修改',n.keep],['all','全部',n.all]].map(([key,label,count])=>`<button role="tab" aria-selected="${key===filter}" data-filter="${key}" class="${key===filter?'selected':''}">${label}<span class="tab-count">${count}</span></button>`).join('');
}
function renderProgress(){
 const total=snapshot?.doc.articles.length||doc?.articles.length||0;
 if(!snapshot){$('#progressArea').innerHTML=`<div class="progress-line"><span>准备好文档与变更要求后，即可开始定位</span></div>`;return;}
 const partial=failed.length>0;
 $('#progressArea').innerHTML=`<div class="progress-line"><span class="progress-state ${busy?'running':''}">${icon(busy?'refresh':partial?'alert':'check',busy?'spin':'')}<span>${busy?'正在逐篇分析':partial?'部分完成':results.length?'分析完成':'分析完成 · 未发现相关内容'}</span><span class="muted">· ${processed} / ${total} 篇教程${busy?'':partial?'已完成':'已检查'}</span></span>${partial&&!busy?`<button class="text-button" id="retryFailed">重试失败项 (${failed.length})</button>`:`<span>${snapshot.doc.demo?'示例数据 · ':''}${busy?'保留已完成结果':'本地规则分析'}</span>`}</div>${busy?`<div class="progress-track"><div style="width:${total?processed/total*100:0}%"></div></div>`:''}${partial?`<div class="field-error">未完成：${failed.map(a=>h(a.title)).join('、')}。${simulateFailure?'这是主动开启的失败状态演示。':'可重试，已完成结果保留。'}</div>`:''}`;
}
function renderFilters(){const prev=$('#articleFilter').value;$('#articleFilter').innerHTML='<option value="all">全部教程</option>'+ (snapshot?.doc.articles||doc?.articles||[]).map(a=>`<option value="${a.id}">${h(a.title)}</option>`).join('');if([...$('#articleFilter').options].some(o=>o.value===prev))$('#articleFilter').value=prev;}
function highlight(text,term,kind='old'){if(!term)return h(text);let output='',last=0;for(const m of text.matchAll(termRegex(term))){output+=h(text.slice(last,m.index))+`<mark class="${kind}-highlight">${h(m[0])}</mark>`;last=m.index+m[0].length;}return output+h(text.slice(last));}
function renderList(){
 const rows=visibleRows();if(!rows.some(r=>r.id===selected))selected=rows[0]?.id||null;
 $('#listCount').textContent=`${rows.length} 条定位结果`;$('#resultFooterCount').textContent=`显示 ${rows.length} / ${results.length} 条`;
 $('#resultList').innerHTML=rows.length?rows.map(r=>`<button class="result-item" data-result="${r.id}" aria-label="查看 ${h(r.id)} ${h(r.articleTitle)} 的修改建议"><span class="result-file-icon">${icon('file')}</span><div class="result-main"><h3>${h(r.articleTitle)}</h3><p>${highlight(r.text,r.old)}</p><div class="location">${h(r.location)}</div></div><div class="result-row-status">${badge(r.status)}<span class="result-open">查看建议 ${icon('arrow')}</span></div></button>`).join(''):`<div class="empty-state">${icon('search')}<strong>${!snapshot?'等待开始分析':results.length?'没有符合筛选的结果':'未发现相关内容'}</strong>${!snapshot?'上传教程，填写变更要求后开始。':results.length?'试试切换状态或清空搜索条件。':'可检查旧内容或补充变更说明后重新分析。'}${results.length?'<button class="text-button" data-action="reset-filters">清空筛选</button>':''}</div>`;
 renderDetail();
}
function renderDetail(){
 const r=results.find(r=>r.id===selected);if(!r){$('#detailPanel').innerHTML=`<div class="empty-detail"><div class="empty-state">${icon('scan')}<strong>每一条建议，都有原文依据</strong>选择一条结果，查看具体位置与修改建议。</div></div>`;return;}
 $('#detailPanel').innerHTML=`<div class="detail-title"><span>内容详情 <span style="color:#4d576b">/</span> ${r.id}</span>${badge(r.status)}</div><h3>${h(r.articleTitle)}</h3><div class="detail-location">${icon('file')}<span>${h(r.articleId)} <span style="color:#465169">›</span> ${h(r.location)}</span></div><div class="detail-rule"></div><div class="quote-label"><span>原文引用</span><button class="icon-btn" data-copy="original" title="复制原文" aria-label="复制原文">${icon('copy')}</button></div><div class="quote-box">${highlight(r.text,r.old)}</div><div class="quote-label"><span>${r.status==='keep'?'保留原文':r.status==='confirm'?'需要确认':'建议改写'}</span>${r.status!=='confirm'?`<button class="icon-btn" data-copy="suggestion" title="复制建议" aria-label="复制建议">${icon('copy')}</button>`:''}</div><div class="quote-box ${r.status==='change'?'rewrite':''}">${highlight(r.suggestion,r.status==='change'?r.next:'','new')}</div><div class="reason-box">${icon(r.status==='confirm'?'alert':'spark')}<div><strong>判断依据</strong>${h(r.reason)}</div></div><div class="basis">变更依据：${h(r.basis)}${r.articleLink?'<br>文档中的链接：'+h(r.articleLink):''}</div><div class="detail-actions"><button class="btn outline" data-action="context">${icon('book')}查看原文</button><button class="btn outline accent" data-copy="suggestion">${icon('copy')}${r.status==='confirm'?'复制确认事项':'复制修改建议'}</button></div>`;
}
function renderResults(){renderStats();renderProgress();renderList();$('#demoBadge').classList.toggle('hidden',!snapshot?.doc.demo);const terms=snapshot?inferTerms(snapshot.config):null;$('#taskMeta').textContent=snapshot?(terms.old&&terms.next?terms.old+' → '+terms.next+' · ': '')+(snapshot.doc.demo?'教程名称更新':snapshot.doc.name):'创建任务，开始你的第一次内容检查';$('#exportButton').disabled=busy||!snapshot;$('#editChange').disabled=busy;updatePageHeading();}
function resetFilters(){filter='actionable';$('#search').value='';$('#articleFilter').value='all';renderStats();renderList();}
function setBusy(value){busy=value;$$('#changeForm input,#changeForm textarea,#changeForm button').forEach(el=>el.disabled=value);$('#newTask').disabled=value;$('#fileInput').disabled=value;$('#previewDoc').disabled=value||!doc;$('#analyzeButton').innerHTML=value?`${icon('refresh','spin')}<span>正在分析…</span>`:`${icon('spark')}<span>开始定位</span>`;renderDocument();}
function saveHistory(){const entry={id:Date.now(),date:new Date().toLocaleString('zh-CN',{hour12:false}),snapshot:clone(snapshot),results:clone(results),failed:clone(failed),processed};history.unshift(entry);}
async function analyze(retry=false){
 if(busy)return;
 if(!retry){if(!doc){toast('请先上传 Word 文档，或载入示例任务。');$('#dropzone').focus();return;}if(!config().description){$('#description').focus();$('#changeForm').reportValidity();return;}if(!doc.confirmed){showDocument();toast('请先核对识别出的教程目录，再确认并开始分析。');return;}}
 const articles=retry?clone(failed):clone(doc.articles);
 if(!retry){snapshot={doc:clone(doc),config:config()};results=[];selected=null;processed=0;stale=false;filter='actionable';failed=[];$('#staleBanner').classList.add('hidden');$('#search').value='';renderFilters();$('#articleFilter').value='all';}
 else {failed=[];simulateFailure=false;}
 setBusy(true);setStage('results');renderResults();
 for(const a of articles){await pause(snapshot.doc.demo?180:50);try{if(simulateFailure&&snapshot.doc.demo&&a.id===snapshot.doc.articles[2]?.id)throw new Error('模拟分析失败');results.push(...analyzeArticle(a,snapshot.doc.blocks,snapshot.config));processed++;}catch(error){failed.push(a);}renderResults();}
 results.sort((a,b)=>snapshot.doc.blocks.findIndex(x=>x.id===a.blockId)-snapshot.doc.blocks.findIndex(x=>x.id===b.blockId));
 setBusy(false);renderResults();updateSteps();saveHistory();toast(failed.length?'部分完成，可重试未完成的教程。':`分析完成，定位到 ${results.length} 条相关内容。`);
}
function openDialog(title,eyebrow,body){$('#dialogTitle').textContent=title;$('#dialogEyebrow').textContent=eyebrow;$('#dialogBody').innerHTML=body;if(!$('#mainDialog').open)$('#mainDialog').showModal();}
function closeDialog(){$('#mainDialog').close();}
function showDocument(focus=null,fromResult=false){
 const source=fromResult?snapshot?.doc:doc;if(!source){toast('还没有可预览的文档，请先上传。');return;}
 dialogFocus=focus;const index=focus?source.articles.findIndex(a=>source.blocks.some(b=>b.id===focus&&b.articleId===a.id)):dialogArticle;dialogArticle=Math.max(0,Math.min(index,source.articles.length-1));
 const a=source.articles[dialogArticle];
 const readOnly=fromResult||busy;
 openDialog(fromResult?'原文与上下文':'文档预览与目录确认',fromResult?'SOURCE CONTEXT':'DOCUMENT PREVIEW',`${source.fallback?'<div class="notice warning" style="margin:16px">未识别出可靠的标题层级，当前按整份文档展示。可使用“设为教程起点”手动划分。</div>':''}${fromResult&&stale?'<div class="notice warning" style="margin:16px">此处显示的是上一次分析时的文档快照。</div>':''}<div class="doc-layout"><aside class="doc-toc"><h3>${source.articles.length} 篇教程 <span class="muted" style="font-size:13px">· ${h(source.name)}</span></h3>${source.articles.map((article,i)=>`<button class="toc-item ${i===dialogArticle?'active':''}" data-toc="${i}" data-readonly="${fromResult}">${h(article.title)}<small>${article.id} · ${article.end-article.start} 个段落</small></button>`).join('')}</aside><section class="doc-content"><div class="doc-title-edit">${readOnly?`<h3>${h(a.title)}</h3>`:`<input id="editTitle" value="${h(a.title)}" aria-label="教程标题"><button class="btn secondary" id="saveTitle">保存标题</button>`}</div><p class="scope-note">${readOnly?'原文来自文档快照，定位编号在本任务内保持稳定。':'修改识别标题或调整教程起点，仅影响目录，不会更改原始 Word 文件。'}</p>${!readOnly&&a.start>0?'<button class="text-button" id="mergePrevious" style="margin-top:12px">合并至上一篇教程</button>':''}${source.blocks.slice(a.start,a.end).map(b=>`<div class="doc-paragraph ${b.id===focus?'focus':''}" id="block-${b.id}"><small><span>${h(b.location)}</span>${!readOnly&&source.blocks.indexOf(b)!==a.start?`<button class="text-button" data-split="${b.id}">设为教程起点</button>`:''}</small>${h(b.text)}</div>`).join('')}</section></div><div class="dialog-footer"><span>${source.blocks.length} 个段落 · 未检查图片、文本框及批注</span><button class="btn secondary" ${readOnly?'data-action="close-dialog"':'id="confirmDirectory"'}>${readOnly?'完成查看':stage==='upload'?'确认并继续':'确认目录'}</button></div>`);
 if(focus)requestAnimationFrame(()=>$('#block-'+focus)?.scrollIntoView({block:'center'}));
}
function rebuildDoc(starts,titles={}){const previous=Object.fromEntries(doc.articles.map(a=>[a.start,a.title]));doc.articles=groupBlocks(doc.blocks,starts,{...previous,...titles});doc.starts=doc.articles.map(a=>a.start);doc.confirmed=false;markStale();renderDocument();}
function showHelp(){openDialog('使用指南','A LITTLE HELP',`<div class="dialog-pad"><div class="help-grid"><div class="help-card"><h3>01 / 导入并确认目录</h3><p>上传一个 .docx 文档。工具读取标题、段落、列表和普通表格；按照最高标题层级识别教程。可修改标题、拆分教程或合并至上一篇。</p></div><div class="help-card"><h3>02 / 描述这一项变更</h3><p>填写变更说明和新旧内容，并补充范围、例外情况。明确的新旧内容支持局部替换；信息不足的操作描述进入“待确认”。</p></div><div class="help-card"><h3>03 / 核对每一处原文</h3><p>默认显示建议修改和待确认。可按教程、状态及关键词筛选；点击结果查看改写与原因，点击“查看原文”阅读上下文。</p></div><div class="help-card"><h3>04 / 复制或导出清单</h3><p>逐条复制原文与建议，或导出全部/筛选结果为 CSV。原 Word 保持不变，由维护人员回到内部平台完成更新。</p></div></div><div class="notice info" style="margin-top:20px">${icon('info')}<span>此版本是可交互的前端原型。文档在浏览器内解析，分析采用本地规则，不具备 AI 语义理解能力。任务记录仅保留在当前页面会话。</span></div><div class="help-card"><h3>原型状态体验</h3><p>示例任务支持演示完整结果、部分失败与重试；新建空白任务可体验上传、校验和空状态。</p><div class="flex gap-3 flex-wrap mt-4"><button class="btn secondary" data-action="demo">载入示例任务</button><button class="btn outline" data-action="demo-failure">演示部分失败</button><button class="btn outline" data-action="blank">新建空白任务</button><button class="btn outline" data-action="download-sample">下载示例 Word</button></div></div><p class="scope-note" style="margin-top:16px">快捷键：/ 搜索结果 · ⌘ / Ctrl + Enter 开始分析 · Esc 关闭弹窗</p></div>`);}
function showHistory(){openDialog('任务记录','TASK HISTORY',`<div class="dialog-pad">${history.length?'<p class="scope-note" style="margin:0 0 16px">当前会话的任务快照；刷新或关闭页面后不会保留。上传的文档不会存储到服务器。</p>'+history.map(item=>`<div class="history-item">${icon('clock')}<div><h3>${h(item.snapshot.config.description)}</h3><p>${h(item.snapshot.doc.name)} · ${item.date} · ${item.results.length} 条结果${item.failed.length?' · 部分完成':''}</p></div><button class="btn secondary" data-history="${item.id}">查看任务</button></div>`).join(''):'<div class="empty-state">'+icon('clock')+'<strong>还没有任务记录</strong>完成一次分析后，这里会保留本次会话的结果。</div>'}</div>`);}
function newTaskDialog(){openDialog('开始新的变更定位','NEW TASK',`<div class="dialog-pad"><p class="muted" style="margin-bottom:20px">上传新的教程集合，或使用示例探索完整工作流程。当前已分析的结果可从任务记录查看。</p><div class="help-grid"><button class="help-card text-left" data-action="blank"><h3>${icon('plus')} 新建空白任务</h3><p>上传自己的 Word 教程集合，从一项变更开始。</p></button><button class="help-card text-left" data-action="demo"><h3>${icon('spark')} 体验示例任务</h3><p>查看 Agent → Skills 更名示例，体验定位与导出。</p></button></div></div>`);}
function blankTask(){doc=null;results=[];snapshot=null;failed=[];processed=0;selected=null;stale=false;simulateFailure=false;setConfig({});$('#staleBanner').classList.add('hidden');$('#fileError').classList.add('hidden');$('#search').value='';filter='actionable';renderDocument();renderFilters();renderResults();updateSteps();closeDialog();setStage('upload');toast('上传一个 Word 文档，开始新任务。');}
const demoConfig={description:'平台功能「Agent」正式更名为「Skills」，请定位教程中需要同步更新的内容。',old:'Agent',next:'Skills',scope:'平台功能名称、操作入口及相关说明',exceptions:'通用技术概念「AI Agent」、链接地址和代码参数保持不变。'};
function loadDemo(failure=false){doc=createDemo();setConfig(demoConfig);snapshot={doc:clone(doc),config:config()};results=doc.articles.flatMap(a=>analyzeArticle(a,doc.blocks,config()));processed=doc.articles.length;failed=[];selected=results.find(r=>r.location!=='教程标题')?.id||null;stale=false;filter='actionable';simulateFailure=failure;$('#search').value='';$('#staleBanner').classList.add('hidden');$('#fileError').classList.add('hidden');renderDocument();renderFilters();$('#articleFilter').value='all';renderResults();updateSteps();closeDialog();setStage('results');if(failure)analyze();else saveHistory();}
async function upload(file){if(!file||busy)return;$('#fileError').classList.add('hidden');setBusy(true);const original=$('#dropzone').innerHTML;$('#dropzone').innerHTML=`<div class="upload-icon">${icon('refresh','spin')}</div><strong>正在读取 Word 文档</strong><small>解析标题、正文与表格文字</small>`;try{const parsed=await parseDocx(file);doc=parsed;markStale();setBusy(false);renderDocument();toast(`已读取 ${doc.articles.length} 篇教程，请确认目录。`);dialogArticle=0;updateSteps();}catch(e){$('#fileError').textContent=e.message||'解析失败，请使用有效的 Word 文档重试。';$('#fileError').classList.remove('hidden');toast('文档读取失败，请查看上传区提示。');}finally{$('#dropzone').innerHTML=original;setBusy(false);renderResults();$('#fileInput').value='';}}
async function copyText(text){try{await navigator.clipboard.writeText(text);toast('已复制到剪贴板');}catch{openDialog('复制内容','COPY CONTENT',`<div class="dialog-pad"><p class="muted mb-4">浏览器未授予剪贴板权限，可选中下方内容手动复制。</p><textarea id="manualCopy" rows="7" readonly>${h(text)}</textarea></div>`);$('#manualCopy').select();}}
function download(content,name,type){const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),5000);}
async function exportCSV(mode){$('#exportMenu').classList.add('hidden');if(!snapshot)return;const rows=mode==='all'?results:visibleRows();if(!rows.length){toast('没有可以导出的结果。');return;}download(csvString(rows,snapshot.doc.name,snapshot.config),`${snapshot.doc.name.replace(/\.docx$/i,'')}_变更清单${stale?'_上次任务':''}${failed.length?'_部分完成':''}.csv`,'text/csv;charset=utf-8');toast(`已导出 ${rows.length} 条${mode==='all'?'全部':'筛选'}结果${stale?'（上次任务快照）':''}。`);}
async function downloadSample(){if(!window.JSZip){toast('Word 组件不可用，请刷新后重试。');return;}const sample=createDemo(),zip=new JSZip();const xmlEscape=s=>h(s).replace(/&#39;/g,'&apos;');zip.file('[Content_Types].xml','<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');zip.folder('_rels').file('.rels','<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');zip.folder('word').file('document.xml',`<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${sample.blocks.map(b=>`<w:p>${b.heading?`<w:pPr><w:outlineLvl w:val="${b.heading-1}"/></w:pPr>`:''}<w:r><w:t xml:space="preserve">${xmlEscape(b.text)}</w:t></w:r></w:p>`).join('')}<w:sectPr/></w:body></w:document>`);download(await zip.generateAsync({type:'uint8array'}),'Trace_示例教程合集.docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document');toast('示例 Word 已下载，可重新上传测试。');}
$('#changeForm').addEventListener('submit',e=>{e.preventDefault();analyze();});
$$('#changeForm input,#changeForm textarea').forEach(el=>el.addEventListener('input',markStale));
$('#description').addEventListener('input',()=>{ // A changed natural-language request must not keep an obsolete explicit mapping.
 $('#oldText').value='';$('#newText').value='';
});
$('#fillExample').addEventListener('click',()=>{setConfig(demoConfig);markStale();toast('已填入名称变更示例，请重新分析。');});
$('#newTask').addEventListener('click',blankTask);$('#previewDoc').addEventListener('click',()=>{dialogArticle=0;showDocument();});$('#closeDialog').addEventListener('click',closeDialog);
$('#mainDialog').addEventListener('click',e=>{if(e.target===$('#mainDialog')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)closeDialog();}});
$('#continueButton').addEventListener('click',()=>{if(!doc||busy)return;if(!doc.confirmed){showDocument();return;}setStage('configure');});
$('#closeDetail').addEventListener('click',()=>$('#resultDialog').close());
for(const [id,offset] of [['previousResult',-1],['nextResult',1]])$('#'+id).addEventListener('click',()=>{const rows=visibleRows(),i=rows.findIndex(r=>r.id===selected);if(rows[i+offset]){selected=rows[i+offset].id;showDetail();$('#detailPanel').scrollTop=0;}});
$('#resultDialog').addEventListener('click',e=>{if(e.target===$('#resultDialog')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)$('#resultDialog').close();}});
$('#exportButton').addEventListener('click',()=>$('#exportMenu').classList.toggle('hidden'));
$('#search').addEventListener('input',renderList);$('#articleFilter').addEventListener('change',renderList);
$('#fileInput').addEventListener('change',e=>upload(e.target.files[0]));$('#dropzone').addEventListener('click',()=>{if(!busy)$('#fileInput').click();});$('#dropzone').addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();if(!busy)$('#fileInput').click();}});
for(const event of ['dragover','dragenter'])$('#dropzone').addEventListener(event,e=>{e.preventDefault();if(!busy)$('#dropzone').classList.add('dragover');});for(const event of ['dragleave','drop'])$('#dropzone').addEventListener(event,e=>{e.preventDefault();$('#dropzone').classList.remove('dragover');});$('#dropzone').addEventListener('drop',e=>{if(e.dataTransfer.files.length!==1){toast('每个任务只能上传一个 .docx 文档。');return;}upload(e.dataTransfer.files[0]);});
$('body').addEventListener('click',e=>{
 const t=e.target.closest('button,a');if(!t)return;
 if(t.dataset.filter){filter=t.dataset.filter;renderStats();renderList();}
 if(t.dataset.result){selected=t.dataset.result;showDetail();}
 if(t.dataset.copy){const r=results.find(r=>r.id===selected);if(r)copyText(t.dataset.copy==='original'?r.text:r.suggestion);}
 if(t.dataset.export)exportCSV(t.dataset.export);
 if(t.dataset.toc!==undefined){dialogArticle=Number(t.dataset.toc);showDocument(null,t.dataset.readonly==='true');}
 if(t.dataset.split){const i=doc.blocks.findIndex(b=>b.id===t.dataset.split);rebuildDoc([...doc.starts,i]);dialogArticle=doc.articles.findIndex(a=>a.start===i);showDocument();toast('已设为新教程起点，请确认目录。');}
 if(t.id==='saveTitle'){const title=$('#editTitle').value.trim();if(!title){toast('教程标题不能为空。');return;}doc.articles[dialogArticle].title=title;doc.confirmed=false;markStale();renderDocument();showDocument();toast('已更新识别标题，原文保持不变。');}
 if(t.id==='mergePrevious'){const start=doc.articles[dialogArticle].start;rebuildDoc(doc.starts.filter(s=>s!==start));dialogArticle--;showDocument();}
 if(t.id==='confirmDirectory'){doc.confirmed=true;renderDocument();closeDialog();if(stage==='upload')setStage('configure');toast('目录已确认。');}
 if(t.id==='retryFailed')analyze(true);
 if(t.dataset.history){const item=history.find(x=>x.id===Number(t.dataset.history));if(!item||busy)return;doc=clone(item.snapshot.doc);snapshot=clone(item.snapshot);results=clone(item.results);failed=clone(item.failed);processed=item.processed;setConfig(snapshot.config);stale=false;selected=null;filter='actionable';$('#search').value='';$('#staleBanner').classList.add('hidden');renderDocument();renderFilters();renderResults();closeDialog();setStage('results');toast('已打开任务快照。');}
 if(t.dataset.nav){if(t.dataset.nav==='document')showDocument();else if(t.dataset.nav==='history')showHistory();}
 if(t.dataset.stage){e.preventDefault();setStage(t.dataset.stage);}
 const action=t.dataset.action;if(!action)return;
 if(action==='demo-start'&&!busy)startDemo();if(action==='advanced')showAdvanced();if(action==='save-advanced'){$('#scope').value=$('#scopeEdit').value.trim();$('#exceptions').value=$('#exceptionsEdit').value.trim();markStale();updateAdvancedSummary();closeDialog();toast('检查范围已保存。');}
 if(action==='help')showHelp();if(action==='close-dialog')closeDialog();if(action==='demo'&&!busy){loadDemo();toast('已载入示例任务。');}if(action==='blank'&&!busy)blankTask();if(action==='demo-failure'&&!busy)loadDemo(true);if(action==='download-sample')downloadSample();if(action==='reset-filters')resetFilters();if(action==='remove-file'&&!busy){doc=null;markStale();renderDocument();toast('已移除当前文档，上次任务结果仍可查看。');}if(action==='context'){const r=results.find(r=>r.id===selected);if(r)showDocument(r.blockId,true);}
});
document.addEventListener('click',e=>{if(!e.target.closest('.export-wrap'))$('#exportMenu').classList.add('hidden');});
document.addEventListener('keydown',e=>{if(e.key==='Escape'){$('#exportMenu').classList.add('hidden');}if(e.key==='/'&&!/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)&&!$('#mainDialog').open&&!$('#resultDialog').open&&stage==='results'){e.preventDefault();$('#search').focus();}if(e.key==='Enter'&&(e.metaKey||e.ctrlKey)&&!$('#mainDialog').open&&!$('#resultDialog').open&&stage==='configure'){e.preventDefault();analyze();}});
renderDocument();renderFilters();renderResults();updateAdvancedSummary();setStage('upload',false);window.history.replaceState({stage:'upload'},'','#upload');
window.addEventListener('popstate',()=>setStage(['upload','configure','results'].includes(location.hash.slice(1))?location.hash.slice(1):'upload',false));
// The local preview server supplies this endpoint; static hosting works without it.
let revision;setInterval(async()=>{try{const response=await fetch('/__revision',{cache:'no-store'});if(!response.ok)return;const {version}=await response.json();if(revision&&revision!==version&&!busy&&!$('#mainDialog').open&&!$('#resultDialog').open)location.reload();revision=version;}catch{}},1600);
