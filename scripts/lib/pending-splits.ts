/**
 * "엑셀이 해설지보다 늦게 올라온" 회차를 구제한다 — 아직 분할본이 없는 매핑 키 중
 * **이번 빌드에서 처음 문항이 생긴** 키를 찾는다.
 *
 * 왜 필요한가: split-pdfs는 problems.json에 문항이 없으면 "매칭 없음, 스킵"으로 끝낸다.
 * 해설지 PDF를 엑셀보다 먼저 Drive에 올리면 sync가 신규 키로 잡아 split을 돌리지만
 * 문항이 없어 아무것도 못 하고, 나중에 엑셀을 올려도 파일 id가 그대로라 sync에게는
 * 더 이상 '신규 키'가 아니다(scripts/lib/mapping-diff.ts) → 통합본 연결로 굳는다.
 *
 * 그래서 배포 파이프라인에서 운영 problems.json과 새 빌드를 비교해
 * "운영엔 문항이 없었는데 이번에 생긴" 키만 골라 split에 넘긴다.
 * 운영에 이미 문항이 있던 키는 제외되므로, 통합본으로 폴백해 둔 옛 회차 수백 개가
 * 통째로 재분할되는 일은 없다(PROJECT.md §10).
 *
 * 판정은 split과 같은 함수(generateAllSpecsFromMap)로 만든 task 기준이라
 * 대상·키 형식·제외 규칙(questions 있음·NO_RESPLIT_KEYS)이 자동으로 일치한다.
 */
import { generateAllSpecsFromMap } from '../split-pdfs';

/** problems.json 한 건에서 매핑 task 판정에 쓰는 필드만 */
export type ProblemLike = {
  sourceType: string;
  round: string;
  certScope: string;
  session: string;
  sessionPart?: string | null;
};

/**
 * baseline(운영)엔 매칭 문항이 없었고 built(새 빌드)엔 생긴, 아직 분할 안 된 매핑 키.
 * mapping은 explanation-files.json 전체.
 */
export function pendingSplitKeys(baseline: ProblemLike[], built: ProblemLike[], mapping: unknown): string[] {
  const keys: string[] = [];
  for (const spec of generateAllSpecsFromMap(mapping)) {
    if (!spec.mappingKey) continue;
    const matches = spec.problemFilter as unknown as (p: ProblemLike) => boolean;
    if (!built.some(matches)) continue; // 엑셀에 아직 문항 없음 — 지금 분할해도 스킵된다
    if (baseline.some(matches)) continue; // 운영에 이미 있던 회차 — 옛 회차 무더기 재분할 방지
    keys.push(spec.mappingKey);
  }
  return keys.sort();
}
