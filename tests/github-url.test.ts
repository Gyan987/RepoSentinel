import { describe, expect, it } from 'vitest';
import { parseGitHubUrl } from '../src/core/github-url';

describe('public GitHub URL parser', () => {
  it.each(['https://github.com/owner/repo', ' https://github.com/owner/repo.git/ ', 'https://www.github.com/owner/repo'])('normalizes a root URL: %s', input => {
    expect(parseGitHubUrl(input)).toEqual({ owner: 'owner', repo: 'repo', url: 'https://github.com/owner/repo', archiveUrl: 'https://codeload.github.com/owner/repo/zip/HEAD' });
  });
  it.each([
    'not a URL', 'http://github.com/owner/repo', 'file:///owner/repo', 'https://localhost/owner/repo',
    'https://github.com.evil.invalid/owner/repo', 'https://github.com@evil.invalid/owner/repo',
    'https://name:password@github.com/owner/repo', 'https://github.com:444/owner/repo',
    'https://github.com/owner', 'https://github.com/owner/repo/tree/main',
    'https://github.com/owner/repo?download=1', 'https://github.com/owner/repo#readme',
    'https://github.com/-owner/repo', 'https://github.com/owner/re%2fpo', 'https://github.com/owner/.git',
  ])('rejects an ambiguous or unsafe URL: %s', input => expect(() => parseGitHubUrl(input)).toThrow());
});
