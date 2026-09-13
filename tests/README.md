# 테스트

재사용 가능한 품질 점검 모음. 세 층으로 나뉩니다.

| 폴더 | 무엇을 | 네트워크 | 실행 |
|---|---|---|---|
| `unit/` | 로더·API 핸들러를 모의 fetch/D1로 검사 | 없음 | `npm test` |
| `e2e/` | 실제 Chrome으로 "방문 → 새 데이터 배포 → 새로고침" 재현 | 로컬만 | `npm run test:e2e` (빌드 포함) |
| `live/` | 운영 사이트 헤더·데이터·게이트 점검 (읽기 전용) | 운영 | `npm run test:live` |

`helpers/`는 공용 도우미(`dist-server.ts`: Cloudflare Pages와 같은 캐시 헤더로 dist 서빙, `fake-d1.ts`: D1 대역)입니다.

## 언제 돌리나

- **자동 (CI)**: `deploy-cloudflare.yml`이 배포 전 `npm test`(실패 시 배포 중단), 배포 후 운영 반영을 기다렸다가 `npm run test:live`(실패 시 워크플로 빨간불 — 배포는 이미 나간 상태)를 실행
- **캐시·데이터 로딩·API 코드를 고쳤을 때**: `npm test` + `npm run test:e2e`
- **신규 회차 엑셀/해설지 반영 후 배포가 끝났을 때**: `npm run build:data` → `npm run test:live`
  (L6이 로컬 빌드와 운영 데이터의 회차별 문항 수를 비교해 배포 누락·지연을 잡음)
- 다른 주소 점검: `LIVE_BASE_URL=https://<preview>.kpcitpe-search.pages.dev npm run test:live`

## 케이스 목록

### unit — `unit/data-loader.test.ts`
| ID | 내용 |
|---|---|
| U1 | `/data/problems.json`을 `cache: 'no-cache'`(매 로드 재검증)로 요청 |
| U2 | sessionStorage에 옛 데이터가 있어도 읽거나 쓰지 않음 |
| U3 | 동시 호출 시 요청 1회 |
| U4 | 응답 실패 시 상태코드 포함 에러 |
| U5 | `src/` 전체에 `force-cache` 문자열 없음 |

### unit — `unit/api-handlers.test.ts`
| ID | 내용 |
|---|---|
| A1 | `/api/me` 비로그인 → `user:null`, `no-store` |
| A2 | `/api/me` 로그인+동의 → `marketingConsent:true`, `no-store` |
| A3 | `/api/me` 로그인+미동의 → `marketingConsent:false` |
| A4 | `/api/explanation` 비로그인 → 401 |
| A5 | `/api/explanation` 로그인+미동의 → 403 |
| A6 | `/api/admin/users`, `users.csv` 비관리자 → 403 |
| A7 | `/api/admin/users` 관리자 → 200, `no-store` |
| A8 | `/api/admin/users.csv?consent=1` 관리자 → 동의자만, `no-store` |

### e2e — `e2e/stale-data.test.ts`
dist/를 Cloudflare Pages와 같은 헤더(`max-age=0, must-revalidate` + ETag)로 서빙하고 `problems.json`을 바꿔 배포를 흉내 냅니다. 설치된 Chrome을 쓰고, 없으면 `npx playwright install chromium` 후 번들 Chromium을 씁니다.

| ID | 내용 |
|---|---|
| E1 | 방문 → 신규 문항 배포 → 같은 탭 새로고침 → 신규 카드·전체 건수 반영 |
| E2 | 방문 → 브라우저 종료 → 배포 → 다시 열기(디스크 캐시 보유) → 반영 |
| E3 | 데이터 미변경 시 재방문은 304 (10MB 재다운로드 없음) |

> 2026-09-13 확인: 수정 전 로더(`force-cache`)로 빌드하면 E1·E2·E3가 모두 실패, 수정 후 모두 통과.

### live — `live/deploy.test.ts`
| ID | 내용 |
|---|---|
| L1 | `index.html` 매번 재검증 헤더 |
| L2 | `problems.json` 매번 재검증 헤더 + ETag |
| L3 | `problems.json` 조건부 요청 → 304 |
| L4 | 배포된 JS 전부 200, 로더 번들이 `no-cache` 사용·`force-cache` 없음 |
| L5 | 운영 데이터 1만 건 이상, id 중복·필수 필드 누락 없음 |
| L6 | 로컬 `data/problems.json`과 회차별 문항 수 일치 (파일 없으면 skip) |
| L7 | 유형별 최신 회차 페이지 200 + "총 N건" 일치 |
| L8 | `/api/me` 비로그인 → `user:null`, `no-store` |
| L9 | `/api/explanation` 비로그인 → 401 |
| L10 | `/api/admin/users`, `users.csv` 비로그인 → 403 |
| L11 | `/_astro/*` 자산은 `immutable` 장기 캐시 (`public/_headers`) |
