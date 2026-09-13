/**
 * 검색어 하이라이트: 매치 구간 <mark>, 겹치는 구간 병합, 긴 본문은 첫 매치 주변만 보여주기.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import HighlightedText, { findIndicesForKey } from '../../src/components/HighlightedText';

const render = (props: Parameters<typeof HighlightedText>[0]) => renderToStaticMarkup(createElement(HighlightedText, props));

describe('HighlightedText', () => {
  it('T1: 매치가 없으면 그대로(HTML 이스케이프), windowed면 maxLength에서 자르고 …', () => {
    expect(render({ text: '<b>쿠버네티스</b>' })).toBe('&lt;b&gt;쿠버네티스&lt;/b&gt;');
    expect(render({ text: 'a'.repeat(50), windowed: true, maxLength: 10 })).toBe(`${'a'.repeat(10)}…`);
  });

  it('T2: 매치 구간은 <mark>, 겹치거나 붙은 구간은 하나로 병합 (끝 인덱스 포함)', () => {
    const html = render({ text: '쿠버네티스 오토스케일링', indices: [[0, 2], [2, 4], [6, 7]] });
    expect(html.match(/<mark[^>]*>([^<]*)<\/mark>/g)).toEqual([
      '<mark class="bg-yellow-200 px-0.5 rounded">쿠버네티스</mark>',
      '<mark class="bg-yellow-200 px-0.5 rounded">오토</mark>',
    ]);
  });

  it('T3: 긴 본문의 뒤쪽 매치는 앞을 …로 줄이고 매치 주변 maxLength만 보여준다', () => {
    const text = `${'가'.repeat(300)}블록체인${'나'.repeat(300)}`;
    const html = render({ text, indices: [[300, 303]], windowed: true, maxLength: 60 });
    expect(html.startsWith('…')).toBe(true);
    expect(html.endsWith('…')).toBe(true);
    expect(html).toContain('>블록체인</mark>');
    expect(html.replace(/<[^>]+>/g, '').replace(/…/g, '')).toHaveLength(60);
  });

  it('T4: findIndicesForKey — 해당 key의 indices, 없으면 undefined', () => {
    const matches = [
      { key: 'title', indices: [[0, 1]] as [number, number][], value: 'x' },
      { key: 'content', indices: [[3, 5]] as [number, number][], value: 'y' },
    ];
    expect(findIndicesForKey(matches as any, 'content')).toEqual([[3, 5]]);
    expect(findIndicesForKey(matches as any, 'round')).toBeUndefined();
    expect(findIndicesForKey(undefined, 'title')).toBeUndefined();
  });
});
