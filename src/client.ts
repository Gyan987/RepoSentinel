import { readBoundedBody } from './core/bounded-body';
import { parseGitHubUrl } from './core/github-url';
import { InputError, LIMITS } from './core/limits';
import type { AnalysisRunner, Report } from './core/types';

export async function fetchGitHubArchive(url: string, signal?: AbortSignal): Promise<ArrayBuffer> {
  const repository = parseGitHubUrl(url);
  const response = await fetch('/api/github', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: repository.url }), signal });
  if (!response.ok) {
    let message = 'The repository archive could not be fetched.';
    try {
      const bytes = await readBoundedBody(response, 4096, 'The server returned an unexpected error.', signal);
      const result: unknown = JSON.parse(new TextDecoder().decode(bytes));
      if (typeof result === 'object' && result !== null && 'error' in result && typeof result.error === 'string') message = result.error;
    } catch { /* Keep a user-facing message for an unconfigured endpoint or HTML error page. */ }
    throw new InputError(message);
  }
  const bytes = await readBoundedBody(response, LIMITS.archiveBytes, 'Archive exceeds the 4 MiB compressed size limit.', signal);
  return bytes.buffer as ArrayBuffer;
}

export async function readUploadedZip(file: File): Promise<ArrayBuffer> {
  if (!/\.zip$/i.test(file.name)) throw new InputError('Choose a .zip repository archive.');
  if (!file.size) throw new InputError('The selected ZIP is empty.');
  if (file.size > LIMITS.archiveBytes) throw new InputError('Archive exceeds the 4 MiB compressed size limit.');
  if (typeof file.arrayBuffer === 'function') return file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(new InputError('The ZIP could not be read. Try choosing the file again.'));
    reader.readAsArrayBuffer(file);
  });
}

export const analyzeInWorker: AnalysisRunner = (job, options = {}) => new Promise((resolve, reject) => {
  if (options.signal?.aborted) { reject(new DOMException('Analysis canceled.', 'AbortError')); return; }
  const worker = new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' });
  const cleanup = () => { worker.terminate(); options.signal?.removeEventListener('abort', abort); };
  const abort = () => { cleanup(); reject(new DOMException('Analysis canceled.', 'AbortError')); };
  options.signal?.addEventListener('abort', abort, { once: true });
  worker.onmessage = (event: MessageEvent<{ type: 'progress'; message: string } | { type: 'result'; report: Report } | { type: 'error'; message: string }>) => {
    if (event.data.type === 'progress') { options.onProgress?.(event.data.message); return; }
    cleanup();
    if (event.data.type === 'result') resolve(event.data.report);
    else reject(new InputError(event.data.message));
  };
  worker.onerror = () => { cleanup(); reject(new InputError('The analysis worker stopped unexpectedly. Try a smaller archive or reload the page.')); };
  worker.postMessage(job, job.type === 'archive' ? [job.buffer] : []);
});
