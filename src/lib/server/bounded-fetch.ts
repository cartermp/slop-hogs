export type ServerFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export function createBoundedFetch(timeoutMs: number, maxBytes: number): ServerFetch {
  return async (input, init) => {
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), timeoutMs);
    const requestSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    const signal = requestSignal ? AbortSignal.any([requestSignal, timeout.signal]) : timeout.signal;
    try {
      const response = await fetch(input, { ...init, signal });
      const declaredSize = Number(response.headers.get("content-length") ?? "0");
      if (!Number.isFinite(declaredSize) || declaredSize > maxBytes) {
        await response.body?.cancel();
        throw new Error("External response exceeds the configured size limit");
      }
      if (!response.body) return response;
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let received = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > maxBytes) {
          await reader.cancel();
          throw new Error("External response exceeds the configured size limit");
        }
        chunks.push(value);
      }
      return new Response(Buffer.concat(chunks), {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    } finally {
      clearTimeout(timer);
    }
  };
}
