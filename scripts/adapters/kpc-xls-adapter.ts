/**
 * KPC 통합 엑셀(`기출`, `모의`, `합숙` 3시트) → Problem[].
 *
 * requirements.md §2 (원본 데이터 구조)와 §5 (데이터 모델) 기준.
 * 정규화 규칙: §2.3, §2.4, §2.5
 * ID 규칙: §5.3
 */
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
// xlsx는 CJS-only라 ESM named import가 깨짐 → createRequire로 우회
const XLSX = require('xlsx') as typeof import('xlsx');
import type {
  AdapterResult,
  AdapterStats,
  AdapterWarning,
  CertScope,
  Problem,
  SourceAdapter,
  SessionType,
  SourceType,
} from './types';

const TARGET_SHEETS = ['기출', '모의', '합숙'] as const;
type TargetSheet = (typeof TARGET_SHEETS)[number];

const COL = {
  round: '회차',
  cert: '종목',
  session: '유형',
  problem: '문제',
  preparing: 'Unnamed: 4',
} as const;

interface RawRow {
  [key: string]: unknown;
  __rowNum__?: number;
}

export class KpcXlsAdapter implements SourceAdapter {
  readonly name = 'kpc-xls';
  readonly sourceTag = 'KPC' as const;

  canHandle(filePath: string): boolean {
    const base = path.basename(filePath).toLowerCase();
    return base.endsWith('.xls') || base.endsWith('.xlsx');
  }

  async parse(filePath: string): Promise<AdapterResult> {
    const sourceFile = path.basename(filePath);
    const wb = XLSX.readFile(filePath, { cellDates: false });

    const stats: AdapterStats = {
      adapter: this.name,
      inputRows: {},
      outputRows: {},
      skipped: 0,
    };
    const warnings: AdapterWarning[] = [];
    const problems: Problem[] = [];
    const seenIds = new Set<string>();

    for (const sheetName of TARGET_SHEETS) {
      const ws = wb.Sheets[sheetName];
      if (!ws) {
        warnings.push({
          level: 'warn',
          message: `시트 누락: ${sheetName}`,
        });
        stats.inputRows[sheetName] = 0;
        stats.outputRows[sheetName] = 0;
        continue;
      }

      const rows = XLSX.utils.sheet_to_json<RawRow>(ws, {
        defval: null,
        raw: false,
      });
      stats.inputRows[sheetName] = rows.length;

      // ── 1차: 행 단위 변환 ──
      const sheetProblems: Problem[] = [];
      const sheetRowNums: number[] = [];
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rowNum = (row.__rowNum__ ?? i + 1) + 1;
        const result = this.transformRow(row, sheetName, sourceFile, rowNum, warnings);
        if (!result) {
          stats.skipped++;
          continue;
        }
        sheetProblems.push(result);
        sheetRowNums.push(rowNum);
      }

      // ── 2차: 보정 — questionNumber=null 행에 (round, cert, session) 그룹 내 자동 순번 부여 ──
      // 옛 회차(80~83회대) 단답형은 본문에 번호 prefix가 없어 questionNumber 추출이 불가.
      // 같은 그룹 내에서 등장 순서대로 1, 2, 3... (이미 사용 중인 번호 회피).
      autoAssignQuestionNumbers(sheetProblems);

      // ── 2.5차: 합숙 sessionPart 추정 (1교시 약술 / 2교시 논술) ──
      if (sheetName === '합숙') {
        inferHapsukSessionParts(sheetProblems);
      }

      // ── 3차: 전역 ID 중복 체크 + 등록 ──
      for (let i = 0; i < sheetProblems.length; i++) {
        const p = sheetProblems[i];
        const rowNum = sheetRowNums[i];
        let id = p.id;
        if (seenIds.has(id)) {
          id = `${id}-row${rowNum}`;
          warnings.push({
            level: 'info',
            message: `중복 ID 회피: ${p.id} → ${id}`,
            context: { sheet: sheetName, row: rowNum },
          });
        }
        seenIds.add(id);
        problems.push({ ...p, id });
      }
      stats.outputRows[sheetName] = sheetProblems.length;
    }

