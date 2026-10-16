import { summarize } from './service.js';

export const tasks = [];
export function status() {
  return summarize();
}
