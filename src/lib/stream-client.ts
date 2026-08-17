// Posts JSON and reads an NDJSON progress stream from the server. Calls onProgress
// (0..1) as {"progress"} lines arrive and resolves with the {"result"} payload.
// Errors ({"error","status"} lines, or HTTP errors) throw with `.status` and `.body`
// so existing error handlers keep working. If the response is not a stream (older
// deploy or an error page), it transparently falls back to reading it as plain JSON.
export type StreamError = Error & { status?: number; body?: unknown };

export async function postJsonStream<T>(
  url: string,
  payload: unknown,
  onProgress?: (ratio: number) => void,
): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('ndjson') || !res.body) {
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(typeof (data as { error?: unknown }).error === 'string' ? (data as { error: string }).error : `HTTP_${res.status}`) as StreamError;
      err.status = res.status;
      err.body = data;
      throw err;
    }
    return data as T;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result: T | undefined;
  let resultSeen = false;

  const handleLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let message: Record<string, unknown>;
    try { message = JSON.parse(trimmed); } catch { return; }
    if (typeof message.progress === 'number') { onProgress?.(message.progress); return; }
    if ('result' in message) { result = message.result as T; resultSeen = true; return; }
    if ('error' in message) {
      const err = new Error(typeof message.error === 'string' ? message.error : 'SERVER_ERROR') as StreamError;
      err.status = typeof message.status === 'number' ? message.status : 500;
      err.body = { error: message.error, ...(typeof message.details === 'string' ? { details: message.details } : {}) };
      throw err;
    }
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let index: number;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      handleLine(line);
    }
  }
  if (buffer.trim()) handleLine(buffer);

  if (!resultSeen) {
    const err = new Error('STREAM_INCOMPLETE') as StreamError;
    err.status = 500;
    throw err;
  }
  return result as T;
}
