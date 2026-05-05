import { useState } from 'react';
import { useAuth } from '../lib/use-auth';

export default function AuthMenu() {
  const { user, loading, refresh } = useAuth();
  const [consentOpen, setConsentOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const baseUrl = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');

  if (loading) return <span className="text-xs text-gray-400">로딩</span>;

  if (!user) {
    const returnTo =
      typeof window !== 'undefined' ? window.location.pathname + window.location.search : '/';
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

  const toggleConsent = async (next: boolean) => {
    setBusy(true);
    try {
      await fetch(`${baseUrl}/api/consent`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ consent: next }),
      });
      refresh();
    } finally {
      setBusy(false);
    }
  };

  const consent = user.marketingConsent ?? false;

  return (
    <div className="relative flex items-center gap-2 text-xs">
      <button
        type="button"
        onClick={() => setConsentOpen((v) => !v)}
        className="font-medium text-gray-700 hover:underline"
      >
        {user.name ?? user.email ?? '사용자'} ▾
      </button>
      <a
        href={`${baseUrl}/api/auth/logout`}
        className="rounded border border-gray-300 bg-white px-2 py-1 hover:bg-gray-50"
      >
        로그아웃
      </a>
      {consentOpen && (
        <div
          className="absolute right-0 top-full z-30 mt-1 w-80 rounded-lg border border-gray-200 bg-white p-3 shadow-lg"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-2 rounded-md bg-emerald-50 p-2 text-xs text-emerald-900">
            <div className="font-semibold">✨ 신규 회차 해설지 우선 안내</div>
            <p className="mt-0.5 text-emerald-800">
              KPC 신규 회차의 해설지가 추가되는 즉시 가장 먼저 메일로 받아보실 수 있어요.
            </p>
          </div>
          <label className="flex cursor-pointer items-start gap-2 text-xs">
            <input
              type="checkbox"
              checked={consent}
              disabled={busy}
              onChange={(e) => toggleConsent(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-gray-300"
            />
            <span className="text-gray-700">
              <strong className="font-medium">광고성 정보 수신 동의</strong>
              <span className="ml-1 text-gray-400">(선택)</span>
            </span>
          </label>
          <p className="mt-2 text-[10px] text-gray-400">
            정보통신망법에 따라 동의자에게만 발송하며, 메일 하단의 수신거부 링크로 언제든 해제할 수 있습니다.
          </p>
        </div>
      )}
    </div>
  );
}
