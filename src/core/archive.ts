import { Inflate } from 'fflate';
import { InputError, LIMITS } from './limits';
import type { RepositoryFile, RepositorySnapshot } from './types';

const decoder = new TextDecoder('utf-8', { fatal: true });
const encoder = new TextEncoder();
const ignoredDirectories = new Set(['.git', 'node_modules', 'vendor', '.venv', 'venv', '__pycache__', 'dist', 'build', 'coverage', 'target', '.next', '.nuxt', '.cache', '.turbo']);
const textExtensions = /\.(md|mdx|rst|txt|json|jsonc|ya?ml|toml|ini|cfg|conf|xml|js|jsx|mjs|cjs|ts|tsx|mts|cts|py|rs|go|java|kt|kts|c|cc|cpp|h|hpp|cs|rb|php|swift|sh|bash|zsh|ps1|html|css|scss|less|vue|svelte|sql|graphql|gql|proto|gradle|properties|lock|gitignore|dockerignore|env|example|sample|pem|key|crt)$/i;
const textNames = /^(readme|license|licence|copying|notice|dockerfile|makefile|gemfile|rakefile|pipfile|procfile|\.gitignore|\.dockerignore|\.npmrc|\.nvmrc|\.env(?:\..*)?)$/i;

export function normalizeArchivePath(input: string): string {
  if (!input || input.length > LIMITS.pathLength || /[\\\x00-\x1f\x7f:]/.test(input) || input.startsWith('/')) {
    throw new InputError('The ZIP contains an unsafe or overly long file path.');
  }
  const path = input.replace(/\/$/, '');
  if (path.split('/').some(segment => !segment || segment === '.' || segment === '..')) {
    throw new InputError('The ZIP contains an unsafe relative path.');
  }
  return path;
}

export function isIgnoredPath(path: string): boolean {
  return path.split('/').slice(0, -1).some(segment => ignoredDirectories.has(segment.toLowerCase()));
}

function isTextPath(path: string): boolean {
  return textExtensions.test(path) || textNames.test(path.split('/').at(-1) ?? '');
}

interface Entry { path: string; directory: boolean; compressed: number; expanded: number; method: number; crc: number; offset: number; flags: number; start: number }

function decodeName(bytes: Uint8Array): string {
  try { return decoder.decode(bytes); } catch { throw new InputError('ZIP file names must use UTF-8 or ASCII encoding.'); }
}

function readDirectory(bytes: Uint8Array): Entry[] {
  if (bytes.byteLength > LIMITS.archiveBytes) throw new InputError('Archive exceeds the 4 MiB compressed size limit.');
  if (bytes.byteLength < 22) throw new InputError('This is not a complete ZIP archive.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50 && i + 22 + view.getUint16(i + 20, true) === bytes.length) { end = i; break; }
  }
  if (end < 0) throw new InputError('ZIP directory is missing or truncated.');
  const count = view.getUint16(end + 10, true);
  const directorySize = view.getUint32(end + 12, true);
  const directoryOffset = view.getUint32(end + 16, true);
  if (view.getUint16(end + 4, true) !== 0 || view.getUint16(end + 6, true) !== 0 || view.getUint16(end + 8, true) !== count || count === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) {
    throw new InputError('Multi-volume and ZIP64 archives are not supported.');
  }
  if (!count) throw new InputError('The archive is empty.');
  if (count > LIMITS.entries) throw new InputError('Archive contains more than 2,000 entries.');
  if (directoryOffset + directorySize !== end) throw new InputError('ZIP directory bounds are invalid.');
  let cursor = directoryOffset;
  let totalExpanded = 0;
  const entries: Entry[] = [];
  const seen = new Set<string>();
  const ranges: [number, number][] = [];
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > end || view.getUint32(cursor, true) !== 0x02014b50) throw new InputError('ZIP directory entry is invalid.');
    const flags = view.getUint16(cursor + 8, true);
    const method = view.getUint16(cursor + 10, true);
    const compressed = view.getUint32(cursor + 20, true);
    const expanded = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const offset = view.getUint32(cursor + 42, true);
    const next = cursor + 46 + nameLength + extraLength + commentLength;
    if (next > end || !nameLength || view.getUint16(cursor + 34, true) !== 0) throw new InputError('ZIP directory entry bounds are invalid.');
    if (flags & 0x41) throw new InputError('Encrypted ZIP archives are not supported.');
    if (![0, 8].includes(method)) throw new InputError('Only stored or deflated ZIP entries are supported.');
    if (expanded === 0xffffffff || compressed === 0xffffffff || offset === 0xffffffff) throw new InputError('ZIP64 archives are not supported.');
    if (((view.getUint32(cursor + 38, true) >>> 16) & 0xf000) === 0xa000) throw new InputError('Symbolic links are not supported in repository ZIPs.');
    const rawName = decodeName(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    const path = normalizeArchivePath(rawName);
    if (seen.has(path)) throw new InputError('ZIP contains duplicate file paths.');
    seen.add(path);
    totalExpanded += expanded;
    if (totalExpanded > LIMITS.expandedBytes) throw new InputError('Archive exceeds the 20 MiB expanded size limit.');
    if (offset + 30 > directoryOffset || view.getUint32(offset, true) !== 0x04034b50) throw new InputError('ZIP local file header is invalid.');
    const localNameLength = view.getUint16(offset + 26, true);
    const start = offset + 30 + localNameLength + view.getUint16(offset + 28, true);
    if (start + compressed > directoryOffset || start > directoryOffset || view.getUint16(offset + 8, true) !== method || view.getUint16(offset + 6, true) !== flags || decodeName(bytes.subarray(offset + 30, offset + 30 + localNameLength)) !== rawName) {
      throw new InputError('ZIP file headers do not match their directory entries.');
    }
    if (!(flags & 8) && (view.getUint32(offset + 18, true) !== compressed || view.getUint32(offset + 22, true) !== expanded || view.getUint32(offset + 14, true) !== view.getUint32(cursor + 16, true))) {
      throw new InputError('ZIP file sizes or checksums disagree.');
    }
    ranges.push([offset, start + compressed]);
    entries.push({ path, directory: rawName.endsWith('/'), compressed, expanded, method, crc: view.getUint32(cursor + 16, true), offset, flags, start });
    cursor = next;
  }
  if (cursor !== end) throw new InputError('ZIP directory length is invalid.');
  ranges.sort((a, b) => a[0] - b[0]);
  if (ranges.some((range, i) => i > 0 && range[0] < ranges[i - 1][1])) throw new InputError('ZIP entries overlap.');
  return entries;
}

