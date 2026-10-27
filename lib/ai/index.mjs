import { AIError, normalizeError } from './errors.mjs';
import { createEdge } from './edge.mjs';
import { createMimo } from './mimo.mjs';
function string(value, name, max, required = true) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw new AIError('INVALID_INPUT', `${name}不能为空且不能超过${max}字符`, 400);
  return value.trim();
}
export function createAI(config, { fetchImpl, loadEdge } = {}) {
  const providers = { mimo: createMimo(config, fetchImpl), edge: createEdge(config, loadEdge) };
  const speech = providers[config.ttsProvider];
  const configured = provider => provider !== 'mimo' || Boolean(config.mimoKey);
  const cache = new Map(), pending = new Map(); let cacheBytes = 0, active = 0;
  const capabilities = () => ({
    text: { provider: config.textProvider, enabled: config.textProvider !== 'template' && configured(config.textProvider) },
    tts: { provider: config.ttsProvider, model: speech.model, enabled: configured(config.ttsProvider), voices: speech.voices, format: speech.format, rateMode: speech.rateMode, maxCharacters: 350 }
  });
  async function run(timeout, fn, parentSignal) {
    if (active >= config.maxConcurrent) throw new AIError('BUSY', '生成任务较多，请稍后重试', 429, true);
    active++;
    const controller = new AbortController();
    const onAbort = () => controller.abort(parentSignal.reason);
    if (parentSignal?.aborted) onAbort(); else parentSignal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(new DOMException('Timeout', 'TimeoutError')), timeout);
    const signal = controller.signal;
    let abortListener;
    try {
      signal.throwIfAborted();
      const aborted = new Promise((_, reject) => { abortListener = () => reject(signal.reason); signal.addEventListener('abort', abortListener, { once: true }); });
      return await Promise.race([fn(signal), aborted]);
    } catch (e) { throw normalizeError(signal.aborted ? signal.reason : e); }
    finally { clearTimeout(timer); if (abortListener) signal.removeEventListener('abort', abortListener); parentSignal?.removeEventListener('abort', onAbort); active--; }
  }
  return {
    capabilities,
    async generateScripts(input, { signal } = {}) {
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AIError('INVALID_INPUT', '请输入商品信息', 400);
      const data = { product: string(input.product, '商品名称', 60), price: string(input.price, '价格', 60), sellingPoint: string(input.sellingPoint ?? '', '卖点', 200, false) };
      if (!capabilities().text.enabled) throw new AIError('PROVIDER_NOT_CONFIGURED', '在线文案尚未配置，请使用本地模板', 503);
      return run(config.textTimeout, s => providers[config.textProvider].generateScripts(data, { signal: s }), signal);
    },
    async synthesizeSpeech(input) {
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AIError('INVALID_INPUT', '请输入语音参数', 400);
      const text = string(input.text, '文字', 350);
      const voice = input.voice ?? speech.voices[0].id;
      const rate = input.rate ?? 0;
      if (!speech.voices.some(v => v.id === voice)) throw new AIError('INVALID_VOICE', '当前服务不支持该音色，请重新选择', 400);
      if (!Number.isInteger(rate) || rate < -30 || rate > 30 || (speech.rateMode === 'none' && rate !== 0)) throw new AIError('INVALID_RATE', '当前服务不支持该语速参数', 400);
      if (!capabilities().tts.enabled) throw new AIError('PROVIDER_NOT_CONFIGURED', '在线语音尚未配置，请使用浏览器试听', 503);
      const key = JSON.stringify([speech.provider, speech.model, speech.format, text, voice, rate, 'style-v1']);
      if (cache.has(key)) { const value = cache.get(key); cache.delete(key); cache.set(key, value); return value; }
      if (pending.has(key)) return pending.get(key);
      const job = run(config.ttsTimeout, signal => speech.synthesizeSpeech({ text, voice, rate }, { signal })).then(result => {
        cache.set(key, result); cacheBytes += result.buffer.length;
        while (cache.size > 40 || cacheBytes > 32 * 1024 * 1024) { const oldest = cache.keys().next().value; cacheBytes -= cache.get(oldest).buffer.length; cache.delete(oldest); }
        return result;
      });
      pending.set(key, job);
      try { return await job; } finally { pending.delete(key); }
    }
  };
}
