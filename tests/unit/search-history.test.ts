/**
 * 검색 기록(localStorage): 최근 10개, 중복 제거, 2자 이상, 손상 데이터 복구.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addHistory, clearHistory, listHistory, removeHistory } from '../../src/lib/search-history';

const KEY = 'kpcitpe.search-history';
let store: Map<string, string>;

beforeEach(() => {
  store = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const queries = () => listHistory().map((e) => e.query);

describe('검색 기록', () => {
  it('H1: 앞뒤 공백 제거, 2자 미만은 저장 안 함', () => {
    addHistory('  쿠버네티스  ');
    addHistory('a');
    addHistory(' ');
    expect(queries()).toEqual(['쿠버네티스']);
  });

  it('H2: 같은 검색어는 중복 없이 맨 앞으로', () => {
    ['AI', 'LLM', 'AI'].forEach(addHistory);
    expect(queries()).toEqual(['AI', 'LLM']);
  });

  it('H3: 최근 10개만 유지', () => {
    for (let i = 1; i <= 12; i++) addHistory(`검색${i}`);
    expect(queries()).toHaveLength(10);
    expect(queries()[0]).toBe('검색12');
    expect(queries()).not.toContain('검색2');
  });

  it('H4: 개별 삭제·전체 삭제', () => {
    ['AI', 'LLM', 'GPU'].forEach(addHistory);
    removeHistory('LLM');
    expect(queries()).toEqual(['GPU', 'AI']);
    clearHistory();
    expect(queries()).toEqual([]);
  });

  it('H5: 저장값이 깨졌거나 배열이 아니면 빈 목록으로 복구', () => {
    store.set(KEY, '{broken');
    expect(listHistory()).toEqual([]);
    store.set(KEY, '{"query":"x"}');
    expect(listHistory()).toEqual([]);
    addHistory('복구됨');
    expect(queries()).toEqual(['복구됨']);
  });

  it('H6: localStorage를 쓸 수 없는 환경(차단/용량 초과)에서도 예외 없음', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    });
    expect(() => addHistory('테스트')).not.toThrow();
    expect(listHistory()).toEqual([]);
  });
});
