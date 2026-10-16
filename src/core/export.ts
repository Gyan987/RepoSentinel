import { categories, categoryLabels, type Report } from './types';

const escapeMarkdown = (value: string) => value.replace(/[\\`*_{}\[\]<>()#!|]/g, '\\$&').replace(/\r/g, '');
const escapeHtml = (value: string | number) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export function reportToMarkdown(report: Report): string {
  const sections = [
    '# RepoSentinel report', '', `**Repository:** ${escapeMarkdown(report.source.label)}`,
    `**Generated:** ${report.generatedAt}`, `**Health score:** ${report.score.overall}/100`, '',
    'Static heuristic signals only. No code was executed and credentials were not validated.', '',
    `Inspected ${report.summary.scannedFiles} of ${report.summary.totalFiles} files; skipped ${report.summary.skippedFiles}.`, '',
    '## Category scores', '', ...categories.map(category => `- ${categoryLabels[category]}: ${report.score.categories[category]}/100`), '',
    '## Prioritized findings', '',
  ];
  if (!report.findings.length) sections.push('No configured checks produced a finding. This is not a guarantee of safety.', '');
  report.findings.forEach((finding, index) => {
    sections.push(`### ${index + 1}. [${finding.severity.toUpperCase()}] ${escapeMarkdown(finding.title)}`, '',
      `- **Category:** ${categoryLabels[finding.category]}`,
      `- **Confidence:** ${Math.round(finding.confidence * 100)}%`,
      `- **Rule:** ${escapeMarkdown(finding.ruleId)}`,
      `- **Location:** ${finding.path ? escapeMarkdown(finding.path) + (finding.line ? `:${finding.line}` : '') : 'Repository-wide'}`, '',
      escapeMarkdown(finding.description), '', `**Evidence:** ${escapeMarkdown(finding.evidence)}`, '',
      `**Recommendation:** ${escapeMarkdown(finding.recommendation)}`, '');
  });
  if (report.warnings.length) sections.push('## Inspection notes', '', ...report.warnings.map(warning => `- ${escapeMarkdown(warning)}`), '');
  return sections.join('\n');
}

export function reportToJson(report: Report): string { return JSON.stringify(report, null, 2) + '\n'; }