    return { problems, stats, warnings };
  }

  /** 한 행 변환. 실패 시 null 반환(+warning). */
  private transformRow(
    row: RawRow,
    sheetName: TargetSheet,
    sourceFile: string,
    rowNum: number,
    warnings: AdapterWarning[],
  ): Problem | null {
    const rawRound = strOrNull(row[COL.round]);
    const rawCert = strOrNull(row[COL.cert]);
    const rawSession = strOrNull(row[COL.session]);
    const rawProblem = strOrNull(row[COL.problem]);
    const rawPreparing = strOrNull(row[COL.preparing]);

    if (!rawProblem) {
      warnings.push({
        level: 'warn',
        message: '문제 본문 누락 — 행 스킵',
        context: { sheet: sheetName, row: rowNum, rawRound, rawCert },
      });
      return null;
    }

    // === sourceType 결정 ===
    const sourceType: SourceType =
      sheetName === '기출' ? '기출' : sheetName === '모의' ? '모의' : '합숙';

    // === 회차 정규화 (§2.4) ===
    const roundInfo = normalizeRound(rawRound, sourceType);
    if (!roundInfo) {
      warnings.push({
        level: 'warn',
        message: `회차 정규화 실패 — 행 스킵`,
        context: { sheet: sheetName, row: rowNum, rawRound },
      });
      return null;
    }

    // === 종목 정규화 (§2.5) ===
    const certScope = normalizeCertScope(rawCert);
    if (!certScope) {
      warnings.push({
        level: 'warn',
        message: `종목 정규화 실패 — 행 스킵`,
        context: { sheet: sheetName, row: rowNum, rawCert },
      });
      return null;
    }

    // === 교시/일차 정규화 (§2.3 이슈 2) ===
    const sessionInfo = normalizeSession(rawSession, sourceType);
    if (!sessionInfo) {
      warnings.push({
        level: 'warn',
        message: `교시/일차 정규화 실패 — 행 스킵`,
        context: { sheet: sheetName, row: rowNum, rawSession },
      });
      return null;
    }

    // === 문제 번호/제목/본문 분리 (§2.3 이슈 3) ===
    const { questionNumber, questionSubNumber, questionLabel, title, content } =
      splitProblem(rawProblem);

    // === academy ===
    // 기출은 자격증기관 시험이라 학원 귀속 없음(null).
    // 모의·합숙은 학원 귀속 — KPC 통합 엑셀이므로 'KPC' 고정.
    const academy = sourceType === '기출' ? null : 'KPC';

    // === ID 생성 (§5.3 보강 — certScope 슬러그 + 소문제 번호 포함) ===
    // 소문제 N.M는 ID에 'N_M'으로 포함 (점은 ID 구분자와 충돌 회피)
    const qPart =
      questionNumber === null
        ? `row${rowNum}`
        : questionSubNumber !== null
          ? `${questionNumber}_${questionSubNumber}`
          : String(questionNumber);
    const id = buildId({
      sourceType,
      academy,
      certScope,
      round: roundInfo.round,
      session: sessionInfo.session,
      questionPart: qPart,
    });

    return {
      id,
      sourceType,
      academy,
      certScope,
      round: roundInfo.round,
      roundLabel: roundInfo.roundLabel,
      roundOrder: roundInfo.roundOrder,
      session: sessionInfo.session,
      sessionType: sessionInfo.sessionType,
      sessionPart: null, // 합숙은 후처리에서 채움
      questionNumber,
      questionSubNumber,
      questionLabel,
      title,
      content,
      preparingFor: rawPreparing ?? null,
      sourceFile,
      explanationFileId: null,
      explanationFileName: null,
    };
  }
}

