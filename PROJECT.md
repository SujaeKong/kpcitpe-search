# kpcitpe-search 프로젝트 정리

> 정보관리 / 컴시응 기술사 기출 · 합숙 · 모의고사 통합 검색 + 해설지 열람 사이트
>
> **운영 URL**: https://kpcitpe-search.pages.dev
> **레포**: https://github.com/SujaeKong/kpcitpe-search

---

## 0. 새 세션에서 빠르게 컨텍스트 회복하려면

이 파일을 처음부터 끝까지 읽으면 프로젝트 결정/구조/운영 흐름이 모두 잡힙니다. 휴대폰의 claude.ai 등에서 작업 이어갈 때 이 파일을 첨부하거나 내용을 붙여넣으면 동일 컨텍스트.

데스크탑 Claude Code 환경에서는 추가로 `~/.claude/projects/-Users-sujaekong-kpcitpe-search/memory/` 의 메모리들이 자동 로드됩니다 (로컬 전용).

---

## 1. 한 줄 소개

12,158건의 KPC 통합 엑셀 문제를 키워드로 검색하고, 매핑된 Drive PDF 해설지를 페이지 안에서 바로 열람. KPC가 신규 엑셀/PDF 추가 시 GitHub 업로드 + Drive 업로드만 하면 모든 후속 처리(빌드/매핑/배포) 자동.

운영 정책:
- 검색은 누구나 가능
- **해설지 열람은 Naver OAuth 로그인 필수** (인증 게이트)
- 마케팅 정보 수신은 별도 동의 (정보통신망법 준수, 선택)

---

## 2. 기술 스택 + 인프라

