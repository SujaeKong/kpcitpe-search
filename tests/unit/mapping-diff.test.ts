/**
 * 신규 회차 자동 분할 — sync 전후 매핑 비교로 "이번에 분할할 키"를 고르고, split이 그 키로만 task를 만드는지.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { flattenMapping, newMappingKeys } from '../../scripts/lib/mapping-diff';
import { filterSpecsByKeys, generateAllSpecsFromMap, type TestSpec } from '../../scripts/split-pdfs';

const entry = (id: string, questions?: Record<string, unknown>) => ({ id, name: `${id}.pdf`, ...(questions ? { questions } : {}) });

const before = {
  $generatedAt: '2026-09-19T18:00:00Z',
  기출: { '139': { '1_정보관리': entry('f139', { '1': { id: 's1', name: 's1.pdf' } }) } },
  합숙: { '2026.08': { '1일차_1교시': entry('h1') } },
  모의: { KPC: { '2026.07': { '1': entry('m1', { '1': { id: 's2', name: 's2.pdf' } }) } } },
};

describe('sync 전후 매핑 비교 (newMappingKeys)', () => {
  it('Y1: 키 경로는 split의 task 키와 같은 형식 — 모의는 KPC 단계 포함', () => {
    expect([...flattenMapping(before).keys()].sort()).toEqual([
      '기출/139/1_정보관리',
      '모의/KPC/2026.07/1',
      '합숙/2026.08/1일차_1교시',
    ]);
  });

  it('Y2: 신규 회차 entry만 대상 — 기존 키·$generatedAt만 바뀐 sync는 빈 목록', () => {
    const after = structuredClone(before) as typeof before & { 기출: Record<string, Record<string, unknown>> };
    after.$generatedAt = '2026-09-20T18:00:00Z';
    expect(newMappingKeys(before, after)).toEqual([]);

    after.기출['140'] = { '1_정보관리': entry('f140a'), '4_컴시응': entry('f140b') };
    expect(newMappingKeys(before, after)).toEqual(['기출/140/1_정보관리', '기출/140/4_컴시응']);
  });

  it('Y3: 해설지 파일이 교체되면(id 변경) 다시 분할 대상, questions가 이미 있으면 제외', () => {
    const replaced = structuredClone(before);
    replaced.합숙['2026.08']['1일차_1교시'] = entry('h1-v2');
    expect(newMappingKeys(before, replaced)).toEqual(['합숙/2026.08/1일차_1교시']);

    // 분할이 끝난(questions 있는) 키는 id가 그대로면 물론, 새로 생겼어도 대상 아님
    const splitDone = structuredClone(before);
    splitDone.기출['140'] = { '1_정보관리': entry('f140a', { '1': { id: 'x', name: 'x.pdf' } }) };
    expect(newMappingKeys(before, splitDone)).toEqual([]);
  });

  it('Y4: split이 그 키로만 task를 만든다 (questions 있는 키는 애초에 제외)', () => {
    const map = structuredClone(before) as any;
    map.기출['140'] = { '1_정보관리': entry('f140a'), '2_정보관리': entry('f140b') };
    const specs = generateAllSpecsFromMap(map);
    const keys = newMappingKeys(before, map);
    expect(keys).toEqual(['기출/140/1_정보관리', '기출/140/2_정보관리']);

    const picked = filterSpecsByKeys(specs, keys.join(','));
    expect(picked.map((s: TestSpec) => s.mappingKey)).toEqual(keys);
    // 키를 안 주면 그대로 통과(수동 mode=all 실행), 없는 키만 주면 0개
    expect(filterSpecsByKeys(specs, '')).toHaveLength(specs.length);
    expect(filterSpecsByKeys(specs, '기출/999/1_정보관리')).toHaveLength(0);
  });

  it('Y5: 실제 140회 sync 전후 매핑(픽스처)에서 기출 140 8개 키가 그대로 나온다', () => {
    // 2026-09-20 140회 해설지 8개 업로드 직후 auto-sync 커밋(4507d2b) 전후에서 추린 조각.
    // CI 체크아웃은 shallow(fetch-depth 1)라 git 이력을 직접 읽으면 안 된다.
    const at = (name: string) =>
      JSON.parse(readFileSync(new URL(`../fixtures/mapping-diff/${name}.json`, import.meta.url), 'utf8'));
    expect(newMappingKeys(at('before-140-sync'), at('after-140-sync'))).toEqual([
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
});