// ===== 정규화 헬퍼 =====

function strOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

/**
 * §2.4 회차 정규화.
 * - 기출: '138', '138회' → round='138', label='138회', order=138
 * - 모의: '모의_2026.04' → round='2026.04', label='모의_2026.04', order=202604
 * - 합숙: '합숙_2026.02' → round='2026.02', label='합숙_2026.02', order=202602
 *   (간혹 '모의2026.04'/'합숙2026.02'처럼 underscore 누락 가능 — 둘 다 허용)
 */
function normalizeRound(
  raw: string | null,
  sourceType: SourceType,
): { round: string; roundLabel: string; roundOrder: number } | null {
  if (!raw) return null;

  if (sourceType === '기출') {
    const m = raw.match(/^(\d+)\s*회?\s*$/);
    if (!m) return null;
    const round = m[1];
    return {
      round,
      roundLabel: `${round}회`,
      roundOrder: parseInt(round, 10),
    };
  }

  // 모의 / 합숙: '모의_2026.04' or '합숙_2026.02' (underscore 누락 / 같은 달 다회차 -N 접미사 허용)
  // 예: '모의_2010.10-1', '모의_2010.10-2' (월 2회 시행)
  const prefix = sourceType === '모의' ? '모의' : '합숙';
  const re = new RegExp(`^${prefix}_?\\s*(\\d{4})\\.(\\d{1,2})(?:[\\-_](\\d+))?\\s*$`);
  const m = raw.match(re);
  if (!m) return null;
  const yyyy = m[1];
  const mm = m[2].padStart(2, '0');
  const seq = m[3]; // 같은 달 회차 번호 (있을 경우)
  const round = seq ? `${yyyy}.${mm}-${seq}` : `${yyyy}.${mm}`;
  // roundOrder: YYYYMM(SS) — seq 없으면 SS=00, 있으면 zero-pad 2자리
  const ss = seq ? seq.padStart(2, '0') : '00';
  return {
    round,
    roundLabel: `${prefix}_${round}`,
    roundOrder: parseInt(`${yyyy}${mm}${ss}`, 10),
  };
}

/**
 * §2.5 종목 정규화.
 * 관리 → 정보관리
 * 응용, 컴시응 → 컴시응
 * 공통, 조직, 보안 → 공통
 */
function normalizeCertScope(raw: string | null): CertScope | null {
  if (!raw) return null;
  const v = raw.trim();
  if (v === '관리' || v === '정보관리') return '정보관리';
  if (v === '응용' || v === '컴시응') return '컴시응';
  if (v === '공통' || v === '조직' || v === '보안') return '공통';
  return null;
}

/**
 * 교시(기출/모의: 1~4) / 일차(합숙: 1일차~8일차) 정규화.
 * 합숙: 'Day-1' / '1일차' / '1' 모두 허용 → '1일차'로 통일 (§2.3 이슈 2).
 * 기출/모의: '1', '1교시' 등 → '1'로 통일.
 */
function normalizeSession(
  raw: string | null,
  sourceType: SourceType,
): { session: string; sessionType: SessionType } | null {
  if (!raw) return null;
  const v = raw.trim();

  if (sourceType === '합숙') {
    // 'Day-1' (영문)
    let m = v.match(/^Day[\s\-_]?(\d+)$/i);
    if (m) return { session: `${m[1]}일차`, sessionType: '일차' };
    // '1일차'
    m = v.match(/^(\d+)\s*일차$/);
    if (m) return { session: `${m[1]}일차`, sessionType: '일차' };
    // '1' (숫자만)
    m = v.match(/^(\d+)$/);
    if (m) return { session: `${m[1]}일차`, sessionType: '일차' };
    return null;
  }

  // 기출/모의 — 교시
  let m = v.match(/^(\d+)\s*교?시?$/);
  if (m) return { session: m[1], sessionType: '교시' };
  return null;
}

