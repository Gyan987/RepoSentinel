import { analyzeRepository } from './core/analyze';
import { readRepositoryZip, snapshotFromFiles } from './core/archive';
import type { AnalysisJob } from './core/types';

self.onmessage = (event: MessageEvent<AnalysisJob>) => {
  try {
    self.postMessage({ type: 'progress', message: 'Validating paths and reading source files…' });
    const snapshot = event.data.type === 'archive' ? readRepositoryZip(event.data.buffer) : snapshotFromFiles(event.data.files);
    self.postMessage({ type: 'progress', message: 'Checking evidence and prioritizing findings…' });
    const report = analyzeRepository(snapshot, event.data.source);
    self.postMessage({ type: 'result', report });
  } catch (error) {
    self.postMessage({ type: 'error', message: error instanceof Error ? error.message : 'Analysis failed. Try another repository archive.' });
  }
};
