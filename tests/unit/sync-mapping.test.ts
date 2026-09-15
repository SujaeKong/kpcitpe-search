/**
 * Drive sync 매핑 규칙: 모의 해설집 파일명 → 매핑 키(종목 포함 여부), 분할 정보 보존.
 * 2026-09 결함: 모의 키에 종목이 없어 정보관리/컴시응 해설집 중 하나만 남고 다른 종목 문항에 연결됨.
 */
import { describe, expect, it } from 'vitest';
import { mouiFileCert, mouiMappingKey, NO_RESPLIT_KEYS, sameMappingContent } from '../../scripts/lib/explanation-keys';
import { collectQuestionsByFileId, parseMoui, restoreQuestionsByFileId } from '../../scripts/sync-drive-mappings';

describe('모의 해설집 파일명 → 매핑 키', () => {
  it('M1: 신형 통합 해설집은 종목 없음', () => {
    expect(parseMoui('[KPC기술사IMPACT실전모의고사]_제131회_해설집_202607_1교시.pdf')).toEqual({ round: '2026.07', session: '1', cert: null });
  });

  it('M2: 옛 회차 종목별 해설집은 종목을 읽는다 (컴퓨터시스템응용·조직응용 → 컴시응)', () => {
    expect(parseMoui('[KPC기술사IMPACT실전모의고사]_제67회 컴퓨터시스템응용_해설집_201601_3교시.pdf')).toEqual({ round: '2016.01', session: '3', cert: '컴시응' });
    expect(parseMoui('[KPC기술사IMPACT실전모의고사]_제42회 정보관리_해설집_201212_2교시.pdf')).toEqual({ round: '2012.12', session: '2', cert: '정보관리' });
    expect(parseMoui('86회 정보관리_해설집_201812_3교시.pdf')).toEqual({ round: '2018.12', session: '3', cert: '정보관리' });
    expect(parseMoui('[조직응용]1교시해설-제25회(2010년12월)KPC기술사IMPACT실전모의고사(김대원PE).pdf')).toEqual({ round: '2010.12', session: '1', cert: '컴시응' });
  });

  it('M3: 종목 표기 없는 옛 통합본([공통], 정보처리통합, 정보처리(컴퓨터))은 종목 없음', () => {
    for (const name of [
      '[공통]1교시해설-제27회(2011년03월)KPC기술사-남경식.pdf',
      '[KPC기술사IMPACT실전모의고사]_제36회 정보처리통합_해설집_201204_3교시.pdf',
      '[KPC기술사IMPACT실전모의고사]_제40회 정보처리(컴퓨터)_해설집_201210_1교시.pdf',
    ]) {
      expect(parseMoui(name)?.cert, name).toBeNull();
    }
  });

  it('M4: 모범답안·문제지는 매핑하지 않는다', () => {
    expect(parseMoui('[KPC기술사IMPACT실전모의고사]_제131회_모범답안_202607_1교시.pdf')).toBeNull();
    expect(parseMoui('1교시문제-제22회(2010년10월).pdf')).toBeNull();
  });

  it('M5: 키는 종목별이면 "교시_종목", 통합이면 "교시"', () => {
    expect(mouiMappingKey('3', '컴시응')).toBe('3_컴시응');
    expect(mouiMappingKey('3', null)).toBe('3');
    expect(mouiFileCert('제59회 정보관리_해설집')).toBe('정보관리');
  });
});

describe('sync의 분할 정보(questions) 보존', () => {
  it('M6: 키 경로가 바뀌어도 같은 fileId entry에 questions를 복원한다', () => {
    const prev = { 모의: { KPC: { '2016.01': { '3': { id: 'file-app', name: 'app', questions: { '7': { id: 'q7', name: 'q7.pdf' } } } } } } };
    const next: any = {
      $comment: 'meta',
      모의: { KPC: { '2016.01': { '3_컴시응': { id: 'file-app', name: 'app' }, '3_정보관리': { id: 'file-mgmt', name: 'mgmt' } } } },
    };
    restoreQuestionsByFileId(next, collectQuestionsByFileId(prev));
    expect(next.모의.KPC['2016.01']['3_컴시응'].questions).toEqual({ '7': { id: 'q7', name: 'q7.pdf' } });
    expect(next.모의.KPC['2016.01']['3_정보관리']).not.toHaveProperty('questions');
  });

  it('M7: 파일이 교체된 entry(새 fileId)에는 옛 분할 정보를 붙이지 않는다', () => {
    const prev = { 기출: { '140': { '1_정보관리': { id: 'old-file', questions: { '1': { id: 'q1' } } } } } };
    const next: any = { 기출: { '140': { '1_정보관리': { id: 'new-file' } } } };
    restoreQuestionsByFileId(next, collectQuestionsByFileId(prev));
    expect(next.기출['140']['1_정보관리']).not.toHaveProperty('questions');
  });

  it('M8: 재분할 금지 목록 12건 — 모의 종목별 해설집 3건은 종목 키 경로', () => {
    expect(NO_RESPLIT_KEYS).toHaveLength(12);
    expect(NO_RESPLIT_KEYS.filter((k) => /_정보관리$/.test(k) && k.startsWith('모의/'))).toEqual([
      '모의/KPC/2012.12/2_정보관리',
      '모의/KPC/2013.05/3_정보관리',
      '모의/KPC/2014.04/2_정보관리',
    ]);
  });
});

describe('시각만 바뀐 매핑 커밋 방지', () => {
  it('M9: $generatedAt과 키 순서는 무시하고, 실제 매핑·분할 변경은 감지한다', () => {
    const a = { $comment: 'c', $generatedAt: '2026-09-12T00:00:00Z', 기출: { '140': { '1_정보관리': { id: 'f1', name: 'n' } } } };
    const reordered = { 기출: { '140': { '1_정보관리': { name: 'n', id: 'f1' } } }, $generatedAt: '2026-09-13T00:00:00Z', $comment: 'c' };
    expect(sameMappingContent(a, reordered)).toBe(true);
    const withSplit = structuredClone(a) as any;
    withSplit.기출['140']['1_정보관리'].questions = { '1': { id: 'q1' } };
    expect(sameMappingContent(a, withSplit)).toBe(false);
  });
});

describe('파일명 연월 오기 보정', () => {
  it('M10: 본문으로 확인한 연월 오기 파일은 실제 회차로, 회차 번호만 틀린 파일은 파일명 연월 그대로', () => {
    expect(parseMoui('KPC기술사모의고사_해설집_31회_201104_정보관리_1교시_유동근PE.pdf')).toEqual({ round: '2011.07', session: '1', cert: '정보관리' });
    expect(parseMoui('[KPC기술사IMPACT실전모의고사]_제76회 컴퓨터시스템응용_해설집_201704_1교시_v1.1.pdf')).toEqual({ round: '2017.06', session: '1', cert: '컴시응' });
    expect(parseMoui('[KPC기술사IMPACT실전모의고사]_제116회_해설집_202311_4교시.pdf')).toEqual({ round: '2023.12', session: '4', cert: null });
    expect(parseMoui('[정보관리]1교시해설-제25회(2011년01월)KPC기술사-최재준.pdf')?.round).toBe('2011.01');
    expect(parseMoui('[KPC기술사IMPACT실전모의고사]_제75회 컴퓨터시스템응용_해설집_201704_2교시.pdf')?.round).toBe('2017.04');
  });
});
