export const STATUS = {change:'建议修改',confirm:'待确认',keep:'无需修改'};
export const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const escRE = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function termRegex(term, flags='gi') {
  if (!term.trim()) return /(?!) /g;
  const left=/^[A-Za-z0-9_]/.test(term)?'(?<![A-Za-z0-9_])':'';
  const right=/[A-Za-z0-9_]$/.test(term)?'(?![A-Za-z0-9_])':'';
  return new RegExp(left+escRE(term)+right,flags);
}
export function inferTerms(config) {
  let old=config.old.trim(), next=config.next.trim();
  const match=config.description.match(/[「“"']?([A-Za-z][\w .-]*?)[」”"']?\s*(?:正式)?(?:更名为|改名为|重命名为|改为|→)\s*[「“"']?([A-Za-z][\w.-]*)/i);
  if(match){old ||= match[1].trim();next ||= match[2].trim();}
  return {old,next};
}
export function analyzeArticle(article, blocks, config) {
  const {old,next}=inferTerms(config);
  const rows=[];
  for(const block of blocks.filter(b=>b.articleId===article.id)){
    const exact=old&&termRegex(old).test(block.text);
    const technical=old&&block.text.split(/[^A-Za-z0-9]+/).some(part=>part.toLowerCase()===old.toLowerCase())&&/https?:|`|_/.test(block.text);
    const operation=/入口|路径|操作|流程|步骤/.test(config.description)&&/点击|进入|打开|选择|导航|菜单|页面|按钮|步骤/.test(block.text);
    if(!exact&&!operation&&!technical)continue;
    let status='confirm',reason='',suggestion='';
    const protectedParts=[...block.text.matchAll(/https?:\/\/[^\s<>，。；）]+|`[^`]+`|\b\w+(?:_\w+)+\b|\/[A-Za-z0-9_/?=&.-]+/g)].map(m=>m[0]);
    const hasProtected=old&&protectedParts.some(s=>termRegex(old).test(s)||s.toLowerCase().includes(old.toLowerCase()));
    const stripped=protectedParts.reduce((s,p)=>s.replace(p,''),block.text);
    const onlyProtected=hasProtected&&!termRegex(old).test(stripped);
    const concept=old&&new RegExp('AI\\s+'+escRE(old),'i').test(block.text)&&/概念|智能体|一类|通用|技术|自主|系统/.test(block.text);
    const exclusions=[...config.exceptions.matchAll(/[「“"']([^」”"']+)[」”"']/g)].map(m=>m[1]);
    const excluded=exclusions.some(term=>block.text.toLowerCase().includes(term.toLowerCase()));
    const unclearException=config.exceptions.trim()&&!/通用|AI Agent|链接|地址|网址|代码|参数|无需|不需要|保持不变/.test(config.exceptions)&&exclusions.length===0;
    if(onlyProtected){status=/链接|地址|网址|代码|参数/.test(config.exceptions)?'keep':'confirm';reason=status==='keep'?'命中内容位于链接或代码参数中，符合本次明确保留的例外范围。':'命中内容位于链接或代码参数中。显示名称更改不能证明技术标识也已更改，请核对。';suggestion=block.text;}
    else if(concept||excluded){status='keep';reason=concept?'此处描述的是 AI Agent 的通用技术概念，不是平台功能名称，符合保留范围。':'此处包含你明确列出的保留内容，本轮不作替换。';suggestion=block.text;}
    else if(exact&&next&&!hasProtected&&!unclearException){status='change';reason='原文包含指定的旧内容，与本次变更直接对应。建议仅替换相关文字，保留其余内容。';suggestion=block.text.replace(termRegex(old),()=>next);}
    else {reason=hasProtected?'同一段落包含功能名称与链接或代码，请分别确认显示名称和技术标识的适用范围。':unclearException?'已定位相关内容，但自定义例外条件需要人工判断，请先确认该段是否适用。':!next?'已定位可能受影响的内容，但尚未提供明确的新名称或新操作路径。':'此处涉及相关操作，但没有明确出现旧内容。请确认新流程是否仍适用。';suggestion='请确认'+(!next?'新的名称或完整操作路径，再填写建议。':'本段的适用范围和最新操作步骤。');}
    rows.push({id:'R-'+block.id.replace('B',''),blockId:block.id,articleId:article.id,articleTitle:article.title,articleLink:article.link||'',location:block.location,text:block.text,status,reason,suggestion,basis:config.description,old,next,scope:config.scope,exceptions:config.exceptions});
  }
  return rows;
}
export function groupBlocks(blocks, starts, titles={}) {
  const indices=[...new Set([0,...starts])].filter(i=>i>=0&&i<blocks.length).sort((a,b)=>a-b);
  const articles=indices.map((start,i)=>({id:'T-'+blocks[start].id.slice(1),title:titles[start]||blocks[start].text, start,end:indices[i+1]??blocks.length,link:''}));
  for(const a of articles){
    let section='正文';
    for(let i=a.start;i<a.end;i++){
      const b=blocks[i];b.articleId=a.id;
      if(b.heading&&i!==a.start)section=b.text;
      b.location=i===a.start&&b.heading?'教程标题':b.table?`${section} · 表格 ${b.table} · 第 ${b.row} 行 / 第 ${b.col} 列 · ${b.id.replace('B','P')}`:`${section} · ${b.id.replace('B','P')}`;
      if(!a.link&&b.links?.length)a.link=b.links[0];
    }
  }
  return articles;
}
export function csvString(rows, fileName, config){
  const headers=['结果编号','文件名','变更说明','教程编号','教程标题','原文章链接或ID','具体位置','原文引用','判断状态','修改原因','建议改写','变更依据','适用范围','例外情况'];
  const cell=v=>{let s=String(v??'');if(/^[\s]*[=+@-]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"'};
  return '\uFEFF'+[headers,...rows.map(r=>[r.id,fileName,config.description,r.articleId,r.articleTitle,r.articleLink,r.location,r.text,STATUS[r.status],r.reason,r.suggestion,r.basis,config.scope,config.exceptions])].map(r=>r.map(cell).join(',')).join('\r\n');
}
export function createDemo(){
  const definitions=[
    ['Agent 使用指南',[['开始使用','进入 Agent 功能页面，点击「创建 Agent」按钮，即可开始配置。','为你的 Agent 设置名称与描述，便于团队成员快速了解它的用途。','完成配置后，点击「发布」，将 Agent 添加到工作空间。']]],
    ['使用 Agent 搭建工作流',[['创建工作流','在左侧导航栏中选择「Agent」，进入工作流管理页面。','点击右上角的「新建」，选择适合当前任务的工作流模板。','你可以为 Agent 添加工具和知识库，完成后保存设置。']]],
    ['团队协作与权限管理',[['成员与权限','管理员可以在 Agent 设置中管理成员的查看和编辑权限。','进入 Agent 功能页面，点击「创建 Agent」按钮，即可开始配置。','共享前请核对成员名单，确认工作空间中的权限设置。']]],
    ['智能体基础知识',[['理解智能体','AI Agent 是一类能够自主规划并执行任务的智能体。','与传统自动化不同，AI Agent 这一通用技术概念强调自主决策能力。','在本平台中，你可以通过 Agent 功能创建自己的智能体。']]],
    ['开发者接入指南',[['接口与配置','接口地址：https://example.com/api/agent/create ，用于发起创建请求。','在配置文件中保留参数 `agent_id`，用于标识当前智能体。','进入 Agent 管理页面，复制该实例的标识。']]],
    ['常见问题与排查',[['操作问题','找不到 Agent 入口时，请联系管理员确认你是否拥有访问权限。','为什么 Agent 没有出现在工作空间？请先检查发布状态。','如果点击后没有响应，请检查浏览器网络连接。']]]
  ];
  let blocks=[],starts=[];
  const push=(text,heading=0)=>blocks.push({id:'B'+String(blocks.length+1).padStart(3,'0'),text,heading,links:[]});
  definitions.forEach(([title,sections])=>{starts.push(blocks.length);push(title,1);sections.forEach(([title,...paragraphs])=>{push(title,2);paragraphs.forEach(t=>push(t));});});
  const articles=groupBlocks(blocks,starts);
  // Demonstrate an uncertain workflow description without inventing a new path.
  const uncertain=blocks.find(b=>b.text.startsWith('点击右上角'));
  uncertain.text='在 Agent 菜单中点击「新建」，也可以使用 /agent/create 路径直接进入。';
  blocks.find(b=>b.text.startsWith('进入 Agent 管理')).text='进入 Agent 管理页面，复制 `agent_id` 参数用于后续配置。';
  return {name:'平台使用教程合集_v2.3.docx',size:248832,blocks,articles,starts,demo:true,confirmed:true};
}
