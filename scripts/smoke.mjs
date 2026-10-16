import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';

// A Node transport adapter exercises the actual emitted web-worker module.
if (!isMainThread) {
  globalThis.self = { postMessage: message => parentPort.postMessage(message) };
  await import(workerData.workerUrl);
  parentPort.on('message', data => globalThis.self.onmessage({ data }));
} else {
  const { preview } = await import('vite');
  const assetNames = await readdir(new URL('../dist/assets/', import.meta.url));
  const workerName = assetNames.find(name => /^analysis\.worker-.*\.js$/.test(name));
  assert.ok(workerName, 'Run npm run build before npm run smoke.');
  const site = await preview({ preview: { host: '127.0.0.1', port: 4175, strictPort: true } });
  const workerUrl = new URL(`../dist/assets/${workerName}`, import.meta.url).href;
  const worker = new Worker(new URL(import.meta.url), { workerData: { workerUrl } });
  const origin = 'http://127.0.0.1:4175';
  try {
    const page = await fetch(origin, { signal: AbortSignal.timeout(5000) });
    assert.equal(page.status, 200);
    assert.match(await page.text(), /RepoSentinel/);
    assert.equal((await fetch(`${origin}/assets/${workerName}`)).status, 200);
    const invalid = await fetch(`${origin}/api/github`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: 'https://example.invalid/a/b' }) });
    assert.equal(invalid.status, 400);
    const archive = await fetch(`${origin}/api/github`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://github.com/octocat/Hello-World' }), signal: AbortSignal.timeout(20000),
    });
    assert.equal(archive.status, 200, `Public GitHub read failed: ${archive.status}`);
    assert.match(archive.headers.get('content-type'), /application\/zip/);
    const buffer = await archive.arrayBuffer();
    const report = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Built worker did not finish within 10 seconds.')), 10000);
      worker.on('message', message => {
        if (message.type === 'progress') return;
        clearTimeout(timer);
        if (message.type === 'result') resolve(message.report);
        else reject(new Error(message.message));
      });
      worker.once('error', error => { clearTimeout(timer); reject(error); });
      worker.postMessage({ type: 'archive', buffer, source: { kind: 'github', label: 'octocat / Hello-World', url: 'https://github.com/octocat/Hello-World' } }, [buffer]);
    });
    assert.equal(report.schemaVersion, 1);
    assert.ok(report.summary.scannedFiles > 0);
    assert.ok(report.score.overall >= 0 && report.score.overall <= 100);
    console.log(JSON.stringify({ smoke: 'passed', site: 'production preview', endpoint: 'public GitHub archive', worker: 'production bundle', scannedFiles: report.summary.scannedFiles, findings: report.findings.length, score: report.score.overall }, null, 2));
  } finally {
    await worker.terminate();
    site.httpServer.closeAllConnections();
    await new Promise((resolve, reject) => site.httpServer.close(error => error ? reject(error) : resolve()));
  }
}
