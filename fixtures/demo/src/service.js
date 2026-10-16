// Deliberately circular imports make a visible architecture signal in the demo.
import { tasks } from './store.js';

export function summarize() {
  return { count: tasks.length };
}
