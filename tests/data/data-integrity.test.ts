/**
 * 빌드된 운영 데이터(data/problems.json) + 해설지 매핑(explanation-files.json) 무결성.
 * 먼저 `npm run build:data`. CI에서는 빌드 직후 실행되어 실패 시 배포를 막는다.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { kichulRoundOrder } from '../../scripts/adapters/kpc-xls-adapter';
import { applyExplanationMap, type ExplanationEntry, type ExplanationMap } from '../../scripts/build';
import { isValidDriveFileId } from '../../src/lib/google-drive';
import type { Problem } from '../../src/lib/types';

const file = (rel: string) => fileURLToPath(new URL(`../../${rel}`, import.meta.url));
if (!existsSync(file('data/problems.json'))) {
  throw new Error('data/problems.json이 없습니다. `npm run build:data` 후 실행하세요.');
}

const problems: Problem[] = JSON.parse(readFileSync(file('data/problems.json'), 'utf8'));
const stats = JSON.parse(readFileSync(file('data/stats.json'), 'utf8'));
const mapping = JSON.parse(readFileSync(file('data/mappings/explanation-files.json'), 'utf8'));

const CERT_SLUG = { 정보관리: 'mgmt', 컴시응: 'app', 공통: 'common' } as const;

// PROJECT.md §10 "옛 회차 분할 정렬 오류": 분할본이 한 칸씩 어긋나 통합본으로 폴백한 회차 — 재분할 금지
const NO_SPLIT_ENTRIES: [string, ...string[]][] = [
  ['기출', '87', '1_정보관리'], ['기출', '93', '3_정보관리'], ['기출', '93', '4_정보관리'], ['기출', '105', '4_컴시응'],
  ['모의', 'KPC', '2010.10', '1'], ['모의', 'KPC', '2012.04', '3'], ['모의', 'KPC', '2012.04', '4'], ['모의', 'KPC', '2012.12', '2'],
  ['모의', 'KPC', '2013.05', '3'], ['모의', 'KPC', '2014.04', '2'], ['모의', 'KPC', '2022.11', '3'], ['모의', 'KPC', '2023.11', '4'],
];

// 모의 옛 회차 종목 불일치(아래 D13) 발견 시점(2026-09-13)의 건수. 늘어나면 실패, 고치면 줄여 갈 것.
const KNOWN_MOUI_CERT_MISMATCH = 1495;

/** 규칙을 어긴 문항 수와 앞 5건 */
function violations(reason: (p: Problem) => string | null | false) {
  const found = problems.flatMap((p) => {
    const r = reason(p);
    return r ? [`${p.id}: ${r}`] : [];
  });
  return { count: found.length, sample: found.slice(0, 5) };
}
const NONE = { count: 0, sample: [] };

function mappedEntries() {
  const out: { sourceType: string; path: string[]; entry: ExplanationEntry }[] = [];
  const walk = (sourceType: string, path: string[], node: any) => {
    if (node && typeof node.id === 'string') {
      out.push({ sourceType, path, entry: node });
    } else if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) walk(sourceType, [...path, k], v);
    }
  };
  for (const st of ['기출', '합숙', '모의', '자체']) walk(st, [], mapping[st] ?? {});
  return out;
}

/** 해설지 파일명이 가리키는 종목 (정보관리/컴시응만, 공통·불명은 null) */
function fileCert(name: string): '정보관리' | '컴시응' | null {
  const split = name.match(/^(?:기출|합숙|모의)_[^_]+_(정보관리|컴시응|공통)_/);
  if (split) return split[1] === '공통' ? null : (split[1] as '정보관리' | '컴시응');
  if (/컴퓨터시스템응용|조직응용|컴시응/.test(name)) return '컴시응';
  if (/정보관리/.test(name)) return '정보관리';
  return null;
}

function certMismatches(sourceType: string) {
  return problems.filter((p) => {
    if (p.sourceType !== sourceType || p.certScope === '공통' || !p.explanationFileName) return false;
    const cert = fileCert(p.explanationFileName);
    return cert !== null && cert !== p.certScope;
  });
}