const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function extractText(bytes: Uint8Array, entry: Entry): string | null {
  const compressed = bytes.subarray(entry.start, entry.start + entry.compressed);
  const parts: Uint8Array[] = [];
  let length = 0;
  const receive = (chunk: Uint8Array) => {
    length += chunk.length;
    if (length > entry.expanded || length > LIMITS.fileBytes) throw new InputError('A ZIP entry expands beyond its declared or allowed size.');
    parts.push(chunk.slice());
  };
  if (entry.method === 0) receive(compressed);
  else {
    try {
      const inflater = new Inflate(receive);
      // Bound temporary allocations even if the ZIP's size metadata is malicious.
      for (let offset = 0; offset < compressed.length; offset += 1024) inflater.push(compressed.subarray(offset, offset + 1024), offset + 1024 >= compressed.length);
      if (!compressed.length) inflater.push(new Uint8Array(), true);
    } catch (error) {
      if (error instanceof InputError) throw error;
      throw new InputError('A ZIP entry has invalid compressed data.');
    }
  }
  if (length !== entry.expanded) throw new InputError('A ZIP entry does not match its declared size.');
  const output = new Uint8Array(length);
  let position = 0;
  for (const part of parts) { output.set(part, position); position += part.length; }
  if (crc32(output) !== entry.crc) throw new InputError('A ZIP entry failed its integrity checksum.');
  if (output.includes(0)) return null;
  try { return decoder.decode(output).replace(/\r\n?/g, '\n'); } catch { return null; }
}

/** Removes a wrapper only when it encloses every entry; supports GitHub and ordinary ZIPs. */
function stripWrapper(entries: Entry[]): Entry[] {
  const files = entries.filter(entry => !entry.directory);
  const root = files[0]?.path.split('/')[0];
  if (!root || ignoredDirectories.has(root.toLowerCase()) || !files.every(entry => entry.path.startsWith(`${root}/`)) || entries.some(entry => entry.path !== root && !entry.path.startsWith(`${root}/`))) return entries;
  return entries.filter(entry => entry.path !== root).map(entry => ({ ...entry, path: entry.path.slice(root.length + 1) }));
}

export function readRepositoryZip(buffer: ArrayBuffer): RepositorySnapshot {
  const bytes = new Uint8Array(buffer);
  const entries = stripWrapper(readDirectory(bytes));
  const regular = entries.filter(entry => !entry.directory);
  if (!regular.length) throw new InputError('The archive contains no files.');
  const files: RepositoryFile[] = [];
  let textBytes = 0;
  let oversized = 0;
  for (const entry of regular) {
    if (entry.expanded > LIMITS.fileBytes) { oversized++; continue; }
    if (isIgnoredPath(entry.path) || !isTextPath(entry.path)) continue;
    const content = extractText(bytes, entry);
    if (content === null) continue;
    files.push({ path: entry.path, content });
    textBytes += entry.expanded;
  }
  if (!files.length) throw new InputError('No supported UTF-8 text or source files were found in this archive.');
  const skippedFiles = regular.length - files.length;
  const warnings: string[] = [];
  if (skippedFiles) warnings.push(`${skippedFiles} binary, generated, unsupported, or oversized files were not inspected. Absence-based findings may need manual verification.`);
  if (oversized) warnings.push(`${oversized} files exceed the 512 KiB per-file scan limit.`);
  return { files: files.sort((a, b) => a.path.localeCompare(b.path)), paths: regular.map(entry => entry.path).sort(), totalEntries: regular.length, skippedFiles, textBytes, warnings };
}

/** The bundled demo uses the same path/size/text policy as ZIP inputs. */
export function snapshotFromFiles(input: RepositoryFile[]): RepositorySnapshot {
  if (!input.length) throw new InputError('No repository files were supplied.');
  if (input.length > LIMITS.entries) throw new InputError('Too many repository files.');
  const seen = new Set<string>();
  let totalBytes = 0;
  for (const file of input) {
    const path = normalizeArchivePath(file.path);
    if (seen.has(path)) throw new InputError('Duplicate repository paths.');
    seen.add(path);
    totalBytes += encoder.encode(file.content).length;
    if (totalBytes > LIMITS.expandedBytes) throw new InputError('Repository exceeds the expanded size limit.');
  }
  const files = input.filter(file => !isIgnoredPath(file.path) && isTextPath(file.path) && encoder.encode(file.content).length <= LIMITS.fileBytes && !file.content.includes('\0')).map(file => ({ ...file, content: file.content.replace(/\r\n?/g, '\n') }));
  if (!files.length) throw new InputError('No supported text files were supplied.');
  return { files, paths: [...seen].sort(), totalEntries: input.length, skippedFiles: input.length - files.length, textBytes: files.reduce((sum, file) => sum + encoder.encode(file.content).length, 0), warnings: input.length === files.length ? [] : ['Some unsupported, generated, or oversized files were not inspected.'] };
}
