import { categories, severityOrder, type Category, type Finding, type HealthScore } from './types';

export const categoryWeights: Record<Category, number> = { documentation: 20, testing: 20, security: 30, dependencies: 15, structure: 10, architecture: 5 };
const penalties = { critical: 70, high: 38, medium: 20, low: 8, info: 0 };

/** Repeated instances of one rule cost at most twice its strongest instance. */
export function calculateScore(findings: Finding[]): HealthScore {
  const scores = Object.fromEntries(categories.map(category => [category, 100])) as Record<Category, number>;
  for (const category of categories) {
    const rules = new Map<string, number[]>();
    for (const finding of findings.filter(item => item.category === category)) {
      const penalty = penalties[finding.severity] * Math.max(0, Math.min(1, finding.confidence));
      rules.set(finding.ruleId, [...(rules.get(finding.ruleId) ?? []), penalty]);
    }
    let deduction = 0;
    for (const instances of rules.values()) deduction += Math.min(instances.reduce((sum, value) => sum + value, 0), Math.max(...instances) * 2);
    scores[category] = Math.max(0, Math.round(100 - deduction));
  }
  let overall = Math.round(categories.reduce((sum, category) => sum + scores[category] * categoryWeights[category] / 100, 0));
  if (findings.some(finding => finding.severity === 'critical')) overall = Math.min(overall, 49);
  else if (findings.some(finding => finding.severity === 'high')) overall = Math.min(overall, 79);
  return { overall, categories: scores };
}

export function compareFindings(a: Finding, b: Finding): number {
  return severityOrder[a.severity] - severityOrder[b.severity] || b.confidence - a.confidence || a.ruleId.localeCompare(b.ruleId) || (a.path ?? '').localeCompare(b.path ?? '') || (a.line ?? 0) - (b.line ?? 0);
}

export function prioritizeFindings(findings: Finding[]): Finding[] { return [...findings].sort(compareFindings); }
