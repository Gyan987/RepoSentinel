export const categories = ['documentation', 'testing', 'security', 'dependencies', 'structure', 'architecture'] as const;
export type Category = (typeof categories)[number];
export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export const severityOrder: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
export const categoryLabels: Record<Category, string> = {
  documentation: 'Documentation', testing: 'Tests & CI', security: 'Secret hygiene',
  dependencies: 'Dependencies', structure: 'Project structure', architecture: 'Architecture',
};

export interface RepositoryFile { path: string; content: string }
export interface RepositorySnapshot {
  files: RepositoryFile[];
  /** Includes safe binary/generated/oversized paths, so absence checks know what was omitted. */
  paths: string[];
  totalEntries: number;
  skippedFiles: number;
  textBytes: number;
  warnings: string[];
}
export interface ReportSource { kind: 'github' | 'zip' | 'demo'; label: string; url?: string }
export interface Finding {
  id: string;
  ruleId: string;
  category: Category;
  severity: Severity;
  confidence: number;
  title: string;
  description: string;
  path?: string;
  line?: number;
  evidence: string;
  recommendation: string;
}
export interface HealthScore { overall: number; categories: Record<Category, number> }
export interface Report {
  schemaVersion: 1;
  generatedAt: string;
  source: ReportSource;
  score: HealthScore;
  findings: Finding[];
  summary: { scannedFiles: number; totalFiles: number; skippedFiles: number; sourceFiles: number; testFiles: number; manifests: number; textBytes: number };
  warnings: string[];
}
export type AnalysisJob = { type: 'archive'; buffer: ArrayBuffer; source: ReportSource } | { type: 'files'; files: RepositoryFile[]; source: ReportSource };
export interface AnalysisOptions { signal?: AbortSignal; onProgress?: (message: string) => void }
export type AnalysisRunner = (job: AnalysisJob, options?: AnalysisOptions) => Promise<Report>;
