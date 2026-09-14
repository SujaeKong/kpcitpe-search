/**
 * Drive sync 파일명·폴더명 파서 회귀 테스트.
 * - 패턴별 예시(코드 주석의 기출 A~G·fallback·무시 패턴, 합숙, 폴더명 회차, 카테고리)
 * - 골든: explanation-files.json에 실제로 매핑된 Drive 파일명 전부를 다시 파싱해 같은 키가 나오는지
 *   → 패턴을 고치다 기존 파일이 안 잡히거나 다른 키로 가면(해설지 연결이 조용히 사라짐) 바로 실패
 * - 매핑 조립(buildMappingFromTree): 보완본 우선·먼저 찾은 파일 유지·모의 종목 키·연월 오기 보정
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mouiMappingKey } from '../../scripts/lib/explanation-keys';
import {
  buildMappingFromTree,
  classifyCategory,
  extractKichulRoundFromFolderName,
  extractRoundFromFolderName,
  parseHapsuk,
  parseKichul,
  parseMoui,
} from '../../scripts/sync-drive-mappings';

const mapping = JSON.parse(readFileSync(fileURLToPath(new URL('../../data/mappings/explanation-files.json', import.meta.url)), 'utf8'));

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {}); // buildMappingFromTree 진행 로그 숨김
});

describe('기출 파일명 (parseKichul)', () => {
  it.each([
    ['A 대괄호 종목_교시', '[컴퓨터시스템응용_1교시]제101회 기술사 문제풀이.pdf', '1', '컴시응'],
    ['A 대괄호 종목-교시', '[정보관리-2교시]제101회 기술사 문제풀이.pdf', '2', '정보관리'],
    ['A 조직응용', '[조직응용-1교시]제95회 문제풀이.pdf', '1', '컴시응'],
    ['B 기출풀이_교시_종목', '124회_기출풀이_3교시_정보관리.pdf', '3', '정보관리'],
    ['C 기출문제풀이_종목-교시', '121회_기출문제풀이_컴시응-4교시.pdf', '4', '컴시응'],
    ['D 해설집_종목_교시', '96회_해설집_정보관리_2교시.pdf', '2', '정보관리'],
    ['E 회차 종목 기출해설지 교시', '122회 정보관리 기출해설지 1교시.pdf', '1', '정보관리'],
    ['F 해설지 종목 교시', '해설지 컴시응 3교시.pdf', '3', '컴시응'],
    ['G 회차-종목 …-교시', '87회-조직응용 문제풀이집-1교시 v1.0.pdf', '1', '컴시응'],
    ['fallback', '130회_기출풀이_정보관리 1교시.pdf', '1', '정보관리'],
  ])('K1 %s: %s → %s교시 %s', (_label, name, session, certScope) => {
    expect(parseKichul(name)).toMatchObject({ session, certScope, isBowan: false });
  });

  it('K2: 보완본 표시를 읽는다', () => {
    expect(parseKichul('[정보관리-2교시]제101회 문제풀이 보완.pdf')).toMatchObject({ session: '2', certScope: '정보관리', isBowan: true });
  });

  it.each([
    ['종목 통합본', '130회_기출풀이(1).pdf'],
    ['기출분석 시리즈', '1. 기출분석 데이터베이스.pdf'],
    ['동기회 통합본', '138회 동기회 해설.pdf'],
    ['회차 종목 통합', '138회 정보관리 통합.pdf'],
    ['교시 없는 통합본', '138회 해설 통합본.pdf'],
    ['문항 단위 수동 분할본', '관리_130_1_13_해설지.pdf'],
    ['종목 없음', '138회 1교시 해설.pdf'],
  ])('K3 무시: %s (%s)', (_label, name) => {
    expect(parseKichul(name)).toBeNull();
  });
});

describe('합숙 파일명 (parseHapsuk)', () => {
  it('H1: 합숙해설집 + N일차 N교시 (공백·밑줄 모두)', () => {
    expect(parseHapsuk('KPC 138회 대비 합숙해설집_1일차_1교시_통합.pdf')).toBe('1일차_1교시');
    expect(parseHapsuk('KPC 140회 대비 합숙해설집 3일차 2교시.pdf')).toBe('3일차_2교시');
  });

  it('H2: 합숙해설집이 아니거나 교시가 없으면 무시', () => {
    expect(parseHapsuk('KPC 138회 합숙 문제지_1일차_1교시.pdf')).toBeNull();
    expect(parseHapsuk('KPC 138회 대비 합숙해설집_1일차.pdf')).toBeNull();
  });
});

describe('폴더명', () => {
  it.each([
    ['138회 (2026-02)', '2026.02'],
    ['093회합숙(2011-02)', '2011.02'],
    ['합숙(2010-10-2)', '2010.10-2'],
    ['제129회(26년04월)KPC기술사 모의고사 해설집', '2026.04'],
    ['제100회_KPC기술사모의고사_정보처리_모범답안(202205)', '2022.05'],
    ['제50회 모의고사', null],
  ])('R1 합숙·모의 회차 폴더 %s → %s', (name, round) => {
    expect(extractRoundFromFolderName(name)).toBe(round);
  });

  it('R2: 기출 회차 폴더 — 제N회에서 앞자리 0 제거, 없으면 null', () => {
    expect(extractKichulRoundFromFolderName('제138회 기출문제 해설집')).toBe('138');
    expect(extractKichulRoundFromFolderName('제089회 정보관리기술사')).toBe('89');
    expect(extractKichulRoundFromFolderName('138회 기출')).toBeNull();
  });

  it.each([
    ['01. 기출문제 & 모의고사', null],
    ['01. 기출문제', '기출'],
    ['03. KPC 모의고사(해설집)', '모의해설집'],
    ['02. KPC 모의고사(모범답안)', null],
    ['04. KPC 합숙', '합숙'],
    ['05. 타학원 자료', null],
  ])('R3 카테고리 폴더 %s → %s', (name, category) => {
    expect(classifyCategory(name)).toBe(category);
  });
});

describe('골든: 현재 매핑의 실제 Drive 파일명 전부', () => {
  const entries = (sourceType: string) => {
    const out: { path: string[]; name: string }[] = [];
    const walk = (node: any, path: string[]) => {
      if (node && typeof node.id === 'string') out.push({ path, name: node.name ?? '' });
      else if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) walk(v, [...path, k]);
    };
    walk(mapping[sourceType] ?? {}, []);
    return out;
  };
  const mismatches = (list: { path: string[]; name: string }[], reparse: (e: { path: string[]; name: string }) => string | null, expected: (e: { path: string[] }) => string) =>
    list.filter((e) => reparse(e) !== expected(e)).map((e) => `${e.path.join('/')} ← ${e.name} (다시 파싱: ${reparse(e)})`);

  it('S1: 기출 파일명은 모두 자기 키(교시_종목)로 다시 파싱된다', () => {
    const list = entries('기출');
    expect(list.length).toBeGreaterThan(200);
    expect(
      mismatches(list, (e) => {
        const p = parseKichul(e.name);
        return p && `${p.session}_${p.certScope}`;
      }, (e) => e.path[1]),
    ).toEqual([]);
  });

  it('S2: 합숙 파일명은 모두 자기 키(N일차_N교시)로 다시 파싱된다', () => {
    const list = entries('합숙');
    expect(list.length).toBeGreaterThan(200);
    expect(mismatches(list, (e) => parseHapsuk(e.name), (e) => e.path[1])).toEqual([]);
  });

  it('S3: 모의 파일명은 모두 자기 회차·키(교시 / 교시_종목)로 다시 파싱된다 (연월 오기 보정 포함)', () => {
    const list = entries('모의');
    expect(list.length).toBeGreaterThan(500);
    expect(
      mismatches(list, (e) => {
        const p = parseMoui(e.name);
        return p && `KPC/${p.round}/${mouiMappingKey(p.session, p.cert)}`;
      }, (e) => e.path.join('/')),
    ).toEqual([]);
  });
});

describe('매핑 조립 (buildMappingFromTree)', () => {
  const pdf = (id: string, name: string) => ({ id, name });

  it('S4: 분류 안 되는 카테고리·회차를 못 읽는 폴더는 건너뛰고, 못 읽은 파일 수를 센다', () => {
    const { map, stats } = buildMappingFromTree([
      { name: '02. KPC 모의고사(모범답안)', rounds: [{ name: '제100회(202205)', pdfs: [pdf('x', '[KPC]_제100회_해설집_202205_1교시.pdf')] }] },
      { name: '01. 기출문제', rounds: [
        { name: '기출 참고자료', pdfs: [pdf('y', '[정보관리-1교시]참고.pdf')] },
        { name: '제138회 기출문제 해설집', pdfs: [pdf('k1', '[정보관리-1교시]제138회.pdf'), pdf('bad', '표지.pdf')] },
      ] },
    ]);
    expect(map.기출).toEqual({ '138': { '1_정보관리': { id: 'k1', name: '[정보관리-1교시]제138회.pdf' } } });
    expect(map.모의).toEqual({});
    expect(stats).toMatchObject({ 기출_매핑: 1, 스킵된_폴더: 1, 파싱_실패_파일: 1 });
  });

  it('S5: 기출은 같은 키에 보완본이 오면 교체하고, 보완본 뒤에 온 일반본은 무시', () => {
    const { map, stats } = buildMappingFromTree([
      { name: '01. 기출문제', rounds: [{ name: '제101회 기출문제 해설집', pdfs: [
        pdf('normal', '[정보관리-2교시]제101회 문제풀이.pdf'),
        pdf('bowan', '[정보관리-2교시]제101회 문제풀이 보완.pdf'),
        pdf('late-normal', '[정보관리-2교시]제101회 문제풀이 v2.pdf'),
      ] }] },
    ]);
    expect(map.기출['101']['2_정보관리'].id).toBe('bowan');
    expect(stats.기출_매핑).toBe(1);
  });

  it('S6: 합숙·모의는 같은 키면 먼저 찾은 파일 유지', () => {
    const { map } = buildMappingFromTree([
      { name: '04. KPC 합숙', rounds: [{ name: '140회 (2026-08)', pdfs: [
        pdf('h-first', 'KPC 140회 대비 합숙해설집_1일차_1교시_통합.pdf'),
        pdf('h-second', 'KPC 140회 대비 합숙해설집_1일차_1교시.pdf'),
      ] }] },
      { name: '03. KPC 모의고사(해설집)', rounds: [{ name: '제131회', pdfs: [
        pdf('m-first', '[KPC기술사IMPACT실전모의고사]_제131회_해설집_202607_1교시.pdf'),
        pdf('m-second', '[KPC기술사IMPACT실전모의고사]_제131회_해설집_202607_1교시_v2.pdf'),
      ] }] },
    ]);
    expect(map.합숙['2026.08']['1일차_1교시'].id).toBe('h-first');
    expect(map.모의.KPC['2026.07']['1'].id).toBe('m-first');
  });

  it('S7: 모의 옛 회차 종목별 해설집은 두 종목 모두 따로 매핑 (2026-09 충돌 결함 회귀 방지), 연월 오기는 보정', () => {
    const { map, stats } = buildMappingFromTree([
      { name: '03. KPC 모의고사(해설집)', rounds: [{ name: '67회', pdfs: [
        pdf('mgmt', '[KPC기술사IMPACT실전모의고사]_제67회 정보관리_해설집_201601_3교시.pdf'),
        pdf('app', '[KPC기술사IMPACT실전모의고사]_제67회 컴퓨터시스템응용_해설집_201601_3교시.pdf'),
        pdf('misdated', 'KPC기술사모의고사_해설집_31회_201104_정보관리_1교시_유동근PE.pdf'),
      ] }] },
    ]);
    expect(Object.keys(map.모의.KPC['2016.01']).sort()).toEqual(['3_정보관리', '3_컴시응']);
    expect(map.모의.KPC['2011.07']['1_정보관리'].id).toBe('misdated');
    expect(map.모의.KPC['2011.04']).toBeUndefined();
    expect(stats.모의_매핑).toBe(3);
  });
});
