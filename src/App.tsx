import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { analyzeInWorker, fetchGitHubArchive, readUploadedZip } from './client';
import { downloadReport } from './core/export';
import { parseGitHubUrl } from './core/github-url';
import { categories, categoryLabels, type AnalysisRunner, type Category, type Finding, type Report } from './core/types';
import { demoFiles } from './demo';

interface AppProps { analyze?: AnalysisRunner; fetchArchive?: typeof fetchGitHubArchive }
const formatBytes = (bytes: number) => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MiB` : `${Math.max(1, Math.round(bytes / 1024))} KiB`;

function FindingCard({ finding, index }: { finding: Finding; index: number }) {
  return <article className={`finding finding-${finding.severity}`}>
    <div className="finding-heading"><span className="finding-index">{String(index + 1).padStart(2, '0')}</span><span className={`severity ${finding.severity}`}>{finding.severity}</span><span className="finding-category">{categoryLabels[finding.category]}</span><span className="confidence">{Math.round(finding.confidence * 100)}% confidence</span></div>
    <h3>{finding.title}</h3><p>{finding.description}</p>
    <div className="file-location"><span aria-hidden="true">↳</span> {finding.path ?? 'Repository-wide'}{finding.line ? `:${finding.line}` : ''}</div>
    <div className="evidence"><span className="micro-label">EVIDENCE</span><pre>{finding.evidence}</pre></div>
    <div className="recommendation"><span aria-hidden="true">↗</span><p>{finding.recommendation}</p></div>
    <span className="rule-id">{finding.ruleId}</span>
  </article>;
}

function Results({ report }: { report: Report }) {
  const [category, setCategory] = useState<Category | 'all'>('all');
  const [priorityOnly, setPriorityOnly] = useState(false);
  const [exportError, setExportError] = useState('');
  const visible = report.findings.filter(finding => (category === 'all' || finding.category === category) && (!priorityOnly || ['critical', 'high'].includes(finding.severity)));
  const priority = report.findings.filter(finding => ['critical', 'high'].includes(finding.severity)).length;
  const label = report.score.overall >= 85 ? 'A solid foundation' : report.score.overall >= 65 ? 'Room to strengthen' : 'Needs attention';
  const exportFile = (format: 'markdown' | 'json' | 'html') => {
    try { downloadReport(report, format); setExportError(''); } catch { setExportError('Your browser could not create the download. Try another browser.'); }
  };
  return <section aria-label="Analysis report" className="report">
    <div className="report-topline"><div><span className="eyebrow">ANALYSIS COMPLETE</span><h2>{report.source.label}</h2></div><div className="export-actions"><button className="button subtle" onClick={() => exportFile('markdown')}>↓ Markdown</button><button className="button subtle" onClick={() => exportFile('json')}>↓ JSON</button><button className="button subtle" onClick={() => exportFile('html')}>↓ HTML</button></div></div>
    {exportError && <p role="alert" className="error-inline">{exportError}</p>}
    <div className="overview">
      <div className="score-block"><div className={`score-ring ${report.score.overall < 65 ? 'score-low' : ''}`} style={{ '--score': `${report.score.overall}%` } as CSSProperties}><div><strong aria-label={`Health score ${report.score.overall} out of 100`}>{report.score.overall}</strong><span>/ 100</span></div></div><div><span className="micro-label">REPOSITORY HEALTH</span><h3>{label}</h3><p>A weighted snapshot of static signals.</p></div></div>
      <div className="stats"><div><strong>{report.summary.scannedFiles}<small> / {report.summary.totalFiles}</small></strong><span>files inspected</span></div><div><strong>{report.findings.length}</strong><span>findings</span></div><div><strong className={priority ? 'attention' : ''}>{priority}</strong><span>high priority</span></div></div>
    </div>
    <div className="category-scores">{categories.map(item => <div key={item}><div><span>{categoryLabels[item]}</span><strong>{report.score.categories[item]}</strong></div><div className="score-track"><span style={{ width: `${report.score.categories[item]}%` }} /></div></div>)}</div>
    <p className="report-disclaimer">Heuristic score, not a security certification. Checks do not run code, tests, package audits, or credential validation.</p>
    {report.warnings.length > 0 && <details className="inspection-notes"><summary>Inspection notes · {report.summary.skippedFiles} files skipped</summary><ul>{report.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul></details>}
    <div className="findings-topline"><div><h2>Prioritized findings <span>{report.findings.length}</span></h2><p>Start with the strongest signals. Every finding includes its evidence.</p></div><label className="priority-toggle"><input type="checkbox" checked={priorityOnly} onChange={event => setPriorityOnly(event.target.checked)} /> High priority only</label></div>
    <div className="filters" aria-label="Filter findings by category"><button aria-pressed={category === 'all'} onClick={() => setCategory('all')}>All findings</button>{categories.map(item => <button key={item} aria-pressed={category === item} onClick={() => setCategory(item)}>{categoryLabels[item]} <span>{report.findings.filter(finding => finding.category === item).length}</span></button>)}</div>
    <div className="finding-list">{visible.length ? visible.map((finding, index) => <FindingCard key={finding.id} finding={finding} index={index} />) : <div className="no-findings"><span aria-hidden="true">✓</span><h3>No findings in this view</h3><p>{report.findings.length ? 'Choose another category or turn off the priority filter.' : 'The configured checks found no issues. Manual review is still valuable.'}</p></div>}</div>
    <div className="report-footnote"><span>{formatBytes(report.summary.textBytes)} of text inspected · {report.summary.manifests} manifests · {report.summary.testFiles} test files</span><span>Report schema v{report.schemaVersion}</span></div>
  </section>;
}

export default function App({ analyze = analyzeInWorker, fetchArchive = fetchGitHubArchive }: AppProps) {
  const [mode, setMode] = useState<'github' | 'zip'>('github');
  const [url, setUrl] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [report, setReport] = useState<Report | null>(null);
  const active = useRef<AbortController | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  useEffect(() => () => active.current?.abort(), []);

  const start = async (kind: 'github' | 'zip' | 'demo') => {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true); setError(''); setReport(null); setProgress('Preparing the repository…');
    try {
      let nextReport: Report;
      const options = { signal: controller.signal, onProgress: setProgress };
      if (kind === 'demo') nextReport = await analyze({ type: 'files', files: demoFiles, source: { kind: 'demo', label: 'pocket-tasks / demo' } }, options);
      else if (kind === 'github') {
        const repository = parseGitHubUrl(url);
        setProgress('Fetching the public default-branch archive…');
        const buffer = await fetchArchive(repository.url, controller.signal);
        nextReport = await analyze({ type: 'archive', buffer, source: { kind: 'github', label: `${repository.owner} / ${repository.repo}`, url: repository.url } }, options);
      } else {
        if (!file) throw new Error('Choose a repository ZIP before analyzing.');
        setProgress('Reading your ZIP locally…');
        const buffer = await readUploadedZip(file);
        nextReport = await analyze({ type: 'archive', buffer, source: { kind: 'zip', label: file.name } }, options);
      }
      if (!controller.signal.aborted) { setReport(nextReport); setProgress('Analysis complete.'); }
    } catch (cause) {
      if (controller.signal.aborted) setProgress('Analysis canceled.');
      else setError(cause instanceof Error ? cause.message : 'Something went wrong. Try again with another repository.');
    } finally {
      if (active.current === controller) { active.current = null; setBusy(false); }
    }
  };
  const submit = (event: FormEvent) => { event.preventDefault(); void start(mode); };
  const chooseFile = (next: File | undefined) => { if (!busy && next) { setFile(next); setError(''); } };

  return <div className="app-shell">
    <a className="skip-link" href="#analyzer">Skip to repository analyzer</a>
    <header className="site-header"><a className="brand" href="/"><span className="brand-mark" aria-hidden="true">R<span>↗</span></span><span>RepoSentinel<span className="brand-tag">REPOSITORY INTELLIGENCE</span></span></a><span className="header-note"><span className="status-dot" /> Zero keys. Clear signals.</span><a className="source-link" href="https://github.com/Gyan987/RepoSentinel" target="_blank" rel="noreferrer">View source <span aria-hidden="true">↗</span></a></header>
    <main>
      <section className="hero"><div className="hero-copy"><span className="eyebrow"><span className="status-dot" /> YOUR CODEBASE, IN FOCUS</span><h1>A clearer view of<br /><em>your repository.</em></h1><p>Turn a public GitHub repo or ZIP into an actionable health report. Real file evidence. Prioritized next steps. No API keys.</p><div className="hero-tags"><span>⌁ Deterministic checks</span><span>◈ Local analysis</span><span>↧ Export-ready</span></div></div><div className="hero-decoration" aria-hidden="true"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="radar-core">R<span>↗</span></div><span className="orbit-label label-one">docs / tests</span><span className="orbit-label label-two">secrets / structure</span><span className="orbit-point point-one" /><span className="orbit-point point-two" /></div></section>
      <section id="analyzer" className="input-section" aria-labelledby="input-title"><div className="section-intro"><span className="step-number">01 / INPUT</span><h2 id="input-title">Start with a repository</h2><p>A small, source-only archive works best.</p></div><div className="input-card"><div className="input-tabs" role="group" aria-label="Repository input type"><button disabled={busy} aria-pressed={mode === 'github'} onClick={() => { setMode('github'); setError(''); }}><span aria-hidden="true">⌘</span> GitHub URL</button><button disabled={busy} aria-pressed={mode === 'zip'} onClick={() => { setMode('zip'); setError(''); }}><span aria-hidden="true">↥</span> Upload ZIP</button><span className="private-badge">NO SIGN-IN REQUIRED</span></div>
      <form onSubmit={submit}>
        {mode === 'github' ? <div className="url-field"><label htmlFor="repository-url">Public repository URL</label><div className="url-input-row"><input id="repository-url" type="url" value={url} onChange={event => setUrl(event.target.value)} placeholder="https://github.com/owner/repository" autoComplete="off" spellCheck={false} disabled={busy} required aria-describedby="github-help" /><button className="button primary" disabled={busy} type="submit">Analyze repository <span aria-hidden="true">↗</span></button></div><p className="field-help" id="github-help">We fetch the default branch from public GitHub. No token or write access.</p></div> : <div className="zip-field"><label className={`drop-zone ${dragging ? 'dragging' : ''}`} onDragOver={event => { event.preventDefault(); if (!busy) setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={event => { event.preventDefault(); setDragging(false); chooseFile(event.dataTransfer.files[0]); }}><input type="file" accept=".zip,application/zip" aria-label="Repository ZIP" disabled={busy} onChange={event => chooseFile(event.target.files?.[0])} /><span className="upload-symbol" aria-hidden="true">↥</span><strong>{file ? file.name : 'Drop a repository ZIP, or browse files'}</strong><span>{file ? `${formatBytes(file.size)} · ready for local analysis` : '4 MiB ZIP · 20 MiB expanded · up to 2,000 entries'}</span></label><div className="zip-actions"><p className="field-help">Your ZIP is read in your browser and is never uploaded.</p><button type="submit" disabled={busy || !file} className="button primary">Analyze ZIP <span aria-hidden="true">↗</span></button></div></div>}
      </form><div className="demo-row"><span>Just looking around?</span><button className="text-button" disabled={busy} onClick={() => void start('demo')}>Try the bundled demo <span aria-hidden="true">→</span></button><span className="demo-caption">No network needed</span></div></div></section>
      <div ref={resultsRef} className="results-area" aria-live="polite" aria-busy={busy}>
        {busy ? <section className="state-card loading-state" role="status"><div className="scanner" aria-hidden="true" /><span className="eyebrow">READING THE SIGNALS</span><h2>Inspecting your repository</h2><p>{progress}</p><button className="button subtle" onClick={() => active.current?.abort()}>Cancel analysis</button></section> : error ? <section className="state-card error-state" role="alert"><span className="state-icon" aria-hidden="true">!</span><span className="eyebrow">INPUT NEEDS ATTENTION</span><h2>We couldn’t finish this analysis</h2><p>{error}</p><span className="field-help">Update the input above and try again. The bundled demo is always available.</span></section> : report ? <Results key={report.generatedAt + report.source.label} report={report} /> : <section className="empty-section"><div className="section-intro"><span className="step-number">02 / INSIGHT</span><h2>Less guesswork.<br />Better next steps.</h2><p>Your report will appear here, with a health score and evidence behind every finding.</p>{progress && <p role="status">{progress}</p>}</div><div className="checks-grid">{[{ icon: '≡', title: 'Docs & onboarding', text: 'READMEs, setup instructions, and local links.' }, { icon: '✓', title: 'Tests & dependencies', text: 'Test signals, CI, manifests, and lockfiles.' }, { icon: '◇', title: 'Secrets & structure', text: 'Credential patterns, file hygiene, and import cycles.' }].map(check => <div className="check-preview" key={check.title}><span aria-hidden="true">{check.icon}</span><h3>{check.title}</h3><p>{check.text}</p></div>)}</div></section>}
      </div>
    </main><footer className="site-footer"><span className="footer-brand">RepoSentinel <span>/</span> Clarity before complexity.</span><p>Static checks. No AI inference. No repository code execution.</p></footer>
  </div>;
}
