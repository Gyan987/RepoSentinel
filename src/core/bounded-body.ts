import { InputError } from './limits.ts';

/** Enforces both advertised and actual byte counts, including chunked responses. */
export async function readBoundedBody(response: { body: ReadableStream<Uint8Array> | null; headers: Headers }, maxBytes: number, message: string, signal?: AbortSignal): Promise<Uint8Array> {
  const declared = response.headers.get('content-length');
  if (declared && Number(declared) > maxBytes) { await response.body?.cancel(); throw new InputError(message); }
  if (!response.body) throw new InputError('The response body was empty.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  const abort = () => { void reader.cancel().catch(() => undefined); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      if (signal?.aborted) throw new DOMException('Request canceled.', 'AbortError');
      const { done, value } = await reader.read();
      if (signal?.aborted) throw new DOMException('Request canceled.', 'AbortError');
      if (done) break;
      length += value.length;
      if (length > maxBytes) { await reader.cancel(); throw new InputError(message); }
      chunks.push(value);
    }
  } finally { signal?.removeEventListener('abort', abort); reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}
