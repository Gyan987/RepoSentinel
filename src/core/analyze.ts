import { isIgnoredPath } from './archive';
import { calculateScore, compareFindings, prioritizeFindings } from './scoring';
import type { Finding, Report, ReportSource, RepositoryFile, RepositorySnapshot } from './types';

type Draft = Omit<Finding, 'id'>;
type AddFinding = (finding: Draft) => void;
const sourcePattern = /\.(?:[cm]?[jt]sx?|py|rs|go|java|kt|kts|c|cc|cpp|h|hpp|cs|rb|php|swift|vue|svelte|sh)$/i;
const manifestPattern = /(?:^|\/)(?:package\.json|pyproject\.toml|requirements[^/]*\.txt|Pipfile|Cargo\.toml|go\.mod|Gemfile|pom\.xml|build\.gradle(?:\.kts)?|composer\.json|pubspec\.yaml|mix\.exs|deno\.jsonc?)$|\.csproj$/i;
const testPathPattern = /(?:^|\/)(?:__tests__|tests?|specs?)(?:\/)|\.(?:test|spec)\.[^/]+$|(?:^|\/)test_[^/]+\.py$|_test\.go$/i;
const lineAt = (content: string, offset: number) => content.slice(0, offset).split('\n').length;
const keyLine = (content: string, key: string) => {
  const offset = content.indexOf(`"${key}"`);
  return offset < 0 ? undefined : lineAt(content, offset);
};
const basename = (path: string) => path.split('/').at(-1) ?? path;
const dirname = (path: string) => path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '';

