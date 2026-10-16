import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { analyzeRepository } from '../src/core/analyze';
import { readRepositoryZip, snapshotFromFiles } from '../src/core/archive';
import { readUploadedZip } from '../src/client';
import type { AnalysisRunner } from '../src/core/types';
import { healthyFiles, zipFiles } from './helpers';

// Real parsing + rules + scoring; only browser worker transport is replaced in jsdom.
const directAnalyzer: AnalysisRunner = async (job, options) => {
  options?.onProgress?.('Checking fixture files…');
  return analyzeRepository(job.type === 'archive' ? readRepositoryZip(job.buffer) : snapshotFromFiles(job.files), job.source);
};

describe('repository analyzer UI smoke flows', () => {
  it('shows the empty state, then analyzes the bundled demo and filters a real report', async () => {
    const user = userEvent.setup();
    render(<App analyze={directAnalyzer} />);
    expect(screen.getByRole('heading', { name: /A clearer view/ })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Analysis report' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Try the bundled demo/ }));
    const report = await screen.findByRole('region', { name: 'Analysis report' });
    expect(within(report).getByText('pocket-tasks / demo')).toBeInTheDocument();
    expect(within(report).getByText('Add a recognizable automated test')).toBeInTheDocument();
    expect(within(report).getByText('Review a circular relative import')).toBeInTheDocument();
    await user.click(within(report).getByRole('button', { name: /^Architecture/ }));
    expect(within(report).queryByText('Add a recognizable automated test')).not.toBeInTheDocument();
    expect(within(report).getByText('Review a circular relative import')).toBeInTheDocument();
  });
  it('takes a real uploaded ZIP all the way to a score and downloadable Markdown/JSON/HTML', async () => {
    const user = userEvent.setup();
    const createUrl = vi.fn((_blob: Blob) => 'blob:report');
    vi.stubGlobal('URL', class extends URL { static createObjectURL = createUrl; static revokeObjectURL = vi.fn(); });
    const downloads: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { downloads.push(this.download); });
    render(<App analyze={directAnalyzer} />);
    await user.click(screen.getByRole('button', { name: /Upload ZIP/ }));
    const file = new File([zipFiles(healthyFiles)], 'healthy.zip', { type: 'application/zip' });
    await user.upload(screen.getByLabelText('Repository ZIP'), file);
    await user.click(screen.getByRole('button', { name: /Analyze ZIP/ }));
    const report = await screen.findByRole('region', { name: 'Analysis report' });
    expect(within(report).getByLabelText('Health score 100 out of 100')).toBeInTheDocument();
    await user.click(within(report).getByRole('button', { name: /Markdown/ }));
    await user.click(within(report).getByRole('button', { name: /JSON/ }));
    await user.click(within(report).getByRole('button', { name: /HTML/ }));
    expect(downloads).toEqual(['reposentinel-report.md', 'reposentinel-report.json', 'reposentinel-report.html']);
    expect(createUrl).toHaveBeenCalledTimes(3);
    expect(createUrl.mock.calls.map(([blob]) => blob.type)).toEqual(['text/markdown;charset=utf-8', 'application/json;charset=utf-8', 'text/html;charset=utf-8']);
    vi.unstubAllGlobals();
  });
  it('fetches a validated public URL and then analyzes the returned archive', async () => {
    const user = userEvent.setup();
    const fetchArchive = vi.fn(async () => zipFiles(healthyFiles));
    render(<App analyze={directAnalyzer} fetchArchive={fetchArchive} />);
    await user.type(screen.getByLabelText('Public repository URL'), 'https://github.com/octocat/Hello-World.git');
    await user.click(screen.getByRole('button', { name: /Analyze repository/ }));
    expect(await screen.findByText('octocat / Hello-World')).toBeInTheDocument();
    expect(fetchArchive).toHaveBeenCalledWith('https://github.com/octocat/Hello-World', expect.any(AbortSignal));
  });
  it('shows actionable URL, fetch, and malformed ZIP errors without a report', async () => {
    const user = userEvent.setup();
    render(<App analyze={directAnalyzer} />);
    await user.type(screen.getByLabelText('Public repository URL'), 'https://example.invalid/a/b');
    await user.click(screen.getByRole('button', { name: /Analyze repository/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('github.com');
    await user.click(screen.getByRole('button', { name: /Upload ZIP/ }));
    await user.upload(screen.getByLabelText('Repository ZIP'), new File(['not zip'], 'broken.zip', { type: 'application/zip' }));
    await user.click(screen.getByRole('button', { name: /Analyze ZIP/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('complete ZIP');
    expect(screen.queryByRole('region', { name: 'Analysis report' })).not.toBeInTheDocument();
  });
  it('shows loading and lets a user cancel a pending analysis', async () => {
    const user = userEvent.setup();
    const pendingAnalyzer: AnalysisRunner = async (_job, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(new DOMException('Canceled', 'AbortError')), { once: true });
    });
    render(<App analyze={pendingAnalyzer} />);
    await user.click(screen.getByRole('button', { name: /Try the bundled demo/ }));
    expect(screen.getByRole('status')).toHaveTextContent('Inspecting your repository');
    expect(screen.getByRole('button', { name: /Analyze repository/ })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: /Cancel analysis/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Analyze repository/ })).toBeEnabled());
    expect(screen.getByRole('status')).toHaveTextContent('Analysis canceled.');
  });
  it('supports file drop and validates upload extension/size before reading', async () => {
    const user = userEvent.setup();
    render(<App analyze={directAnalyzer} />);
    await user.click(screen.getByRole('button', { name: /Upload ZIP/ }));
    const file = new File([zipFiles(healthyFiles)], 'dropped.zip', { type: 'application/zip' });
    fireEvent.drop(screen.getByLabelText('Repository ZIP').closest('label')!, { dataTransfer: { files: [file] } });
    expect(screen.getByText('dropped.zip')).toBeInTheDocument();
    await expect(readUploadedZip(new File(['text'], 'not-a-zip.txt'))).rejects.toThrow('.zip');
    await expect(readUploadedZip(new File([], 'empty.zip'))).rejects.toThrow('empty');
    const huge = new File([new Uint8Array(4 * 1024 * 1024 + 1)], 'huge.zip');
    await expect(readUploadedZip(huge)).rejects.toThrow('4 MiB');
  });
});
