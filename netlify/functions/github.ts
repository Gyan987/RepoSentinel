import { handleGitHubArchive } from '../../src/server/github';

export default async (request: Request): Promise<Response> => handleGitHubArchive(request);
