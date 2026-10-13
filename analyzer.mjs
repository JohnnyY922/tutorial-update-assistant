import {analyzeArticle as analyzeLocally} from '../engine.mjs';
import {AnalysisError, createAnalysisRequest, normalizeAnalysisResponse} from './analysis-contract.mjs';
export const sourceLabel = mode => mode === 'api' ? 'AI 服务分析' : '本地规则分析';
export function createAnalyzer(settings, {fetchImpl = globalThis.fetch, makeRequestId = () => globalThis.crypto.randomUUID()} = {}) {
  const options = {...settings};
  if (!['local','api'].includes(options.mode)) throw new AnalysisError('INVALID_CONFIG','分析模式配置无效。');
  if (options.mode === 'api' && (typeof options.endpoint !== 'string' || !options.endpoint.trim() || !Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0)) {
    throw new AnalysisError('INVALID_CONFIG','请配置分析接口地址与有效的超时时间。');
  }
  return {
    mode: options.mode,
    async analyzeArticle({article, blocks, config, document, signal}) {
      if (options.mode === 'local') return analyzeLocally(article, blocks, config).map(r => ({...r,analysisSource:'local'}));
      const request = createAnalysisRequest({article, blocks, config, document, requestId:makeRequestId()});
      const controller = new AbortController();
      let timedOut = false;
      const abort = () => controller.abort();
      if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, {once:true});
      const timer = setTimeout(() => { timedOut = true; controller.abort(); }, options.timeoutMs);
      try {
        if (controller.signal.aborted) throw new AnalysisError('CANCELLED','本次分析已取消。');
        const response = await fetchImpl(options.endpoint, {
          method:'POST', headers:{'Content-Type':'application/json','Accept':'application/json'},
          credentials:'same-origin', cache:'no-store', signal:controller.signal, body:JSON.stringify(request),
        });
        if (!response.ok) {
          const messages = {401:'分析服务需要登录，请完成登录后重试。',403:'没有使用分析服务的权限。',413:'教程超出服务处理范围，请拆分后重试。',429:'服务请求过于频繁，请稍后重试。',501:'AI 服务尚未接入。',503:'AI 服务暂不可用，请稍后重试。'};
          throw new AnalysisError('HTTP_'+response.status, messages[response.status] || `分析服务请求失败（HTTP ${response.status}）。`);
        }
        let payload;
        try { payload = await response.json(); } catch (e) {
          if (controller.signal.aborted) throw e;
          throw new AnalysisError('INVALID_RESPONSE','分析服务没有返回有效的 JSON 数据。');
        }
        return normalizeAnalysisResponse(payload, request, article);
      } catch (error) {
        if (timedOut) throw new AnalysisError('TIMEOUT','分析服务响应超时，请重试本篇教程。');
        if (controller.signal.aborted) throw new AnalysisError('CANCELLED','本次分析已取消。');
        if (error instanceof AnalysisError) throw error;
        throw new AnalysisError('NETWORK_ERROR','无法连接分析服务，请检查网络、服务地址或跨域配置。');
      } finally {
        clearTimeout(timer);signal?.removeEventListener('abort',abort);
      }
    },
  };
}
