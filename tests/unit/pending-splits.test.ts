/**
 * 엑셀이 해설지보다 늦게 올라온 회차 구제 — 이번 빌드에서 처음 문항이 생긴 미분할 매핑 키 판정.
 * (해설지 PDF를 먼저 올리면 split이 "문항 없음"으로 스킵하고, 이후 엑셀만 올려서는 재분할이 안 걸린다)
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { pendingSplitKeys, type ProblemLike } from '../../scripts/lib/pending-splits';

/** 2026-09-20 140회 해설지 8개 업로드 직후 sync된 실제 매핑 조각 (기출 139·140, 합숙 2026.08) */
const mapping = JSON.parse(
  readFileSync(new URL('../fixtures/mapping-diff/after-140-sync.json', import.meta.url), 'utf8'),
);

const kichul = (round: string, session: string, certScope: string): ProblemLike => ({
  sourceType: '기출', round, session, certScope, sessionPart: null,
});
const hapsuk = (round: string, session: string, sessionPart: string): ProblemLike => ({
  sourceType: '합숙', round, session, sessionPart, certScope: '공통',
});

/** 기출 140회 8개 교시 문항 (엑셀에 140회가 반영된 상태) */
const problems140 = ['정보관리', '컴시응'].flatMap((cert) =>
  ['1', '2', '3', '4'].map((s) => kichul('140', s, cert)),
);
/** 그 이전부터 있던 문항 — 139회(분할 완료)와 합숙 2026.08(분할 완료) */
const older: ProblemLike[] = [
  ...['1', '2', '3', '4'].map((s) => kichul('139', s, '정보관리')),
  ...['1일차', '2일차', '3일차'].flatMap((d) => ['1교시', '2교시'].map((k) => hapsuk('2026.08', d, k))),
];

describe('분할 대기 키 판정 (pendingSplitKeys)', () => {
  it('Z1: 엑셀이 늦게 올라온 회차 — 운영엔 없고 이번 빌드에 생긴 미분할 키만 나온다', () => {
    expect(pendingSplitKeys(older, [...older, ...problems140], mapping)).toEqual([
      '기출/140/1_정보관리',
      '기출/140/1_컴시응',
      '기출/140/2_정보관리',
      '기출/140/2_컴시응',
      '기출/140/3_정보관리',
      '기출/140/3_컴시응',
      '기출/140/4_정보관리',
      '기출/140/4_컴시응',
    ]);
  });

  it('Z2: 운영에 이미 문항이 있던 키는 제외 — 통합본 폴백한 옛 회차가 통째로 재분할되지 않는다', () => {
    // 140회가 운영에도 이미 있으면(분할만 안 된 상태) 대상 아님 — 이 조건이 옛 회차 548개를 막는다
    const live = [...older, ...problems140];
    expect(pendingSplitKeys(live, live, mapping)).toEqual([]);
  });

  it('Z3: 이미 분할된(questions 있는) 키는 문항이 새로 생겨도 제외', () => {
    // 139회·합숙 2026.08은 픽스처에서 questions를 가진 상태 → 신규 문항 취급해도 안 나옴
    expect(pendingSplitKeys([], older, mapping)).toEqual([]);
  });

  it('Z4: 해설지만 올라오고 엑셀에 문항이 아직 없으면 대상 아님 (분할해도 스킵되므로)', () => {
    expect(pendingSplitKeys([], [], mapping)).toEqual([]);
    // 140회 중 1교시 정보관리만 엑셀에 들어온 경우 그 키 하나만
    expect(pendingSplitKeys([], [kichul('140', '1', '정보관리')], mapping)).toEqual(['기출/140/1_정보관리']);
  });

  it('Z5: 매핑에 없는 회차의 문항이 생겨도 아무 키도 만들지 않는다 (해설지 미업로드)', () => {
    expect(pendingSplitKeys(older, [...older, kichul('141', '1', '정보관리')], mapping)).toEqual([]);
  });
});
