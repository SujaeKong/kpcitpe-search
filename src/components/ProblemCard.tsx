import { useState } from 'react';
import type { Problem } from '../lib/types';
import Badge from './Badge';
import HighlightedText, { findIndicesForKey } from './HighlightedText';
import type { SearchResult } from '../lib/search';
import ExplanationModal from './ExplanationModal';

interface Props {
  result: SearchResult;
}

const MOBILE_BREAKPOINT = 768; // iOS Safari iframe PDF 호환 이슈로 모바일은 새 탭 전환

export default function ProblemCard({ result }: Props) {
  const p: Problem = result.problem;
  const [modalOpen, setModalOpen] = useState(false);
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
  const externalUrl = hasExplanation
    ? `https://drive.google.com/file/d/${p.explanationFileId}/view`
    : null;

  const handleOpenExplanation = (e: React.MouseEvent) => {
    e.preventDefault();
    if (typeof window !== 'undefined' && window.innerWidth < MOBILE_BREAKPOINT && externalUrl) {
      window.open(externalUrl, '_blank', 'noopener,noreferrer');
    } else {
      setModalOpen(true);
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
    </article>
  );
}
