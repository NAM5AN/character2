import { apiErrorPayload } from '@/lib/http';

type StreamRun = (emit: (progress: number) => void) => Promise<unknown>;

// Builds an NDJSON streaming response that emits {"progress":0..1} lines while `run`
// works and a final {"result":...} (or {"error":...,"status":...}) line. Progress is
// monotonic and throttled. An optional time-based floor keeps the bar moving even when
// the underlying work reports no real progress (e.g. streaming unavailable).
export function ndjsonStream(
  run: StreamRun,
  // headers: 스트리밍 응답에도 Set-Cookie 같은 헤더를 붙여야 하는 호출부를 위한 것.
  options: { estimateSeconds?: number; floorCap?: number; headers?: Record<string, string> } = {},
): Response {
  const encoder = new TextEncoder();
  const estimateSeconds = options.estimateSeconds ?? 0;
  const floorCap = options.floorCap ?? 0.9;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let sent = 0;
      let closed = false;
      const send = (obj: unknown) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
      };
      const bump = (value: number) => {
        const v = Math.max(0, Math.min(1, value));
        if (v <= sent) return;
        sent = v;
        send({ progress: v });
      };

      const startedAt = Date.now();
      const ticker = estimateSeconds > 0
        ? setInterval(() => {
            const elapsed = (Date.now() - startedAt) / 1000;
            // Ease toward the cap so it slows down as it approaches the estimate.
            const ratio = 1 - Math.exp(-elapsed / Math.max(1, estimateSeconds));
            bump(Math.min(floorCap, ratio * floorCap));
          }, 700)
        : null;

      try {
        const result = await run(bump);
        if (ticker) clearInterval(ticker);
        bump(1);
        send({ result });
      } catch (error) {
        if (ticker) clearInterval(ticker);
        const { status, body } = apiErrorPayload(error);
        send({ error: body.error, status, ...(body.details ? { details: body.details } : {}) });
      } finally {
        if (ticker) clearInterval(ticker);
        closed = true;
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-store, no-transform',
      'x-accel-buffering': 'no',
      ...(options.headers ?? {}),
    },
  });
}
