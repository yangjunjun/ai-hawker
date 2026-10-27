export class AIError extends Error {
  constructor(code, message, status = 502, retryable = false) {
    super(message); Object.assign(this, { code, status, retryable });
  }
}
export function normalizeError(error) {
  if (error instanceof AIError) return error;
  if (error?.name === 'TimeoutError') return new AIError('UPSTREAM_TIMEOUT', '生成服务响应超时，请稍后重试', 504, true);
  if (error?.name === 'AbortError') return new AIError('CANCELLED', '请求已取消', 499);
  return new AIError('UPSTREAM_UNAVAILABLE', '生成服务暂时不可用，请稍后重试', 502, true);
}
export async function readLimited(response, limit) {
  const chunks = []; let size = 0;
  if (!response.body) throw new AIError('INVALID_RESPONSE', '生成服务返回了空响应');
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > limit) throw new AIError('RESPONSE_TOO_LARGE', '生成结果超出大小限制');
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks);
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
