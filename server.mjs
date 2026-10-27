import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { loadConfig } from './lib/ai/config.mjs';
import { createAI } from './lib/ai/index.mjs';
import { AIError, normalizeError } from './lib/ai/errors.mjs';
const root = fileURLToPath(new URL('./public/', import.meta.url));
function json(res, status, body) {
  if (res.destroyed) return;
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}
async function readJSON(req) {
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) throw new AIError('INVALID_INPUT', '请求需使用 application/json', 415);
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 8192) throw new AIError('BODY_TOO_LARGE', '请求体过大', 413);
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new AIError('INVALID_JSON', '请求体不是有效 JSON', 400); }
}
export function createApp({ config = loadConfig(), ai = createAI(config), logger = console } = {}) {
  let windowStart = Date.now(), requests = 0;
  const server = http.createServer(async (req, res) => {
    const requestId = randomUUID();
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const controller = new AbortController();
    res.on('close', () => { if (!res.writableEnded) controller.abort(); });
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/')) {
        const origin = req.headers.origin;
        const sameOrigin = origin && ['http', 'https'].some(p => origin === `${p}://${req.headers.host}`);
        if (origin && !sameOrigin && !config.allowedOrigins.includes(origin)) throw new AIError('ORIGIN_DENIED', '当前网页未被授权访问服务', 403);
        if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
        if (req.method === 'OPTIONS') {
          res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '600' });
          res.end(); return;
        }
        if (!['/api/health', '/api/capabilities', '/api/scripts', '/api/tts'].includes(url.pathname)) throw new AIError('NOT_FOUND', '接口不存在', 404);
        const read = ['/api/health', '/api/capabilities'].includes(url.pathname);
        if (req.method !== (read ? 'GET' : 'POST')) throw new AIError('METHOD_NOT_ALLOWED', '请求方法不支持', 405);
        if (url.pathname === '/api/health') return json(res, 200, { ok: true });
        if (url.pathname === '/api/capabilities') return json(res, 200, ai.capabilities());
        if (Date.now() - windowStart >= 60000) { windowStart = Date.now(); requests = 0; }
        if (++requests > config.requestsPerMinute) { res.setHeader('Retry-After', '60'); throw new AIError('RATE_LIMIT', '请求过于频繁，请稍后重试', 429, true); }
        const input = await readJSON(req);
        if (url.pathname === '/api/scripts') return json(res, 200, await ai.generateScripts(input, { signal: controller.signal }));
        const audio = await ai.synthesizeSpeech(input);
        if (res.destroyed) return;
        res.writeHead(200, { 'Content-Type': audio.contentType, 'Content-Length': audio.buffer.length, 'Cache-Control': 'no-store', 'Content-Disposition': `${url.searchParams.get('download') === '1' ? 'attachment' : 'inline'}; filename="hawker-voice.${audio.extension}"` });
        res.end(audio.buffer); return;
      }
      if (!['GET', 'HEAD'].includes(req.method)) throw new AIError('METHOD_NOT_ALLOWED', '请求方法不支持', 405);
      const assets = { '/': ['index.html', 'text/html; charset=utf-8'], '/index.html': ['index.html', 'text/html; charset=utf-8'], '/favicon.svg': ['favicon.svg', 'image/svg+xml'], '/config.js': ['config.js', 'text/javascript; charset=utf-8'] };
      const asset = assets[url.pathname];
      if (!asset) throw new AIError('NOT_FOUND', '资源不存在', 404);
      const bytes = await readFile(path.join(root, asset[0]));
      res.writeHead(200, { 'Content-Type': asset[1], 'Cache-Control': 'no-store' });
      res.end(req.method === 'HEAD' ? undefined : bytes);
    } catch (error) {
      const e = normalizeError(error);
      logger.error?.('[API]', { requestId, code: e.code, status: e.status });
      json(res, e.status, { error: e.message, code: e.code, retryable: e.retryable, requestId });
    }
  });
  server.requestTimeout = 15000; server.headersTimeout = 10000;
  return server;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = loadConfig(); const server = createApp({ config });
  server.listen(config.port, config.host, () => console.log(`叫卖助手 v0.2.0：http://${config.host}:${server.address().port}（文案 ${config.textProvider} / 语音 ${config.ttsProvider}）`));
}
