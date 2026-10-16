import { InputError } from './limits.ts';

export interface GitHubRepository { owner: string; repo: string; url: string; archiveUrl: string }

export function parseGitHubUrl(input: string): GitHubRepository {
  let url: URL;
  try { url = new URL(input.trim()); } catch { throw new InputError('Enter a full public repository URL, such as https://github.com/owner/repository.'); }
  if (url.protocol !== 'https:' || !['github.com', 'www.github.com'].includes(url.hostname) || url.port || url.username || url.password) {
    throw new InputError('Use an HTTPS github.com repository URL without credentials or a custom port.');
  }
  if (url.search || url.hash || url.pathname.includes('%')) throw new InputError('Use the repository root URL without a query, fragment, or encoded path.');
  const match = /^\/([^/]+)\/([^/]+)\/?$/.exec(url.pathname);
  if (!match) throw new InputError('Use the repository root URL, not a branch, file, or organization URL.');
  const owner = match[1];
  const repo = match[2].replace(/\.git$/i, '');
  if (!/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(owner) || !/^[a-z\d_.-]{1,100}$/i.test(repo) || ['.', '..'].includes(repo)) {
    throw new InputError('The GitHub owner or repository name is invalid.');
  }
  return {
    owner, repo, url: `https://github.com/${owner}/${repo}`,
    // This fixed origin and validated path are the endpoint's only outbound target.
    archiveUrl: `https://codeload.github.com/${owner}/${repo}/zip/HEAD`,
  };
}
