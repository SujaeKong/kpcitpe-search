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
          className="absolute right-0 top-full z-30 mt-1 w-72 rounded-lg border border-gray-200 bg-white p-3 shadow-lg"
          onClick={(e) => e.stopPropagation()}
        >
          <p className="mb-2 text-xs text-gray-600">
            KPC 기술사회의 신규 강의 / 합숙 / 모의고사 안내 메일을 받으시려면 동의해 주세요.
            언제든 해제 가능.
          </p>
          <label className="flex cursor-pointer items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={consent}
              disabled={busy}
              onChange={(e) => toggleConsent(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300"
            />
            <span className="text-gray-700">마케팅 정보 수신 동의 (선택)</span>
          </label>
          <p className="mt-2 text-[10px] text-gray-400">
            정보통신망법에 따라 광고성 정보는 동의자에게만 발송. 발송 시 수신거부 링크 포함.
          </p>
        </div>
      )}
    </div>
  );
}
