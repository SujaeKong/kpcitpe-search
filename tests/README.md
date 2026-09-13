# 테스트

재사용 가능한 품질 점검 모음. 네 층으로 나뉩니다.

| 폴더 | 무엇을 | 선행 조건 | 실행 |
|---|---|---|---|
| `unit/` | 로더·검색·정규화·빌드 매핑·인증·API 핸들러 (모의 fetch/D1) | 없음 | `npm test` |
| `data/` | 빌드된 문항 데이터 규칙 + 해설지 매핑 무결성 | `npm run build:data` | `npm run test:data` |
| `e2e/` | 실제 Chrome 화면 흐름 + 빌드 결과물 | 빌드(스크립트에 포함) | `npm run test:e2e` |
| `live/` | 운영 사이트 헤더·데이터·게이트 (읽기 전용) | 배포 완료 | `npm run test:live` |

`helpers/`: `dist-server.ts`(Cloudflare Pages와 같은 캐시 헤더로 dist 서빙 + `/api/*` 대역), `browser.ts`(Chrome 실행), `api-context.ts`(API 핸들러 직접 호출), `fake-d1.ts`(D1 대역), `problem-fixture.ts`(문항 픽스처).

## 언제 돌리나

- **자동 (CI `deploy-cloudflare.yml`)**: `npm test` → 빌드 → `npm run test:data` (둘 다 실패 시 배포 중단) → 배포 → 운영 반영 대기 → `npm run test:live` (실패 시 빨간불, 배포는 이미 나감)
- **코드 수정 후**: `npm test` + `npm run test:e2e`
- **신규 회차 엑셀/해설지 반영 후**: `npm run build:data && npm run test:data`, 배포 후 `npm run test:live`
- 다른 주소 점검: `LIVE_BASE_URL=https://<preview>.kpcitpe-search.pages.dev npm run test:live`

## 알려진 결함 표시

`it.fails`로 표시한 테스트는 **아직 고치지 않은 결함**입니다. 결함이 있으면 통과하고, 고치면 "예상 밖 통과"로 실패하므로 그때 `it`으로 바꿉니다.

- D13: 옛 모의고사(2010~2017) 정보관리/컴시응 해설지 종목 뒤섞임 — PROJECT.md §16

## 케이스 목록

### unit/data-loader.test.ts — problems.json 로더
| ID | 내용 |
|---|---|
| U1 | `cache: 'no-cache'`(매 로드 재검증)로 요청 |
| U2 | sessionStorage 옛 데이터를 읽거나 쓰지 않음 |
| U3 | 동시 호출 시 요청 1회 |
| U4 | 응답 실패 시 상태코드 포함 에러 |
| U5 | `src/` 전체에 `force-cache` 없음 |

### unit/search.test.ts — 검색·필터
| ID | 내용 |
|---|---|
| S1–S2 | 최신순(회차↓ → 기출·합숙·모의 → 문항번호) / 오래된순 |
| S3–S5 | Fuse 제목 검색 + matches, 검색어+정렬 조합, 공백 검색어 |
| S6–S7 | 종목·출처 필터, 학원 `(없음)`=기출 |
| S8–S9 | 교시 칩(기출·모의 session / 합숙 sessionPart), 일차 칩은 합숙만 + 교시와 AND |
| S10–S11 | 회차 범위 양끝 포함, limit |

### unit/normalize.test.ts — 엑셀 정규화 (어댑터)
| ID | 내용 |
|---|---|
| N1 | 기출 회차 → 시험 연월(138=2026.02, 1년 3회), 단조 증가 |
| N2–N3 | 회차 표기 변형(`140회`, `모의2026.4`, `-N` 다회차), 접두어 불일치 거부 |
| N4–N5 | 종목 6표기→3종, `Day-1`/`1일차`/`1`→`1일차`, `2교시`→`2` |
| N6 | 소문제 `N.M`/`N-M`, 일반 `N.`, 번호 없음, `1. 2단계`는 일반 문항 |
| N7–N9 | 자동 문항번호: 등장순+ID 재생성, 명시번호 max+1, 모의는 종목 통합 번호(공통→정관→컴시) |
| N10–N11 | 합숙 교시 추정(≤8 논술, 9–16 약술, 17+ 앞 13개), 번호 재등장 → 2교시 |
| N12 | ID 규칙(종목·학원·일차 슬러그, 소문제 `N_M`) |

### unit/build-mapping.test.ts — 빌드 파이프라인
| ID | 내용 |
|---|---|
| B1 | 엑셀 최신 버전만 채택(숫자 비교 v100 > v99) |
| B2 | 기출 `교시_종목` 키 우선, `교시` 키 폴백 |
| B3 | 분할 PDF 우선, 없는 번호는 통합본 |
| B4 | 합숙 `일차_교시` / `일차` 키 |
| B5 | 모의 `-N` 회차 정확 키 우선, base 회차 폴백 |
| B6 | 매핑 없으면 비움 + 매칭 건수 |

