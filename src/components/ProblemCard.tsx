import { useState } from 'react';
import { createPortal } from 'react-dom';
import type { Problem } from '../lib/types';
import Badge from './Badge';
import HighlightedText, { findIndicesForKey } from './HighlightedText';
import type { SearchResult } from '../lib/search';
import ExplanationModal from './ExplanationModal';
import { useAuth } from '../lib/use-auth';

interface Props {
  result: SearchResult;
}

const MOBILE_BREAKPOINT = 768; // iOS Safari iframe PDF 호환 이슈로 모바일은 새 탭 전환

export default function ProblemCard({ result }: Props) {
  const p: Problem = result.problem;
  const [modalOpen, setModalOpen] = useState(false);
  const [consentPromptOpen, setConsentPromptOpen] = useState(false);
  const [consentBusy, setConsentBusy] = useState(false);
  const { user, loading: authLoading, refresh } = useAuth();
  const baseUrl = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');
  // 로그인했지만 광고성 정보 수신 미동의 → 해설지 게이트 대상
  const needsConsent = Boolean(user) && !user?.marketingConsent;
  const titleIdx = findIndicesForKey(result.matches, 'title');
  const contentIdx = findIndicesForKey(result.matches, 'content');
  const sessionLabel =
    p.sessionType === '교시'
      ? `${p.session}교시`
      : p.sessionPart
        ? `${p.session} ${p.sessionPart}`
        : p.session;
  const numLabel = p.questionLabel ? `${p.questionLabel}번` : '';

  const hasExplanation = Boolean(p.explanationFileId);
  // NOTE: 서버 프록시(/api/explanation) 전환은 OAuth refresh token invalid_grant로
  // 보류. 자격증명 복구 전까지 Drive 직접 /preview로 임시 복구 (파일은 아직 공개).
  const externalUrl = hasExplanation
    ? `https://drive.google.com/file/d/${p.explanationFileId}/preview`
    : null;

  // 해설지 뷰 실제 오픈 (모바일은 새 탭, 데스크탑은 모달)
  const openExplanationView = () => {
    if (typeof window !== 'undefined' && window.innerWidth < MOBILE_BREAKPOINT && externalUrl) {
      window.open(externalUrl, '_blank', 'noopener,noreferrer');
    } else {
      setModalOpen(true);
    }
  };

  const handleOpenExplanation = (e: React.MouseEvent) => {
    e.preventDefault();
    if (authLoading) return;
    // 1) 미로그인 → 네이버 로그인
    if (!user) {
      const returnTo =
        typeof window !== 'undefined'
          ? window.location.pathname + window.location.search
          : '/';
      window.location.href = `${baseUrl}/api/auth/naver/login?return=${encodeURIComponent(returnTo)}`;
      return;
    }
    // 2) 로그인했지만 수신 미동의 → 그 자리에서 동의 프롬프트
    if (!user.marketingConsent) {
      setConsentPromptOpen(true);
      return;
    }
    // 3) 동의 완료 → 바로 열기
    openExplanationView();
  };

  // 프롬프트에서 "동의하고 보기": 수신동의 저장 → 인증 캐시 갱신 → 해설지 오픈
  const handleConsentAndView = async () => {
    setConsentBusy(true);
    try {
      const res = await fetch(`${baseUrl}/api/consent`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ consent: true }),
      });
      if (!res.ok) throw new Error('consent failed');
      refresh();
      setConsentPromptOpen(false);
      openExplanationView();
    } catch {
      // 네트워크/서버 오류: 프롬프트 유지하고 버튼만 다시 활성화
    } finally {
      setConsentBusy(false);
    }
  };

  return (
    <article className="rounded border border-gray-200 bg-white p-4 hover:shadow-sm transition-shadow">
      <header className="flex flex-wrap items-center gap-1.5 text-xs">
        <Badge variant="source">{p.sourceType}</Badge>
        <Badge variant="cert">{p.certScope}</Badge>
        {p.academy && <Badge variant="academy">{p.academy}</Badge>}
        <Badge variant="round">{p.roundLabel}</Badge>
        <Badge variant="session">
          {sessionLabel}
          {numLabel && ` ${numLabel}`}
        </Badge>
        {p.preparingFor && (
          <span className="ml-auto text-gray-500">{p.preparingFor}</span>
        )}
      </header>

      <h3 className="mt-2 text-base font-semibold text-gray-900">
        <HighlightedText text={p.title} indices={titleIdx} />
      </h3>

      <p className="mt-1.5 text-sm text-gray-600 whitespace-pre-wrap break-words">
        <HighlightedText
          text={p.content}
          indices={contentIdx}
          windowed
          maxLength={220}
        />
      </p>

      <footer className="mt-3 flex items-center gap-2 text-sm">
        {hasExplanation ? (
          <button
            type="button"
            onClick={handleOpenExplanation}
            className="rounded border border-gray-300 px-2.5 py-1 hover:bg-gray-50"
          >
            📖 해설지 보기
            {!authLoading && !user && (
              <span className="ml-1 text-xs text-gray-400">(로그인 필요)</span>
            )}
            {!authLoading && needsConsent && (
              <span className="ml-1 text-xs text-gray-400">(수신동의 필요)</span>
            )}
          </button>
        ) : (
          <span className="text-xs text-gray-400">해설지 준비 중</span>
        )}
      </footer>
      <ExplanationModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        problem={p}
      />
      {consentPromptOpen &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
            onClick={() => !consentBusy && setConsentPromptOpen(false)}
            role="dialog"
            aria-modal="true"
            aria-label="수신동의 안내"
          >
            <div
              className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-900">
                <div className="font-semibold">✨ 해설지는 수신동의 후 볼 수 있어요</div>
                <p className="mt-1 text-emerald-800">
                  KPC 신규 회차의 해설지가 추가되는 즉시 가장 먼저 메일로 받아보실 수 있어요.
                </p>
              </div>
              <p className="mt-3 text-xs text-gray-600">
                아래 <strong className="font-medium">동의하고 보기</strong>를 누르면 광고성 정보
                수신에 동의하게 되며, 바로 해설지가 열립니다.
              </p>
              <p className="mt-1 text-[10px] text-gray-400">
                정보통신망법에 따라 동의자에게만 발송하며, 메일 하단의 수신거부 링크로 언제든 해제할
                수 있습니다.
              </p>
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setConsentPromptOpen(false)}
                  disabled={consentBusy}
                  className="rounded border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-60"
                >
                  닫기
                </button>
                <button
                  type="button"
                  onClick={handleConsentAndView}
                  disabled={consentBusy}
                  className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
                >
                  {consentBusy ? '처리 중…' : '동의하고 보기'}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </article>
  );
}
