/**
 * 해설지 매핑 키 규칙 — sync-drive-mappings / split-pdfs / 테스트 공용.
 */

export type MouiCert = '정보관리' | '컴시응';

/**
 * 모의 해설집 파일명의 종목. 옛 회차(2010~2019)는 교시마다 정보관리·컴시응(조직응용) 해설집이 따로 있다.
 * 종목 통합 해설집(`제131회_해설집`, `정보처리통합`, `[공통]`)이면 null.
 */
export function mouiFileCert(fileName: string): MouiCert | null {
  if (/컴퓨터시스템응용|시스템응용|조직응용|컴시응/.test(fileName)) return '컴시응';
  if (/정보관리/.test(fileName)) return '정보관리';
  return null;
}

/** 모의 매핑 키: 종목별 해설집은 `교시_종목`, 통합 해설집은 `교시` */
export function mouiMappingKey(session: string, cert: MouiCert | null): string {
  return cert ? `${session}_${cert}` : session;
}

/**
 * 옛 형식 분할이 문항과 한 칸씩 어긋나 통합본으로 폴백한 매핑 항목 (PROJECT.md §10) — 자동 재분할 금지.
 * 경로 = 출처/…/키. 모의 종목별 해설집 3건은 2026-09 종목 키 분리 이후 경로.
 */
export const NO_RESPLIT_KEYS: readonly string[] = [
  '기출/87/1_정보관리',
  '기출/93/3_정보관리',
  '기출/93/4_정보관리',
  '기출/105/4_컴시응',
  '모의/KPC/2010.10/1',
  '모의/KPC/2012.04/3',
  '모의/KPC/2012.04/4',
  '모의/KPC/2012.12/2_정보관리',
  '모의/KPC/2013.05/3_정보관리',
  '모의/KPC/2014.04/2_정보관리',
  '모의/KPC/2022.11/3',
  '모의/KPC/2023.11/4',
];