### unit/api-handlers.test.ts — 사용자별 API 캐시·게이트
| ID | 내용 |
|---|---|
| A1–A3 | `/api/me` 비로그인·동의·미동의, `no-store` |
| A4–A5 | `/api/explanation` 비로그인 401, 미동의 403 |
| A6–A8 | 관리자 API 비관리자 403, 관리자 200 + `no-store`, CSV 동의자만 |

### unit/auth-flow.test.ts — 인증 흐름
| ID | 내용 |
|---|---|
| J1–J5 | JWT 왕복, 다른 키·위조 payload·만료·깨진 형식 → null(예외 없음) |
| J6–J8 | 세션 쿠키 파싱·플래그(HttpOnly/Secure/Lax/7일), isAdmin 대소문자·공백 |
| J9–J10 | Drive fileId 검증, `safeReturnPath` 내부 경로만 허용 |
| F1–F2 | 깨진 세션 쿠키 → `/api/me` 비로그인 200, 해설지 401 (500 아님) |
| F3–F4 | 로그아웃 쿠키 삭제 + return 유지, 외부 주소(`//`, `/\`, 탭, `/..//`) 차단 |
| F5–F7 | 네이버 로그인 URL·state 쿠키, 환경변수 없음 500, 콜백 거부/누락/state 불일치 400 |
| F8–F9 | 콜백 성공(upsert·세션 쿠키·state 삭제·한글 return 인코딩), 외부 return 차단 |
| F10–F11 | 수신동의 401/400, 동의·철회가 D1과 `/api/me`에 반영 |

### unit/search-history.test.ts — 검색 기록
| ID | 내용 |
|---|---|
| H1–H4 | 공백 제거·2자 이상, 중복 앞으로, 최근 10개, 개별·전체 삭제 |
| H5–H6 | 깨진 저장값 복구, localStorage 차단 환경에서도 예외 없음 |

### data/data-integrity.test.ts — 운영 데이터·매핑
| ID | 내용 |
|---|---|
| D1 | 1만 건 이상, stats 합계 일치, id 중복 없음 |
| D2–D6 | 학원 귀속, ID 접두어, 일차/교시 일관성, 회차 표기·정렬값, 문항번호·라벨·본문 |
| D7–D8 | 매핑 fileId 형식·문항 키·분할 파일 중복 없음, 문항의 해설지 id가 매핑에 존재 |
| D9 | **재분할 금지** 옛 형식 12개 회차에 `questions` 없음 |
| D10 | 빌드 결과가 현재 매핑과 일치(재빌드 누락 감지) |
| D11 | 기출·합숙 해설지 파일명 종목 = 문항 종목 |
| D12 | 모의 종목 불일치가 알려진 건수(1,495)보다 늘지 않음 |
| D13 | `it.fails` 모의 종목 불일치 0건 (알려진 결함) |

### e2e/stale-data.test.ts — 캐시 시나리오
| ID | 내용 |
|---|---|
| E1 | 방문 → 신규 문항 배포 → 같은 탭 새로고침 → 반영 |
| E2 | 방문 → 브라우저 종료 → 배포 → 재실행(디스크 캐시) → 반영 |
| E3 | 데이터 미변경 재방문은 304 |

> 2026-09-13: 수정 전 로더(`force-cache`)로 빌드하면 E1·E2·E3 모두 실패, 수정 후 통과 확인.

### e2e/ui-flows.test.ts — 화면 흐름
| ID | 내용 |
|---|---|
| E4 | 비로그인 해설지 클릭 → 현재 검색 상태를 return으로 네이버 로그인 |
| E5 | 로그인+미동의 → 동의 안내 → 동의 저장 → 서버 프록시 iframe 모달 |
| E6 | 로그인+동의 → 바로 모달, ESC 닫힘 |
| E7 | URL 필터 복원 + 칩 클릭 시 결과 수·URL 동기화 |
| E8 | 회차 목록 → 최신 합숙 회차 페이지 문항 수 일치 |
| E9 | 회차 페이지 카드(client:visible)도 해설지 게이트 동작 |

### e2e/build-output.test.ts — 빌드 결과물
| ID | 내용 |
|---|---|
| O1–O2 | 모든 회차 페이지 생성 + "총 N건" 일치, 회차 목록 링크 누락 없음 |
| O3 | `_headers`는 `/_astro/*`만 장기 캐시, `_routes.json`이 정적 자산을 워커에서 제외 |
| O4 | `dist/data/problems.json` = 방금 빌드한 데이터 |

### live/deploy.test.ts — 운영 사이트
| ID | 내용 |
|---|---|
| L1–L3 | index.html·problems.json 매번 재검증 + ETag, 조건부 요청 304 |
| L4 | 배포 JS 전부 200, 로더 번들 `no-cache`·`force-cache` 없음 |
| L5–L7 | 데이터 무결성, 로컬 빌드와 회차별 문항 수 일치, 최신 회차 페이지 |
| L8–L10 | `/api/me` no-store, 해설지 401, 관리자 403 |
| L11 | `/_astro/*` immutable 장기 캐시 |
