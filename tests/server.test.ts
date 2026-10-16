// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleGitHubArchive } from '../src/server/github';
import { readBoundedBody } from '../src/core/bounded-body';
import { LIMITS } from '../src/core/limits';
import netlifyHandler from '../netlify/functions/github';
import { zipFiles } from './helpers';

const request = (url = 'https://github.com/octocat/Hello-World') => new Request('https://reposentinel.example/api/github', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) });
afterEach(() => vi.useRealTimers());

describe('bounded public archive endpoint', () => {
  it('fetches only a validated codeload URL without credentials, then returns a ZIP', async () => {
    const bytes = zipFiles({ 'README.md': '# Public repository' });
    const upstream = vi.fn<typeof fetch>(async () => new Response(bytes));
    const response = await handleGitHubArchive(request(), upstream);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/zip');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.arrayBuffer()).toEqual(bytes);
    expect(upstream).toHaveBeenCalledWith('https://codeload.github.com/octocat/Hello-World/zip/HEAD', expect.objectContaining({ redirect: 'error', method: 'GET' }));
    expect(upstream.mock.calls[0][1]?.headers).not.toHaveProperty('Authorization');
  });
  it('rejects unsupported methods, content types, malformed JSON, and missing input', async () => {
    expect((await netlifyHandler(new Request('http://localhost/api/github'))).status).toBe(405);
    const unsupported = new Request('http://localhost/api/github', { method: 'POST', body: 'hello' });
    expect((await handleGitHubArchive(unsupported)).status).toBe(415);
    for (const body of ['{oops', '{}', '{"url":12}']) {
      const response = await handleGitHubArchive(new Request('http://localhost/api/github', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }));
      expect(response.status).toBe(400);
    }
  });
  it('rejects oversized JSON before making any outbound fetch', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const response = await handleGitHubArchive(new Request('http://localhost/api/github', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: 'x'.repeat(3000) }) }), fetcher);
    expect(response.status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('never fetches arbitrary origins or repository subpaths', async () => {
    const fetcher = vi.fn<typeof fetch>();
    for (const url of ['http://127.0.0.1/admin', 'https://github.com.evil.invalid/a/b', 'https://github.com/a/b/tree/main']) expect((await handleGitHubArchive(request(url), fetcher)).status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([[404, 404], [403, 429], [429, 429], [500, 502]])('maps upstream %s to %s without leaking upstream text', async (upstreamStatus, expectedStatus) => {
    const response = await handleGitHubArchive(request(), async () => new Response('private upstream details', { status: upstreamStatus }));
    expect(response.status).toBe(expectedStatus);
    expect(await response.text()).not.toContain('private upstream details');
  });
  it('rejects oversized archive headers and oversized chunked bodies', async () => {
    let response = await handleGitHubArchive(request(), async () => new Response('data', { headers: { 'Content-Length': String(LIMITS.archiveBytes + 1) } }));
    expect(response.status).toBe(413);
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(LIMITS.archiveBytes)); controller.enqueue(new Uint8Array(1)); controller.close(); } });
    response = await handleGitHubArchive(request(), async () => new Response(stream));
    expect(response.status).toBe(413);
  });
  it('rejects non-ZIP data and handles network/redirect errors', async () => {
    expect((await handleGitHubArchive(request(), async () => new Response('<html>not zip</html>'))).status).toBe(502);
    expect((await handleGitHubArchive(request(), async () => { throw new Error('redirect refused'); })).status).toBe(502);
  });
  it('aborts an unresponsive fetch within the configured deadline', async () => {
    vi.useFakeTimers();
    const fetcher: typeof fetch = async (_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    });
    const pending = handleGitHubArchive(request(), fetcher);
    await vi.advanceTimersByTimeAsync(LIMITS.fetchTimeoutMs + 1);
    expect((await pending).status).toBe(504);
  });
  it('cancels a stalled response body on abort', async () => {
    const controller = new AbortController();
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ start() { /* Intentionally stalled. */ }, cancel });
    const result = readBoundedBody({ body: stream, headers: new Headers() }, 100, 'too big', controller.signal);
    controller.abort();
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    expect(cancel).toHaveBeenCalledOnce();
  });
});
