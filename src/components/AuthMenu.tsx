import { useEffect, useState } from 'react';

interface AppUser {
  sub: string;
  name?: string;
  email?: string;
}

interface MeResponse {
  user: AppUser | null;
}

export default function AuthMenu() {
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);
  const baseUrl = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');

  useEffect(() => {
    let cancel = false;
    fetch(`${baseUrl}/api/me`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : Promise.resolve({ user: null })))
      .then((data: MeResponse) => {
        if (!cancel) {
          setUser(data.user);
          setLoading(false);
        }
      })
      .catch(() => !cancel && setLoading(false));
    return () => {
      cancel = true;
    };
  }, [baseUrl]);

  if (loading) {
    return <span className="text-xs text-gray-400">로딩</span>;
  }

  if (user) {
    return (
      <div className="flex items-center gap-2 text-xs">
        <span className="font-medium text-gray-700">
          {user.name ?? user.email ?? '사용자'}
        </span>
        <a
          href={`${baseUrl}/api/auth/logout`}
          className="rounded border border-gray-300 bg-white px-2 py-1 hover:bg-gray-50"
        >
          로그아웃
        </a>
      </div>
    );
  }

  const returnTo = typeof window !== 'undefined' ? window.location.pathname + window.location.search : '/';
  return (
    <a
      href={`${baseUrl}/api/auth/naver/login?return=${encodeURIComponent(returnTo)}`}
      className="inline-flex items-center gap-1.5 rounded bg-[#03C75A] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#02b150]"
    >
      <span className="font-bold">N</span>
      <span>네이버 로그인</span>
    </a>
  );
}