function documentation(snapshot: RepositorySnapshot, add: AddFinding): void {
  const readmePath = snapshot.paths.find(path => /^readme(?:\.(?:md|mdx|rst|txt))?$/i.test(path));
  if (!readmePath) add({ ruleId: 'docs.readme-missing', category: 'documentation', severity: 'medium', confidence: 1,
    title: 'Add a root README', description: 'A root README is the first navigation point for a new contributor.',
    evidence: `No root README was found among ${snapshot.totalEntries} files.`, recommendation: 'Add README.md with purpose, prerequisites, installation, usage, and testing commands.' });
  const readme = snapshot.files.find(file => file.path === readmePath);
  if (readme) {
    if (readme.content.trim().length < 200) add({ ruleId: 'docs.readme-thin', category: 'documentation', severity: 'low', confidence: 0.95,
      title: 'Give the README more context', description: 'The README is short enough that essential onboarding context may be absent.', path: readme.path, line: 1,
      evidence: `README contains ${readme.content.trim().length} characters.`, recommendation: 'Explain what the project does and show one complete setup and usage example.' });
    if (!/(?:\b(?:installation|install|setup|set up|getting started|quickstart|quick start)\b|npm (?:ci|install)|pip install|cargo (?:run|build)|go run|docker (?:run|compose))/i.test(readme.content)) {
      add({ ruleId: 'docs.setup-missing', category: 'documentation', severity: 'medium', confidence: 0.8,
        title: 'Document the setup path', description: 'No recognized installation or getting-started instructions appear in the root README.', path: readme.path, line: 1,
        evidence: 'No setup heading or common installation command matched.', recommendation: 'Document prerequisites, dependency installation, configuration, and the command to start the project.' });
    }
    const links = [...readme.content.matchAll(/\[[^\]\n]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)].slice(0, 100);
    for (const match of links) {
      const target = match[1].replace(/^<|>$/g, '').split(/[?#]/)[0];
      if (!target || /^(?:[a-z][a-z\d+.-]*:|\/\/|\/)/i.test(target)) continue;
      let decoded: string;
      try { decoded = decodeURIComponent(target); } catch { continue; }
      const normalized = decoded.replace(/^\.\//, '').replace(/\/$/, '');
      if (!normalized || normalized.includes('..') || snapshot.paths.some(path => path === normalized || path.startsWith(`${normalized}/`))) continue;
      add({ ruleId: 'docs.broken-local-link', category: 'documentation', severity: 'low', confidence: 0.9,
        title: 'Repair a local README link', description: 'A relative Markdown link does not point to a path present in the archive.', path: readme.path, line: lineAt(readme.content, match.index ?? 0),
        evidence: `Missing relative target: ${normalized.slice(0, 240)}`, recommendation: 'Update the link or include the missing document. Generated routes may need manual verification.' });
    }
  }
  if (!snapshot.paths.some(path => /^(?:license|licence|copying)(?:\.[^/]+)?$/i.test(path))) add({ ruleId: 'docs.license-missing', category: 'documentation', severity: 'low', confidence: 0.95,
    title: 'Clarify the project license', description: 'No conventional root license file was found.', evidence: 'No LICENSE, LICENCE, or COPYING file at the repository root.', recommendation: 'Choose an appropriate license and add its complete text to a root LICENSE file.' });
}

function testing(paths: string[], testFiles: RepositoryFile[], sourceFiles: RepositoryFile[], files: RepositoryFile[], add: AddFinding): void {
  const possibleUnscannedTests = paths.some(path => sourcePattern.test(path) && testPathPattern.test(path));
  if (sourceFiles.length && !testFiles.length && !possibleUnscannedTests) add({ ruleId: 'tests.missing', category: 'testing', severity: 'high', confidence: 0.9,
    title: 'Add a recognizable automated test', description: 'No conventional test files or Rust inline test markers were found in the inspected source.',
    evidence: `${sourceFiles.length} source files; no recognized test files. Tests were not executed.`, recommendation: 'Add a test covering the main user flow and an invalid input case, with a documented command to run it.' });
  if (sourceFiles.length && !paths.some(path => /^\.github\/workflows\/[^/]+\.ya?ml$/i.test(path) || /^(?:\.gitlab-ci\.ya?ml|azure-pipelines\.ya?ml|Jenkinsfile|\.circleci\/config\.ya?ml)$/i.test(path))) add({ ruleId: 'tests.ci-missing', category: 'testing', severity: 'low', confidence: 0.85,
    title: 'Make checks repeatable in CI', description: 'No supported conventional CI configuration path was found.', evidence: 'No GitHub Actions, GitLab CI, Azure Pipelines, Jenkins, or CircleCI configuration matched.', recommendation: 'Run the build and automated tests for every pull request.' });
  for (const file of files.filter(file => basename(file.path) === 'package.json')) {
    try {
      const pkg: unknown = JSON.parse(file.content);
      if (!isRecord(pkg)) continue;
      const command = isRecord(pkg.scripts) ? pkg.scripts.test : undefined;
      if (typeof command !== 'string' || !command.trim() || /no test specified|no tests? yet/i.test(command)) add({ ruleId: 'tests.npm-command-missing', category: 'testing', severity: 'medium', confidence: 0.95,
        title: 'Provide a working npm test command', description: 'This package has no non-placeholder test script.', path: file.path,
        evidence: 'package.json scripts.test is absent, empty, or a recognized placeholder.', recommendation: 'Add a test script that invokes your actual test runner; account for workspace-level commands if this is a monorepo.' });
    } catch { /* The manifest check reports malformed JSON. */ }
  }
}

function isPlaceholder(value: string): boolean {
  return /(?:example|placeholder|changeme|change-me|replace-me|redacted|xxxxxxxx)/i.test(value) || /^(?:your|dummy|fake|demo|sample|test)[_-]/i.test(value) || /^\$|^<.*>$/.test(value);
}

function security(files: RepositoryFile[], add: AddFinding): void {
  const patterns = [
    { id: 'github-token', label: 'GitHub token-like value', regex: /\b(?:gh[pousr]_[A-Za-z0-9]{30,255}|github_pat_[A-Za-z0-9_]{40,255})\b/g, severity: 'critical' as const, confidence: 0.98 },
    { id: 'aws-key', label: 'AWS access key ID', regex: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, severity: 'high' as const, confidence: 0.95 },
    { id: 'private-key', label: 'Private key header', regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g, severity: 'critical' as const, confidence: 0.98 },
    { id: 'slack-token', label: 'Slack token-like value', regex: /\bxox[baprs]-[A-Za-z0-9-]{20,200}\b/g, severity: 'high' as const, confidence: 0.95 },
    { id: 'google-key', label: 'Google API key-like value', regex: /\bAIza[0-9A-Za-z_-]{35}\b/g, severity: 'high' as const, confidence: 0.9 },
    { id: 'credential-url', label: 'URL with embedded credentials', regex: /https?:\/\/[^\s/:"'<>]+:[^\s/@"'<>]{4,}@[^\s/"'<>]+/g, severity: 'high' as const, confidence: 0.9 },
  ];
  for (const file of files) {
    const sample = /(?:^|\/)(?:fixtures?|examples?|__fixtures__)(?:\/)|\.(?:example|sample|template)$/.test(file.path);
    for (const pattern of patterns) {
      pattern.regex.lastIndex = 0;
      let count = 0;
      for (const match of file.content.matchAll(pattern.regex)) {
        if (isPlaceholder(match[0])) continue;
        add({ ruleId: `security.${pattern.id}`, category: 'security', severity: sample ? 'medium' : pattern.severity, confidence: sample ? 0.7 : pattern.confidence,
          title: `Review a possible exposed ${pattern.id.replaceAll('-', ' ')}`, description: 'A static signature matched a credential-like value. Validity was not checked.', path: file.path, line: lineAt(file.content, match.index ?? 0),
          evidence: `${pattern.label} detected; value redacted.`, recommendation: 'Verify locally. If real, revoke or rotate the credential, remove it from tracked files and history, and load it through environment configuration.' });
        if (++count >= 100) break;
      }
    }
    const assignments = /\b(?:api[_-]?key|secret|access[_-]?token|password|passwd|client[_-]?secret)["']?\s*[:=]\s*["']([^"'\n]{8,160})["']/gi;
    for (const match of [...file.content.matchAll(assignments)].slice(0, 100)) {
      if (isPlaceholder(match[1]) || /^(?:process\.env\.|os\.environ|env\(|\{\{)/.test(match[1])) continue;
      add({ ruleId: 'security.hardcoded-secret', category: 'security', severity: 'medium', confidence: sample ? 0.55 : 0.75,
        title: 'Review a hardcoded credential assignment', description: 'A sensitive variable name is assigned a non-placeholder string literal.', path: file.path, line: lineAt(file.content, match.index ?? 0),
        evidence: 'Credential-like string assignment detected; name and value redacted.', recommendation: 'Confirm whether this is a real credential. Use environment variables or a secret store and rotate any exposed value.' });
    }
    if (/(?:^|\/)\.env(?:\.(?!example$|sample$|template$|test$)[\w.-]+)?$/i.test(file.path)) {
      const realAssignments = file.content.split('\n').map((line, index) => ({ match: /^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/i.exec(line), line: index + 1 }))
        .filter(item => item.match && !isPlaceholder(item.match[2].replace(/^["']|["']$/g, '')) && !/^\s*["']?["']?\s*(?:#.*)?$/.test(item.match[2]));
      if (realAssignments.length) add({ ruleId: 'security.env-file', category: 'security', severity: 'high', confidence: 0.9,
        title: 'Review a committed environment file', description: 'An environment file contains non-placeholder assignments, which may include sensitive configuration.', path: file.path, line: realAssignments[0].line,
        evidence: `${realAssignments.length} non-placeholder assignments detected; all names and values redacted.`, recommendation: 'Keep real environment files out of version control. Commit a sanitized .env.example instead and rotate exposed credentials.' });
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }

function dependencies(files: RepositoryFile[], paths: string[], sourceFiles: RepositoryFile[], add: AddFinding): number {
  const manifests = paths.filter(path => manifestPattern.test(path));
  if (sourceFiles.length && !manifests.length) add({ ruleId: 'deps.manifest-missing', category: 'dependencies', severity: 'medium', confidence: 0.65,
    title: 'Make dependencies discoverable', description: 'No supported dependency manifest was recognized; the project may also be dependency-free.',
    evidence: 'No npm, Python, Rust, Go, Ruby, JVM, PHP, Dart, .NET, Elixir, or Deno manifest matched.', recommendation: 'Provide the ecosystem manifest or document explicitly that the project has no external dependencies.' });
  for (const file of files.filter(file => basename(file.path) === 'package.json')) {
    let pkg: unknown;
    try { pkg = JSON.parse(file.content); if (!isRecord(pkg)) throw new Error(); }
    catch {
      add({ ruleId: 'deps.invalid-package-json', category: 'dependencies', severity: 'high', confidence: 1,
        title: 'Repair package.json', description: 'The package manifest is not a valid JSON object.', path: file.path, line: 1,
        evidence: 'Strict JSON parsing failed or the root value is not an object.', recommendation: 'Fix the JSON syntax and validate the manifest with the package manager.' });
      continue;
    }
    const groups = ['dependencies', 'devDependencies', 'optionalDependencies'];
    const declared = groups.flatMap(group => isRecord(pkg[group]) ? Object.entries(pkg[group]) : []);
    const directory = dirname(file.path);
    const locks = ['package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb'];
    const hasLock = paths.some(path => locks.includes(path) || locks.some(lock => path === directory + lock));
    if (declared.length && !hasLock) add({ ruleId: 'deps.lockfile-missing', category: 'dependencies', severity: 'medium', confidence: 0.95,
      title: 'Commit a dependency lockfile', description: 'This npm-style package declares dependencies but no recognized local or root lockfile is present.', path: file.path,
      evidence: `${declared.length} dependency declarations; no npm, pnpm, Yarn, or Bun lockfile.`, recommendation: 'Generate and commit a lockfile, then use immutable or CI installation in automation.' });
    for (const [name, range] of declared) {
      if (typeof range !== 'string' || !/^(?:\*|latest|next|>=?\s*\d.*|x|\d+\.x)$/i.test(range.trim())) continue;
      add({ ruleId: 'deps.floating-version', category: 'dependencies', severity: 'medium', confidence: 0.9,
        title: 'Constrain a floating dependency', description: 'A dependency uses a wildcard, moving tag, or open-ended version range.', path: file.path, line: keyLine(file.content, name),
        evidence: 'A dependency declaration uses an unconstrained version; the package name and value are omitted.', recommendation: 'Choose a deliberate supported version range and maintain a committed lockfile.' });
    }
    const scripts = isRecord(pkg.scripts) ? Object.values(pkg.scripts).filter((value): value is string => typeof value === 'string') : [];
    if (scripts.some(command => /\b(?:curl|wget)\b[^\n|]*\|\s*(?:sudo\s+)?(?:sh|bash)\b/.test(command))) add({ ruleId: 'deps.remote-shell-script', category: 'security', severity: 'medium', confidence: 0.9,
      title: 'Review a remote shell pipeline', description: 'A package script downloads content directly into a shell.', path: file.path,
      evidence: 'A script contains curl/wget piped to sh/bash; command details are omitted.', recommendation: 'Review the source, pin a verified release, and verify its checksum before executing it.' });
  }
  for (const file of files.filter(file => /(?:^|\/)requirements[^/]*\.txt$/i.test(file.path))) {
    const floating = file.content.split('\n').findIndex(line => /^\s*[\w.-]+(?:\[[^\]]+\])?\s*(?:#.*)?$/.test(line) && !line.trim().startsWith('#'));
    if (floating >= 0) add({ ruleId: 'deps.python-unpinned', category: 'dependencies', severity: 'medium', confidence: 0.85,
      title: 'Pin Python requirements deliberately', description: 'A requirements file contains a bare package name without a version constraint.', path: file.path, line: floating + 1,
      evidence: 'At least one bare dependency declaration was found.', recommendation: 'Use deliberate version constraints and a reproducible lock or compiled requirements workflow.' });
  }
  return manifests.length;
}

interface ImportEdge { target: string; line: number }
function architecture(sourceFiles: RepositoryFile[], add: AddFinding): void {
  const paths = new Set(sourceFiles.map(file => file.path));
  const graph = new Map<string, ImportEdge[]>();
  const resolve = (from: string, request: string): string | undefined => {
    const parts = (dirname(from) + request).split('/');
    const normalized: string[] = [];
    for (const part of parts) {
      if (part === '..') { if (!normalized.length) return undefined; normalized.pop(); }
      else if (part !== '.' && part) normalized.push(part);
    }
    const base = normalized.join('/');
    const stem = base.replace(/\.[cm]?jsx?$/, '');
    return [base, ...['.ts', '.tsx', '.js', '.jsx', '.mts', '.mjs', '/index.ts', '/index.tsx', '/index.js'].flatMap(extension => [base + extension, stem + extension])].find(candidate => paths.has(candidate));
  };
  for (const file of sourceFiles) {
    const lines = file.content.split('\n');
    const nonEmpty = lines.filter(line => line.trim()).length;
    if (nonEmpty > 400) add({ ruleId: 'arch.large-module', category: 'architecture', severity: 'medium', confidence: 0.8,
      title: 'Review a large source module', description: 'Large modules can be harder to navigate; length alone does not prove poor design.', path: file.path, line: 1,
      evidence: `${nonEmpty} non-empty lines; review threshold is 400.`, recommendation: 'Check for separable responsibilities and extract cohesive modules where it improves readability and testing.' });
    if (!/\.[cm]?[jt]sx?$/.test(file.path)) continue;
    const imports = [...file.content.matchAll(/^\s*(?:(?:import|export)\s+(?:[^;\n]*?\s+from\s*)?["']([^"']+)["']|(?:const|let|var)\s+[^;\n]*?=\s*require\(["']([^"']+)["']\))/gm)];
    const targets = new Set(imports.map(match => match[1] ?? match[2]));
    if (targets.size > 20) add({ ruleId: 'arch.import-fanout', category: 'architecture', severity: 'low', confidence: 0.8,
      title: 'Review a highly connected module', description: 'This module references many distinct import targets.', path: file.path, line: 1,
      evidence: `${targets.size} distinct static import targets; review threshold is 20.`, recommendation: 'Check whether this file combines unrelated responsibilities. Barrel exports and composition roots may be intentional.' });
    graph.set(file.path, imports.flatMap(match => {
      const request = match[1] ?? match[2];
      const target = request.startsWith('.') ? resolve(file.path, request) : undefined;
      return target ? [{ target, line: lineAt(file.content, match.index ?? 0) }] : [];
    }));
  }
  const visited = new Set<string>();
  const active = new Set<string>();
  const stack: string[] = [];
  const reported = new Set<string>();
  const visit = (path: string) => {
    visited.add(path); active.add(path); stack.push(path);
    for (const edge of graph.get(path) ?? []) {
      if (active.has(edge.target)) {
        const cycle = [...stack.slice(stack.indexOf(edge.target)), edge.target];
        const key = [...new Set(cycle)].sort().join('|');
        if (!reported.has(key) && reported.size < 20) {
          reported.add(key);
          add({ ruleId: 'arch.import-cycle', category: 'architecture', severity: 'medium', confidence: 0.95,
            title: 'Review a circular relative import', description: 'A cycle exists in the recognized JavaScript/TypeScript static relative-import graph.', path, line: edge.line,
            evidence: cycle.slice(0, 10).join(' → ') + (cycle.length > 10 ? ' → …' : ''), recommendation: 'Move shared contracts to a lower-level module or invert the dependency. Type-only cycles may be harmless and need review.' });
        }
      } else if (!visited.has(edge.target)) visit(edge.target);
    }
    stack.pop(); active.delete(path);
  };
  for (const path of [...graph.keys()].sort()) if (!visited.has(path)) visit(path);
}

export function analyzeRepository(snapshot: RepositorySnapshot, source: ReportSource, now = new Date()): Report {
  const findings: Finding[] = [];
  const ids = new Set<string>();
  let truncated = false;
  let worstIndex = 0;
  const refreshWorst = () => {
    worstIndex = findings.reduce((worst, item, index) => compareFindings(item, findings[worst]) > 0 ? index : worst, 0);
  };
  const add: AddFinding = finding => {
    const id = `${finding.ruleId}:${finding.path ?? 'repository'}:${finding.line ?? 0}`;
    if (ids.has(id)) return;
    const candidate = { ...finding, id };
    if (findings.length >= 500) {
      truncated = true;
      if (compareFindings(candidate, findings[worstIndex]) >= 0) return;
      ids.delete(findings[worstIndex].id);
      findings[worstIndex] = candidate;
      ids.add(id); refreshWorst();
      return;
    }
    ids.add(id); findings.push(candidate);
    if (findings.length === 500) refreshWorst();
  };
  const files = [...snapshot.files].sort((a, b) => a.path.localeCompare(b.path));
  const paths = snapshot.paths.filter(path => !isIgnoredPath(path));
  const sourceFiles = files.filter(file => sourcePattern.test(file.path));
  const testFiles = sourceFiles.filter(file => testPathPattern.test(file.path) || (/\.rs$/.test(file.path) && /#\[(?:tokio::)?test\]/.test(file.content)));
  // The bounded collector retains the highest-priority signals across all rules.
  security(files, add);
  documentation(snapshot, add);
  testing(paths, testFiles, sourceFiles, files, add);
  const manifests = dependencies(files, paths, sourceFiles, add);
  if (sourceFiles.length && !paths.some(path => /^\.gitignore$/i.test(path))) add({ ruleId: 'structure.gitignore-missing', category: 'structure', severity: 'low', confidence: 0.9,
    title: 'Define generated and local-only files', description: 'No root .gitignore was found.', evidence: 'The archive does not contain a root .gitignore.', recommendation: 'Ignore generated output, local environment files, caches, and editor artifacts appropriate to your stack.' });
  if (!sourceFiles.length) add({ ruleId: 'structure.no-source', category: 'structure', severity: 'info', confidence: 0.8,
    title: 'No supported source files recognized', description: 'This may be a documentation/data repository or an unsupported language.', evidence: `${files.length} text files inspected; no supported source extension matched.`, recommendation: 'Interpret code-related signals in context; include source files if you intended a code repository analysis.' });
  architecture(sourceFiles.filter(file => !testFiles.includes(file)), add);
  const prioritized = prioritizeFindings(findings);
  return {
    schemaVersion: 1, generatedAt: now.toISOString(), source,
    score: calculateScore(prioritized), findings: prioritized,
    summary: { scannedFiles: files.length, totalFiles: snapshot.totalEntries, skippedFiles: snapshot.skippedFiles, sourceFiles: sourceFiles.length, testFiles: testFiles.length, manifests, textBytes: snapshot.textBytes },
    warnings: [...snapshot.warnings, ...(truncated ? ['Report limited to the 500 highest-priority findings. Reduce the input scope for a more complete review.'] : [])],
  };
}
