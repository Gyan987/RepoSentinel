import { describe, expect, it } from 'vitest';
import { calculateScore, prioritizeFindings } from '../src/core/scoring';
import type { Finding, Severity } from '../src/core/types';

const finding = (severity: Severity, overrides: Partial<Finding> = {}): Finding => ({ id: 'a', ruleId: 'rule', category: 'security', severity, confidence: 1, title: 'Finding', description: 'Description', evidence: 'Evidence', recommendation: 'Recommendation', ...overrides });

describe('health score and priority policy', () => {
  it('starts at 100 and ignores informational signals', () => {
    expect(calculateScore([]).overall).toBe(100);
    expect(calculateScore([finding('info')]).overall).toBe(100);
  });
  it('has a critical ceiling of 49 and a high ceiling of 79', () => {
    expect(calculateScore([finding('critical')]).overall).toBeLessThanOrEqual(49);
    expect(calculateScore([finding('high')]).overall).toBeLessThanOrEqual(79);
  });
  it('weights confidence and bounds all category scores', () => {
    const full = calculateScore([finding('medium')]);
    const half = calculateScore([finding('medium', { confidence: 0.5 })]);
    expect(half.overall).toBeGreaterThan(full.overall);
    const score = calculateScore(Array.from({ length: 100 }, (_, index) => finding('critical', { ruleId: `rule-${index}` })));
    expect(score.categories.security).toBe(0);
    expect(score.overall).toBeGreaterThanOrEqual(0);
  });
  it('caps repeated instances of the same rule at twice its strongest instance', () => {
    const two = calculateScore([finding('medium'), finding('medium', { id: 'b' })]);
    expect(calculateScore(Array.from({ length: 50 }, () => finding('medium')))).toEqual(two);
    expect(two.categories.security).toBe(60);
  });
  it('orders severity first, then confidence, and uses deterministic tie breaks', () => {
    const inputs = [finding('low', { id: 'l' }), finding('high', { id: 'h', confidence: 0.8 }), finding('critical', { id: 'c' }), finding('high', { id: 'h2', confidence: 0.95 })];
    expect(prioritizeFindings(inputs).map(item => item.id)).toEqual(['c', 'h2', 'h', 'l']);
  });
});
