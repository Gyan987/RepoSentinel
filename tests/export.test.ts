import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadReport, reportToHtml, reportToJson, reportToMarkdown } from '../src/core/export';
import { categories, categoryLabels, type Report } from '../src/core/types';

const makeReport = (): Report => ({
  schemaVersion: 1,
  generatedAt: '2026-10-16T12:34:56.000Z',
  source: { kind: 'github', label: 'example / project', url: 'https://github.com/example/project' },
  score: { overall: 73, categories: { documentation: 92, testing: 84, security: 62, dependencies: 77, structure: 96, architecture: 88 } },
  summary: { scannedFiles: 12, totalFiles: 17, skippedFiles: 5, sourceFiles: 6, testFiles: 2, manifests: 1, textBytes: 4321 },
  warnings: ['Skipped generated files.', 'Inspection stopped at the configured limit.'],
  findings: [
    { id: 'finding-one', ruleId: 'security.example', category: 'security', severity: 'high', confidence: 0.95, title: 'Review a sensitive assignment', description: 'A static signal needs local review.', path: 'src/config.ts', line: 7, evidence: 'const credential = [redacted];\nsecond line', recommendation: 'Remove the assignment and rotate a confirmed credential.' },
    { id: 'finding-two', ruleId: 'docs.example', category: 'documentation', severity: 'low', confidence: 0.8, title: 'Improve onboarding', description: 'Setup guidance is incomplete.', evidence: 'No setup heading was found.', recommendation: 'Document installation and usage.' },
  ],
});

const parseHtml = (html: string) => new DOMParser().parseFromString(html, 'text/html');
const details = (element: Element) => Object.fromEntries([...element.querySelectorAll('dt')].map(term => [term.textContent, term.nextElementSibling?.textContent]));
const readBlob = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(reader.error);
  reader.readAsText(blob);
});

afterEach(() => { vi.useRealTimers(); });

