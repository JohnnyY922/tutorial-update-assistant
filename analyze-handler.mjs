/** Backend-only reference handler. Mount it at POST /api/analyze-article.
 * No provider is connected by default; unconfigured handlers return 501.
 * authorize(request) must verify the deployment's real user/session.
 * analyzeWithModel(payload, {signal}) must return the contract envelope.
 */
import {validateAnalysisRequest, normalizeAnalysisResponse} from '../services/analysis-contract.mjs';
const json = (body,status=200) => new Response(JSON.stringify(body), {status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
export function createAnalyzeHandler({authorize,analyzeWithModel}={}) {
  return async function handle(request) {
    if (request.method !== 'POST') return json({error:'METHOD_NOT_ALLOWED'},405);
    if (!authorize || !analyzeWithModel) return json({error:'AI_NOT_CONFIGURED'},501);
    try { if (!await authorize(request)) return json({error:'UNAUTHORIZED'},401); }
    catch { return json({error:'AUTH_UNAVAILABLE'},503); }
    let payload;
    try { payload = validateAnalysisRequest(await request.json()); }
    catch { return json({error:'INVALID_REQUEST'},400); }
    let response;
    try { response = await analyzeWithModel(payload,{signal:request.signal}); }
    catch { return json({error:'MODEL_UNAVAILABLE'},503); }
    try { normalizeAnalysisResponse(response,payload,payload.article); }
    catch { return json({error:'INVALID_MODEL_RESPONSE'},502); }
    return json(response);
  };
}
