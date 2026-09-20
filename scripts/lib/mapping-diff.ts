/**
 * 매핑(explanation-files.json) 두 버전을 비교해 "이번에 새로 분할해야 할 키"를 뽑는다.
 *
 * 신규 회차를 Drive 폴더에 올리면 sync가 매핑에 entry를 추가하는데, split을 mode=all로
 * 돌리면 questions가 없는 옛 회차 수백 개까지 재분할돼 정렬 오류가 되살아난다
 * (PROJECT.md §10). 그래서 자동 분할은 **이번 sync로 바뀐 키만** 대상으로 한다.
 *
 * 대상 조건:
 *   - 이전 매핑에 없던 키 (신규 회차·신규 교시)
 *   - 있었지만 Drive 파일 id가 바뀐 키 (해설지 교체본 업로드)
 * 이미 questions가 있는 키는 split 쪽에서 다시 걸러지므로 여기서도 제외한다.
 */

type Entry = { id?: string; name?: string; questions?: Record<string, unknown> };
type Rounds = Record<string, Record<string, Entry>>;
type Mapping = { 기출?: Rounds; 합숙?: Rounds; 모의?: { KPC?: Rounds } };

/** 매핑을 `키경로 → entry` 평면 맵으로 (키경로는 split의 NO_RESPLIT_KEYS·task 키와 같은 형식) */
export function flattenMapping(map: Mapping): Map<string, Entry> {
  const out = new Map<string, Entry>();
  const groups: [string[], Rounds][] = [
    [['기출'], map.기출 ?? {}],
    [['합숙'], map.합숙 ?? {}],
    [['모의', 'KPC'], map.모의?.KPC ?? {}],
  ];
  for (const [prefix, rounds] of groups) {
    for (const [round, sessions] of Object.entries(rounds)) {
      if (!sessions || typeof sessions !== 'object') continue;
      for (const [key, entry] of Object.entries(sessions)) {
        if (!entry || typeof entry !== 'object') continue;
        out.set([...prefix, round, key].join('/'), entry);
      }
    }
  }
  return out;
}

/** prev → next 사이에 새로 생겼거나 파일이 교체된, 아직 분할되지 않은 키 목록 */
export function newMappingKeys(prev: Mapping, next: Mapping): string[] {
  const before = flattenMapping(prev);
  const keys: string[] = [];
  for (const [key, entry] of flattenMapping(next)) {
    if (!entry.id) continue;
    if (entry.questions && Object.keys(entry.questions).length > 0) continue;
    const old = before.get(key);
    if (!old || old.id !== entry.id) keys.push(key);
  }
  return keys.sort();
}