describe('standalone HTML report export', () => {
  it('includes all source metadata, scores, summary values, warnings, and findings in their report order', () => {
    const report = makeReport();
    const before = JSON.stringify(report);
    const html = reportToHtml(report);
    const document = parseHtml(html);

    expect(html).toMatch(/^<!doctype html>/i);
    expect(document.documentElement.lang).toBe('en');
    expect(document.querySelector('meta[charset]')?.getAttribute('charset')).toBe('utf-8');
    expect(document.title).toBe(`RepoSentinel report — ${report.source.label}`);
    expect(details(document.querySelector('section[aria-labelledby="source-heading"]')!)).toEqual({
      Repository: report.source.label, 'Source type': 'github', 'Source URL': report.source.url,
      Generated: report.generatedAt, 'Report schema version': '1',
    });
    expect(document.querySelector('.overall')?.textContent).toBe('Overall health score: 73/100');
    expect([...document.querySelectorAll('tbody tr')].map(row => row.textContent)).toEqual(categories.map(category => `${categoryLabels[category]}${report.score.categories[category]}/100`));
    expect(details(document.querySelector('section[aria-labelledby="summary-heading"]')!)).toEqual({
      'Files inspected': '12', 'Total files': '17', 'Files skipped': '5', 'Source files': '6',
      'Test files': '2', Manifests: '1', 'Text bytes inspected': '4321', Findings: '2', 'High-priority findings': '1',
    });
    expect([...document.querySelectorAll('section[aria-labelledby="notes-heading"] li')].map(note => note.textContent)).toEqual(report.warnings);
    const findings = [...document.querySelectorAll('.finding')];
    expect(findings).toHaveLength(report.findings.length);
    findings.forEach((element, index) => {
      const finding = report.findings[index];
      expect(element.querySelector('h3')?.textContent).toBe(`${index + 1}. [${finding.severity.toUpperCase()}] ${finding.title}`);
      expect(details(element)).toEqual({ Category: categoryLabels[finding.category], Confidence: `${Math.round(finding.confidence * 100)}%`, Rule: finding.ruleId, 'Finding ID': finding.id, Location: finding.path ? `${finding.path}:${finding.line}` : 'Repository-wide' });
      expect(element.querySelector('p')?.textContent).toBe(finding.description);
      expect(element.querySelector('pre')?.textContent).toBe(finding.evidence);
      expect(element.querySelector('p:last-child')?.textContent).toBe(finding.recommendation);
    });
    expect(JSON.stringify(report)).toBe(before);
  });

  it('escapes repository-controlled strings as text without scripts, active markup, or external assets', () => {
    const attack = `</style><script>alert("x")</script><img src="https://example.invalid/x" onerror='alert(1)'>&`;
    const report = makeReport();
    report.source.label = `Repository ${attack}`;
    report.source.url = `javascript:alert("url") ${attack}`;
    report.generatedAt = `Generated ${attack}`;
    report.warnings = [`Warning ${attack}`];
    report.findings = [{ ...report.findings[0], id: `ID ${attack}`, ruleId: `Rule ${attack}`, title: `Title ${attack}`, description: `Description ${attack}`, path: `Path ${attack}`, evidence: `Evidence ${attack}`, recommendation: `Recommendation ${attack}` }];
    const html = reportToHtml(report);
    const document = parseHtml(html);

    expect(html).not.toContain(attack);
    for (const entity of ['&amp;', '&lt;', '&gt;', '&quot;', '&#39;']) expect(html).toContain(entity);
    expect(document.title).toBe(`RepoSentinel report — ${report.source.label}`);
    for (const value of [report.source.label, report.source.url, report.generatedAt, report.warnings[0], report.findings[0].id, report.findings[0].ruleId, report.findings[0].title, report.findings[0].description, report.findings[0].path!, report.findings[0].evidence, report.findings[0].recommendation]) {
      expect(document.body.textContent).toContain(value);
    }
    expect(document.querySelectorAll('script, img, iframe, object, embed, link, base, [src], [href], [onerror], [onclick]')).toHaveLength(0);
    expect(document.querySelectorAll('style')).toHaveLength(1);
    expect(document.querySelector('style')?.textContent).not.toMatch(/@import|url\s*\(/i);
    expect(document.querySelector('style')?.textContent).toContain('@media print');
    expect(document.querySelector('style')?.textContent).toContain('white-space: pre-wrap');
  });

  it('handles clean reports, absent source URLs, and file locations without line numbers', () => {
    const report = makeReport();
    report.source = { kind: 'zip', label: 'clean.zip' };
    report.findings = [];
    report.warnings = [];
    const document = parseHtml(reportToHtml(report));
    expect(document.body.textContent).toContain('No configured checks produced a finding. This is not a guarantee of safety.');
    expect(document.body.textContent).toContain('No inspection warnings.');
    expect(document.body.textContent).not.toContain('undefined');
    expect(details(document.querySelector('section[aria-labelledby="source-heading"]')!)).not.toHaveProperty('Source URL');
    expect(document.querySelectorAll('.finding')).toHaveLength(0);

    report.findings = [{ ...makeReport().findings[0], path: 'src/index.ts', line: undefined }];
    expect(details(parseHtml(reportToHtml(report)).querySelector('.finding')!).Location).toBe('src/index.ts');
  });
});

describe('report downloads', () => {
  it('downloads the original Markdown/JSON and standalone HTML with their filenames, MIME types, contents, and URL cleanup', async () => {
    const report = makeReport();
    const createUrl = vi.fn((_blob: Blob) => 'blob:report');
    const revokeUrl = vi.fn();
    vi.stubGlobal('URL', class extends URL { static createObjectURL = createUrl; static revokeObjectURL = revokeUrl; });
    const downloads: { name: string; href: string }[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.isConnected).toBe(true);
      downloads.push({ name: this.download, href: this.href });
    });
    vi.useFakeTimers();
    for (const format of ['markdown', 'json', 'html'] as const) downloadReport(report, format);
    expect(downloads).toEqual([
      { name: 'reposentinel-report.md', href: 'blob:report' },
      { name: 'reposentinel-report.json', href: 'blob:report' },
      { name: 'reposentinel-report.html', href: 'blob:report' },
    ]);
    expect(document.querySelector('a[download]')).toBeNull();
    const blobs = createUrl.mock.calls.map(([blob]) => blob);
    expect(blobs.map(blob => blob.type)).toEqual(['text/markdown;charset=utf-8', 'application/json;charset=utf-8', 'text/html;charset=utf-8']);
    expect(revokeUrl).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(revokeUrl).toHaveBeenCalledTimes(3);
    expect(revokeUrl).toHaveBeenCalledWith('blob:report');
    vi.useRealTimers();
    expect(await Promise.all(blobs.map(readBlob))).toEqual([reportToMarkdown(report), reportToJson(report), reportToHtml(report)]);
    expect(JSON.parse(await readBlob(blobs[1]))).toEqual(report);
  });
});