/**
 * §2.3 이슈 3 + 소문제 형식 보강.
 *
 * 매칭 패턴 (우선순위 순):
 *  1) 'N.M[.] 제목'   → 소문제 (예: '1.1 ...', '2.3. ...')   메인=N, 서브=M
 *  2) 'N-M[.] 제목'   → 하이픈 변형 (예: '1-2 ...')          메인=N, 서브=M
 *  3) 'N. 제목' / 'N.제목' → 일반 문항 (§2.3 이슈 3)         메인=N, 서브=null
 */
function splitProblem(raw: string): {
  questionNumber: number | null;
  questionSubNumber: number | null;
  questionLabel: string;
  title: string;
  content: string;
} {
  const content = raw.trim();
  const firstLine = content.split(/\r?\n/, 1)[0];

  // (1) N.M[.] — 점 사이 공백은 없음 (N. M은 일반 문항으로 봐야 함)
  let m = firstLine.match(/^(\d+)\.(\d+)\.?\s*(.+)$/);
  if (m) {
    const main = parseInt(m[1], 10);
    const sub = parseInt(m[2], 10);
    return {
      questionNumber: main,
      questionSubNumber: sub,
      questionLabel: `${main}.${sub}`,
      title: m[3].trim(),
      content,
    };
  }
  // (2) N-M[.]
  m = firstLine.match(/^(\d+)-(\d+)\.?\s*(.+)$/);
  if (m) {
    const main = parseInt(m[1], 10);
    const sub = parseInt(m[2], 10);
    return {
      questionNumber: main,
      questionSubNumber: sub,
      questionLabel: `${main}-${sub}`,
      title: m[3].trim(),
      content,
    };
  }
  // (3) N. 또는 N.제목
  m = firstLine.match(/^(\d+)\.\s*(.+)$/);
  if (m) {
    const main = parseInt(m[1], 10);
    return {
      questionNumber: main,
      questionSubNumber: null,
      questionLabel: String(main),
      title: m[2].trim(),
      content,
    };
  }
  return {
    questionNumber: null,
    questionSubNumber: null,
    questionLabel: '',
    title: firstLine.slice(0, 80),
    content,
  };
}

/**
 * questionNumber=null 행에 (round, cert, session) 그룹 내 자동 순번 부여.
 * 80~83회대 단답형 시험은 본문에 번호 prefix가 없어 추출이 불가능 → 등장 순서로 채움.
 *
 * 그룹 내에 명시 번호와 null이 섞여 있을 경우(드문 케이스), 명시 번호의 max + 1부터
 * 미사용 번호로 채운다 — 명시 번호와 충돌 회피.
 *
 * 호출 후 각 행의 questionNumber, questionLabel, id가 갱신됨.
 */
function autoAssignQuestionNumbers(sheetProblems: Problem[]): void {
  const groups = new Map<string, Problem[]>();
  for (const p of sheetProblems) {
    const key = `${p.sourceType}|${p.round}|${p.certScope}|${p.session}`;
    let g = groups.get(key);
    if (!g) {
      g = [];
      groups.set(key, g);
    }
    g.push(p);
  }

  for (const group of groups.values()) {
    const explicit = group
      .map((p) => p.questionNumber)
      .filter((n): n is number => n !== null);
    if (group.every((p) => p.questionNumber !== null)) continue; // 보정 불필요

    const used = new Set<number>(explicit);
    let next = explicit.length === 0 ? 1 : Math.max(...explicit) + 1;

    for (const p of group) {
      if (p.questionNumber !== null) continue;
      while (used.has(next)) next++;
      const num = next;
      used.add(num);
      next++;

      p.questionNumber = num;
      p.questionLabel = String(num);
      // id 재생성 — qPart는 항상 String(num) (소문제 prefix 없음, 단답형이므로)
      p.id = buildId({
        sourceType: p.sourceType,
        academy: p.academy,
        certScope: p.certScope,
        round: p.round,
        session: p.session,
        questionPart: String(num),
      });
    }
  }
}

