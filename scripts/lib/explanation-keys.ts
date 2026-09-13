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

/**
 * 파일명의 연월이 실제 회차와 다른 모의 해설집 — PDF 본문 머리말·첫 문항을 엑셀과 대조해 확인 (2026-09-13).
 * sync는 파일명에서 읽은 연월 대신 여기 적힌 회차로 매핑한다.
 * (파일명 회차 번호만 틀리고 연월은 맞는 `제25회(2011년01월)` = 본문 제26회 2011년 1월은 보정 불필요)
 */
export const MOUI_ROUND_OVERRIDES: readonly { fileNameIncludes: string; round: string; evidence: string }[] = [
  { fileNameIncludes: '해설집_31회_201104_', round: '2011.07', evidence: '본문 "제31회 … 2011년 7월", 정보관리 1교시 1번 인메모리컴퓨팅' },
  { fileNameIncludes: '_제76회 컴퓨터시스템응용_해설집_201704_', round: '2017.06', evidence: '본문 "제76회 … 2017년 6월", 컴시응 1교시 사용성 테스트' },
  { fileNameIncludes: '_제116회_해설집_202311_', round: '2023.12', evidence: '본문 "116회", 4교시 1번 AGI·AI 안전성' },
];

export function correctMouiRound(fileName: string, round: string): string {
  return MOUI_ROUND_OVERRIDES.find((o) => fileName.includes(o.fileNameIncludes))?.round ?? round;
}

/** 모의 매핑 키: 종목별 해설집은 `교시_종목`, 통합 해설집은 `교시` */
export function mouiMappingKey(session: string, cert: MouiCert | null): string {
  return cert ? `${session}_${cert}` : session;
}

/**
 * `$generatedAt`과 키 순서를 무시하고 매핑 내용이 같은지.
 * 내용이 그대로면 sync·split이 파일을 다시 쓰지 않아 시각만 바뀐 커밋·배포가 쌓이지 않게 한다.
 */
export function sameMappingContent(a: unknown, b: unknown): boolean {
  const canonical = (node: any): any => {
    if (Array.isArray(node)) return node.map(canonical);
    if (!node || typeof node !== 'object') return node;
    return Object.fromEntries(
      Object.keys(node)
        .filter((k) => k !== '$generatedAt')
        .sort()
        .map((k) => [k, canonical(node[k])]),
    );
  };
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

/**
 * 옛 형식 분할이 문항과 한 칸씩 어긋나 통합본으로 폴백한 매핑 항목 (PROJECT.md §10) — 자동 재분할 금지.
 * 경로 = 출처/…/키. 모의 종목별 해설집 3건은 2026-09 종목 키 분리 이후 경로.
 * (원래 12건이던 '모의/KPC/2023.11/4'는 116회(2023.12) 해설집이 잘못된 회차에 매핑돼 어긋났던 것으로 확인 —
 *  2026-09-13 회차 보정(MOUI_ROUND_OVERRIDES)과 함께 목록에서 제외, 분할은 제목 정렬 가드가 검증)
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
];
