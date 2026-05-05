/**
 * 모든 React island가 공유하는 인증 상태 hook.
 * 모듈 레벨 캐시로 /api/me는 한 번만 호출됨.
 */
import { useEffect, useState } from 'react';

export interface AppUser {
  sub: string;
  name?: string;
  email?: string;
  marketingConsent?: boolean;
}

interface MeResponse {
  user: AppUser | null;
}

let cachedPromise: Promise<AppUser | null> | null = null;
const listeners = new Set<(user: AppUser | null) => void>();

function getBaseUrl(): string {
  // Astro의 BASE_URL은 / (Cloudflare) 또는 /kpcitpe-search/ (GitHub Pages 옛날 빌드)
  return (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');
}

async function loadUser(): Promise<AppUser | null> {
  if (cachedPromise) return cachedPromise;
  cachedPromise = fetch(`${getBaseUrl()}/api/me`, { credentials: 'include' })
    .then((r) => (r.ok ? r.json() : Promise.resolve({ user: null })))
    .then((d: MeResponse) => d.user)
    .catch(() => null);
  return cachedPromise;
}

/** 캐시 무효화 + 리스너 알림. consent 변경 등 후 호출. */
function refresh(): void {
  cachedPromise = null;
  loadUser().then((u) => {
    for (const l of listeners) l(u);
  });
}

export function useAuth(): {
  user: AppUser | null;
  loading: boolean;
  refresh: () => void;
} {
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancel = false;
    loadUser().then((u) => {
      if (!cancel) {
        setUser(u);
        setLoading(false);
      }
    });
    const onUpdate = (u: AppUser | null) => {
      if (!cancel) setUser(u);
    };
    listeners.add(onUpdate);
    return () => {
      cancel = true;
      listeners.delete(onUpdate);
    };
  }, []);

  return { user, loading, refresh };
}
