import { describe, expect, it } from 'vitest';
import { normalizeArchivePath, readRepositoryZip, snapshotFromFiles } from '../src/core/archive';
import { LIMITS } from '../src/core/limits';
import { centralOffset, zipFiles } from './helpers';

describe('safe archive handling', () => {
  it('unwraps a GitHub-style root, normalizes newlines, and keeps all safe paths for absence checks', () => {
    const result = readRepositoryZip(zipFiles({ 'project-HEAD/README.md': '# Hello\r\nWorld', 'project-HEAD/src/main.ts': 'export const x = 1;', 'project-HEAD/node_modules/no.js': 'ignored', 'project-HEAD/icon.png': 'binary' }));
    expect(result.files.map(file => file.path)).toEqual(['README.md', 'src/main.ts']);
    expect(result.files[0].content).toBe('# Hello\nWorld');
    expect(result.paths).toContain('icon.png');
    expect(result.skippedFiles).toBe(2);
    expect(result.warnings).toHaveLength(1);
  });
  it.each(['../escape.txt', '/absolute.txt', 'C:/evil.txt', 'folder/../evil.txt', 'folder\\evil.txt', 'a//b', './README.md', 'bad\0name', 'bad\nname', 'a'.repeat(241)])('rejects path %s', path => {
    expect(() => normalizeArchivePath(path)).toThrow(/path/i);
    expect(() => readRepositoryZip(zipFiles({ [path]: 'unsafe' }))).toThrow();
  });
  it('accepts a directory marker but not a directory-only archive', () => {
    expect(normalizeArchivePath('src/')).toBe('src');
    expect(() => readRepositoryZip(zipFiles({ 'src/': '' }))).toThrow(/no files/i);
  });
  it('rejects non-ZIP, truncated, and empty inputs', () => {
    expect(() => readRepositoryZip(new ArrayBuffer(1))).toThrow(/complete ZIP/);
    expect(() => readRepositoryZip(new ArrayBuffer(40))).toThrow(/directory/);
    expect(() => readRepositoryZip(zipFiles({}))).toThrow(/empty/);
    const full = zipFiles({ 'README.md': 'hello' });
    expect(() => readRepositoryZip(full.slice(0, full.byteLength - 3))).toThrow();
  });
  it('rejects compressed and expanded byte limit violations before extraction', () => {
    expect(() => readRepositoryZip(new ArrayBuffer(LIMITS.archiveBytes + 1))).toThrow(/4 MiB/);
    const bytes = zipFiles({ 'README.md': 'hello' });
    new DataView(bytes).setUint32(centralOffset(bytes) + 24, LIMITS.expandedBytes + 1, true);
    expect(() => readRepositoryZip(bytes)).toThrow(/20 MiB/);
  });
  it('rejects too many entries', () => {
    const files = Object.fromEntries(Array.from({ length: LIMITS.entries + 1 }, (_, index) => [`file-${index}.txt`, '']));
    expect(() => readRepositoryZip(zipFiles(files))).toThrow(/2,000/);
  });
  it('does not trust understated expansion metadata', () => {
    const bytes = zipFiles({ 'README.md': 'A'.repeat(20_000) });
    const view = new DataView(bytes);
    view.setUint32(22, 10, true);
    view.setUint32(centralOffset(bytes) + 24, 10, true);
    expect(() => readRepositoryZip(bytes)).toThrow(/expands beyond/);
  });
  it('verifies CRC integrity of inspected entries', () => {
    const bytes = zipFiles({ 'README.md': 'hello' }, 0);
    const start = 30 + new DataView(bytes).getUint16(26, true);
    new Uint8Array(bytes)[start] ^= 0xff;
    expect(() => readRepositoryZip(bytes)).toThrow(/checksum/);
  });
  it.each([
    ['encryption', (view: DataView, central: number) => view.setUint16(central + 8, 1, true), /encrypted/i],
    ['symlink', (view: DataView, central: number) => view.setUint32(central + 38, 0xa0000000, true), /symbolic/i],
    ['unsupported compression', (view: DataView, central: number) => view.setUint16(central + 10, 12, true), /stored or deflated/i],
    ['ZIP64', (view: DataView, central: number) => view.setUint32(central + 24, 0xffffffff, true), /ZIP64/],
    ['mismatched header', (view: DataView) => view.setUint16(8, 12, true), /headers do not match/i],
  ] as const)('rejects %s', (_name, mutate, message) => {
    const bytes = zipFiles({ 'README.md': 'hello' });
    mutate(new DataView(bytes), centralOffset(bytes));
    expect(() => readRepositoryZip(bytes)).toThrow(message);
  });
  it('skips oversized source and binary files without losing their paths', () => {
    const result = readRepositoryZip(zipFiles({ 'README.md': '# Repository', 'src/huge.ts': 'a'.repeat(LIMITS.fileBytes + 1), 'src/data.txt': 'binary\0data' }));
    expect(result.files).toHaveLength(1);
    expect(result.paths).toContain('src/huge.ts');
    expect(result.skippedFiles).toBe(2);
    expect(result.warnings.join(' ')).toContain('512 KiB');
  });
  it('rejects inputs containing no inspectable text', () => {
    expect(() => readRepositoryZip(zipFiles({ 'image.png': 'image' }))).toThrow(/No supported/);
    expect(() => readRepositoryZip(zipFiles({ 'node_modules/only.js': 'export const x = 1;' }))).toThrow(/No supported/);
  });
  it('validates direct/demo paths, duplicates, and input size too', () => {
    expect(() => snapshotFromFiles([])).toThrow(/No repository/);
    expect(() => snapshotFromFiles([{ path: '../bad', content: 'x' }])).toThrow();
    expect(() => snapshotFromFiles([{ path: 'a.txt', content: 'a' }, { path: 'a.txt', content: 'b' }])).toThrow(/Duplicate/);
  });
});
