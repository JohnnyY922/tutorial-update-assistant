import {inferTerms} from '../engine.mjs';
export const SCHEMA_VERSION = '1.0';
export class AnalysisError extends Error {
  constructor(code, message) { super(message); this.name = 'AnalysisError'; this.code = code; }
}
const invalid = message => { throw new AnalysisError('INVALID_RESPONSE', message); };
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonempty = value => typeof value === 'string' && value.trim().length > 0;

// All paragraphs of the current article are included, not just keyword matches.
export function createAnalysisRequest({article, blocks, config, document, requestId}) {
  const request = {
    schemaVersion: SCHEMA_VERSION, requestId,
    document: {name: document.name, outline: document.articles.map(a => ({id: a.id, title: a.title}))},
    change: {...config},
    article: {
      id: article.id, title: article.title,
      blocks: blocks.filter(b => b.articleId === article.id).map(b => ({
        id: b.id, text: b.text, location: b.location, heading: b.heading || 0,
        ...(b.table ? {table: b.table, row: b.row, col: b.col} : {}),
      })),
    },
  };
  validateAnalysisRequest(request);
  return request;
}

export function validateAnalysisRequest(request) {
  const fail = () => { throw new AnalysisError('INVALID_REQUEST', '分析请求不符合接口约定。'); };
  if (!isObject(request) || request.schemaVersion !== SCHEMA_VERSION || !nonempty(request.requestId) ||
      !isObject(request.change) || !nonempty(request.change.description) ||
      !['old','next','scope','exceptions'].every(k => typeof request.change[k] === 'string') ||
      !isObject(request.document) || typeof request.document.name !== 'string' ||
      !Array.isArray(request.document.outline) || !request.document.outline.every(a => isObject(a) && nonempty(a.id) && nonempty(a.title)) ||
      !isObject(request.article) || !nonempty(request.article.id) || !nonempty(request.article.title) ||
      !Array.isArray(request.article.blocks) || request.article.blocks.length === 0) fail();
  const ids = new Set();
  for (const b of request.article.blocks) {
    if (!isObject(b) || !nonempty(b.id) || ids.has(b.id) || !nonempty(b.text) || !nonempty(b.location) ||
        !Number.isInteger(b.heading) || b.heading < 0 || b.heading > 9) fail();
    if (b.table !== undefined && !['table','row','col'].every(k => Number.isInteger(b[k]) && b[k] > 0)) fail();
    ids.add(b.id);
  }
  return request;
}

// Location, title, quote and result ID always come from the local document snapshot.
export function normalizeAnalysisResponse(response, request, article) {
  if (!isObject(response) || response.schemaVersion !== SCHEMA_VERSION || response.requestId !== request.requestId ||
      response.articleId !== request.article.id) invalid('服务返回的任务或教程编号不匹配。');
  if (response.complete !== true) invalid('服务未完成整篇教程分析，请重试。');
  const blocks = new Map(request.article.blocks.map(b => [b.id, b]));
  if (!Array.isArray(response.checkedBlockIds) || response.checkedBlockIds.length !== blocks.size ||
      new Set(response.checkedBlockIds).size !== blocks.size || response.checkedBlockIds.some(id => !blocks.has(id))) {
    invalid('服务没有确认检查全部段落，本篇教程不能标记为完成。');
  }
  if (!Array.isArray(response.findings) || response.findings.length > blocks.size) invalid('服务返回的结果清单无效。');
  const seen = new Set(), {old, next} = inferTerms(request.change);
  const rows = response.findings.map(f => {
    if (!isObject(f) || !blocks.has(f.blockId) || seen.has(f.blockId)) invalid('结果包含不存在或重复的段落编号。');
    const block = blocks.get(f.blockId);
    if (!['change','confirm','keep'].includes(f.status) || !nonempty(f.reason)) invalid('结果缺少有效状态或判断原因。');
    if ('originalText' in f && f.originalText !== block.text) invalid('返回的原文与文档不一致。');
    if (f.status === 'keep') {
      if (f.suggestion != null && f.suggestion !== block.text) invalid('无需修改的结果不能改写原文。');
    } else if (!nonempty(f.suggestion) || f.status === 'change' && f.suggestion === block.text) {
      invalid('结果缺少有效改写或待确认事项。');
    }
    seen.add(f.blockId);
    return {
      id: 'R-' + block.id.replace('B',''), blockId: block.id,
      articleId: article.id, articleTitle: article.title, articleLink: article.link || '',
      location: block.location, text: block.text, status: f.status, reason: f.reason,
      suggestion: f.status === 'keep' ? block.text : f.suggestion,
      basis: request.change.description, scope: request.change.scope, exceptions: request.change.exceptions,
      old, next, analysisSource: 'api',
    };
  });
  const order = new Map(request.article.blocks.map((b,i) => [b.id,i]));
  return rows.sort((a,b) => order.get(a.blockId) - order.get(b.blockId));
}
