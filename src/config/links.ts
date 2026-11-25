export const DONATE_URL = 'https://paypal.me/GoodProject';

function readViteEnv(key: string): string | undefined {
  try {
    const env = (import.meta as { env?: Record<string, string | undefined> }).env;
    const raw = env?.[key]?.trim();
    return raw && /^https?:\/\//i.test(raw) ? raw : undefined;
  } catch {
    return undefined;
  }
}

export function resolveDonateUrl(): string {
  return readViteEnv('VITE_DONATE_URL') ?? DONATE_URL;
}

export function resolveGitHubUrl(): string {
  const envUrl = readViteEnv('VITE_GITHUB_URL');
  if (envUrl) return envUrl;

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