/**
 * 합숙 sessionPart 추정.
 *
 * 휴리스틱 (사용자 도메인 지식 기반):
 * - 합숙 1교시: 약술형 13~16문항
 * - 합숙 2교시: 논술형 5~8문항
 * - 한 일차 안에 1교시·2교시가 같이 들어있는 경우도 있음
 *
 * 그룹별 결정:
 *  1) 같은 questionNumber가 그룹 내 두 번째 등장이면 → 2교시 (2016년형 동거 패턴)
 *  2) 첫 등장 행들에 대해:
 *     - 사이즈 ≤ 8       : 모두 2교시 (논술 단독)
 *     - 9 ≤ 사이즈 ≤ 16  : 모두 1교시 (약술 단독)
 *     - 사이즈 ≥ 17      : 첫 13개 1교시, 나머지 2교시
 */
function inferHapsukSessionParts(sheetProblems: Problem[]): void {
  const groups = new Map<string, Problem[]>();
  for (const p of sheetProblems) {
    const key = `${p.round}|${p.certScope}|${p.session}`;
    let g = groups.get(key);
    if (!g) {
      g = [];
      groups.set(key, g);
    }
    g.push(p);
  }

  for (const group of groups.values()) {
    const seen = new Set<number>();
    const isSecond: boolean[] = group.map((p) => {
      if (p.questionNumber === null) return false;
      if (seen.has(p.questionNumber)) return true;
      seen.add(p.questionNumber);
      return false;
    });

    const firstOccCount = isSecond.filter((b) => !b).length;
    let firstSessionLimit: number;
    if (firstOccCount <= 8) firstSessionLimit = 0; // 모두 2교시
    else if (firstOccCount <= 16) firstSessionLimit = firstOccCount; // 모두 1교시
    else firstSessionLimit = 13; // 17+: 첫 13개 1교시

    let firstIdx = 0;
    for (let i = 0; i < group.length; i++) {
      if (isSecond[i]) {
        group[i].sessionPart = '2교시';
      } else {
        group[i].sessionPart = firstIdx < firstSessionLimit ? '1교시' : '2교시';
        firstIdx++;
      }
    }
  }
}

const CERT_SLUG: Record<CertScope, string> = {
  정보관리: 'mgmt',
  컴시응: 'app',
  공통: 'common',
};

/**
 * §5.3 ID 생성. 합숙도 학원 귀속이 있으므로 academy 슬러그 포함.
 * 또한 같은 회차/교시/번호로 정보관리·컴시응이 동시 출제되므로 certScope 슬러그도 포함
 * — requirements.md §5.3 보강.
 *
 * 기출: kichul-{round}-{cert}-{session}-{q}
 * 합숙: hapsuk-{academy}-{round}-{cert}-{session-slug}-{q}   (1일차 → 1ilcha)
 * 모의: moui-{academy}-{round}-{cert}-{session}-{q}
 */
function buildId(args: {
  sourceType: SourceType;
  academy: string | null;
  certScope: CertScope;
  round: string;
  session: string;
  questionPart: string;
}): string {
  const { sourceType, academy, certScope, round, session, questionPart } = args;
  const aca = (academy ?? 'unknown').toLowerCase();
  const cert = CERT_SLUG[certScope];

  if (sourceType === '기출') {
    return `kichul-${round}-${cert}-${session}-${questionPart}`;
  }
  if (sourceType === '합숙') {
    const slug = session.replace(/일차$/, 'ilcha');
    return `hapsuk-${aca}-${round}-${cert}-${slug}-${questionPart}`;
  }
  if (sourceType === '모의') {
    return `moui-${aca}-${round}-${cert}-${session}-${questionPart}`;
  }
  // 자체 — 이 어댑터에서는 사용 안 함
  return `custom-${aca}-${round}-${cert}-${session}-${questionPart}`;
}
