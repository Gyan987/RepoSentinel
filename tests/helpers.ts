import { strToU8, zipSync } from 'fflate';
import { snapshotFromFiles } from '../src/core/archive';

export function zipFiles(files: Record<string, string>, level: 0 | 6 = 6): ArrayBuffer {
  return zipSync(Object.fromEntries(Object.entries(files).map(([path, content]) => [path, strToU8(content)])), { level }).buffer as ArrayBuffer;
}

export const healthyFiles: Record<string, string> = {
  'README.md': '# Project\n\nA deliberately small but complete project for testing deterministic checks.\n\n## Installation\n\nRun `npm ci` to install dependencies.\n\n## Usage\n\nRun `npm start`.\n\n## Testing\n\nRun `npm test` to check the main user flow and its error cases.\n',
  'LICENSE': 'MIT License\nCopyright Example\n',
  'package.json': JSON.stringify({ name: 'healthy-project', scripts: { test: 'vitest run', start: 'node src/index.js' }, dependencies: { express: '4.21.2' } }, null, 2),
  'package-lock.json': '{"lockfileVersion":3}',
  '.gitignore': 'node_modules/\n.env\n',
  '.github/workflows/ci.yml': 'name: CI\non: push\njobs: {}\n',
  'src/index.js': 'export const greet = name => `Hello ${name}`;\n',
  'tests/index.test.js': 'import { greet } from "../src/index.js";\nassert.equal(greet("World"), "Hello World");\n',
};

export function snapshot(files: Record<string, string> = healthyFiles) {
  return snapshotFromFiles(Object.entries(files).map(([path, content]) => ({ path, content })));
}

export function centralOffset(buffer: ArrayBuffer): number {
  const view = new DataView(buffer);
  return view.getUint32(buffer.byteLength - 6, true);
}
