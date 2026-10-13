/** Public configuration only. Never put an AI API key in browser code. */
export const analysisConfig = Object.freeze({
  mode: 'local', // 'local' = existing rules; 'api' = your own backend
  endpoint: '/api/analyze-article',
  timeoutMs: 60000,
});
