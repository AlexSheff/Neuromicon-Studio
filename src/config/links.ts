export const DONATE_URL = 'https://paypal.me/GoodProject';

export function resolveGitHubUrl(): string {
  const envUrl = import.meta.env.VITE_GITHUB_URL?.trim();
  if (envUrl && /^https?:\/\//i.test(envUrl)) {
    return envUrl;
  }

  if (typeof window !== 'undefined') {
    const { hostname, pathname } = window.location;
    if (hostname.endsWith('.github.io')) {
      const owner = hostname.split('.')[0];
      const repo = pathname.split('/').filter(Boolean)[0];
      if (owner) {
        return repo ? `https://github.com/${owner}/${repo}` : `https://github.com/${owner}`;
      }
    }
  }

  return 'https://github.com';
}
