import {groupBlocks} from './engine.mjs';
const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const elements=(node,name)=>Array.from(node.getElementsByTagNameNS(W,name));
function parseXML(text){const xml=new DOMParser().parseFromString(text,'application/xml');if(xml.querySelector('parsererror'))throw new Error('Word 文档 XML 结构损坏，无法读取。');return xml;}
function textOf(node){return elements(node,'t').filter(t=>{let p=t.parentElement;while(p&&p!==node){if(p.localName==='txbxContent')return false;p=p.parentElement;}return true;}).map(t=>t.textContent).join('');}
export async function parseDocx(file){
 if(!/\.docx$/i.test(file.name))throw new Error('文件格式不支持，请上传 .docx 格式的 Word 文档。');
 if(file.size>20*1024*1024)throw new Error('文件超过 20 MB，请拆分教程后再上传。');
 if(!window.JSZip)throw new Error('Word 解析组件未加载，请刷新页面重试。');
 let zip;try{zip=await JSZip.loadAsync(await file.arrayBuffer());}catch{throw new Error('文件无法解压，可能已经损坏、被加密，或并非有效的 .docx 文件。');}
 const entries=['word/document.xml','word/styles.xml','word/_rels/document.xml.rels'];
 let total=0;Object.values(zip.files).forEach(f=>{total+=f._data?.uncompressedSize||0;});
 if(total>100*1024*1024)throw new Error('解压后的文档内容过大，请拆分文档后再试。');
 for(const path of entries)if((zip.file(path)?._data?.uncompressedSize||0)>20*1024*1024)throw new Error('文档正文结构超过处理范围，请拆分文档后再上传。');
 if(!zip.file(entries[0]))throw new Error('未找到 Word 正文内容，请确认文件有效且未加密。');
 const [documentXML,stylesXML,linksXML]=await Promise.all(entries.map(path=>zip.file(path)?.async('string')||Promise.resolve('')));
 const xml=parseXML(documentXML),styles=new Map(),links=new Map();
 if(stylesXML){const stylesDoc=parseXML(stylesXML);elements(stylesDoc,'style').forEach(s=>{const id=s.getAttributeNS(W,'styleId'),name=elements(s,'name')[0]?.getAttributeNS(W,'val')||id;const outline=elements(s,'outlineLvl')[0]?.getAttributeNS(W,'val');const nameMatch=name.match(/(?:heading|标题)\s*([1-9])/i);styles.set(id,{level:outline!==undefined?Number(outline)+1:nameMatch?Number(nameMatch[1]):0,base:elements(s,'basedOn')[0]?.getAttributeNS(W,'val')});});}
 const headingFor=(id,seen=new Set())=>{if(seen.has(id))return 0;seen.add(id);const s=styles.get(id);return s?.level||s?.base&&headingFor(s.base,seen)||0;};
 if(linksXML)Array.from(parseXML(linksXML).documentElement.children).forEach(n=>links.set(n.getAttribute('Id'),n.getAttribute('Target')));
 const blocks=[];let table=0;
 function addParagraph(p,position={}){const text=textOf(p);if(!text.trim())return;const style=elements(p,'pStyle')[0]?.getAttributeNS(W,'val');const level=elements(p,'outlineLvl')[0]?.getAttributeNS(W,'val');const heading=level!==undefined?Number(level)+1:headingFor(style);const paragraphLinks=elements(p,'hyperlink').map(h=>links.get(h.getAttributeNS(R,'id'))).filter(Boolean);blocks.push({id:'B'+String(blocks.length+1).padStart(3,'0'),text,heading,...position,links:paragraphLinks});}
 const body=elements(xml,'body')[0];if(!body)throw new Error('未找到可读取的文档正文。');
 const process=(node)=>{if(node.namespaceURI===W&&node.localName==='p')addParagraph(node);else if(node.namespaceURI===W&&node.localName==='tbl'){table++;const tableNumber=table;Array.from(node.children).filter(n=>n.localName==='tr').forEach((tr,r)=>Array.from(tr.children).filter(n=>n.localName==='tc').forEach((tc,c)=>elements(tc,'p').forEach(p=>addParagraph(p,{table:tableNumber,row:r+1,col:c+1}))));}else if(['sdt','sdtContent','customXml'].includes(node.localName))Array.from(node.children).forEach(process);};
 Array.from(body.children).forEach(process);
 if(!blocks.length)throw new Error('没有找到可读取的文字。扫描件、图片、文本框和批注暂不纳入检查。');
 if(blocks.length>10000||blocks.reduce((n,b)=>n+b.text.length,0)>2000000)throw new Error('文档超过本地原型的处理范围（10,000 段或 200 万字），请拆分后再上传。');
 const headings=blocks.map((b,i)=>({i,level:b.heading})).filter(b=>b.level>0&&b.level<4&&!blocks[b.i].table);
 const min=headings.length?Math.min(...headings.map(h=>h.level)):0;
 const starts=headings.filter(h=>h.level===min).map(h=>h.i);
 const fallback=!starts.length;
 const titles=fallback?{0:file.name.replace(/\.docx$/i,'')}:starts[0]>0?{0:'文档前置内容'}:{};
 const articles=groupBlocks(blocks,starts,titles);
 return {name:file.name,size:file.size,blocks,articles,starts:articles.map(a=>a.start),demo:false,confirmed:false,fallback};
}