describe('문항 데이터 규칙', () => {
  it('D1: 1만 건 이상, stats.json 합계와 일치, id 중복 없음', () => {
    expect(problems.length).toBeGreaterThan(10_000);
    expect(stats.total).toBe(problems.length);
    expect(problems.length - new Set(problems.map((p) => p.id)).size).toBe(0);
  });

  it('D2: 학원 귀속 — 기출은 null, 합숙·모의는 반드시 학원', () => {
    expect(violations((p) => ((p.sourceType === '기출') !== (p.academy === null)) && `academy=${p.academy}`)).toEqual(NONE);
  });

  it('D3: ID가 출처·학원·회차·종목·교시 슬러그로 시작', () => {
    expect(
      violations((p) => {
        const cert = CERT_SLUG[p.certScope];
        const aca = (p.academy ?? '').toLowerCase();
        const prefix =
          p.sourceType === '기출' ? `kichul-${p.round}-${cert}-${p.session}-`
          : p.sourceType === '합숙' ? `hapsuk-${aca}-${p.round}-${cert}-${p.session.replace(/일차$/, 'ilcha')}-`
          : `moui-${aca}-${p.round}-${cert}-${p.session}-`;
        return !p.id.startsWith(prefix) && `기대 접두어 ${prefix}`;
      }),
    ).toEqual(NONE);
  });

  it('D4: 합숙은 N일차 + 1/2교시, 기출·모의는 숫자 교시 + sessionPart 없음', () => {
    expect(
      violations((p) =>
        p.sourceType === '합숙'
          ? (p.sessionType !== '일차' || !/^\d+일차$/.test(p.session) || !['1교시', '2교시'].includes(p.sessionPart ?? '')) &&
            `${p.sessionType}/${p.session}/${p.sessionPart}`
          : (p.sessionType !== '교시' || !/^\d+$/.test(p.session) || p.sessionPart) && `${p.sessionType}/${p.session}/${p.sessionPart}`,
      ),
    ).toEqual(NONE);
  });

  it('D5: 회차 표기·정렬값 일관성 (기출은 시험 연월 공식, 합숙·모의는 YYYYMMSS)', () => {
    expect(
      violations((p) => {
        if (p.sourceType === '기출') {
          const ok = /^\d+$/.test(p.round) && p.roundLabel === `${p.round}회` && p.roundOrder === kichulRoundOrder(Number(p.round));
          return !ok && `${p.round}/${p.roundLabel}/${p.roundOrder}`;
        }
        const m = p.round.match(/^(\d{4})\.(\d{2})(?:-(\d+))?$/);
        const ok = m && p.roundLabel === `${p.sourceType}_${p.round}` && p.roundOrder === Number(`${m[1]}${m[2]}${(m[3] ?? '0').padStart(2, '0')}`);
        return !ok && `${p.round}/${p.roundLabel}/${p.roundOrder}`;
      }),
    ).toEqual(NONE);
  });

  it('D6: 문항번호는 모두 채워져 있고 라벨과 일치, 제목·본문 비어 있지 않음', () => {
    expect(
      violations((p) => {
        if (p.questionNumber === null) return '문항번호 없음';
        const labels = p.questionSubNumber === null
          ? [String(p.questionNumber)]
          : [`${p.questionNumber}.${p.questionSubNumber}`, `${p.questionNumber}-${p.questionSubNumber}`];
        if (!labels.includes(p.questionLabel)) return `라벨 ${p.questionLabel}`;
        return (!p.title.trim() || !p.content.trim()) && '제목/본문 비어 있음';
      }),
    ).toEqual(NONE);
  });
});

describe('해설지 매핑 무결성', () => {
  const entries = mappedEntries();

  it('D7: Drive fileId 형식이 유효하고 분할 문항 키는 양의 정수, 분할 파일이 여러 항목에 중복되지 않음', () => {
    const bad: string[] = [];
    const seen = new Map<string, string>();
    for (const { sourceType, path, entry } of entries) {
      const where = [sourceType, ...path].join('/');
      if (!isValidDriveFileId(entry.id)) bad.push(`${where}: id ${entry.id}`);
      for (const [q, split] of Object.entries(entry.questions ?? {})) {
        if (!/^[1-9]\d*$/.test(q)) bad.push(`${where}: 문항 키 ${q}`);
        if (!isValidDriveFileId(split.id)) bad.push(`${where}/${q}: id ${split.id}`);
        if (seen.has(split.id)) bad.push(`${where}/${q}: ${seen.get(split.id)}와 같은 분할 파일`);
        seen.set(split.id, `${where}/${q}`);
      }
    }
    expect(bad.slice(0, 5)).toEqual([]);
  });

  it('D8: 문항에 연결된 해설지 id는 모두 매핑 파일에 존재', () => {
    const ids = new Set(entries.flatMap(({ entry }) => [entry.id, ...Object.values(entry.questions ?? {}).map((q) => q.id)]));
    expect(violations((p) => !!p.explanationFileId && !ids.has(p.explanationFileId) && `없는 id ${p.explanationFileId}`)).toEqual(NONE);
  });

  it('D9: [재분할 금지] 옛 형식 12개 회차에는 분할(questions)이 없다', () => {
    const resplit = NO_SPLIT_ENTRIES.filter(([st, ...path]) => {
      const entry = path.reduce((node: any, key) => node?.[key], mapping[st]);
      return entry?.questions !== undefined;
    });
    expect(resplit.map((e) => e.join('/'))).toEqual([]);
  });

  it('D10: 빌드 결과의 해설지 연결이 현재 매핑 파일과 같다 (매핑 갱신 후 재빌드 누락 감지)', () => {
    const rebuilt = problems.map((p) => ({ ...p, explanationFileId: null, explanationFileName: null }));
    applyExplanationMap(rebuilt, { 기출: mapping.기출, 합숙: mapping.합숙, 모의: mapping.모의, 자체: mapping.자체 } as ExplanationMap);
    const diffs = rebuilt.filter((p, i) => (p.explanationFileId ?? null) !== (problems[i].explanationFileId ?? null)).map((p) => p.id);
    expect({ count: diffs.length, sample: diffs.slice(0, 5) }).toEqual(NONE);
  });

  it('D11: 기출·합숙은 해설지 파일명의 종목이 문항 종목과 같다', () => {
    const mismatched = [...certMismatches('기출'), ...certMismatches('합숙')];
    expect(mismatched.slice(0, 5).map((p) => `${p.id} → ${p.explanationFileName}`)).toEqual([]);
  });

  it(`D12: 모의 종목 불일치가 알려진 ${KNOWN_MOUI_CERT_MISMATCH}건보다 늘지 않는다`, () => {
    expect(certMismatches('모의').length).toBeLessThanOrEqual(KNOWN_MOUI_CERT_MISMATCH);
  });

  // 알려진 결함: 옛 모의(2010~2017) 정보관리/컴시응 별도 해설집이 sync에서 `학원/회차/교시` 한 키로
  // 합쳐져 한 종목 파일만 남음 → 다른 종목 문항에 엉뚱한 해설이 연결됨. 고치면 이 테스트가 "예상 밖 통과"로
  // 실패하니 it.fails → it 으로 바꾸고 D12 기준값을 0으로.
  it.fails('D13: [알려진 결함] 모의도 해설지 파일명의 종목이 문항 종목과 같아야 한다', () => {
    expect(certMismatches('모의').length).toBe(0);
  });
});
