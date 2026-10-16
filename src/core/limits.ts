export const LIMITS = Object.freeze({
  archiveBytes: 4 * 1024 * 1024,
  expandedBytes: 20 * 1024 * 1024,
  fileBytes: 512 * 1024,
  entries: 2000,
  pathLength: 240,
  requestBytes: 2048,
  fetchTimeoutMs: 15_000,
});

export class InputError extends Error {
  constructor(message: string) { super(message); this.name = 'InputError'; }
}
