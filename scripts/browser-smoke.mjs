import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
import { chromium } from 'playwright';
import { createApp } from '../server.mjs';
import { loadConfig } from '../lib/ai/config.mjs';
const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const configJS = await readFile(new URL('../public/config.js', import.meta.url), 'utf8');
const caps = { text: { provider: 'mimo', enabled: true }, tts: { provider: 'mimo', model: 'mimo-v2.5-tts', enabled: true, format: 'wav', rateMode: 'none', voices: [{ id: '苏打', name: 'MiMo · 苏打', description: '中文男声', gender: 'male' }, { id: '冰糖', name: 'MiMo · 冰糖', description: '中文女声', gender: 'female' }] } };
const scripts = ['enthusiastic', 'playful', 'concise'].map(style => ({ style, text: `红富士苹果，5元一斤，AI ${style}` }));
const wav = Buffer.alloc(48); wav.write('RIFF'); wav.writeUInt32LE(40, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(24000, 24); wav.writeUInt32LE(48000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(4, 40);
const server = createApp({ config: loadConfig({}), logger: { error() {} } }); server.listen(0, '127.0.0.1'); await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
let count = 0;
async function run(name, fn) { await fn(); count++; console.log(`PASS ${name}`); }
try {
  browser = await chromium.launch({ headless: true });
  async function page() {
    const p = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    p.errors = []; p.on('pageerror', e => p.errors.push(e.message));
    await p.addInitScript(() => {
      window.__spoken = []; window.__players = [];
      Object.defineProperty(window, 'speechSynthesis', { value: { cancel() {}, getVoices() { return []; }, speak(u) { window.__spoken.push(u.text); } } });
      window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
      window.Audio = class { constructor(url) { this.src = url; this.duration = 3; this.currentTime = 0; window.__players.push(this); } async play() {} pause() {} };
    });
    return p;
  }
  await run('file:// works without API: templates, edit, browser speech, no fake export', async () => {
    const p = await page(); let calls = 0; p.on('request', r => { if (r.url().includes('/api/')) calls++; });
    await p.goto(new URL('../public/index.html', import.meta.url).href);
    assert.equal(await p.locator('.script-editor').count(), 3);
    await p.locator('#product').fill('甜玉米'); await p.locator('#generateBtn').click(); assert.match(await p.locator('.script-editor').first().inputValue(), /甜玉米/);
    await p.locator('.script-editor').first().fill('我的手动文案'); await p.locator('#playBtn').click(); assert.deepEqual(await p.evaluate(() => window.__spoken), ['我的手动文案']);
    await p.locator('#downloadBtn').click(); assert.match(await p.locator('#toast').textContent(), /需要连接/); assert.equal(calls, 0); assert.deepEqual(p.errors, []); await p.close();
  });
  await run('same-origin Node keeps six Edge voices and MP3 download label', async () => {
    const p = await page(); await p.goto(base); await p.waitForFunction(() => document.querySelector('#connectionText').textContent.includes('Edge'));
    assert.equal(await p.locator('.voice-option').count(), 6); assert.equal(await p.locator('#rate').isDisabled(), false); assert.match(await p.locator('#downloadBtn').textContent(), /MP3/); assert.deepEqual(p.errors, []); await p.close();
  });
  await run('MiMo capabilities, text generation, normal rate and real WAV filename', async () => {
    const p = await page(); let ttsBody;
    await p.route('**/api/capabilities', r => r.fulfill({ json: caps }));
    await p.route('**/api/scripts', r => r.fulfill({ json: { provider: 'mimo', scripts } }));
    await p.route('**/api/tts', r => { ttsBody = r.request().postDataJSON(); return r.fulfill({ contentType: 'audio/wav', body: wav }); });
    await p.goto(base); await p.waitForFunction(() => document.querySelector('#rate').disabled);
    assert.equal(await p.locator('.voice-option').count(), 2);
    await p.locator('#generateBtn').click(); await p.waitForFunction(() => document.querySelector('#generatedTag').textContent.includes('MiMo'));
    assert.match(await p.locator('.script-editor').first().inputValue(), /AI enthusiastic/);
    const waitDownload = p.waitForEvent('download'); await p.locator('#downloadBtn').click(); const download = await waitDownload;
    assert.match(download.suggestedFilename(), /\.wav$/); assert.equal(ttsBody.voice, '苏打'); assert.equal(ttsBody.rate, 0); assert.deepEqual(p.errors, []); await p.close();
  });
  await run('failed generation preserves edits; explicit template action remains available', async () => {
    const p = await page(); await p.route('**/api/capabilities', r => r.fulfill({ json: caps })); await p.route('**/api/scripts', r => r.fulfill({ status: 429, json: { error: '额度受限' } }));
    await p.goto(base); await p.waitForFunction(() => document.querySelector('#rate').disabled); await p.locator('.script-editor').first().fill('不要覆盖我');
    await p.locator('#generateBtn').click(); await p.waitForFunction(() => document.querySelector('#generationStatus').textContent.includes('已保留'));
    assert.equal(await p.locator('.script-editor').first().inputValue(), '不要覆盖我'); await p.locator('#templateBtn').click(); assert.match(await p.locator('.script-editor').first().inputValue(), /红富士苹果/); assert.deepEqual(p.errors, []); await p.close();
  });
  await run('editing during generation cancels stale results and restores the button', async () => {
    const p = await page(); await p.route('**/api/capabilities', r => r.fulfill({ json: caps })); let release, started;
    const requested = new Promise(resolve => { started = resolve; });
    await p.route('**/api/scripts', async r => { started(); await new Promise(resolve => { release = resolve; }); await r.fulfill({ json: { scripts } }).catch(() => {}); });
    await p.goto(base); await p.waitForFunction(() => document.querySelector('#rate').disabled); await p.locator('#generateBtn').click(); await requested;
    assert.equal(await p.locator('#generateBtn').isDisabled(), true); await p.locator('.script-editor').first().fill('更新后的文案'); release(); await p.waitForTimeout(150);
    assert.equal(await p.locator('.script-editor').first().inputValue(), '更新后的文案'); assert.equal(await p.locator('#generateBtn').isDisabled(), false); assert.deepEqual(p.errors, []); await p.close();
  });
  await run('speech failure falls back, download failure stays visible', async () => {
    const p = await page(); await p.route('**/api/capabilities', r => r.fulfill({ json: caps })); await p.route('**/api/tts', r => r.fulfill({ status: 504, json: { error: '语音超时' } }));
    await p.goto(base); await p.waitForFunction(() => document.querySelector('#rate').disabled); await p.locator('#playBtn').click(); await p.waitForFunction(() => window.__spoken.length === 1);
    await p.locator('#downloadBtn').click(); await p.waitForFunction(() => document.querySelector('#toast').textContent.includes('下载失败')); assert.equal(await p.locator('#downloadBtn').isDisabled(), false); assert.deepEqual(p.errors, []); await p.close();
  });
  await run('stop cancels pending synthesis without late playback or fallback', async () => {
    const p = await page(); await p.route('**/api/capabilities', r => r.fulfill({ json: caps })); let release, started;
    const requested = new Promise(resolve => { started = resolve; });
    await p.route('**/api/tts', async r => { started(); await new Promise(resolve => { release = resolve; }); await r.fulfill({ contentType: 'audio/wav', body: wav }).catch(() => {}); });
    await p.goto(base); await p.waitForFunction(() => document.querySelector('#rate').disabled); await p.locator('#playBtn').click(); await requested; await p.locator('#stopBtn').click(); release(); await p.waitForTimeout(150);
    assert.equal(await p.evaluate(() => window.__players.length + window.__spoken.length), 0); assert.equal(await p.locator('#modeStatus').textContent(), '准备就绪'); assert.deepEqual(p.errors, []); await p.close();
  });
  await run('loop reuses synthesized audio and selected MiMo voice survives reload', async () => {
    const p = await page(); let calls = 0;
    await p.route('**/api/capabilities', r => r.fulfill({ json: caps })); await p.route('**/api/tts', r => { calls++; return r.fulfill({ contentType: 'audio/wav', body: wav }); });
    await p.goto(base); await p.waitForFunction(() => document.querySelector('#rate').disabled); await p.locator('[data-voice="冰糖"]').click();
    await p.reload(); await p.waitForFunction(() => document.querySelector('#rate').disabled); assert.equal(await p.locator('[data-voice="冰糖"]').getAttribute('aria-pressed'), 'true');
    await p.reload(); await p.waitForFunction(() => document.querySelector('#rate').disabled); assert.equal(await p.locator('[data-voice="冰糖"]').getAttribute('aria-pressed'), 'true');
    await p.locator('#loopDelay').selectOption('2000'); await p.locator('#loopSwitch').click(); await p.locator('#playBtn').click(); await p.waitForFunction(() => window.__players.length === 1);
    await p.evaluate(() => window.__players[0].onended()); await p.waitForFunction(() => window.__players.length === 2); assert.equal(calls, 1);
    await p.locator('#stopBtn').click(); assert.deepEqual(p.errors, []); await p.close();
  });
  await run('GitHub Pages remains static without config; explicit HTTPS API enables MiMo', async () => {
    for (const configured of [false, true]) {
      const p = await page(); let apiCalls = 0;
      await p.route('https://yangjunjun.github.io/**', r => {
        const path = new URL(r.request().url()).pathname;
        if (path.endsWith('config.js')) return r.fulfill({ contentType: 'text/javascript', body: configured ? 'window.HAWKER_CONFIG={apiBaseUrl:"https://hawker-api.example"};' : configJS });
        return r.fulfill({ contentType: 'text/html', body: html });
      });
      await p.route('https://hawker-api.example/**', r => { apiCalls++; return r.fulfill({ json: caps }); });
      await p.goto('https://yangjunjun.github.io/ai-hawker/');
      if (configured) { await p.waitForFunction(() => document.querySelector('#rate').disabled); assert.equal(apiCalls, 1); }
      else { assert.equal(await p.locator('.voice-option').count(), 6); assert.equal(apiCalls, 0); }
      assert.deepEqual(p.errors, []); await p.close();
    }
  });
  await run('mobile layout stays within viewport', async () => {
    const p = await page(); await p.setViewportSize({ width: 390, height: 844 }); await p.goto(base);
    assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); assert.deepEqual(p.errors, []); await p.close();
  });
  console.log(`${count} browser checks passed (mock upstream/audio; no live API credentials).`);
} finally { await browser?.close(); await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); }
