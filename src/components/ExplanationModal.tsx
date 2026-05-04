/**
 * 해설지 임베드 모달 (Google Drive `/preview` iframe).
 *
 * - ESC / 백드롭 클릭으로 닫기
 * - body 스크롤 잠금
 * - 모달 헤더에 "새 탭" / "다운로드" / "닫기"
 * - 모바일은 모달 대신 새 탭으로 여는 흐름은 ProblemCard에서 처리
 *   (iOS Safari iframe PDF 호환 이슈 회피 — requirements.md §6.1 F4)
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Problem } from '../lib/types';

interface Props {
  open: boolean;
  onClose: () => void;
  problem: Problem;
}

export default function ExplanationModal({ open, onClose, problem }: Props) {
  const [iframeFailed, setIframeFailed] = useState(false);
  const loadTimer = useRef<number | null>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // iframe 로드 실패(권한·쿠키 차단) 감지: 5초 안에 onLoad 안 오면 fallback 노출
    setIframeFailed(false);
    loadTimer.current = window.setTimeout(() => setIframeFailed(true), 5000);

    return () => {
      document.removeEventListener('keydown', handler);
      document.body.style.overflow = prevOverflow;
      if (loadTimer.current) window.clearTimeout(loadTimer.current);
    };
  }, [open, onClose, problem.explanationFileId]);

  const handleIframeLoad = () => {
    if (loadTimer.current) window.clearTimeout(loadTimer.current);
  };

  if (!open || !problem.explanationFileId) return null;

  const fileId = problem.explanationFileId;
  // /preview는 임베드 뷰 — Drive UI(다운로드/인쇄 버튼) 없이 PDF만 노출
  const previewUrl = `https://drive.google.com/file/d/${fileId}/preview`;
  const externalUrl = previewUrl;

  const sessionLabel =
    problem.sessionType === '교시'
      ? `${problem.session}교시`
      : problem.sessionPart
        ? `${problem.session} ${problem.sessionPart}`
        : problem.session;
  const numLabel = problem.questionLabel ? `${problem.questionLabel}번` : '';
  const headerTitle = [
    problem.sourceType,
    problem.certScope,
    problem.academy,
    problem.roundLabel,
    `${sessionLabel}${numLabel ? ` ${numLabel}` : ''}`,
  ]
    .filter(Boolean)
    .join(' · ');

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black/60 p-2 sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="해설지"
    >
      <div
        className="mx-auto flex h-full w-full max-w-5xl flex-col overflow-hidden rounded-lg bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center gap-2 border-b border-gray-200 px-3 py-2">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-semibold text-gray-900">{headerTitle}</h2>
            {problem.explanationFileName && (
              <p className="truncate text-xs text-gray-500">{problem.explanationFileName}</p>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <a
              href={externalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50"
              title="Drive에서 열기"
            >
              ↗ 새 탭
            </a>
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50"
              aria-label="닫기"
            >
              ✕
            </button>
          </div>
        </header>
        <div className="relative flex-1">
          <iframe
            src={previewUrl}
            className="h-full w-full border-0"
            title={problem.explanationFileName ?? '해설지'}
            allow="autoplay"
            onLoad={handleIframeLoad}
          />
          {iframeFailed && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/95 p-6 text-center">
              <p className="text-sm font-medium text-gray-900">
                해설지를 페이지 안에 표시할 수 없습니다
              </p>
              <p className="mt-2 max-w-md text-xs text-gray-600">
                Google Drive 공유 권한이 "링크 있는 모든 사용자 - 보기"로 설정되어
                있는지 확인해 주세요. 또는 브라우저의 third-party 쿠키 차단으로 인해 임베드가 막힐 수 있습니다.
              </p>
              <div className="mt-4 flex gap-2">
                <a
                  href={externalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
                >
                  ↗ 새 탭에서 열기
                </a>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
