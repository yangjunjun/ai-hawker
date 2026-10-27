function integer(env, key, fallback, min, max) {
  const n = Number(env[key] ?? fallback);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`Invalid configuration: ${key}`);
  return n;
}
export function loadConfig(env = process.env) {
  const textProvider = env.TEXT_PROVIDER || 'template';
  const ttsProvider = env.TTS_PROVIDER || 'edge';
  if (!['template', 'mimo'].includes(textProvider)) throw new Error('Invalid TEXT_PROVIDER');
  if (!['edge', 'mimo'].includes(ttsProvider)) throw new Error('Invalid TTS_PROVIDER');
  const url = new URL(env.MIMO_BASE_URL || 'https://api.xiaomimimo.com/v1');
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('MIMO_BASE_URL must be an HTTPS base URL without credentials/query');
  const allowedOrigins = (env.ALLOWED_ORIGINS || '').split(',').map(x => x.trim()).filter(Boolean);
  for (const origin of allowedOrigins) {
    if (new URL(origin).origin !== origin || !/^https?:/.test(origin)) throw new Error('ALLOWED_ORIGINS requires exact HTTP(S) origins');
  }
  return {
    textProvider, ttsProvider, mimoKey: env.MIMO_API_KEY?.trim() || '',
    mimoBaseUrl: url.href.replace(/\/$/, ''),
    textModel: env.MIMO_TEXT_MODEL || 'mimo-v2.6-flash',
    ttsModel: env.MIMO_TTS_MODEL || 'mimo-v2.5-tts',
    textTimeout: integer(env, 'TEXT_TIMEOUT_MS', 20000, 100, 120000),
    ttsTimeout: integer(env, 'TTS_TIMEOUT_MS', 45000, 100, 120000),
    maxConcurrent: integer(env, 'AI_MAX_CONCURRENT', 4, 1, 16),
    requestsPerMinute: integer(env, 'AI_REQUESTS_PER_MINUTE', 30, 1, 1000),
    allowedOrigins, edgeProxy: env.TTS_PROXY || '',
    host: env.HOST || '127.0.0.1', port: integer(env, 'PORT', 3000, 0, 65535)
  };
}
