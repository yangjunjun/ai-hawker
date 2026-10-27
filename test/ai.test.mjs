import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { loadConfig } from '../lib/ai/config.mjs';
import { createAI } from '../lib/ai/index.mjs';
import { createMimo, decodeWav, validateScripts } from '../lib/ai/mimo.mjs';
import { createApp } from '../server.mjs';
import { readLimited } from '../lib/ai/errors.mjs';
const product = { product: '红富士苹果', price: '5元一斤', sellingPoint: '新鲜到货' };
const scripts = ['enthusiastic', 'playful', 'concise'].map(style => ({ style, text: '红富士苹果，5元一斤，新鲜到货！' }));
const textResponse = () => Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ scripts }) } }] });
function wav() {
  const b = Buffer.alloc(48); b.write('RIFF'); b.writeUInt32LE(40, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(24000, 24); b.writeUInt32LE(48000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(4, 40); return b;
}
const audioResponse = () => Response.json({ choices: [{ finish_reason: 'stop', message: { audio: { data: wav().toString('base64') } } }] });
const config = (extra = {}) => loadConfig({ TEXT_PROVIDER: 'mimo', TTS_PROVIDER: 'mimo', MIMO_API_KEY: 'test-secret', ...extra });
const speech = { text: '红富士苹果，5元一斤', voice: '苏打', rate: 0 };
async function serve(t, c, ai) {
  const logs = [];
  const server = createApp({ config: c, ai, logger: { error: (...args) => logs.push(args) } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return { base: `http://127.0.0.1:${server.address().port}`, logs };
}
const post = (base, path, body, headers = {}) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

test('defaults retain template and Edge; config validates URLs and limits', () => {
  const c = loadConfig({}); assert.equal(c.textProvider, 'template'); assert.equal(c.ttsProvider, 'edge');
  for (const env of [{ TTS_PROVIDER: 'unknown' }, { AI_MAX_CONCURRENT: '0' }, { MIMO_BASE_URL: 'http://bad.test' }, { ALLOWED_ORIGINS: '*' }]) assert.throws(() => loadConfig(env));
});
test('capabilities expose neither keys nor upstream URLs; missing key disables only MiMo', () => {
  const caps = createAI(config({ MIMO_API_KEY: '', TTS_PROVIDER: 'edge' })).capabilities();
  assert.equal(caps.text.enabled, false); assert.equal(caps.tts.enabled, true); assert.equal(caps.tts.format, 'mp3');
  const serialized = JSON.stringify(createAI(config()).capabilities()); assert.ok(!serialized.includes('test-secret')); assert.ok(!serialized.includes('https:'));
});
test('MiMo text uses fixed JSON contract and server-owned credentials', async () => {
  let request;
  const ai = createAI(config(), { fetchImpl: async (url, init) => { request = { url, ...init, body: JSON.parse(init.body) }; return textResponse(); } });
  const result = await ai.generateScripts({ ...product, baseUrl: 'https://attacker.test', model: 'other' });
  assert.deepEqual(result.scripts, scripts); assert.equal(request.url, 'https://api.xiaomimimo.com/v1/chat/completions');
  assert.equal(request.headers['api-key'], 'test-secret'); assert.equal(request.redirect, 'error'); assert.equal(request.body.stream, false);
  assert.deepEqual(request.body.response_format, { type: 'json_object' }); assert.equal(request.body.model, 'mimo-v2.6-flash');
  assert.deepEqual(JSON.parse(request.body.messages[1].content), product);
});
test('reject duplicate styles, changed prices, overlong scripts and incomplete JSON', async () => {
  for (const invalid of [{ scripts: scripts.slice(1) }, { scripts: [scripts[0], scripts[0], scripts[2]] }, { scripts: scripts.map(s => ({ ...s, text: '红富士苹果 3元一斤' })) }, { scripts: scripts.map(s => ({ ...s, text: s.text + '长'.repeat(350) })) }]) assert.throws(() => validateScripts(invalid, product), { code: 'INVALID_RESPONSE' });
  for (const response of [{ choices: [{ finish_reason: 'length' }] }, { choices: [{ finish_reason: 'stop', message: { content: 'oops' } }] }]) {
    const ai = createAI(config(), { fetchImpl: async () => Response.json(response) });
    await assert.rejects(ai.generateScripts(product), { code: 'INVALID_RESPONSE' });
  }
});
test('MiMo TTS uses assistant text, normal rate and actual WAV output', async () => {
  let body;
  const ai = createAI(config(), { fetchImpl: async (_, init) => { body = JSON.parse(init.body); return audioResponse(); } });
  const result = await ai.synthesizeSpeech(speech);
  assert.deepEqual(body.audio, { format: 'wav', voice: '苏打' }); assert.equal(body.messages[1].role, 'assistant'); assert.equal(body.messages[1].content, speech.text);
  assert.equal(result.extension, 'wav'); assert.equal(result.contentType, 'audio/wav'); assert.deepEqual(result.buffer, wav());
  await assert.rejects(ai.synthesizeSpeech({ ...speech, rate: 10 }), { code: 'INVALID_RATE' });
  await assert.rejects(ai.synthesizeSpeech({ ...speech, voice: 'zh-CN-YunjianNeural' }), { code: 'INVALID_VOICE' });
});
test('validate input before making paid calls', async () => {
  let calls = 0; const ai = createAI(config(), { fetchImpl: async () => { calls++; return textResponse(); } });
  for (const value of [null, [], { text: 123 }, { text: 'x'.repeat(351) }, { ...speech, rate: '0' }]) await assert.rejects(ai.synthesizeSpeech(value));
  for (const value of [null, [], {}, { ...product, product: 'x'.repeat(61) }]) await assert.rejects(ai.generateScripts(value));
  assert.equal(calls, 0);
});
test('upstream errors are sanitized and not retried', async () => {
  for (const [status, code, expected] of [[401, 'UPSTREAM_AUTH', 503], [403, 'UPSTREAM_AUTH', 503], [429, 'UPSTREAM_RATE_LIMIT', 429], [500, 'UPSTREAM_ERROR', 502]]) {
    let calls = 0;
    const ai = createAI(config(), { fetchImpl: async () => { calls++; return new Response('test-secret private body', { status }); } });
    await assert.rejects(ai.generateScripts(product), e => e.code === code && e.status === expected && !e.message.includes('secret')); assert.equal(calls, 1);
  }
});
test('empty, malformed and oversized audio are rejected', () => {
  const emptyWav=wav();emptyWav.writeUInt32LE(0,40);emptyWav.writeUInt32LE(36,4);
  for (const data of [undefined, '', '!!!!', emptyWav.toString('base64'), Buffer.from('not an audio').toString('base64'), 'A'.repeat(12 * 1024 * 1024 + 4)]) assert.throws(() => decodeWav(data));
});
test('response size is enforced while consuming the stream', async () => {
  let cancelled = false;
  const r = new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(20)); }, cancel() { cancelled = true; } }));
  await assert.rejects(readLimited(r, 10), { code: 'RESPONSE_TOO_LARGE' }); assert.equal(cancelled, true);
});
test('timeout aborts upstream and returns 504; caller can cancel text', async () => {
  let signal;
  const ai = createAI(config({ TEXT_TIMEOUT_MS: '100' }), { fetchImpl: async (_, init) => { signal = init.signal; return new Promise(() => {}); } });
  await assert.rejects(ai.generateScripts(product), { code: 'UPSTREAM_TIMEOUT', status: 504 }); assert.equal(signal.aborted, true);
  const controller = new AbortController(); const pending = ai.generateScripts(product, { signal: controller.signal }); controller.abort();
  await assert.rejects(pending, { code: 'CANCELLED' });
});
test('speech deduplicates simultaneous requests and caches only successes', async () => {
  let calls = 0, release;
  const ai = createAI(config(), { fetchImpl: async () => { calls++; await new Promise(resolve => { release = resolve; }); return audioResponse(); } });
  const a = ai.synthesizeSpeech(speech), b = ai.synthesizeSpeech(speech); release();
  assert.deepEqual(await a, await b); await ai.synthesizeSpeech(speech); assert.equal(calls, 1);
  const failed = createAI(config(), { fetchImpl: async () => { calls++; return new Response('bad', { status: 500 }); } });
  await assert.rejects(failed.synthesizeSpeech(speech)); await assert.rejects(failed.synthesizeSpeech(speech)); assert.equal(calls, 3);
});
test('concurrency is bounded across text and TTS', async () => {
  let release;
  const ai = createAI(config({ AI_MAX_CONCURRENT: '1' }), { fetchImpl: async () => { await new Promise(resolve => { release = resolve; }); return textResponse(); } });
  const first = ai.generateScripts(product); await assert.rejects(ai.synthesizeSpeech(speech), { code: 'BUSY', status: 429 }); release(); await first;
});
test('Edge adapter retains voice/rate/proxy and MP3, with no MiMo calls', async () => {
  let options;
  const ai = createAI(loadConfig({ TTS_PROXY: 'http://127.0.0.1:7890' }), { loadEdge: async () => ({ EdgeTTS: class { constructor(o) { options = o; } async *streamAudio() { yield Buffer.from('ID3fixture'); } } }) });
  const audio = await ai.synthesizeSpeech({ text: '你好', voice: 'zh-CN-YunjianNeural', rate: 10 });
  assert.equal(audio.extension, 'mp3'); assert.equal(audio.contentType, 'audio/mpeg'); assert.equal(options.rate, '+10%'); assert.equal(options.proxy, 'http://127.0.0.1:7890');
});
test('HTTP routes serve assets, capabilities, scripts and WAV headers', async t => {
  const c = config(); const ai = createAI(c, { fetchImpl: async (_, init) => JSON.parse(init.body).audio ? audioResponse() : textResponse() });
  const { base } = await serve(t, c, ai);
  assert.deepEqual(await (await fetch(base + '/api/health')).json(), { ok: true });
  const cap = await (await fetch(base + '/api/capabilities')).json(); assert.equal(cap.tts.format, 'wav');
  assert.equal((await fetch(base + '/config.js')).headers.get('content-type'), 'text/javascript; charset=utf-8');
  assert.equal((await fetch(base + '/.env')).status, 404);
  assert.equal((await post(base, '/api/scripts', product)).status, 200);
  const audio = await post(base, '/api/tts?download=1', speech); assert.equal(audio.headers.get('content-type'), 'audio/wav'); assert.match(audio.headers.get('content-disposition'), /\.wav/); assert.deepEqual(Buffer.from(await audio.arrayBuffer()), wav());
});
test('HTTP errors keep legacy error string, redact logs and enforce methods/body types', async t => {
  const c = config(); const ai = createAI(c, { fetchImpl: async () => { throw Error('test-secret'); } }); const { base, logs } = await serve(t, c, ai);
  const r = await post(base, '/api/scripts', product); const error = await r.json(); assert.equal(r.status, 502); assert.equal(typeof error.error, 'string'); assert.ok(error.requestId); assert.ok(!JSON.stringify(logs).includes('secret'));
  assert.equal((await fetch(base + '/api/tts')).status, 405);
  assert.equal((await fetch(base + '/api/scripts', { method: 'POST', body: '{}' })).status, 415);
  assert.equal((await fetch(base + '/api/scripts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' })).status, 400);
  assert.equal((await post(base, '/api/scripts', { product: 'x'.repeat(9000) })).status, 413);
});
test('CORS allows configured origin and preflight but rejects others, including null', async t => {
  const c = config({ ALLOWED_ORIGINS: 'https://yangjunjun.github.io' }); const { base } = await serve(t, c, createAI(c));
  const r = await fetch(base + '/api/tts', { method: 'OPTIONS', headers: { Origin: 'https://yangjunjun.github.io', 'Access-Control-Request-Method': 'POST' } });
  assert.equal(r.status, 204); assert.equal(r.headers.get('access-control-allow-origin'), 'https://yangjunjun.github.io');
  for (const origin of ['https://evil.test', 'null']) assert.equal((await post(base, '/api/tts', speech, { Origin: origin })).status, 403);
});
test('HTTP request rate limit is enforced independently of upstream', async t => {
  const c = config({ AI_REQUESTS_PER_MINUTE: '1' }); const { base } = await serve(t, c, createAI(c, { fetchImpl: async () => textResponse() }));
  assert.equal((await post(base, '/api/scripts', product)).status, 200); const r = await post(base, '/api/scripts', product); assert.equal(r.status, 429); assert.equal(r.headers.get('retry-after'), '60');
});
