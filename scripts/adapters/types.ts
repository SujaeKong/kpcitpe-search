/**
 * 어댑터 공용 타입 정의.
 * src/lib/types.ts와 동일한 Problem 스키마를 공유한다.
 * (런타임 의존을 피하려고 어댑터 측에 별도 사본을 둠)
 */

export type CertScope = '정보관리' | '컴시응' | '공통';
export type SourceType = '기출' | '합숙' | '모의' | '자체';
export type Academy = 'KPC' | 'ITPE' | null;
export type SessionType = '교시' | '일차';

export interface Problem {
  // ===== 식별자 =====
  id: string;

  // ===== 출처 분류 =====
  sourceType: SourceType;
  academy: Academy;

  // ===== 자격증 분류 =====
  certScope: CertScope;

  // ===== 회차 정보 =====
  round: string;          // "138" | "2026.04" | "2026.02"
  roundLabel: string;     // 표시용: "138회" | "모의_2026.04" | "합숙_2026.02"
  roundOrder: number;     // 정렬용: 138 (기출) | 202604 (모의/합숙 YYYYMM)

  // ===== 교시/일차 =====
  session: string;        // "1", "2", "3", "4", "1일차"~"8일차"
  sessionType: SessionType;
  /**
   * 합숙 일차 안에서 1교시(약술) / 2교시(논술) 구분.
   * - 합숙은 한 일차 안에 1교시(13~16문항) + 2교시(5~8문항)가 섞일 수 있음
   * - 그룹 패턴 휴리스틱으로 추정 (kpc-xls-adapter inferHapsukSessionParts)
   * - 합숙 외 sourceType은 항상 null
   */
  sessionPart?: '1교시' | '2교시' | null;

  // ===== 문제 내용 =====
  questionNumber: number | null;     // 1, 2, ... (소문제 N.M 형식이면 메인번호 N)
  questionSubNumber: number | null;  // 소문제 번호 M (없으면 null) — 예: '1.2' → 1, 2
  questionLabel: string;             // 표시용 문항 라벨: '1' | '1.2' | '1-가'
  title: string;
  content: string;

  // ===== 메타 =====
  preparingFor?: string | null;

  // ===== 출처 추적 =====
  sourceFile: string;

  // ===== 해설지 =====
  explanationFileId?: string | null;
  explanationFileName?: string | null;
}

/**
 * 어댑터별로 구현체를 만든다.
 * - KPC 통합 엑셀 → kpc-xls-adapter
 * - ITPE 엑셀     → itpe-xlsx-adapter (향후)
 * - 표준 템플릿   → standard-template-adapter
 */
export interface SourceAdapter {
  /** 어댑터 이름 (로그/디버깅용) */
  name: string;

  /** 출처 식별 태그 */
  sourceTag: 'KPC' | 'ITPE' | 'CUSTOM' | string;

  /** 파일 경로(들)에서 표준 Problem 배열로 변환 */
  parse(filePath: string): Promise<AdapterResult>;

  /** 사전 검증 (선택): 파일이 이 어댑터로 처리 가능한지 */
  canHandle?(filePath: string): boolean;
}

/**
 * 어댑터가 반환하는 결과.
 * problems 외에 변환 통계와 경고를 함께 돌려줌 — 빌드 단계에서 §5단계 통계 출력에 사용.
 */
export interface AdapterResult {
  problems: Problem[];
  stats: AdapterStats;
  warnings: AdapterWarning[];
}

export interface AdapterStats {
  /** 어댑터 이름 */
  adapter: string;
  /** 시트별 또는 서브-소스별 입력 행 수 */
  inputRows: Record<string, number>;
  /** 시트별 변환 성공 행 수 */
  outputRows: Record<string, number>;
  /** 변환 실패(스킵) 행 수 */
  skipped: number;
}

export interface AdapterWarning {
  level: 'info' | 'warn' | 'error';
  message: string;
  /** 디버깅 컨텍스트 (시트, 행번호, 원본 값 등) */
  context?: Record<string, unknown>;
}
