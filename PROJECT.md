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
| 해설지 | Google Drive (`/preview` iframe) | API로 자동 매핑, lock은 owner-only라 미적용 |
| 자동화 | GitHub Actions | deploy-cloudflare + sync-drive + rename-hapsuk |

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
│   ├── build.ts                  변환 파이프라인
│   ├── sync-drive-mappings.ts    Drive 매핑 자동화
│   ├── rename-old-hapsuk.ts      합숙 옛 회차 폴더명 변경 (1회성)
│   └── debug-quality.ts
├── src/
│   ├── components/             검색 + 인증 + admin UI
│   ├── layouts/BaseLayout.astro
│   ├── lib/
│   │   ├── search.ts           Fuse 래퍼 + 필터/정렬
│   │   ├── search-history.ts   localStorage 검색 히스토리
│   │   ├── data-loader.ts      problems.json fetch + sessionStorage 캐시
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
├── .github/workflows/
│   ├── deploy-cloudflare.yml   엑셀 push → 빌드 → Cloudflare 배포
│   ├── sync-drive.yml          매일 KST 03:00 + 수동
│   └── rename-hapsuk.yml       1회성 (이미 실행 완료)
├── wrangler.toml
├── astro.config.mjs            SITE/BASE 환경변수 의존
├── PROJECT.md (이 문서)
├── requirements.md             초기 요구사항 (참고용)
└── README.md
```

---

## 4. 환경변수 / Secrets 정리

### Cloudflare Pages env_vars (production)
- `NAVER_CLIENT_ID` — Naver OAuth client_id
- `NAVER_CLIENT_SECRET` — Naver OAuth secret
- `JWT_SECRET` — JWT 서명 키 (32 bytes hex)
- `PUBLIC_SITE_URL` — `https://kpcitpe-search.pages.dev`
- `ADMIN_EMAILS` — 콤마구분 admin 이메일 (`ksujae22@naver.com`)
- (D1 `DB`는 wrangler.toml binding으로 주입)

### GitHub Secrets
- `CLOUDFLARE_API_TOKEN` — Cloudflare 배포용
- `CLOUDFLARE_ACCOUNT_ID` — `f20bfdcf3a187412a74b852b36ad4240`
- `GOOGLE_SERVICE_ACCOUNT_JSON` — Drive sync용
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

런타임:
```
사용자 → 검색바 입력
   ↓ debounce 200ms
[클라이언트 Fuse.js 검색 — problems.json 메모리]
   ↓
결과 카드 표시
   ↓ "📖 해설지 보기" 클릭
[useAuth() 체크]
   ├─ 미로그인 → /api/auth/naver/login 으로 redirect
   └─ 로그인 → ExplanationModal 열기 (iframe /preview)
```

---

## 6. 운영 매뉴얼

### 6.1 신규 회차 추가 (가장 흔한 케이스)

**A. 해설지 PDF (Drive)**
1. Drive `01. 기출문제 & 모의고사/{카테고리}` 진입
2. 신규 회차 폴더 생성 (예: `제139회 기출문제 해설집`, `139회 (2026-05)`, `제130회(26년07월)KPC기술사 모의고사 해설집`)
3. 폴더 안에 PDF 드래그
4. **끝** — 다음 KST 03:00 자동 sync에서 매핑 (Actions 탭 수동 trigger 가능)

**B. 통합 엑셀 (검색 데이터)** — GitHub 웹에서:
1. https://github.com/SujaeKong/kpcitpe-search → `data/source/kpc/`
2. **Add file → Upload files** → 새 엑셀 드래그
3. (옵션) 옛 파일 휴지통
4. commit 메시지 한 줄 (예: `data: KPC v260712`)
5. Commit changes → 1~2분 후 자동 배포

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
| 검색 결과 없음 | 클라이언트 sessionStorage 캐시 | `Cmd+Shift+R` |
| "해설지 준비 중"인데 매핑 됐을 거 같음 | 캐시 또는 매핑 mismatch | data-loader.ts CACHE_KEY/VERSION bump |
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
모의:  {academy}.{round}.{session}        예: 'KPC' → '2026.04' → '1'
```

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
- **종목**: 6가지 표기 → 3종 (`정보관리`, `컴시응`, `공통`).
- **합숙 일차**: `Day-1`, `1일차`, `1` → `1일차`로 통일.
- **소문제**: `1.1`, `1-2` 형태 → `questionSubNumber` 분리.
- **옛 회차 단답형 questionNumber=null**: 그룹 내 자동 순번.
- **합숙 sessionPart**: 그룹 사이즈 + 같은 번호 두 번째 등장 휴리스틱.
- **합숙 옛 회차 폴더명**: `093회합숙(2011-02)` 등 (YYYY-MM) 추가됨.

---

## 8. 매핑 커버리지 (현재)

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

---

## 9. GitHub Actions 워크플로우

### 9.1 deploy-cloudflare.yml
- **트리거**: main push / 수동
- **동작**: setup-pages → npm ci → npm run build → wrangler pages deploy
- **소요**: 1~2분

### 9.2 sync-drive.yml
- **트리거**: 매일 KST 03:00 / 수동
- **동작**: Drive sync (매핑) → 변경 시 commit (pull --rebase 자동 retry) → deploy-cloudflare 트리거
- **소요**: 1~3분

### 9.3 rename-hapsuk.yml (1회성)
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

---

## 11. 향후 작업 후보

### Phase B — PDF 보호 (선택, 도메인 불필요)
Drive PDF 비공개 + Workers proxy. 현재는 페이지 측 차단만이라 URL 우회 가능. 진정 차단 필요 시 1주.

### Phase C — 마케팅 메일 발송 (도메인 필요, 연 1.5만원)
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

### Sync
```bash
gh workflow run sync-drive.yml --ref main
gh run list --workflow=sync-drive.yml --limit 3
gh run view <RUN_ID> --log
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
- **Drive**: SA `kpc-drive-bot@kpcitpe-search.iam.gserviceaccount.com` 편집자 권한. 폴더는 "링크 있는 모든 사용자 - 뷰어".
- **JWT**: HMAC-SHA256, JWT_SECRET 32 bytes, 7일 만료.
- **세션 쿠키**: HttpOnly, Secure, SameSite=Lax.
- **OAuth state**: CSRF 방어 쿠키 + 검증.
- **D1**: wrangler.toml binding으로 자동 인증. SA JSON 미사용.
- **Admin**: ADMIN_EMAILS 화이트리스트 (콤마 구분).
- **노출된 시크릿** (이전 채팅에서 평문 등장): Cloudflare API token, Naver Client Secret, JWT_SECRET — 위험 낮음 (결제 손실 X). routine 재발급 권장.

---

## 14. 메모리 (.claude/projects/.../memory/) — 데스크탑 Claude Code 전용

다른 세션에서 자동 회복:
- `project_hosting.md` — Cloudflare Pages 배포 결정 (GitHub Pages 폐기)
- `project_data_model_academy.md` — 합숙도 academy 귀속, 기출만 null
- `project_data_normalization.md` — 회차 -N 접미사, ID에 cert 슬러그, 소문제, 옛 회차 자동 순번
- `feedback_git_author.md` — git commit author = ksujae@gmail.com

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
