/**
 * 분할 시그널 회귀 테스트용 "골격 텍스트" — 해설지 본문을 가리고 검출 정규식이 보는 구조만 남긴다.
 *
 * 저장소가 공개라 유료 해설 본문이 픽스처로 들어가면 안 된다:
 *  - 한글: 표지어 글자(문제풀이·출제도메인·교시·번·배경·의)만 남기고 나머지는 '가' (한글 여부 유지)
 *  - 영문: 대/소문자 모양만 'A' / 'a' (단어 경계·대문자 클래스 유지), 단 "rights reserved" 표지는 그대로
 *  - 그 밖의 문자(한자·기호·이모지 조각): '·', 숫자·공백·ASCII 기호는 유지
 * UTF-16 길이를 보존해 시그널의 앞 N자 창(slice)도 원문과 같다. 캡처 시 원문·골격 검출 결과가 같은지 확인한다.
 */
const KEEP_HANGUL = new Set([...'문제풀이출도메인교시번배경의']);

export function redactPageText(text: string): string {
  return text
    .split(/(rights\s+reserved)/)
    .map((part, i) => (i % 2 === 1 ? part : redactPart(part)))
    .join('');
}

function redactPart(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const code = s.charCodeAt(i);
    if (code < 0x80) out += /[A-Z]/.test(ch) ? 'A' : /[a-z]/.test(ch) ? 'a' : ch;
    else if (code >= 0xac00 && code <= 0xd7a3) out += KEEP_HANGUL.has(ch) ? ch : '가';
    else out += /\s/.test(ch) ? ch : '·';
  }
  return out;
}
