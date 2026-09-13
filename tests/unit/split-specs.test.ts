/**
 * split-pdfs 자동 task 생성 + 제목 정렬 가드.
 * - 모의 종목별 해설집(`교시_종목`)은 그 종목 문항으로만 분할
 * - 재분할 금지 항목(NO_RESPLIT_KEYS)은 자동 task에서 제외
 * - 문항↔구간이 한 칸씩 어긋난 분할(옛 형식 off-by-one)은 제목 대조로 차단
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { checkTitleAlignment, filterSpecs, generateAllSpecsFromMap, mergeSplitResultFile, mergeSplitResults, titleTokens } from '../../scripts/split-pdfs';
import { makeProblem } from '../helpers/problem-fixture';

const map = {
  기출: {
    '87': { '1_정보관리': { id: 'kichul-87-no-resplit' }, '1_컴시응': { id: 'kichul-87-app' } },
  },
  모의: {
    KPC: {
      '2016.01': {
        '3_컴시응': { id: 'app-3', name: '제67회 컴퓨터시스템응용_해설집_201601_3교시.pdf' },
        '3_정보관리': { id: 'mgmt-3', name: '제67회 정보관리_해설집_201601_3교시.pdf', questions: { '1': { id: 'q' } } },
      },
      '2010.10': { '2': { id: 'combined-2', name: '2교시해설-제22회(2010년10월).pdf' } },
      '2012.12': { '2_정보관리': { id: 'mgmt-no-resplit' }, '2_컴시응': { id: 'app-2012' } },
    },
  },
};

const specs = generateAllSpecsFromMap(map);
const byId = (id: string) => specs.find((s) => s.fileId === id);

describe('자동 task 생성', () => {
  it('P1: 모의 종목별 해설집 → 그 종목·교시·회차(-N 포함) 문항만', () => {
    const spec = byId('app-3')!;
    expect(spec).toMatchObject({ sourceType: '모의', round: '2016.01', session: '3', certScope: '컴시응' });
    const moui = (o: Parameters<typeof makeProblem>[0]) => makeProblem({ sourceType: '모의', academy: 'KPC', round: '2016.01', session: '3', ...o });
    expect(spec.problemFilter(moui({ certScope: '컴시응' }))).toBe(true);
    expect(spec.problemFilter(moui({ certScope: '정보관리' }))).toBe(false);
    expect(spec.problemFilter(moui({ certScope: '컴시응', session: '2' }))).toBe(false);
  });

  it('P2: 통합 해설집(교시 키)은 공통 — 모든 종목, base 회차의 -N 회차 포함', () => {
    const spec = byId('combined-2')!;
    expect(spec.certScope).toBe('공통');
    const p = (certScope: '정보관리' | '컴시응' | '공통', round: string) =>
      makeProblem({ sourceType: '모의', academy: 'KPC', round, session: '2', certScope });
    expect([p('정보관리', '2010.10-1'), p('컴시응', '2010.10-2'), p('공통', '2010.10')].every(spec.problemFilter)).toBe(true);
  });

  it('P3: 이미 분할된 항목과 재분할 금지 항목은 task를 만들지 않는다', () => {
    expect(byId('mgmt-3')).toBeUndefined();
    expect(byId('kichul-87-no-resplit')).toBeUndefined();
    expect(byId('mgmt-no-resplit')).toBeUndefined();
    expect(specs.map((s) => s.fileId).sort()).toEqual(['app-2012', 'app-3', 'combined-2', 'kichul-87-app']);
  });

  it('P4: SPLIT_ONLY — "모의:종목별"은 모의 종목별만, "기출"은 기출만, 빈 값은 전체', () => {
    expect(filterSpecs(specs, '모의:종목별').map((s) => s.fileId).sort()).toEqual(['app-2012', 'app-3']);
    expect(filterSpecs(specs, '기출').map((s) => s.fileId)).toEqual(['kichul-87-app']);
    expect(filterSpecs(specs, '')).toHaveLength(4);
    expect(filterSpecs(specs, undefined)).toHaveLength(4);
  });
});

describe('제목 정렬 가드', () => {
  const titles = ['UMB에 대하여 설명하시오', 'Semantic Web 기술', 'OCL 제약 언어를 설명하시오', 'L4/L7 스위치 비교'];
  const pageFor = (title: string) => `문 제 ${title} 출제 배경 답안 작성 ...`;

  it('P5: 제목 토큰은 서술어를 빼고 소문자로', () => {
    expect(titleTokens('OCL 제약 언어를 설명하시오')).toEqual(['ocl', '제약', '언어를']);
  });

  it('P6: 구간 첫 페이지마다 짝지은 제목이 있으면 offset 0', () => {
    expect(checkTitleAlignment(titles.map(pageFor), titles).bestOffset).toBe(0);
  });

  it('P7: 구간이 한 칸 앞 문항 내용이면(off-by-one) offset ±1로 잡는다', () => {
    const shifted = [pageFor('서문'), ...titles.slice(0, 3).map(pageFor)]; // i번째 구간에 i-1번째 문항
    expect(checkTitleAlignment(shifted, titles).bestOffset).toBe(-1);
    const ahead = [...titles.slice(1).map(pageFor), pageFor('부록')]; // i번째 구간에 i+1번째 문항
    expect(checkTitleAlignment(ahead, titles).bestOffset).toBe(1);
  });

  it('P8: 텍스트가 없는(스캔) PDF는 근거가 없으므로 0 (기존 동작 유지)', () => {
    expect(checkTitleAlignment(['', '', '', ''], titles).bestOffset).toBe(0);
  });

  it('P9: pdf.js처럼 글자 사이 공백이 있어도 대조된다', () => {
    const spaced = titles.map((t) => t.split('').join(' '));
    expect(checkTitleAlignment(spaced, titles).bestOffset).toBe(0);
  });
});

describe('분할 결과 머지', () => {
  const upload = (questionNumber: number, fileId: string, validated = true) => ({ questionNumber, fileId, fileName: `${fileId}.pdf`, validated });
  const moui = (round: string, session: string, certScope: '정보관리' | '컴시응' | '공통') => ({ sourceType: '모의' as const, round, session, certScope });

  it('P10: 검증된 분할만 해당 키에 머지 — 모의 종목별은 교시_종목, 실패 task·재분할 금지 항목은 제외', () => {
    const target = structuredClone(map) as any;
    const updated = mergeSplitResults(target, [
      { ok: true, task: moui('2016.01', '3', '컴시응'), uploaded: [upload(7, 'split-7'), upload(8, 'split-8', false)] },
      { ok: false, task: moui('2012.12', '2', '컴시응'), uploaded: [upload(1, 'failed-1')] },
      { ok: true, task: moui('2012.12', '2', '정보관리'), uploaded: [upload(1, 'forbidden-1')] },
      { ok: true, task: { sourceType: '기출', round: '87', session: '1', certScope: '컴시응' }, uploaded: [upload(2, 'kichul-2')] },
    ]);
    expect(updated).toBe(2);
    expect(target.모의.KPC['2016.01']['3_컴시응'].questions).toEqual({ '7': { id: 'split-7', name: 'split-7.pdf' } });
    expect(target.모의.KPC['2012.12']['2_컴시응']).not.toHaveProperty('questions');
    expect(target.모의.KPC['2012.12']['2_정보관리']).not.toHaveProperty('questions');
    expect(target.기출['87']['1_컴시응'].questions).toEqual({ '2': { id: 'kichul-2', name: 'kichul-2.pdf' } });
  });

  it('P11: 모의 -N 회차 task는 정확한 회차 키가 없으면 base 회차 entry에 머지', () => {
    const target = structuredClone(map) as any;
    expect(mergeSplitResults(target, [{ ok: true, task: moui('2010.10-2', '2', '공통'), uploaded: [upload(1, 'n1')] }])).toBe(1);
    expect(target.모의.KPC['2010.10']['2'].questions).toEqual({ '1': { id: 'n1', name: 'n1.pdf' } });
  });
});

describe('분할 결과 파일 머지', () => {
  it('P12: 같은 분할 결과를 다시 머지하면 매핑 파일을 다시 쓰지 않는다 ($generatedAt 유지)', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'split-merge-'));
    const mappingPath = path.join(dir, 'mapping.json');
    const resultPath = path.join(dir, 'result.json');
    writeFileSync(mappingPath, JSON.stringify({ $generatedAt: 'old', ...map }, null, 2) + '\n');
    writeFileSync(
      resultPath,
      JSON.stringify([{ ok: true, task: { sourceType: '모의', round: '2016.01', session: '3', certScope: '컴시응' }, uploaded: [{ questionNumber: 7, fileId: 's7', fileName: 's7.pdf', validated: true }] }]),
    );
    try {
      expect(mergeSplitResultFile(resultPath, mappingPath)).toBe(1);
      const afterFirst = readFileSync(mappingPath, 'utf8');
      expect(JSON.parse(afterFirst).$generatedAt).not.toBe('old');
      mergeSplitResultFile(resultPath, mappingPath);
      expect(readFileSync(mappingPath, 'utf8')).toBe(afterFirst);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('SPLIT_ONLY 회차 지정', () => {
  it('P13: "모의:회차=…"는 지정한 회차의 모의 task만', () => {
    expect(filterSpecs(specs, '모의:회차=2016.01, 2010.10').map((s) => s.fileId).sort()).toEqual(['app-3', 'combined-2']);
    expect(filterSpecs(specs, '모의:회차=2099.01')).toEqual([]);
  });
});