| 영역 | 선택 | 비고 |
|---|---|---|
| 프레임워크 | Astro 4 + React (Islands) + hybrid 모드 | 정적 + SSR 혼합 |
| 어댑터 | @astrojs/cloudflare 11.x | Pages Advanced Mode (`_worker.js/`) |
| 스타일 | Tailwind CSS | KPC red 액센트 |
| 검색 | Fuse.js | 클라이언트 메모리 검색 |
| 데이터 변환 | TypeScript + xlsx + tsx | scripts/build.ts |
| 호스팅 | **Cloudflare Pages** (`kpcitpe-search.pages.dev`) | GitHub Pages는 비활성화 (2026-05-05) |
| 백엔드 | Cloudflare Workers (Pages Functions) | OAuth callback, /api/me, /api/admin/* |
| DB | Cloudflare D1 (`kpcitpe-users`) | id `e4db547e-fb9f-4a42-a095-e259912bc429` |
| 인증 | Naver OAuth + JWT (HMAC-SHA256, Web Crypto) | 7일 세션 쿠키 |
| 해설지 열람 | `/api/explanation` 서버 프록시 (서비스계정으로 Drive 스트리밍) | **로그인 + 수신동의** 사용자만. 클라+서버 2단 게이트 |
| 해설지 읽기 인증 | Service Account (drive.readonly, RS256 JWT in Worker) | 통합본+분할본 전부 읽음. `src/lib/google-drive.ts` |
| 자동화 | GitHub Actions | deploy-cloudflare + sync-drive + split-pdfs + rename-hapsuk |
| PDF 분할 | pdfjs-dist + pdf-lib + Google OAuth Delegation | 통합 PDF → 문항별 PDF 자동 분할 (CI에서만, 사용자 Drive에 업로드) |
| 테스트 | Vitest + Playwright(설치된 Chrome) | `tests/` — unit / data / e2e / live. CI는 unit·data(배포 전)·live(배포 후), e2e는 로컬. `tests/README.md` |

---

## 3. 프로젝트 구조

```
kpcitpe-search/
├── data/
│   ├── source/kpc/             KPC 통합 엑셀 (사용자 업로드)
│   ├── mappings/
│   │   └── explanation-files.json   해설지 Drive ID 매핑 (자동)
│   ├── problems.json           CI에서 자동 생성 (.gitignore)
│   └── stats.json
├── public/
│   ├── favicon.png             KPC 로고
│   ├── robots.txt
│   └── data/                   problems.json 사본 (CI 빌드 시)
├── scripts/
│   ├── adapters/
│   │   ├── kpc-xls-adapter.ts    엑셀 → Problem[] 변환
│   │   └── types.ts
│   ├── build.ts                  변환 파이프라인 (분할 PDF 우선 매핑)
│   ├── sync-drive-mappings.ts    Drive 매핑 자동화 (questions 필드 보존)
│   ├── split-pdfs.ts             통합 PDF → 문항별 분할 (Phase B)
│   ├── debug-pdf-text.ts         페이지별 텍스트 덤프 (시그널 분석용)
│   ├── debug-multi.ts            다중 PDF + _split 폴더 진단
│   ├── rename-old-hapsuk.ts      합숙 옛 회차 폴더명 변경 (1회성)
│   └── debug-quality.ts
├── src/
│   ├── components/             검색 + 인증 + admin UI
│   ├── layouts/BaseLayout.astro
│   ├── lib/
│   │   ├── search.ts           Fuse 래퍼 + 필터/정렬
│   │   ├── search-history.ts   localStorage 검색 히스토리
│   │   ├── data-loader.ts      problems.json fetch (로드마다 ETag 재검증)
│   │   ├── jwt.ts              Web Crypto JWT
│   │   ├── auth.ts             세션 쿠키 헬퍼
│   │   ├── db.ts               D1 사용자 DB 헬퍼 (자동 schema)
│   │   ├── admin.ts            ADMIN_EMAILS 화이트리스트
│   │   ├── use-auth.ts         React useAuth hook (모듈 캐시)
│   │   └── types.ts
│   └── pages/
│       ├── index.astro                    메인 검색
│       ├── admin.astro                    관리자 페이지
│       ├── rounds/index.astro             회차 목차
│       ├── rounds/[sourceType]/[round].astro   회차별
│       └── api/
│           ├── me.ts                       세션 사용자 정보
│           ├── consent.ts                  마케팅 동의 토글
│           ├── auth/naver/login.ts
│           ├── auth/naver/callback.ts
│           ├── auth/logout.ts
│           ├── admin/users.ts              사용자 list (admin)
│           └── admin/users.csv.ts          CSV 다운로드 (admin)
├── tests/                      재사용 테스트 (README.md에 케이스 목록)
│   ├── unit/                   로더·검색·정규화·빌드 매핑·인증·API (npm test)
│   ├── data/                   빌드 데이터·해설지 매핑 무결성 (npm run test:data)
│   ├── e2e/                    실제 Chrome 캐시·화면 흐름 + 빌드 결과물 (npm run test:e2e)
│   ├── live/                   운영 사이트 점검 (npm run test:live)
│   ├── helpers/                dist 서버+API 대역, 브라우저, API 호출, D1 대역, 픽스처
│   └── vitest.config.ts
├── .github/workflows/
│   ├── deploy-cloudflare.yml   엑셀 push → 빌드 → Cloudflare 배포
│   ├── sync-drive.yml          매일 KST 03:00 + 수동, split-pdfs 자동 트리거
│   ├── split-pdfs.yml          통합 PDF 문항별 분할 + 자동 매핑 머지
│   ├── split-debug.yml         페이지별 덤프 (디버그용)
│   ├── split-diag.yml          다중 PDF 진단 (디버그용)
│   └── rename-hapsuk.yml       1회성 (이미 실행 완료)
├── wrangler.toml
├── astro.config.mjs            SITE/BASE 환경변수 의존
├── PROJECT.md (이 문서)
├── requirements.md             초기 요구사항 (참고용)
└── README.md
```

---

## 4. 환경변수 / Secrets 정리

### Cloudflare Pages env_vars / secrets (production)
- `NAVER_CLIENT_ID` — Naver OAuth client_id
- `NAVER_CLIENT_SECRET` — Naver OAuth secret
- `JWT_SECRET` — JWT 서명 키 (32 bytes hex)
- `PUBLIC_SITE_URL` — `https://kpcitpe-search.pages.dev`
- `ADMIN_EMAILS` — 콤마구분 admin 이메일 (`ksujae22@naver.com`)
- **`GOOGLE_SERVICE_ACCOUNT_JSON`** — `/api/explanation` 프록시가 Drive 해설지를 읽는 데 사용. 없으면 해설지 500. `deploy-cloudflare.yml`의 "Sync runtime secrets" 스텝이 GitHub 시크릿 → Pages로 **배포마다 자동 주입**(단일 출처).
- (D1 `DB`는 wrangler.toml binding으로 주입)

**OAuth Delegation (사용자 Drive 쓰기용 — CI/split-pdfs 전용, Worker 미사용)**:
- `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REFRESH_TOKEN` (GitHub Secrets에만)
- 이유: SA는 storage quota=0이라 업로드 불가 → 사용자(`ksujae@gmail.com`) OAuth로 Drive 15GB 사용. scope `drive.file`.
- ⚠️ OAuth 앱은 **프로덕션 게시 필수** — "테스트" 상태면 refresh token이 7일마다 만료(`invalid_grant`)되어 split-pdfs가 깨짐. (런타임 해설지는 SA라 무관.)

### GitHub Secrets
- `CLOUDFLARE_API_TOKEN` — Cloudflare 배포 + Pages 시크릿 주입용
- `CLOUDFLARE_ACCOUNT_ID` — `f20bfdcf3a187412a74b852b36ad4240`
- `GOOGLE_SERVICE_ACCOUNT_JSON` — Drive sync + 해설지 프록시 (Pages로도 주입)
- `GOOGLE_OAUTH_CLIENT_ID/SECRET/REFRESH_TOKEN` — split-pdfs 업로드용
- `DRIVE_ROOT_FOLDER_ID` — `1gKPEW_eVdR086KXwPDZIeUfPvlQp9-rV`

---

## 5. 데이터 흐름

```
[엑셀 업로드]                       [Drive PDF 업로드]
   GitHub data/source/kpc/             01. 기출문제 & 모의고사/*
   ↓ push                              ↓
deploy-cloudflare.yml                sync-drive.yml (매일 03:00 + 수동)
   ↓                                   ↓
   npm run build                       Drive 트리 BFS → 파일명 정규식 파싱
     = build:data + astro build        ↓
   ↓                                   explanation-files.json 갱신
   wrangler pages deploy dist          ↓
   ↓                                   변경 시 commit → deploy-cloudflare 트리거
[Cloudflare Pages 갱신]              ↓
                                    [Cloudflare Pages 갱신]
```

런타임 트래픽 (3경로):

**① 검색 — 100% 클라이언트 (서버 안 거침)**
```
브라우저 → Cloudflare CDN → index.html + problems.json(~9.9MB, HTTP 캐시 + 로드마다 ETag 재검증 → 미변경 시 304)
   → React 하이드레이션 → Fuse.js 인덱스(브라우저 메모리) → 로컬 검색. 서버 왕복 0, 비로그인 OK
```

**② 인증 — Pages Functions + D1**
```
/api/auth/naver/login → nid.naver.com 동의 → /api/auth/naver/callback
   → D1 users upsert → JWT 서명 → Set-Cookie(kpc_session, HttpOnly)
/api/me → 쿠키 검증 → {user, marketingConsent}
```

**③ 해설지 — 2단 게이트 + 서비스계정 Drive 프록시**
```
"📖 해설지 보기" 클릭
   │ (클라 1차 게이트, ProblemCard)
   ├─ 미로그인 → 네이버 로그인 이동
   ├─ 로그인+미동의 → "동의하고 보기" 프롬프트 → /api/consent (D1 update)
   └─ 동의완료 → iframe src = /api/explanation?fileId=XXX
                    ↓ Cloudflare Function (서버 2차 게이트 = 권위)
        JWT 검증 실패→401 / D1 marketing_consent=0→403
                    ↓ 통과 시 서비스계정 JWT(RS256)→access_token
        Drive files.get?alt=media (통합본+분할본) → application/pdf 스트리밍(no-store)
```
- 클라 게이트는 UX·즉시차단, 서버 게이트가 진짜 enforce(우회 불가). `src/pages/api/explanation.ts` + `src/lib/google-drive.ts`.

---

## 6. 운영 매뉴얼

### 6.1 신규 회차 추가 (가장 흔한 케이스)

**A. 해설지 PDF (Drive)**
1. Drive `01. 기출문제 & 모의고사/{카테고리}` 진입
2. 신규 회차 폴더 생성 (예: `제139회 기출문제 해설집`, `139회 (2026-05)`, `제130회(26년07월)KPC기술사 모의고사 해설집`)
3. 폴더 안에 PDF 드래그
4. **끝** — 다음 KST 03:00 자동 sync에서 매핑 → split-pdfs가 문항별 분할 → 사이트 자동 배포 (Actions 탭 수동 trigger 가능)

자동 흐름:
```
sync-drive (매핑 갱신, commit)
   ↓ sync 전후 매핑을 비교해 이번에 새로 생긴(또는 파일 id가 바뀐) 키만 추출
split-pdfs (mode=all + keys=<신규 키>, 문항별 분할 + questions 매핑 머지, commit)
   ↓
deploy-cloudflare (build:data + 사이트 빌드 + Pages 배포)
```

**신규 키만 넘기는 이유** (2026-09-20 도입, `scripts/lib/mapping-diff.ts`): `mode=all`을 키 제한 없이 돌리면 questions 없는 옛 회차 수백 개가 전부 재분할돼 통합본으로 폴백해 둔 정렬오류 회차(§10)가 다시 어긋난 분할로 되살아난다. 그렇다고 종전처럼 `mode=test`(하드코딩 `TEST_SPECS`)만 돌리면 **신규 회차가 아예 분할되지 않는다** — 실제로 140회는 이 때문에 통합본 연결로만 남아 수동 실행이 필요했다. 신규 키가 없는 sync는 종전대로 `TEST_SPECS` 회귀 분할만 돈다.

분할이 신규 PDF 형식이라 실패해도 통합 PDF로 fallback (사이트 동작에 영향 없음). 실패 패턴은 디버그 워크플로로 분석 후 시그널 추가.

**해설지를 교체 업로드할 때**: 같은 키라도 Drive 파일 id가 바뀌면 신규 키로 잡혀 다시 분할된다. 단, 기존 분할본은 `OVERWRITE=0`이라 그대로 남으므로 내용이 바뀌었으면 `Split PDFs`를 `overwrite=true`로 한 번 돌려야 한다.

**파일명 변형을 먼저 확인한다** (2026-11-07, 모의 제132회): KPC가 `해설집` → `해설지`로 바꿔 보내면 `parseMoui` 패턴 A(`_해설집_YYYYMM_N교시`)가 전부 놓친다. 업로드 전에 `parseMoui`/`parseKichul`에 실제 파일명을 넣어 돌려보고, 안 잡히면 파일명을 바꾸지 말고 **파서를 넓힌 뒤 골든 테스트**(`npm test` — 기존 매핑 파일명 전부 재파싱)로 회귀가 없음을 확인한다. 이번엔 `_해설[집지]_(?:제?\d+회_)?YYYYMM_N교시`로 넓혔고, 그 결과 **예전에도 '해설지'로 왔던 파일 6개가 그동안 매핑 누락이었던 것**이 함께 드러났다(2023.07/4·2023.10/4·2023.11/4·2023.12/1·2024.07/1·2024.11/3 → 해설지 연결 9,859 → 9,963, 분할본 3,558 → 3,646). 즉 파싱 실패는 조용히 "해설지 없음"으로 보이므로, 커버리지 급감이 아니라 **처음부터 안 붙은 상태**로 남는다.

**엑셀·PDF 순서는 상관없다** (2026-09-22 보강, `scripts/lib/pending-splits.ts`): split은 problems.json에 문항이 없으면 "매칭 없음, 스킵"으로 끝난다. 해설지를 엑셀보다 먼저 올리면 sync가 신규 키로 잡아 split을 돌려도 아무것도 못 하고, 나중에 엑셀을 올려도 파일 id가 그대로라 sync에겐 더 이상 신규 키가 아니라 통합본 연결로 굳었다. 그래서 배포가 **운영 problems.json과 새 빌드를 비교해 "운영엔 문항이 없었는데 이번에 생긴" 미분할 키**를 찾아(배포 전 계산) 배포 성공 후 split에 넘긴다. 운영에 이미 문항이 있던 키는 제외되므로 통합본 폴백해 둔 옛 회차는 건드리지 않는다 — 실측으로 미분할 키 694개 중 672개가 이 조건에서 걸러진다. 분할이 끝나면 questions가 생겨 다음 배포에서 대상에서 빠지므로 반복되지 않는다.

**B. 통합 엑셀 (검색 데이터)** — GitHub 웹에서:
1. https://github.com/SujaeKong/kpcitpe-search → `data/source/kpc/`
2. **Add file → Upload files** → 새 엑셀 드래그 (파일명 `KPC_기술사문제검색_v{YYMMDD}.xls`)
3. commit 메시지 한 줄 (예: `data: KPC v260712`)
4. Commit changes → 1~2분 후 자동 배포

옛 버전 파일은 **삭제할 필요 없음** — `build.ts`가 같은 베이스명을 가진 `_v{날짜}` 파일 중 가장 높은 버전만 자동 채택하고 나머지는 스킵 로그를 남김 (`scripts/build.ts:pickLatestVersions`). 이력 보존용으로 남겨두면 됨.

### 6.2 관리자 페이지 사용
- https://kpcitpe-search.pages.dev/admin
- `ksujae22@naver.com` 계정 로그인 시만 접근
- 사용자 통계 / CSV 다운로드 (전체 / 동의자만)

### 6.3 신규 admin 추가
Cloudflare 대시보드 → Pages → kpcitpe-search → Settings → Environment variables → `ADMIN_EMAILS` 값에 콤마로 추가 → 재배포.

또는 API:
```bash
curl -X PATCH "https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/pages/projects/kpcitpe-search" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"deployment_configs":{"production":{"env_vars":{"ADMIN_EMAILS":{"value":"a@x.com,b@y.com","type":"secret_text"}}}}}'
```

### 6.4 트러블슈팅

| 증상 | 원인 | 해결 |
|---|---|---|
| 신규 회차 카드가 예전 방문자에게만 안 보임 | (2026-09-12 수정) 과거 `data-loader`의 `force-cache` + 버전 고정 sessionStorage가 옛 problems.json을 재사용 | 현재는 로드마다 재검증 → 새로고침으로 반영. 그래도 안 보이면 라이브 `/data/problems.json`에 해당 회차가 있는지 먼저 확인(배포 문제) |
| "해설지 준비 중"인데 매핑 됐을 거 같음 | 매핑 mismatch 또는 미배포 | 라이브 `/data/problems.json`에서 해당 문항 `explanationFileId` 확인 → 비어 있으면 sync/split 매핑 로그 확인 |
| 매핑 누락 (특정 회차) | 새 파일명 변형 미매칭 | sync log 확인 → parseKichul/Moui/Hapsuk 패턴 추가 |
| sync workflow 실패 (push rejected) | 자동 commit + 수동 push 충돌 | 자동 `pull --rebase` retry 설정됨 |
| iframe PDF 로드 실패 | Drive 공유 권한 미설정 | 폴더 → 일반 액세스 → "링크 있는 모든 사용자" |
| OAuth redirect 실패 | NAVER_CLIENT_ID/CALLBACK URL 불일치 | Naver Developers 콘솔 콜백 URL = `https://kpcitpe-search.pages.dev/api/auth/naver/callback` |
| `/admin` "권한 없음" | ADMIN_EMAILS 미등록 또는 다른 계정 로그인 | env_var 확인, 로그아웃 후 admin 계정으로 재로그인 |
| GitHub Pages 404 | 의도된 비활성화 (2026-05-05) | Cloudflare Pages URL 사용 |

### 6.5 D1 직접 쿼리 (디버깅)
Cloudflare 대시보드 → D1 → `kpcitpe-users` → Console:
```sql
SELECT * FROM users ORDER BY joined_at DESC LIMIT 10;
SELECT COUNT(*) FROM users WHERE marketing_consent = 1;
```

또는 wrangler:
```bash
wrangler d1 execute kpcitpe-users --command "SELECT * FROM users LIMIT 5" --remote
```

---

## 7. 데이터 모델

### 7.1 Problem 스키마 (problems.json)

```ts
{
  id: string;                            // 'kichul-138-mgmt-1-3' 등
  sourceType: '기출' | '합숙' | '모의' | '자체';
  academy: 'KPC' | 'ITPE' | null;       // 기출만 null
  certScope: '정보관리' | '컴시응' | '공통';
  round: string;                         // '138' | '2026.04'
  roundLabel: string;
  roundOrder: number;
  session: string;                       // '1' | '1일차'
  sessionType: '교시' | '일차';
  sessionPart?: '1교시' | '2교시' | null; // 합숙
  questionNumber: number | null;
  questionSubNumber: number | null;
  questionLabel: string;
  title: string;
  content: string;
  preparingFor?: string | null;
  sourceFile: string;
  explanationFileId?: string | null;     // sync가 채움
  explanationFileName?: string | null;
}
```

### 7.2 explanation-files.json 매핑 키

```
기출:  {round}.{session}_{certScope}     예: '138' → '1_정보관리'
합숙:  {round}.{session}_{sessionPart}    예: '2026.02' → '1일차_1교시'
모의:  {academy}.{round}.{session}        예: 'KPC' → '2026.04' → '1'          (종목 통합 해설집)
       {academy}.{round}.{session}_{종목} 예: 'KPC' → '2016.01' → '3_컴시응'   (옛 회차 종목별 해설집, 2026-09~)
```

각 entry 구조:
```typescript
interface ExplanationEntry {
  id: string;          // 통합 PDF Drive fileId (fallback)
  name?: string;
  questions?: {        // Phase B: 문항별 분할 PDF (있으면 우선)
    [questionNumber: string]: {
      id: string;      // 분할 PDF fileId (사용자 Drive `_split/` 폴더)
      name: string;
    };
  };
}
```

build.ts의 `applyExplanationMap`이 problem 별로:
1. `questions[problem.questionNumber]` 있으면 그 fileId 사용
2. 없으면 entry.id (통합 PDF) 사용

모의 round는 -N suffix(`2010.10-1`) variant도 base round(`2010.10`)로 자동 fallback.

모의 조회 순서(build `applyExplanationMap`): 정보관리·컴시응 문항은 `교시_종목` → `교시`(통합). **다른 종목 해설집으로는 절대 폴백하지 않음.** 공통 문항은 `교시` → 없으면 종목별 해설집의 통합본만(분할 번호는 그 종목 문항 번호라 사용 안 함). 키 규칙은 `scripts/lib/explanation-keys.ts`(sync·split 공용).

### 7.3 D1 users 테이블

```sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  naver_id TEXT UNIQUE NOT NULL,
  email TEXT,
  name TEXT,
  joined_at INTEGER NOT NULL,
  last_login_at INTEGER NOT NULL,
  marketing_consent INTEGER NOT NULL DEFAULT 0,
  marketing_consent_at INTEGER
);
```

### 7.4 데이터 정규화 규칙 (보강 적용)

- **회차**: `'138', '138회'` → `'138'`. `'모의_2010.10-1'` (월 2회) 지원.
- **종목**: 6가지 표기 → 3종 (`정보관리`, `컴시응`, `공통`). `조직`(2010~2011 모의, 조직응용)은 `컴시응` (2026-09~, 이전엔 공통으로 잘못 분류).
- **합숙 일차**: `Day-1`, `1일차`, `1` → `1일차`로 통일.
- **소문제**: `1.1`, `1-2` 형태 → `questionSubNumber` 분리.
- **옛 회차 단답형 questionNumber=null**: 그룹 내 자동 순번.
- **합숙 sessionPart**: 그룹 사이즈 + 같은 번호 두 번째 등장 휴리스틱.
- **합숙 옛 회차 폴더명**: `093회합숙(2011-02)` 등 (YYYY-MM) 추가됨.

---

## 8. 매핑 커버리지 (현재)

### 8.1 통합 PDF 매핑

```
기출   : 279건 매핑 (회차 기반, 47회차 중 ~30+회차)
합숙   : 216건 (옛 회차 매핑 후 +30)
모의   : 400건 (새 패턴 추가 후 +20)
─────────────
총 895건 매핑 / 12,158건 전체
```

매처 위치: `scripts/sync-drive-mappings.ts` 의 `parseKichul` / `parseHapsuk` / `parseMoui`.

신규 패턴 등장 시 sync log에 미매칭 폴더 샘플이 출력됨:
```bash
gh run view <RUN_ID> --log | grep '매칭 0/'
```

### 8.2 문항별 분할 PDF (Phase B)

매핑 JSON의 각 entry에 `questions` 필드(문항번호 → 분할 PDF id) 자동 추가.

```json
"기출": {
  "138": {
    "1_정보관리": {
      "id": "...",       // 통합 PDF (fallback)
      "name": "...",
      "questions": {     // 분할 PDF (있으면 우선 사용)
        "1": { "id": "...", "name": "기출_138_정보관리_1_01_..." },
        "2": { ... }
      }
    }
  }
}
```

build.ts가 `problem.questionNumber`로 분할 PDF 우선 매핑, 없으면 통합 PDF fallback.

---

## 9. GitHub Actions 워크플로우

### 9.1 deploy-cloudflare.yml
- **트리거**: main push / 수동
- **동작**: npm ci → **unit 테스트** → npm run build → **data 무결성 테스트** → **해설지 연결 회귀 검사**(운영 대비 급감 시 중단) (셋 중 하나라도 실패 시 배포 중단) → 시크릿 주입 → wrangler pages deploy → 운영 반영 대기(problems.json + JS 번들 목록이 dist와 일치) → **live 테스트**
- **소요**: 1~2분

### 9.2 sync-drive.yml
- **트리거**: 매일 KST 03:00 / 수동
- **동작**: Drive sync (매핑) → 변경 시 commit → **split-pdfs 트리거** → deploy-cloudflare 트리거
- 매핑 내용이 같으면 `$generatedAt`도 유지해 파일이 안 바뀜 → 커밋·split·배포 없음. push 충돌 시 최신 main으로 reset 후 sync 재실행(3회)
- **소요**: 1~3분

### 9.3 split-pdfs.yml (Phase B)
- **트리거**: sync-drive 변경 후 자동 / 수동
- **동작**: explanation-files.json의 entry 별로 통합 PDF를 문항별 분할 → 사용자 Drive(`_split/`)에 업로드 → 자체검증 → 매핑 JSON에 `questions` 필드 머지 → 자동 commit
- **모드**:
  - `test`: TEST_SPECS 19개 회차만 (디버그용)
  - `all`: explanation-files.json 전체 entry (기본, ~895 task). idempotent — 이미 `questions` 있으면 자동 스킵
- **옵션**: `overwrite` (기존 분할 파일 휴지통 이동 후 재업로드), `batch_offset/batch_limit` (chunked 실행), `concurrency` (병렬, 기본 5), `only` (task 좁히기: `모의`, `모의:종목별`)
- **자동 제외**: `NO_RESPLIT_KEYS`(재분할 금지 **21건**)는 `mode=all`에서도, 키를 명시해도 task를 만들지 않음
- **`keys`**: 매핑 키를 콤마로 지정해 좁힘. 키를 명시한 실행은 이미 분할된 항목도 대상(`includeAlreadySplit`) — 복구용 재분할 경로. sync·배포의 신규 회차 자동 분할도 이 입력을 쓴다
- **`only` 예**: `모의`, `모의:종목별`, `모의:회차=2011.07,2023.12`
- **매핑 push 충돌**: 실행 중 다른 워크플로가 매핑을 커밋하면 rebase 대신 최신 main으로 reset 후 `npm run split:merge`로 분할 결과를 재머지해 push (3회). 그래도 실패하면 산출물 `split-result`로 수동 복구(§12)
- **소요**: 전체 ~1.5~3시간 (concurrency=7 기준), idempotent라 두 번째부터는 신규 entry만

### 9.4 split-audit.yml (Split Alignment Audit)
- **트리거**: 매주 월 KST 05:00 자동(내용 감사) / 수동. 읽기 전용 — 매핑·Drive를 바꾸지 않음
- **`check` 입력**:
  - `content` — 올라간 분할본 PDF를 읽어 그 교시 문항 제목과 대조(짝 어긋남 적발). **분할 작업 후에는 이걸 돌려 확인한다**
  - `alignment` — 통합본을 다시 재서 검출 수·번호·제목 정렬 확인
  - `title-anchor` — 제목만으로 문항 시작 페이지를 특정할 수 있는지 측정(쓰기 없음)
  - `text-layer` — 통합본 폴백 원인 전수 분류(`classifyFallback`: detect-gap / no-signal / sequence / alignment / ocr-candidate / image-heavy / no-resplit / ok). 이미지 페이지 규모와 "고치면 몇 문항이 분할되는가"를 센다
  - `renumber` — 번호 위치순 재배정 실험. sequence 중단 건이 재배정으로 가드를 통과하는지 제목 정렬로 판정(쓰기 없음)
- **옵션**: `only`(키 접두어), `concurrency`, `target`(combined/splits), `sample`(0=전체)
- **소요**: content 전수 약 10분, text-layer 전수 약 40분

### 9.5 split-debug.yml / split-diag.yml
- **트리거**: 수동
- **동작**: 페이지별 텍스트/좌표/마커 후보 덤프. 새 PDF 형식 만났을 때 시그널 추가용 분석 도구.

### 9.6 rename-hapsuk.yml (1회성)
- 합숙 옛 회차 폴더명에 (YYYY-MM) 추가하는 1회성 스크립트. 이미 실행 완료. 향후 필요 시 재사용.

---

## 10. 변경 이력 (전체 작업)

### Phase 1: 데이터 변환 (Day 1)
- KpcXlsAdapter: 3시트 통합, 정규화, 소문제 분리, 옛 회차 자동 순번
- 합숙 sessionPart 휴리스틱
- 12,158건 정확 변환

### Phase 2: 검색 UI (Day 2)
- Astro + React Islands + Fuse.js + Tailwind
- 검색바(debounce) + 필터(다중 칩) + 정렬 + 회차 슬라이더
- 모바일 필터 drawer
- 검색 히스토리 (localStorage)
- URL 동기화
- 검색어 하이라이팅

### Phase 3: 해설지 (Day 2~3)
- iframe 임베드 모달 (ESC, 백드롭, 모바일 새 탭, 5초 fallback)
- Drive sync 자동화 (Service Account, 매일 03:00)
- 매핑 패턴: 기출 8가지 + 모의 5가지 + 합숙 1가지
- 합숙 옛 회차 폴더 자동 이름 변경 (1회성)
- 다운로드 차단 시도 → 개인 Drive owner-only 제약으로 페이지 측 차단(/preview + 버튼 제거)으로 대응

### 부가 기능
- 회차별 브라우징 (`/rounds/`, `/rounds/[sourceType]/[round]`) — 동적 라우트, 203 페이지
- KPC 로고 헤더/푸터/favicon (astro:assets)
- og/twitter 메타, robots.txt
- ID 규칙 보강 (cert/academy 슬러그)

### Cloudflare 마이그레이션 (Day 3)
- GitHub Pages → Cloudflare Pages
- @astrojs/cloudflare adapter (hybrid 모드)
- wrangler.toml + GitHub Actions 자동 배포
- GitHub Pages 비활성화

### Phase A: 인증 (Day 3)
- A1: Cloudflare 마이그레이션
- A2: Naver OAuth + Web Crypto JWT (외부 라이브러리 0)
- A3: D1 사용자 DB + 마케팅 동의 (정보통신망법 준수) + 해설지 인증 게이트
- 동의 패널 인센티브 강조 ("신규 회차 해설지 우선 안내")

### Admin 페이지 (Day 3)
- /admin 사용자 관리 (통계 + 테이블 + CSV)
- ADMIN_EMAILS 화이트리스트
- 미인증/비-admin/admin 3단계 UX

### Phase B: 문항별 PDF 분할 (Day 4)

**목표**: 통합 PDF(예: 한 교시 16문항 통째로) → 문항별 분할 PDF로 자동 변환. 사이트에서 카드 클릭 시 그 문항 풀이만 열림.

**핵심 결정**:
- **Service Account vs OAuth Delegation**: SA는 storage quota=0이라 업로드 불가. OAuth Delegation으로 사용자(`ksujae@gmail.com`) Drive 15GB 사용 (R2/카드 결제 회피).
- **읽기/쓰기 인증 분리**: 통합 PDF 다운로드는 SA, 분할 PDF 업로드는 OAuth.
- **`drive.file` scope**: 앱이 만든 파일만 접근 (least privilege).

**다중 시그널 자동 검출**:

| 시그널 | 패턴 | 적용 회차 예 |
|---|---|---|
| `munje` | `문 제 N.` (페이지 첫 400자, 직전 글자가 한글이면 제외) | 합숙 130회+, 기출 130회+, 모의 100회+ |
| `bracketmunje` | `[문제풀이] N.` | 87회 등 옛 기출 |
| `kpc-domain` | `출제도메인` + 페이지 시작 `") N 제목"` | 22회 등 옛 모의 |
| `kpc-bunho` | `N 교시 M 번 {제목}` | 110회 등 기출 |
| `kpc-mungje` | `N {keyword} 문제` + `도메인` + `출제(배경\|의도)` | 일부 합숙/모의 (성공률 불안정) |
| `kpc-rights-num` | `rights reserved {pageNum} ... {questionNum} {title}` + `출제도메인` | 89~115회 KPC Convergence 형식 |

시그널 우선순위로 시도, 첫 번째로 ≥3 문항 검출되는 것 채택. 두 자리 숫자 자릿수 사이 공백 변형 지원(`1 0 .` → 10).

**안전 가드** (모두 통과해야 분할 적용):
1. 검출 ≥ 3 (signal=none이면 fallback)
2. 검출 갯수 == problems 갯수 (다르면 매핑 안전 X → fallback)
3. 검출 번호 시퀀스가 1, 2, ..., N 연속 (페이지번호 mis-match 차단)
4. (2026-09~) 제목 정렬: 각 구간 첫 페이지에 짝지은 문항 제목 토큰이 있는지 offset -2..2로 대조, 0이 아닌 offset이 더 잘 맞으면 포기 (옛 형식 off-by-one 차단, `checkTitleAlignment`)

→ 가드 실패 시 `questions` 필드 미생성, 사이트는 통합 PDF 그대로 사용.

**자체검증**: 업로드된 분할 PDF를 다시 다운로드해 시그널별 마커가 존재하는지 재확인. 검증 실패 시 `validated: false` 표기.

**PDF 내부번호 ↔ problems 번호 분리**:
- 87회 1교시 정관: PDF 내부 1번 = problems의 14번(OCL). 검출 순서 ↔ problems의 questionNumber 정렬 순서 1:1 매핑.
- 파일명/매핑 키는 problems의 번호, 자체검증은 PDF 내부 번호 사용.

**자동 모드 + 병렬 + chunking**:
- `SPLIT_MODE=all`: mappings 전체 entry → spec 자동 생성, 이미 `questions` 있으면 스킵 (idempotent).
- `CONCURRENCY=N`: N개 task 동시 처리 (Drive API rate limit 고려, 기본 5~7).
- `BATCH_OFFSET/BATCH_LIMIT`: chunked 실행 (timeout 회피).

**파일명 규칙**:
```
{종류}_{회차}_{종목}_{교시}_{번호padded}_{핵심키워드}.pdf
예) 합숙_2026.02_공통_1일차_1교시_01_패스키Passkey에_대해_설명하시오.pdf
    기출_87_정보관리_1_14_OCL.pdf  (PDF 내부 1번이 problems 14번)
```

**자동 워크플로 통합**:
- sync-drive.yml이 매핑 변경 감지 시 split-pdfs.yml 자동 트리거 → split-pdfs가 매핑 JSON 업데이트 + 자동 commit/push
- sync-drive-mappings.ts는 `questions` 필드 보존 (sync가 split이 추가한 정보를 날리지 않게)

**검증 결과 (19개 샘플 task, 6개 시그널)**: 16/19 분할 성공 (총 211문항), 3/19 fallback (모두 옛 형식 PDF: 합숙 114/107회, 모의 77회).

**⚠️ 옛 회차 분할 정렬 오류 → 통합본 폴백 (2026-06)**: 옛 2008~2010년대 형식에서 문항↔내용이 한 칸씩 어긋나는 분할이 발견됨 (예: 87회 1교시 Q2 클릭 시 1번 해설 노출 — 엑셀 문제번호와 PDF 물리 순서 불일치 + 마커 검출 off-by-one). best-offset 검증(본문 vs ±2 문제제목 매칭)으로 일관되게 어긋난 **12개 회차의 `questions`를 제거해 통합본(전체 PDF)으로 폴백**: 기출 87/1정·93/3정·93/4정·105/4컴, 모의 2010.10/1·2012.04/3·4·2012.12/2·2013.05/3·2014.04/2·2022.11/3·2023.11/4. **이 회차들은 옛 형식 검출 off-by-one을 고치기 전까지 재분할(split-pdfs) 금지** — 재분할하면 다시 어긋남. (2026-09: `scripts/lib/explanation-keys.ts`의 `NO_RESPLIT_KEYS`로 split-pdfs 자동 task에서 제외. 모의 2012.12/2·2013.05/3·2014.04/2는 종목 키 분리 후 `…/2_정보관리` 경로. **모의 2023.11/4는 목록에서 제외** — 파일이 실제로는 116회(2023.12) 4교시 해설집인데 2023.11에 잘못 매핑돼 어긋났던 것으로 본문 확인, 2023.12로 옮기고 제목 정렬 가드로 분할 → 현재 11건.) (정렬 검증 방법: SA로 분할본 1페이지 텍스트 추출 → 문제제목 토큰 매칭 best-offset.)

### 캐시 품질 수정 + 테스트 도입 (2026-09-12~13)
- **증상**: 예전 방문자는 새로고침해도 신규 회차(140회 기출·합숙 2026.08) 카드가 안 보임. 서버 데이터는 정상.
- **원인**: `data-loader`가 `force-cache`로 브라우저 캐시의 옛 problems.json을 재검증 없이 사용 + 버전 고정 sessionStorage(데이터가 quota 초과라 실제론 저장 실패).
- **수정**: `cache: 'no-cache'`(ETag 재검증, 미변경 시 304) + sessionStorage 제거. `/api/me`, `/api/admin/users(.csv)`에 `private, no-store` 추가(사용자별 응답 캐시 금지).
- **테스트**: `tests/` (unit 13 / e2e 3 / live 11). e2e는 수정 전 코드로 빌드 시 3건 모두 실패 → 수정 후 통과로 버그 재현력 확인.
- **CI 연동**: deploy-cloudflare가 배포 전 unit, 배포 후 live 실행 (e2e는 로컬 전용).
- **캐시 헤더**: `public/_headers`로 `/_astro/*`(해시 파일명)만 `max-age=31536000, immutable`. HTML·`/data/*`는 기본 `max-age=0, must-revalidate` 유지 — 이 둘에 장기 캐시를 걸면 같은 장애가 재발하므로 금지.

### 테스트 확장 + 인증 결함 수정 (2026-09-13)
- **테스트**: unit 77 / data 13 / e2e 13 / live 11. 검색·정규화·빌드 매핑·인증 흐름·데이터 무결성·화면 흐름 추가. 테스트에서 import하도록 어댑터 정규화 함수와 `build.ts`의 `pickLatestVersions`/`applyExplanationMap`을 export (`build.ts`는 직접 실행 시에만 `main()`).
- **수정 — open redirect**: 로그아웃/로그인 콜백의 return 검사가 `startsWith('/')`뿐이라 `//evil.com`, `/\evil.com`, `/\t/evil.com`, `/..//evil.com`으로 외부 이동 가능 → `safeReturnPath()`(URL 해석 후 같은 origin만, 한글 인코딩)로 통일.
- **수정 — 깨진 세션 쿠키 500**: 서명이 base64가 아닌 쿠키면 `verifyJwt`의 `atob` 예외로 `/api/me`·해설지 API가 500 → 형식 오류는 null(비로그인) 처리.
- **발견 — 모의 해설지 종목 뒤섞임**: 아래 "모의 해설지 종목 키 분리"에서 수정.

### 모의 해설지 종목 키 분리 (2026-09-13)
- **결함**: 옛 모의(2010~2019)는 교시마다 정보관리·컴시응 해설집이 따로인데 sync가 `KPC/회차/교시` 한 키에 먼저 찾은 파일만 저장 → 50개 회차 1,508문항이 다른 종목 해설에 연결. 겹친 원인: 모의 자동 문항번호가 교시 통합 번호로 바뀐 뒤(컴시응 1~6 → 7~12) 옛 종목별 분할 번호가 다른 종목 문항 번호와 맞물림.
- **수정**: sync 모의 키에 종목 포함(`교시_종목`), questions는 fileId 기준 보존. build는 같은 종목 → 통합 순으로만 조회. split-pdfs는 종목 키 인식 + `NO_RESPLIT_KEYS` 자동 제외 + 제목 정렬 가드 + `only` 입력.
- **매핑 이전**: 종목별 해설집 208건 키 이동, 기존 분할 50건은 해당 종목 문항 수와 모두 일치해 현재 번호로 재배치(분할 파일명 주제어로 대조 검증). 결과: 잘못된 연결 1,508건 해제, 같은 종목 재배치 246건, 공통 문항 통합본 31건. 기출·합숙 변화 없음.
- **후속 (같은 날 완료)**: sync가 짝 종목 해설집 210개 추가 매핑(모의 408 → 618 entry). `split-pdfs mode=all only=모의:종목별` 365 task 중 49개 해설집(364 PDF, 전부 자체검증 OK) 분할, 나머지는 검출 수 불일치 184·번호 시퀀스 비정상 103·검출 실패 3·문항 없음 26으로 통합본 유지. 제목 정렬 가드에 걸린 건 0. 워크플로 매핑 push가 rebase 충돌로 실패해 산출물로 `split:merge` 복구 → 워크플로를 재머지 방식으로 수정.
- **결과(모의)**: 분할본 2,128 / 통합본 2,925 / 없음 908 문항, 종목 불일치 0. (없음 +58은 자기 종목 해설집이 Drive에 없는데 다른 종목 해설에 연결돼 있던 문항)

### 시각만 바뀐 매핑 커밋 제거 + '조직' 종목 정규화 (2026-09-13)
- **매일 쌓이던 bot 커밋**: sync가 내용이 같아도 `$generatedAt`을 새로 써 매일 커밋 → split(test)·배포까지 매일 실행됐음. `sameMappingContent`(시각·키 순서 무시 비교)로 내용이 같으면 시각 유지, split 결과 머지도 내용이 같으면 파일을 쓰지 않음.
- **sync-drive push 충돌**: rebase 대신 최신 main으로 reset 후 sync 재실행(분할 정보는 fileId 기준 보존).
- **'조직' → 컴시응**: 원본 엑셀에서 '조직'은 모의 2010.03~2011.07 15회차 278행에만 있고 항상 '관리'와 짝, '응용'과 같은 회차에 쓰인 적 없음, 해설집 `[조직응용]N교시해설` → 조직응용(지금의 컴시응). 영향: 종목 270·ID(common→app) 315·자동 문항번호 90건 변경(ID는 React key로만 사용). 해당 구간 분할본 주제어 일치 79/82로 전후 동일, 연결 해제 6건(2010.12 4교시 조직 문항이 [정보관리] 해설집에 연결돼 있던 것).
- **분할본 주제어 가드**: 전체 분할본 연결 3,561건을 파일명 주제어 ↔ 문항 제목·본문으로 대조(기호 무시)해 실제 어긋남 3건 발견 — 모의 2011.05 1교시 12·13번(엑셀에 정보관리·컴시응 선택 문항이 같은 번호로 2개씩, 분할본은 정보관리 것만 → 컴시응 SON·VRM에 CPLD·Sort 분할본), 모의 2010.11 2교시 7번(엑셀↔PDF 순서 차이로 9번 주제 분할본). build `splitMatchesProblem`으로 주제어가 안 맞으면 통합본 연결, data D13으로 감시.
- **파일명 연월 오기 보정**: 모의 해설집 파일명의 회차 번호↔연월을 대조해 불일치 4묶음 발견, Drive PDF 본문 머리말·첫 문항을 엑셀과 대조해 확정. ① `해설집_31회_201104_*` 8개 = 실제 2011.07(본문 "제31회 2011년 7월") ② `제76회 컴퓨터시스템응용_해설집_201704_1교시` = 2017.06 ③ `제116회_해설집_202311_4교시` = 2023.12 ④ `제25회(2011년01월)` 6개는 본문 제26회 2011년 1월 → 회차 번호만 오기, 매핑 정상. ①~③을 `MOUI_ROUND_OVERRIDES`(sync가 파일명 연월 대신 사용)로 보정하고 매핑 10건 이동. 재분할 금지였던 2023.11/4는 원인이 이 오매핑이라 목록에서 제외. data D14(모의 회차 번호↔연월 1:1)로 감시.
- **옮긴 회차 분할**: `split-pdfs mode=all only=모의:회차=2011.07,2017.06,2023.12` 17 task → 해설집 4개(2011.07 1_컴시응 13·3_정보관리 6·4_정보관리 6, 2023.12 4교시 8) 분할본 33개 전부 자체검증 OK, 제목 정렬 가드 통과. 나머지 13 task는 검출 수 불일치·번호 시퀀스 비정상으로 통합본 유지. 이번엔 매핑 push가 재머지 방식으로 정상 처리됨.
- **결과**: 전체 해설지 연결 9,697 → 9,759 / 12,441. 모의 분할본 2,158 · 통합본 2,951 · 없음 852.
- **live L3 안정화**: 배포 직후 엣지마다 새/옛 버전이 섞여 먼저 받은 ETag로 보낸 조건부 요청이 200을 받는 경우 발생(4de5ba9·3aaea2b 배포 live 실패, 사이트 기능 문제 아님) → 요청 직전 ETag를 다시 받고 3초 간격 최대 5회 재시도.

### 테스트 추가 3차 + 발견 결함 수정 (2026-09-14)
- **테스트 추가**: unit — Drive 서비스계정 JWT·토큰 캐시(실제 RSA 키로 서명 검증), 해설지 프록시 성공·502·400·500, 관리자 통계·CSV, 사용자 DB SQL을 sql.js로 실제 SQLite 실행(upsert·COALESCE·동의 갱신), 하이라이트 / data — stats.json 일치, 최신 엑셀만 사용 / e2e — 검색창·기록, 더 보기, 모바일 drawer·새 탭, 로그인 메뉴, 404 / live — 네이버 로그인 운영 설정, 404, robots·favicon·admin. (devDependency `sql.js` 추가)
- **소프트 404**: 404 페이지가 없어 Cloudflare Pages가 없는 주소(`/nope`, 없는 회차)에 index.html을 200으로 응답 → `src/pages/404.astro` 추가(dist/404.html).
- **CSV Injection**: 관리자 CSV가 네이버 이름·이메일을 그대로 써 `=HYPERLINK(...)` 같은 값이 엑셀에서 수식으로 실행될 수 있었음 → `=`·`+`·`-`·`@`·탭·CR 시작 값에 `'` 접두.
- **검색 기록 드롭다운 재열림**: 기록 항목을 고르면 드롭다운이 닫히는데 포커스가 입력창에 남아 다시 클릭해도 안 열림 → 입력창 클릭 시에도 열기.

### sync 파일명 파서 회귀 테스트 (2026-09-14)
- `sync-drive-mappings.ts`를 Drive 목록 수집(`syncMappings`)과 매핑 조립(`buildMappingFromTree`, 순수 함수)으로 분리하고 파서(`parseKichul`·`parseHapsuk`·`parseMoui`·폴더명·카테고리)를 export.
- `tests/unit/sync-parsers.test.ts` 40건: 패턴별 예시 + **골든**(매핑 파일의 실제 Drive 파일명 전부를 다시 파싱해 같은 키) + 조립 규칙(보완본 우선·먼저 찾은 파일 유지·모의 종목 키·연월 보정).
- 변이 확인: 합숙 구분자 축소·모의 키 종목 제거는 잡힘. 기출 패턴 G(`87회-조직응용 …-1교시`)는 제거해도 일반 매처가 현재 파일명에서 같은 결과 → 현 데이터 기준 중복 패턴.

### PDF 분할 시그널 테스트 + 87회 컴시응 분할 어긋남 (2026-09-15)
- **테스트**: `split-signals`(시그널 6종 정규식·구간·가드·골격 텍스트 13건) + `split-signals-golden`(실제 PDF 16개 18건).
- **공개 저장소 보호**: 실제 PDF 텍스트는 `scripts/lib/split-redact.ts`로 본문을 가린 골격 텍스트(한글은 표지어 글자만, 영문은 대소문자 모양만, 숫자·기호·"rights reserved" 유지, UTF-16 길이 보존)만 픽스처로 저장. 캡처(`split-fixtures` 워크플로, `npm run split:fixtures`) 때 원문·골격 검출 결과 동일을 강제.
- **가드 순서 수정**: `checkSplitGuards`로 분리하고 Drive 폴더 생성·OVERWRITE 휴지통 이동 **전에** 검사. 기존엔 `overwrite=true`에서 가드로 포기할 분할인데도 기존 분할본을 먼저 휴지통으로 보내 매핑이 끊길 수 있었음.
- **발견**: 제목 정렬 가드가 운영 중인 **기출 87회 1교시 컴시응** 분할본을 어긋남으로 판정 → Drive에서 확인하니 엑셀(1,2,4~14번)과 PDF 문항 순서가 달라 4~14번이 다른 문항 해설(`04_WiBro.pdf` = Haptics, `14_Haptics.pdf` = RFID). 분할본 파일명이 엑셀 제목으로 붙어 D13으로는 못 잡던 유형. 분할 13건 제거(통합본 폴백) + `NO_RESPLIT_KEYS` 추가(12건).
- **전체 감사 도구**: `split-audit` 워크플로(`npm run split:audit`) — 이미 분할된 항목 전부를 통합 PDF로 다시 검출·가드 검사해 어긋남 후보를 보고(읽기 전용).
- **전수 감사 결과(2026-09-15)**: 분할된 421개 중 정상 415, 제목 정렬 어긋남 6 — 기출 90/3컴·93/1정·93/2정, 모의 2023.04/2, 합숙 2025.02 2일차 1·2교시. 후보마다 분할본 2개씩 Drive에서 열어 보니 **12/12 모두 다른 문항 내용**(예: 합숙 2025.02 2일차 2교시 `04_QoS.pdf` = 최소신장트리, 모의 2023.04 2교시 `03_인공지능 윤리` = 사이버 침해 EDR/SIEM). 원인은 엑셀 문항번호와 PDF 속 문항 순서 차이. 6건 분할 제거(통합본 폴백) + `NO_RESPLIT_KEYS` 추가 → **18건**.

### 배포 전 해설지 연결 급감 감지 (2026-09-15)
- `deploy-cloudflare.yml`에 data 테스트 다음 단계로 `npm run check:links`(`scripts/check-link-regression.ts`, 판정 `scripts/lib/link-regression.ts`): 새 빌드 `data/problems.json`을 운영 `/data/problems.json`과 출처·회차별 개수로 비교. 문항 ID는 쓰지 않음.
- **배포 중단 조건**: 전체 문항 −1% 초과 · 회차 사라짐 · 전체 연결 감소 > max(50, 1%) · 회차 하나 연결 절반 이상 & 5건 이상 끊김 · 분할본 연결 감소 > max(50, 2%). 결과는 Actions 요약에 표로 기록.
- **의도한 감소**(잘못된 연결 폴백, 회차 삭제): 커밋 **제목(첫 줄)** 에 `[allow-link-drop]` 또는 수동 배포 입력 `allow_link_drop` → 경고만 남기고 배포. 본문에 설명으로 적힌 토큰은 무시(도입 커밋 본문의 토큰으로 허용이 켜졌던 문제 수정). 운영 데이터를 못 읽으면 검사를 건너뜀(경고).
- 과거 변경 대입: 9/13 모의 종목 키 분리는 "모의 2014.11 연결 26→13"으로 걸림(허용 대상), 이후 변경들은 통과.

### 140회 기출 해설지 업로드 (2026-09-20)
- 로컬 PDF 8개(정보관리·컴시응 × 1~4교시)를 `scripts/upload-140-kichul.mjs`(OAuth 루프백 업로더, 합숙용 `upload-140.mjs`와 같은 방식)로 `01. 기출문제/제140회 기출문제 해설집`(`1iEzo-KVfhYPuoSJ30byBvCRftgFGbLLX`)에 업로드.
- **업로드 전 본문 검증**: 표지 텍스트는 컴시응 파일에도 "정보처리기술사"로 찍혀 있어 종목 판정에 쓸 수 없음 → 본문 문항 제목을 `problems.json`의 140회 데이터와 대조해 8개 모두 파일명의 교시·종목과 일치 확인(정보관리 1교시 12/13, 나머지 전부 일치). 파일명(`140회_기출풀이_정보관리 1교시 해설지_20260919_v1.3.pdf`)은 `parseKichul` 일반 매처가 그대로 파싱해 개명 불필요.
- sync → 매핑 8키 등록 → split(`mode=all only='기출:회차=140'`) → 배포. 운영 결과 **62/62 연결, 분할본 56**.
- **정보관리 4교시 3·5번 미검출 → 분할기 보강**: 한 해설집 안에서 서식이 섞여 1·2·4·6번만 `문 제 N.`이고 3·5번은 `3. 소프트웨어 형상관리…`처럼 번호만 있어 munje 시그널이 4개만 검출 → count 가드로 통합본 폴백했다. `fillMissingRangesByTitle`로 ① 페이지 머리의 `N.` ② 해당 문항 제목 토큰 60% 이상 일치 ③ **다른 문항 제목과는 불일치**(6문항이 나열된 시험문제 페이지 오검출 차단 — 이 조건 없이 돌렸을 때 실제로 목록 페이지를 잡았음) ④ 이웃 문항 시작 페이지 사이, 네 조건을 모두 만족할 때만 보강. 보강한 문항은 시그널 마커가 없으므로 자체검증도 제목 토큰으로 한다(이걸 빼먹어 "검출 6·업로드 6·검증 4"로 매핑이 4개만 됐다). 결과 62/62 전부 분할본.
- **자동 split이 신규 회차를 처리하지 않던 문제** → §6.1 자동 흐름으로 수정. 당시엔 `mode=test` 고정이라 140회가 통합본 연결로만 남았다.

### 분할본 내용 어긋남 전수 적발 (2026-10-03)
- **발견**: 운영 검색에서 "형상관리의 기준선(Baseline) 유형 및 주요 산출물"로 찾는 문항(모의 2026.06 2교시 4번)에 **8번 NPU 해설**이 열렸다. Drive 분할본을 직접 읽어 확인.
- **기존 검증이 전부 통과한 이유**: ① 분할본 파일명은 엑셀 제목으로 붙이므로 내용과 무관 ② splitter 자체검증은 `문 제 N.`(**PDF 내부 번호**) 마커만 확인 — 페이지 순서 ↔ 엑셀 번호 순서로 1:1 짝짓는 구조라 짝이 어긋나도 PDF 자기 번호는 맞아 통과 ③ 정렬 감사(`audit-split-alignment`)는 통합본을 다시 재는 것이라 **이미 올라간 분할본 파일을 읽지 않음**(이 교시를 지금 재면 정렬 ok·8/8).
- **전수 감사 신설** (`scripts/audit-split-content.ts`, `npm run split:audit:content`): 분할본 첫 2페이지를 그 교시 전체 문항 제목과 대조해 최고점 문항이 연결된 문항인지 판정(ok/mismatch/weak). 어긋나면 실제 몇 번 문항인지와 재분할 keys까지 출력. **매주 월 KST 05:00 자동 실행**(split-audit 워크플로, `check` 입력으로 alignment/content 선택).
- **결과**: 3,599개 중 **어긋남 59개**(해설집 33개). 가장 큰 곳은 모의 2026.06 1~4교시 18건(`2→4, 3→7, 4→8` 패턴), 모의 2011.01 1교시 정보관리 4건, 합숙 2024.05 2일차 1교시 3건. 기출도 4건(130/137/98회).
- **조치**: ① 어긋난 59건 연결 해제 → 통합본 폴백(연결 수 9,859 유지, 분할본 3,598→3,539) ② 33개 해설집 `overwrite=true` 재분할 ③ 재감사 **어긋남 0건**(ok 3,456 / weak 102 / 분할본 3,558).
- **근본 원인 수정**: splitter 자체검증이 **엑셀 문항 내용까지** 확인한다 — 같은 교시 다른 문항 제목과 비교해 연결된 문항이 최고점이 아니면 검증 실패(매핑 제외 → 통합본 폴백). 제목 근거가 약한 문항은 종전 시그널 마커 판정.
- **중복 번호 주의**: 옛 모의 종목 선택 문항(2011.05 1교시 12·13번은 정보관리·컴시응 각각 존재)은 같은 번호가 2개다. 감사·검증 모두 그 전부를 후보로 봐야 한다 — 하나로 가정하면 올바른 분할본을 떨어뜨려 통합본으로 후퇴시킨다. 어느 문항에 붙일지는 빌드 `splitMatchesProblem`이 주제어로 가린다.
- **남은 불확실성**: weak 102건(모의 83·기출 13·합숙 6)은 제목 토큰 근거가 약해 내용 판정 불가 — 짧은 제목(`Folksonomy`), 그림·지문 위주 문항. 어긋났다는 뜻은 아니고 이 방법으로 확인이 안 되는 것. 시그널 마커 검증은 통과한 항목들이다.
- **재분할 플래그**: `generateAllSpecsFromMap`은 questions가 있는 항목을 제외하므로, 복구용 재분할은 키를 명시해야 한다(`SPLIT_KEYS` → `includeAlreadySplit`). 재분할 금지 회차는 이 경로로도 풀리지 않는다.

### 통합본 폴백 전수 원인 분석 + 쪽번호 오독 보정 (2026-11-07~08)

- **발단**: 모의 2023.12 1교시 13·15번이 통합본으로만 열려 조사 → 그 두 문항은 **텍스트 레이어 없는 이미지 페이지**(페이지 크기도 595×841 vs 595.2×841.92)로, 텍스트 기반 검출로는 원리상 불가. OCR 도입 가치를 재려면 규모를 먼저 알아야 했다.
- **감사 지표 수정**: 처음 만든 텍스트 레이어 감사(`scripts/audit-text-layer.ts`)는 실제 가드를 호출하지 않고 "빈 페이지가 있으면 OCR로 풀림"으로 분류해 **OCR 효과를 과대계상**했다(빈 페이지 2장에 누락 10문항인 건까지 포함). `scripts/lib/split-fallback.ts`의 `classifyFallback`으로 교체 — `checkSplitGuards`의 reason을 받아 분류하고, OCR 후보는 **누락 ≤ 빈 페이지**일 때만.
- **전수 감사 결과(통합본 폴백 720개)**: detect-gap 375개/3,906문항 · sequence 169개/1,119문항 · ocr-candidate 59개/493문항 · **ok 56개/271문항** · no-signal 42개/337문항 · no-resplit 18개/173문항 · image-heavy 1개/6문항. 가드 중단 사유 원시 분포는 `count 435 / sequence 169 / none 43 / pass 63`.
- **ok 56개는 코드 변경 없이 풀렸다**: 9/20 `fillMissingRangesByTitle` 보강 이후 검출은 되는데, 그 뒤 split을 신규 회차 키로만 좁혀 돌려서 옛 회차를 아무도 다시 돌리지 않은 적체였다. 전부 미분할 27건 재분할 → **+211문항**.
- **sequence 169개의 공통 원인 — 쪽번호를 문항번호로 읽음**: 169건 전부 시그널 `kpc-mungje`. 이 PDF들의 머리말은 `104 회 … Notes 9 KPC 기술사회 3 파이프라인 해저드 문제` 순서라, 정규식 `\b(\d{1,2})\s+…\s+문제\s`가 앞쪽 **쪽번호**부터 매칭하며 안쪽의 올바른 후보(`3 파이프라인 해저드 문제`)를 전역 매칭으로 삼켜버린다. "쪽번호는 보통 더 크므로 최소값 채택" 회피책은 후보가 하나뿐이라 작동할 기회가 없었다. 결과: 6문항을 정확히 6개 찾고 번호만 `[1,5,9,12,16,19]`로 읽음 — **구간은 맞다**.
- **보정** (`scripts/lib/split-renumber.ts`): 구간 수가 문항 수와 같고 번호가 엑셀과 다를 때, 제목 정렬이 짝짓기를 증명하면 번호를 **시작 페이지 순서대로** 엑셀 번호로 재배정. 조건은 `offset 0이 최고점` + `점수 ≥ 문항 수의 60%` + `다른 offset보다 엄격히 높음` 셋 다. 10/03 오연결 59건의 원인이 "번호만 보고 짝지음"이었으므로 제목이 증명할 때만 적용하고, 업로드 시 내용 검증이 한 번 더 가린다. `checkTitleAlignment`는 순환 import 회피를 위해 `scripts/lib/split-alignment.ts`로 분리.
- **가드 번호 비교도 수정**: `checkSplitGuards`가 "1..N 연속"을 요구해, 옛 모의 컴시응(한 교시에서 정보관리 1~6 / 컴시응 7~12로 번호가 이어짐) 31건을 재배정 후에도 떨어뜨렸다. `expectedNumbers` 옵션으로 **엑셀 문항번호와 비교**(미지정 시 종전 1..N). 중복 번호 회차는 집합이 같아야 통과.
- **결과**: 재배정 실험(run 42381150359)에서 169건 중 162건이 조건 통과(제목 100% 146건) → 146건 분할 **932문항 중 931 검증 통과**, 근거 60~99% 12건 분할 **101문항 중 85 연결**. 분할본 **3,646 → 4,873 (+1,227문항)**. 전수 내용 감사 **어긋남 0건**(ok 4,744 / weak 129).
- **제외 10건**: 제목 근거 60% 미만 7건(합숙 2020.05 2교시 3건은 제목 일치 0/6)은 재배정 보류로 통합본 유지 — 조건이 자동으로 막는다. 제목 정렬 최고점이 offset 0이 아닌 3건(합숙 2015.01/2일차_1교시 −2, 합숙 2018.01/3일차_1교시 +1, 모의 2014.06/4_정보관리 −1)은 엑셀↔PDF 문항 **순서 자체가 다름** → `NO_RESPLIT_KEYS`에 추가(18 → 21).
- **OCR은 보류**: 59개 해설집 493문항 규모이고 그 문항들도 통합본으로 내용은 열린다. 같은 노력으로 detect-gap 375개/3,906문항이 남아 있어 우선순위가 아니다. `ocrmypdf`/`tesseract`는 OSS CLI라 Actions에서 돌리면 LLM 비용은 들지 않는다(로컬 Mac에는 미설치).
- **남은 최대 덩어리**: `detect-gap` 375개/3,906문항(검출 수 부족, 빈 페이지로 설명 안 됨) + `no-signal` 42개/337문항. 둘 다 서식 미지원이라 시그널 보강 영역.

### 제목 기반 검출 — detect-gap 해소 (2026-11-08)

- **조사**: 통합본 폴백 512개를 다시 분해하니 성격이 셋이었다 — 미검출(0<검출<문항) 313개/3,305문항, **과검출**(검출>문항) 62개/601문항, 검출 전무 42개/337문항. 미검출 313개 중 **170개는 1~2문항만 부족**해서 전체가 통합본으로 남아 있었다. 과검출은 합숙 1교시 다수로, 엑셀에 문항이 빠진 회차다(분할기 문제가 아님).
- **기존 보강이 한 건도 발동하지 않은 이유**: `fillMissingRangesByTitle`은 ① 머리말에 `N.` 숫자 마커가 있어야 하고 ② `for (let n = 1; n <= titles.length; n++)`로 **문항번호가 1..N이라고 가정**한다. 이 집단은 숫자 마커가 없고, 옛 모의 컴시응은 번호가 7~12다.
- **제목 기반 검출 신설** (`scripts/lib/split-title-anchor.ts`): 숫자를 전혀 쓰지 않고 제목 토큰 60%+로 각 문항의 첫 페이지를 찾는다. **네 조건을 모두** 만족할 때만 채택 — ① 전 문항 유일 특정(한 페이지에 두 문항 제목이 맞으면 그 페이지는 버림: 시험문제 목록·표지 차단) ② 페이지가 문항 순서대로 단조증가 ③ 시그널 검출 수 ≤ 엑셀 문항 수(과검출 회차 제외) ④ 마지막 앵커 뒤 잔여 ≤ 12p. `detectRanges`는 시그널이 이미 문항 수를 맞췄으면 앵커로 덮지 않는다.
- **②가 실제로 작동한다는 독립 증거**: 단조증가 검사에 걸린 30건 중 8건이 **이미 알려진 재분할 금지 회차**였다(기출 90/3_컴시응, 93/1~4_정보관리, 105/4_컴시응, 합숙 2025.02/2일차_2교시, 모의 2023.04/2). 작년에 분할본을 직접 열어 확인해 금지 목록에 넣은 회차를, 이 검사가 PDF만 보고 독립적으로 재현했다.
- **결과**: 네 조건 통과 179개 중 **175개 분할, 1,445문항 연결**. 1차 20건(153문항, 검증 100%)→내용 감사 0건 확인→나머지 159건. 분할본 **4,873 → 6,290**, 운영 통합본 3,673. 전수 내용 감사 **어긋남 0건**(ok 6,161 / weak 129 — weak 증가 없음).
- **실물 확인**: `기출/101/3_정보관리` 4번은 `4 B트리, B+트리 정의 및 차이점`으로 시작해 엑셀 4번 지문·모범목차·"끝"까지 온전, 앞 문항 혼입 없음. 시그널이 0이던 `기출/107/3_정보관리` 3번도 `3 O2O(Online-to-Offline/Offline-to-Online)`로 정확히 시작.
- **시그널 실패의 또 다른 원인 — 한글 인코딩 깨짐**: 기출 107회 해설집은 추출 텍스트가 `도메인`→`도메읶`, `출제의도`→`춗제의도`로 나온다(옛 한글 폰트 매핑). `kpc-mungje`는 `/도\s*메\s*인/`을 찾으므로 원리상 걸릴 수 없다. 제목 앵커는 영문·숫자 토큰(`O2O`)으로 맞아 통과했다. `no-signal` 42개 중 상당수가 서식 문제가 아니라 이 문제일 수 있다.
- **남은 3건 / 18문항**: 기출 116/2_정보관리, 모의 2018.06/3_정보관리, 모의 2015.05/4_정보관리는 시그널이 **개수는 맞게** 찾아(6/6) 앵커 경로로 가지 않았고, 번호가 쪽번호라 가드에 걸렸는데 재배정은 제목 근거 부족(3/6)으로 거절했다. 제목 앵커로는 6문항이 전부 유일 특정된다 — 시그널이 찾은 페이지가 틀렸고 앵커 페이지가 맞다. "가드 실패 후 앵커 재시도"를 넣으면 풀리지만 우선순위 규칙 변경이라 보류.
- **PDF 파손 1건**: `모의/KPC/2010.11/3`은 pdf-lib이 `Failed to parse number`로 실패(원본 파일명이 `.pdf.webhard__`). 통합본 유지.

**알려진 한계**:
- 일부 옛 합숙(2010년대) PDF는 풀이지 형식 불규칙 → fallback (통합 PDF로 정상 표시)
- 가드가 까다로워서 문항이 많은 일부 회차(예: 13개 중 12개만 검출)도 fallback. 안전성 우선.

---

## 11. 향후 작업 후보

### Phase B-2 — 옛 회차 분할 정밀화 (선택)
2010년대 합숙/일부 기출의 풀이 형식 추가 시그널 또는 OCR 기반 분할로 분할률 향상. 현재 fallback이라 사용자 경험 영향 없음.

### Phase C — PDF 보호 (선택, 도메인 불필요)
Drive PDF 비공개 + Workers proxy. 현재는 페이지 측 차단만이라 URL 우회 가능. 진정 차단 필요 시 1주.

### Phase D — 마케팅 메일 발송 (도메인 필요, 연 1.5만원)
- DB 동의자 추출 (admin CSV로 가능)
- Brevo / Resend SDK 통합
- 자체 도메인 + SPF/DKIM
- 발송 UI (템플릿 + 발송 대상 segment)
- 수신거부 링크 + [광고] 표기 (정보통신망법)

### 부가
- 수동 sitemap.xml (build:data가 회차 페이지 URL 자동 생성)
- /stats 시각화 페이지
- ITPE 어댑터 (ITPE 데이터 확보 시)
- 자체 출제 표준 템플릿 어댑터

---

## 12. 빠른 명령어

### 로컬 개발
```bash
npm install
npm run dev          # http://localhost:4321
npm run build:data   # data/problems.json 생성
npm run build        # 데이터 + 사이트
npm run preview
```

### 테스트 (`tests/README.md`)
```bash
npm test             # unit: 로더·검색·정규화·빌드 매핑·인증·API (네트워크 없음)
npm run build:data && npm run test:data   # 데이터 규칙 + 해설지 매핑 무결성 (재분할 금지 회차 포함)
npm run test:e2e     # 빌드 후 실제 Chrome: 캐시 시나리오, 해설지 게이트, 필터, 회차 페이지
npm run build:data && npm run test:live   # 배포 후 운영 헤더·데이터·게이트 점검
```

### Sync
```bash
gh workflow run sync-drive.yml --ref main
gh run list --workflow=sync-drive.yml --limit 3
gh run view <RUN_ID> --log
```

### PDF 분할 (Phase B)
```bash
# 19개 샘플로 테스트 (idempotent)
gh workflow run split-pdfs.yml --ref main -f mode=test -f overwrite=false

# 전체 회차 자동 (시간 오래 걸림 — 1.5~3시간)
gh workflow run split-pdfs.yml --ref main \
  -f mode=all -f overwrite=false -f concurrency=7

# 잘못 분할된 회차 재처리 (휴지통 이동 후 재업로드)
gh workflow run split-pdfs.yml --ref main \
  -f mode=test -f overwrite=true

# 모의 옛 회차 종목별 해설집만 분할 (재분할 금지 항목 자동 제외)
gh workflow run split-pdfs.yml --ref main -f mode=all -f only='모의:종목별' -f concurrency=7

# 분할 워크플로의 매핑 push가 실패했을 때: 산출물로 최신 매핑에 복구
gh run download <RUN_ID> -n split-result -D /tmp/split && npm run split:merge -- /tmp/split/split-result.json

# 디버그: 새 PDF 형식 분석
gh workflow run split-diag.yml --ref main
gh run view <RUN_ID> --log | grep "Diagnose" | sed 's/^[^Z]*Z //'
```

### 배포 상태
```bash
gh run list --workflow=deploy-cloudflare.yml --limit 3
```

### D1 직접 쿼리
```bash
wrangler d1 execute kpcitpe-users --command "SELECT COUNT(*) FROM users" --remote
```

### Cloudflare env_var 변경
```bash
curl -X PATCH "https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/pages/projects/kpcitpe-search" \
  -H "Authorization: Bearer ${TOKEN}" -H "Content-Type: application/json" \
  -d '{"deployment_configs":{"production":{"env_vars":{...}}}}'
```

---

## 13. 보안 모델

- **GitHub 레포**: public, 본인만 쓰기. 2FA 권장.
- **Cloudflare 배포**: API token 비밀. 노출 시 routine 재발급 (cf 대시보드 → My Profile → API Tokens → Roll).
- **Drive**: SA `kpc-drive-bot@kpcitpe-search.iam.gserviceaccount.com` 편집자 권한. 폴더는 "링크 있는 모든 사용자 - 뷰어"(상속).
- **해설지 접근 제어**: `/api/explanation` 서버 프록시가 **로그인(JWT) + 수신동의(D1 marketing_consent)** 를 검증한 뒤에만 SA로 PDF 스트리밍. 클라이언트 게이트(ProblemCard)는 UX용이고 서버가 권위. 검색은 비로그인 포함 공개.
  - **누수 차단 완료(2026-06-14)**: Drive 루트 `01. 기출문제 & 모의고사`(`1gKPEW...`)에만 직접 걸려 있던 `anyone:reader`를 SA(writer, drive 스코프)로 제거 → 하위 통합본·분할본 전부 비공개로 전파. 직접 Drive URL 우회 불가, 비인증 접근은 로그인 리다이렉트. SA는 writer라 비공개 후에도 읽어 프록시 정상. split-pdfs는 `makePublic()` 안 하므로 신규 분할본도 자동 비공개. (per-file un-share는 'anyone'이 폴더 상속이라 실패 — 반드시 루트 폴더에서 제거.)
- **JWT**: HMAC-SHA256, JWT_SECRET 32 bytes, 7일 만료.
- **세션 쿠키**: HttpOnly, Secure, SameSite=Lax.
- **OAuth state**: CSRF 방어 쿠키 + 검증.
- **D1**: wrangler.toml binding으로 자동 인증.
- **Admin**: ADMIN_EMAILS 화이트리스트 (콤마 구분).
- **노출된 시크릿** (이전 채팅에서 평문 등장): Cloudflare API token, Naver Client Secret, JWT_SECRET — 위험 낮음 (결제 손실 X). routine 재발급 권장.

---

## 14. 메모리 (.claude/projects/.../memory/) — 데스크탑 Claude Code 전용

다른 세션에서 자동 회복:
- `project_hosting.md` — Cloudflare Pages 배포 결정 (GitHub Pages 폐기)
- `project_data_model_academy.md` — 합숙도 academy 귀속, 기출만 null
- `project_data_normalization.md` — 회차 -N 접미사, ID에 cert 슬러그, 소문제, 옛 회차 자동 순번
- `project_explanation_consent_gate.md` — 해설지 수신동의 게이트 + SA 프록시 + 누수차단 미완
- `project_round_upload_gotchas.md` — 신규 회차는 "제{N}회 ..." 전용 폴더에 (오염 함정)
- `feedback_git_author.md` — git commit author = ksujae@gmail.com
- `feedback_external_ui_versions.md` — Google/Cloudflare/Naver UI 자주 개편 → 가이드 전 현행 확인
- `feedback_keep_project_md_updated.md` — 변경 시 PROJECT.md 같이 갱신

---

## 15. 휴대폰 / 다른 디바이스에서 작업 이어가기

- **사이트 사용**: https://kpcitpe-search.pages.dev/ 어디서든 OK (반응형)
- **Claude 작업**:
  - 데스크탑 Claude Code → 같은 머신 재시작 OK (메모리 자동 회복)
  - 휴대폰 / 다른 머신 / claude.ai 웹 → 이 PROJECT.md 파일을 첨부/붙여넣기로 컨텍스트 회복

---

## 16. 알려진 이슈 / 한계

- **PDF 다운로드 완전 차단 안 됨**: 개인 Drive `copyRequiresWriterPermission`은 owner만 변경 가능. SA 자동화 불가. 진정 차단은 자체 PDF 뷰어 필요 (Phase B).
- **합숙 090/092회**: 엑셀 자체에 데이터 없어 매핑 대상 없음.
- **wrangler 3.114.1**: pages 프로젝트는 wrangler.toml에 `[build]` 섹션 거부. 우리 `build` 섹션 제거됨.
- **Cloudflare API token 권한**: 기본 Workers 템플릿엔 D1 권한 없음. D1 생성/마이그레이션은 대시보드 또는 권한 추가 토큰 필요.
- **GitHub Pages**: 2026-05-05 비활성화. 외부 링크에 옛 URL 있으면 404.

---

이 문서가 단일 컨텍스트입니다. 다른 세션 시작 시 이 파일을 먼저 읽고 작업 이어가면 됩니다.
