import { AIError } from './errors.mjs';
export const edgeVoices = [
  ['zh-CN-YunjianNeural', '东北热情大哥', '男声 · 东北风格文案，非真实方言', 'male'],
  ['zh-CN-liaoning-XiaobeiNeural', '辽宁方言女声', '辽宁话音色', 'female'],
  ['zh-CN-XiaoxiaoNeural', '亲切女声', '温柔自然', 'female'],
  ['zh-CN-YunxiNeural', '活泼小哥', '清爽活力', 'male'],
  ['zh-CN-shaanxi-XiaoniNeural', '陕西方言女声', '陕西地方口音', 'female'],
  ['zh-CN-YunyangNeural', '广播男声', '稳重有力', 'male']
].map(([id, name, description, gender]) => ({ id, name, description, gender }));
export function createEdge(config, loadEdge = () => import('node-edge-tts')) {
  return {
    provider: 'edge', model: 'edge-neural', format: 'mp3', rateMode: 'percent', voices: edgeVoices,
    async synthesizeSpeech({ text, voice, rate }, { signal }) {
      const { EdgeTTS } = await loadEdge(); signal.throwIfAborted();
      const tts = new EdgeTTS({ voice, lang: 'zh-CN', rate: `${rate >= 0 ? '+' : ''}${rate}%`, outputFormat: 'audio-24khz-48kbitrate-mono-mp3', timeout: config.ttsTimeout, ...(config.edgeProxy ? { proxy: config.edgeProxy } : {}) });
      const stream = tts.streamAudio(text); const chunks = []; let size = 0;
      const cancel = () => { if (typeof stream.destroy === 'function') stream.destroy(); };
      signal.addEventListener('abort', cancel, { once: true });
      try {
        for await (const chunk of stream) {
          signal.throwIfAborted();
          if (!Buffer.isBuffer(chunk)) continue;
          size += chunk.length;
          if (size > 8 * 1024 * 1024) throw new AIError('RESPONSE_TOO_LARGE', '音频超出大小限制');
          chunks.push(chunk);
        }
        if (!size) throw new AIError('INVALID_RESPONSE', '语音服务未返回音频');
        return { buffer: Buffer.concat(chunks), contentType: 'audio/mpeg', extension: 'mp3', provider: 'edge', model: 'edge-neural' };
      } finally { signal.removeEventListener('abort', cancel); }
    }
  };
}