export function reportToHtml(report: Report): string {
  const detail = (label: string, value: string | number) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`;
  const metadata = [
    detail('Repository', report.source.label), detail('Source type', report.source.kind),
    ...(report.source.url ? [detail('Source URL', report.source.url)] : []),
    detail('Generated', report.generatedAt), detail('Report schema version', report.schemaVersion),
  ].join('\n');
  const summary = [
    detail('Files inspected', report.summary.scannedFiles), detail('Total files', report.summary.totalFiles),
    detail('Files skipped', report.summary.skippedFiles), detail('Source files', report.summary.sourceFiles),
    detail('Test files', report.summary.testFiles), detail('Manifests', report.summary.manifests),
    detail('Text bytes inspected', report.summary.textBytes), detail('Findings', report.findings.length),
    detail('High-priority findings', report.findings.filter(finding => ['critical', 'high'].includes(finding.severity)).length),
  ].join('\n');
  const findings = report.findings.map((finding, index) => `<li><article class="finding">
<h3>${index + 1}. [${escapeHtml(finding.severity.toUpperCase())}] ${escapeHtml(finding.title)}</h3>
<dl class="details">
${detail('Category', categoryLabels[finding.category])}
${detail('Confidence', `${Math.round(finding.confidence * 100)}%`)}
${detail('Rule', finding.ruleId)}
${detail('Finding ID', finding.id)}
${detail('Location', finding.path ? `${finding.path}${finding.line !== undefined ? `:${finding.line}` : ''}` : 'Repository-wide')}
</dl>
<p class="narrative">${escapeHtml(finding.description)}</p>
<h4>Evidence</h4><pre>${escapeHtml(finding.evidence)}</pre>
<h4>Recommendation</h4><p class="narrative">${escapeHtml(finding.recommendation)}</p>
</article></li>`).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>RepoSentinel report — ${escapeHtml(report.source.label)}</title>
<style>
* { box-sizing: border-box; }
body { margin: 0; padding: 32px 20px; color: #18252e; background: #f4f6f7; font: 16px/1.6 system-ui, sans-serif; }
main { max-width: 960px; margin: auto; padding: 36px; background: #fff; border: 1px solid #cdd5da; border-radius: 12px; }
h1, h2, h3, h4 { line-height: 1.3; break-after: avoid; }
h1 { margin-top: 0; } h2 { margin-top: 32px; border-bottom: 1px solid #cdd5da; padding-bottom: 8px; }
h3 { margin-top: 0; } h4 { margin-bottom: 8px; }
p, dd, li, h1, h2, h3 { overflow-wrap: anywhere; }
.repository { font-size: 1.2rem; font-weight: 600; } .disclaimer { color: #465661; }
.details { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px 24px; }
.details > div { min-width: 0; } dt { font-weight: 600; } dd { margin: 0; white-space: pre-wrap; }
.overall { font-size: 1.3rem; } table { width: 100%; border-collapse: collapse; }
th, td { padding: 9px 12px; border: 1px solid #cdd5da; text-align: left; } thead { background: #edf2f5; }
.findings { list-style: none; padding: 0; } .finding { padding: 24px; margin: 20px 0; border: 1px solid #b7c3ca; border-radius: 8px; break-inside: avoid; }
.narrative, pre { white-space: pre-wrap; } pre { font: 0.9rem/1.6 ui-monospace, monospace; overflow-wrap: anywhere; padding: 16px; border: 1px solid #cdd5da; background: #f4f6f7; }
@media (max-width: 600px) { body { padding: 12px; } main, .finding { padding: 16px; } }
@page { margin: 16mm; }
@media print { body { padding: 0; background: #fff; color: #000; font-size: 11pt; } main { max-width: none; padding: 0; border: 0; border-radius: 0; } .finding { border-radius: 0; } .disclaimer { color: #000; } pre, thead { background: #fff; } tr { break-inside: avoid; } }
</style>
</head>
<body><main>
<header><h1>RepoSentinel report</h1><p class="repository">${escapeHtml(report.source.label)}</p>
<p class="disclaimer">Static heuristic signals only, not a security certification. No code was executed and credentials were not validated.</p></header>
<section aria-labelledby="source-heading"><h2 id="source-heading">Source metadata</h2><dl class="details">${metadata}</dl></section>
<section aria-labelledby="scores-heading"><h2 id="scores-heading">Health scores</h2>
<p class="overall"><strong>Overall health score: ${escapeHtml(report.score.overall)}/100</strong></p>
<table><thead><tr><th scope="col">Category</th><th scope="col">Score</th></tr></thead><tbody>
${categories.map(category => `<tr><th scope="row">${escapeHtml(categoryLabels[category])}</th><td>${escapeHtml(report.score.categories[category])}/100</td></tr>`).join('\n')}
</tbody></table></section>
<section aria-labelledby="summary-heading"><h2 id="summary-heading">Inspection summary</h2><dl class="details">${summary}</dl></section>
<section aria-labelledby="notes-heading"><h2 id="notes-heading">Inspection notes</h2>
${report.warnings.length ? `<ul>${report.warnings.map(warning => `<li class="narrative">${escapeHtml(warning)}</li>`).join('\n')}</ul>` : '<p>No inspection warnings.</p>'}</section>
<section aria-labelledby="findings-heading"><h2 id="findings-heading">Prioritized findings</h2>
${report.findings.length ? `<ol class="findings">${findings}</ol>` : '<p>No configured checks produced a finding. This is not a guarantee of safety.</p>'}</section>
</main></body>
</html>
`;
}

const exportFormats = {
  markdown: { render: reportToMarkdown, type: 'text/markdown;charset=utf-8', extension: 'md' },
  json: { render: reportToJson, type: 'application/json;charset=utf-8', extension: 'json' },
  html: { render: reportToHtml, type: 'text/html;charset=utf-8', extension: 'html' },
};

export function downloadReport(report: Report, format: 'markdown' | 'json' | 'html'): void {
  const output = exportFormats[format];
  const blob = new Blob([output.render(report)], { type: output.type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `reposentinel-report.${output.extension}`;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
