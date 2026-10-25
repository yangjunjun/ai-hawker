import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, 'public');
const port = Number(process.env.PORT || 3000);
const voiceIds = new Set([
  'zh-CN-YunjianNeural',
  'zh-CN-liaoning-XiaobeiNeural',
  'zh-CN-XiaoxiaoNeural',
  'zh-CN-YunxiNeural',
  'zh-CN-shaanxi-XiaoniNeural',
  'zh-CN-YunyangNeural'
]);
const cache = new Map();
const cacheMax = 40;
const pending = new Map();

function json(res, status, body) {
  res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
  res.end(JSON.stringify(body));
}
function reject(res, status, message) { json(res, status, { error: message }); }

async function readJSON(req) {
  let size = 0;
  const parts = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 8192) { const err = new Error('请求体过大'); err.code = 413; throw err; }
    parts.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(parts).toString('utf8')); }
  catch { const err = new Error('请求体不是有效 JSON'); err.code = 400; throw err; }
}

async function synthesize(text, voice, rate) {
  const key = JSON.stringify([text, voice, rate]);
  if (cache.has(key)) {
    const buf = cache.get(key);
    cache.delete(key); cache.set(key, buf);
    return buf;
  }
  if (pending.has(key)) return pending.get(key);
  const job = (async () => {
    // 独立依赖：浏览器试听无需该模块；npm install 后启用在线神经 TTS。
    const { EdgeTTS } = await import('node-edge-tts');
    const tts = new EdgeTTS({
      voice, lang: 'zh-CN', rate: rate >= 0 ? `+${rate}%` : `${rate}%`,
      outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
      timeout: 25000,
      ...(process.env.TTS_PROXY ? { proxy: process.env.TTS_PROXY } : {})
    });
    const chunks = [];
    for await (const chunk of tts.streamAudio(text)) {
      if (Buffer.isBuffer(chunk)) chunks.push(chunk);
    }
    if (!chunks.length) throw new Error('TTS 服务未返回音频');
    const buffer = Buffer.concat(chunks);
    if (buffer.length > 8 * 1024 * 1024) throw new Error('音频超出大小限制');
    cache.set(key, buffer);
    if (cache.size > cacheMax) cache.delete(cache.keys().next().value);
    return buffer;
  })();
  pending.set(key, job);
  try { return await job; }
  finally { pending.delete(key); }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname === '/api/health') return json(res, 200, { ok: true, provider: 'node-edge-tts' });
  if (url.pathname === '/api/tts') {
    if (req.method !== 'POST') return reject(res, 405, '仅支持 POST');
    try {
      const input = await readJSON(req);
      const text = String(input.text ?? '').trim();
      const voice = String(input.voice ?? 'zh-CN-YunjianNeural');
      const rate = Number(input.rate ?? 0);
      if (text.length < 1 || text.length > 350) return reject(res, 400, '文字长度需为 1–350 个字符');
      if (!voiceIds.has(voice)) return reject(res, 400, '不支持的音色');
      if (!Number.isInteger(rate) || rate < -30 || rate > 30) return reject(res, 400, '语速超出允许范围');
      const audio = await synthesize(text, voice, rate);
      const requestedDownload = url.searchParams.get('download') === '1';
      res.writeHead(200, {
        'Content-Type': 'audio/mpeg',
        'Content-Length': audio.length,
        'Cache-Control':'no-store',
        'Content-Disposition': requestedDownload ? `attachment; filename="hawker-voice.mp3"` : 'inline'
      });
      res.end(audio);
    } catch (err) {
      console.error('[TTS]', err?.message || err);
      reject(res, err.code && Number.isInteger(err.code) ? err.code : 502,
        err.code ? err.message : '在线语音服务暂时不可用；可以先使用浏览器语音试听');
    }
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return reject(res, 405, '方法不支持');
  const assets = {'/':'index.html','/index.html':'index.html','/favicon.svg':'favicon.svg'};
  const asset = assets[url.pathname];
  if (!asset) return reject(res, 404, '资源不存在');
  try {
    const bytes = await readFile(path.join(root, asset));
    res.writeHead(200, {
      'Content-Type': asset.endsWith('.svg') ? 'image/svg+xml' : 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options':'nosniff'
    });
    if (req.method === 'HEAD') res.end(); else res.end(bytes);
  } catch { reject(res, 404, '资源不存在'); }
});
server.listen(port, process.env.HOST || '127.0.0.1', () => {
  console.log(`\n  叫卖助手已启动：http://localhost:${port}`);
  console.log('  试听：在线神经语音 / 浏览器回退；下载：MP3\n');
});
