import { parseGitHubUrl } from '../core/github-url.ts';
import { InputError, LIMITS } from '../core/limits.ts';
import { readBoundedBody } from '../core/bounded-body.ts';

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
const responseHeaders = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };

const jsonError = (message: string, status: number) => new Response(JSON.stringify({ error: message }), { status, headers: { ...responseHeaders, 'Content-Type': 'application/json' } });

/** No token, GitHub API, arbitrary origins, redirects, repository execution, or filesystem writes. */
export async function handleGitHubArchive(request: Request, fetcher: Fetcher = fetch): Promise<Response> {
  if (request.method !== 'POST') return new Response(JSON.stringify({ error: 'Use POST with a public GitHub repository URL.' }), { status: 405, headers: { ...responseHeaders, 'Content-Type': 'application/json', Allow: 'POST' } });
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return jsonError('Send a JSON request body.', 415);
  let input: unknown;
  try {
    const body = await readBoundedBody(request, LIMITS.requestBytes, 'Request body is too large.', request.signal);
    input = JSON.parse(new TextDecoder().decode(body));
  } catch (error) { return jsonError(error instanceof InputError ? error.message : 'Request body must be valid JSON.', 400); }
  if (typeof input !== 'object' || input === null || !('url' in input) || typeof input.url !== 'string') return jsonError('A repository URL is required.', 400);
  let repository: ReturnType<typeof parseGitHubUrl>;
  try { repository = parseGitHubUrl(input.url); } catch (error) { return jsonError((error as Error).message, 400); }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LIMITS.fetchTimeoutMs);
  const cancel = () => controller.abort();
  request.signal.addEventListener('abort', cancel, { once: true });
  if (request.signal.aborted) controller.abort();
  try {
    const upstream = await fetcher(repository.archiveUrl, {
      method: 'GET', redirect: 'error', signal: controller.signal,
      headers: { Accept: 'application/zip', 'User-Agent': 'RepoSentinel/0.1 (public archive inspection)' },
    });
    if (!upstream.ok) await upstream.body?.cancel();
    if (upstream.status === 404) return jsonError('Repository not found, private, or empty. Check the public repository URL, or upload a ZIP.', 404);
    if (upstream.status === 429 || upstream.status === 403) return jsonError('GitHub temporarily refused this request. Try again later or upload a ZIP.', 429);
    if (!upstream.ok) return jsonError('GitHub could not provide this archive. Try again later or upload a ZIP.', 502);
    const bytes = await readBoundedBody(upstream, LIMITS.archiveBytes, 'This repository archive exceeds 4 MiB. Upload a smaller source-only ZIP.', controller.signal);
    if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) return jsonError('GitHub did not return a ZIP archive.', 502);
    return new Response(bytes.buffer as ArrayBuffer, { status: 200, headers: {
      ...responseHeaders, 'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${repository.repo}.zip"`,
      'Content-Length': String(bytes.byteLength),
    } });
  } catch (error) {
    if (controller.signal.aborted) return jsonError('The GitHub archive request timed out or was canceled. Try again or upload a ZIP.', 504);
    if (error instanceof InputError) return jsonError(error.message, 413);
    return jsonError('Could not reach the public GitHub archive service. Try again or upload a ZIP.', 502);
  } finally { clearTimeout(timeout); request.signal.removeEventListener('abort', cancel); }
}
