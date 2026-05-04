# kpcitpe-search 프로젝트 정리

> 정보관리 / 컴시응 기술사 기출 · 합숙 · 모의고사 통합 검색 정적 사이트
>
> https://sujaekong.github.io/kpcitpe-search/

---

## 1. 한 줄 소개

12,158건의 문제를 키워드로 검색하고 → 매핑된 해설지(Drive PDF)를 페이지 안에서 바로 열람.
KPC 신규 엑셀/PDF 추가 시 자동 빌드 + Drive sync로 사용자 부담 거의 0.

---

## 2. 기술 스택

| 영역 | 선택 | 비고 |
|---|---|---|
| 프레임워크 | Astro 4 + React (Islands) | 정적 사이트 + 일부 인터랙션만 React |
| 스타일 | Tailwind CSS | 액센트 색만 KPC red |
| 검색 | Fuse.js | 한글 fuzzy, 클라이언트 메모리 |
| 데이터 변환 | TypeScript + xlsx + tsx | scripts/build.ts |
| 호스팅 | GitHub Pages | 무료, KST PoP 양호 |
| 해설지 | Google Drive (`/preview` iframe) | API로 자동 매핑 + lock |
| 자동화 | GitHub Actions | build-and-deploy + sync-drive |

---

## 3. 프로젝트 구조

```
kpcitpe-search/
├── data/
│   ├── source/kpc/             KPC 통합 엑셀 (사용자 업로드)
│   ├── mappings/
│   │   └── explanation-files.json   해설지 Drive ID 매핑 (자동 생성)
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
│   ├── sync-drive-mappings.ts    Drive 매핑 + lock 자동화
│   └── debug-quality.ts          1회성 디버그
├── src/
│   ├── components/             검색 UI (React + Astro)
│   ├── layouts/
│   ├── lib/                    search.ts, data-loader.ts, types.ts
│   └── pages/
│       ├── index.astro                      메인 검색
│       └── rounds/
│           ├── index.astro                   회차 목차
│           └── [sourceType]/[round].astro   회차별 페이지
├── .github/workflows/
│   ├── build-and-deploy.yml    엑셀 push → 빌드 → 배포
│   └── sync-drive.yml          매일 KST 03:00 + 수동 trigger
└── PROJECT.md (이 문서)
```

---

## 4. 데이터 흐름

```
[사용자]
  ├─ KPC 엑셀 → GitHub data/source/kpc/ (1~2분/회차)
  └─ Drive PDF → 01. 기출문제 & 모의고사/* (1~2분/회차)
                                ↓
                ┌───────────────┴───────────────┐
                ↓                                ↓
[엑셀 push 시]                          [매일 03:00 또는 수동 trigger]
  build-and-deploy.yml                    sync-drive.yml
    ↓                                       ↓
    npm run build                           ① Drive 트리 BFS
      = build:data + astro build              ② 파일명 정규식 파싱
    ↓                                       ③ explanation-files.json 갱신
    dist/                                   ④ PDF에 copyRequiresWriterPermission=true
    ↓                                       ⑤ 변경 시 commit & build-and-deploy 트리거
    GitHub Pages 배포
                                            ↓
                                          [사이트 갱신, 자동]
```

---

## 5. 운영 매뉴얼

### 5.1 신규 회차 추가 (가장 흔한 케이스)

**A. 해설지 PDF (Drive)**
1. https://drive.google.com → `01. 기출문제 & 모의고사/{카테고리}` 진입
2. 신규 회차 폴더 생성 (예: `제139회 기출문제 해설집`, `139회 (2026-05)`, `제130회(26년07월)KPC기술사 모의고사 해설집`)
3. 폴더 안에 PDF 드래그 업로드
4. **끝** — 다음 KST 03:00 자동 sync에서 매핑 + 다운로드 차단(lock) 자동 처리

**즉시 반영하려면**: GitHub 레포 → **Actions** 탭 → **Sync Drive Mappings** → **Run workflow** 클릭.

**B. 통합 엑셀 (검색 데이터)**

**옵션 1 — GitHub 웹 (CLI 없이)**
1. https://github.com/SujaeKong/kpcitpe-search → `data/source/kpc/` 진입
2. **Add file → Upload files** → 새 엑셀 드래그
3. (옵션) 옛 파일 클릭 → 휴지통 (같은 commit에 묶임)
4. 하단 commit 메시지 한 줄 (예: `data: KPC v260712`)
5. **Commit changes** 클릭 → 1~2분 후 자동 빌드/배포

**옵션 2 — 터미널**
```bash
cd /Users/sujaekong/kpcitpe-search
git pull
cp ~/Downloads/KPC_..._v260712.xls data/source/kpc/
rm data/source/kpc/KPC_..._v260411.xls   # 옛 파일 정리
git add data/source/kpc/
git commit -m "data: KPC 엑셀 v260712"
git push
```

### 5.2 트러블슈팅

| 증상 | 원인 | 해결 |
|---|---|---|
| 검색 결과 없음 | 클라이언트 sessionStorage 옛 캐시 | `Cmd+Shift+R` 강제 새로고침 또는 시크릿 창 |
| "해설지 준비 중"인데 매핑은 됐을 거 같음 | 위와 동일 (캐시) | 위와 동일 |
| 매핑 누락 (특정 회차) | 새 파일명 변형이 매처에서 미매칭 | Actions log 확인 → `parseKichul`/`parseMoui`/`parseHapsuk` 패턴 추가 |
| sync workflow 실패 (push rejected) | 수동 push와 자동 commit 충돌 | 워크플로우에 `pull --rebase` 자동 retry 적용됨, 다음 sync에서 회복 |
| iframe PDF 로드 실패 | Drive 공유 권한 미설정 | 폴더 공유 → 일반 액세스 → 링크 있는 모든 사용자 |
| 다운로드 차단 안 됨 | SA가 뷰어 권한 (편집자 아님) | Drive 폴더 공유 → SA 권한 → 편집자로 변경 |
| 잘못된 데이터 commit | 실수 | GitHub 웹 → Commits → Revert 또는 파일 history → Restore |

### 5.3 캐시 무효화

데이터 모델/매핑 큰 변경 시 클라이언트 강제 새 fetch 필요:
- `src/lib/data-loader.ts` 의 `CACHE_KEY` 와 `VERSION` 둘 다 bump (`v3` → `v4` 등)
- 다음 배포 후 모든 사용자 자동 새 fetch

### 5.4 보안 모델

- **GitHub 레포**: public 읽기, 본인만 쓰기. 외부인은 fork/PR만 가능.
- **계정 보안**: GitHub 2FA 활성화 권장.
- **실수 복원**: git history 영구 보존 (force push 안 함).
- **Drive PDF**:
  - "링크가 있는 모든 사용자 - 뷰어"로 공유
  - SA(`kpc-drive-bot@kpcitpe-search.iam.gserviceaccount.com`)는 **편집자** 권한 (lock 설정용)
  - 모든 PDF에 `copyRequiresWriterPermission: true` 적용 → viewer는 다운로드/인쇄/복사 불가
  - 사이트는 `/preview` URL로만 노출 (Drive UI 가림)

---

## 6. 데이터 모델

### 6.1 Problem 스키마

```typescript
{
  id: string;                            // 'kichul-138-mgmt-1-3' 등
  sourceType: '기출' | '합숙' | '모의' | '자체';
  academy: 'KPC' | 'ITPE' | null;       // 기출만 null
  certScope: '정보관리' | '컴시응' | '공통';
  round: string;                         // '138' | '2026.04' | '2026.02'
  roundLabel: string;                    // '138회' | '모의_2026.04'
  roundOrder: number;                    // 정렬용
  session: string;                       // '1' | '1일차'
  sessionType: '교시' | '일차';
  sessionPart?: '1교시' | '2교시' | null; // 합숙만
  questionNumber: number | null;
  questionSubNumber: number | null;      // '1.2' 형태 소문제
  questionLabel: string;
  title: string;
  content: string;
  preparingFor?: string | null;
  sourceFile: string;
  explanationFileId?: string | null;     // sync가 채움
  explanationFileName?: string | null;
}
```

### 6.2 explanation-files.json 매핑 키

```
기출:  {round}.{session}_{certScope}     예: '138' → '1_정보관리'
합숙:  {round}.{session}_{sessionPart}    예: '2026.02' → '1일차_1교시'
모의:  {academy}.{round}.{session}        예: 'KPC' → '2026.04' → '1'
```

### 6.3 데이터 정규화 규칙 (보강 적용)

- **회차**: `'138', '138회'` → `'138'`. 모의/합숙 `'모의_2010.10-1'` (월 2회) 지원.
- **종목**: 6가지 표기 → 3종 (`정보관리`, `컴시응`, `공통`).
- **합숙 일차**: `Day-1`, `1일차`, `1` → `1일차`로 통일.
- **소문제**: `1.1`, `1-2` 형태 → `questionNumber=1, questionSubNumber=2`.
- **옛 회차 단답형**: questionNumber=null → `(회차, 종목, 교시)` 그룹 내 자동 순번 부여.
- **합숙 sessionPart**: 그룹 사이즈 + 같은 번호 두 번째 등장 휴리스틱으로 1교시/2교시 분리.

---

## 7. GitHub Actions 워크플로우

### 7.1 build-and-deploy.yml
- **트리거**: main push / 수동
- **단계**: setup-pages → npm ci → npm run build (data + site) → upload-pages-artifact → deploy-pages
- **소요**: ~50초

### 7.2 sync-drive.yml
- **트리거**: 매일 KST 03:00 / 수동
- **단계**: Drive sync (매핑 + lock) → 변경 시 commit (`pull --rebase` 자동 retry) → build-and-deploy 트리거
- **소요**: 통상 1~3분, 첫 lock 적용 시 15~20분

### 7.3 GitHub Secrets (등록 완료)
- `GOOGLE_SERVICE_ACCOUNT_JSON`: Drive API 인증
- `DRIVE_ROOT_FOLDER_ID`: `1gKPEW_eVdR086KXwPDZIeUfPvlQp9-rV`

---

## 8. 신규 패턴 등장 시 매처 보강 가이드

새 회차의 PDF 파일명이 기존 패턴에 안 맞으면 sync log에서 매칭 0건으로 보고됨.

```
gh run view <RUN_ID> --log | grep '매칭 0/'
```

→ 어느 폴더의 어떤 파일명인지 확인 후 정규식 추가:

| 카테고리 | 함수 | 위치 |
|---|---|---|
| 기출 | `parseKichul` | scripts/sync-drive-mappings.ts |
| 합숙 | `parseHapsuk` | 동일 |
| 모의 | `parseMoui` | 동일 |

수정 → push → sync 자동 재실행 (다음 03:00) 또는 수동 trigger.

---

## 9. 개발 변경 이력 (오늘 작업)

### Phase 1: 변환 파이프라인
- KpcXlsAdapter: 3시트 통합, 회차/종목/교시 정규화, 소문제 분리, 옛 회차 단답형 자동 순번
- 합숙 sessionPart 휴리스틱 (1교시/2교시 자동 분류)
- 12,158건 정확 변환

### Phase 2: 검색 UI
- Astro + React Islands + Fuse.js + Tailwind
- 검색바(debounce 200ms) + 필터 패널(다중 칩)
- 정렬 옵션 (관련도/최신/오래된)
- 모바일 필터 drawer
- 회차 범위 dropdown
- URL 동기화 (`?q=`, `?cert=`, `?type=`, `?session=`, `?rmin=`, `?rmax=`, `?sort=`)
- 검색어 하이라이팅
- 결과 0건 안내 카드

### Phase 3: 해설지
- iframe 임베드 모달 (ESC, 백드롭, 모바일 새 탭 fallback, 5초 타임아웃 fallback UI)
- Drive sync 자동화 — Service Account, 매일 03:00 cron + 수동 trigger
- 매핑 패턴: 기출 8가지 변형 + 모의 5가지 + 합숙 1가지
- 다운로드/인쇄/복사 차단 (`copyRequiresWriterPermission` 자동 적용)
- 다운로드 버튼 UI 제거 (보기 전용)

### 부가
- 회차 목차 페이지 (`/rounds/`) + 회차별 페이지 (`/rounds/{type}/{round}`) — 동적 라우트, 203 페이지 정적 생성
- KPC 로고 헤더/푸터/favicon 통합 (astro:assets 자동 최적화 + densities)
- "Powered by KPC 기술사회" 푸터
- og/twitter 메타 태그, robots.txt
- ID 규칙 보강 (cert 슬러그 + academy 슬러그 추가)

### 매핑 커버리지
- 기출 47회차 중 14회차 → 매처 보강 후 다수 회차 추가
- 합숙 28회차 (옛 회차 13개 제외)
- 모의 98회차 → 새 패턴 추가로 더 매핑 예상
- 빌드 시 8,922건 / 12,158건 = **73%** 매핑됨

---

## 10. 향후 작업 후보

- **검색 히스토리** (localStorage 기반 최근 검색어)
- **수동 sitemap.xml** (build:data가 회차 페이지 URL list 자동 생성)
- **합숙 옛 회차** 회차→연월 매핑 표 추가 (095, 096, 098, 099, 090, 092, 093, 101, 102, 104, 105, 107, 122합숙 등)
- **/stats 페이지** (현재 보류)
- **ITPE 어댑터** 신규 작성 (ITPE 데이터 확보 시)
- **자체 출제 표준 템플릿** 어댑터
- **Naver OAuth + 백엔드 proxy** (인증 필요한 운영 단계)

---

## 11. 빠른 명령어 모음

### 로컬 개발
```bash
npm install
npm run dev          # http://localhost:4321/kpcitpe-search
npm run build:data   # data/problems.json 생성
npm run build        # 데이터 + 사이트 빌드
npm run preview      # dist 결과 미리보기
```

### Sync 관련
```bash
gh workflow run sync-drive.yml --ref main         # sync 수동 실행
gh run list --workflow=sync-drive.yml --limit 3   # 최근 실행 확인
gh run view <RUN_ID> --log | less                 # 상세 로그
```

### 빌드 상태
```bash
gh run list --workflow=build-and-deploy.yml --limit 3
```

### 매핑 통계
```python
python3 -c "
import json
d = json.load(open('data/mappings/explanation-files.json'))
for cat in ['기출', '합숙']:
    print(f'{cat}: {len(d.get(cat, {}))}회차')
print(f'모의 KPC: {len(d.get(\"모의\", {}).get(\"KPC\", {}))}회차')"
```

---

## 12. 메모리 (.claude/projects/.../memory/)

다른 Claude 세션이 이 프로젝트의 컨텍스트를 빠르게 회복하기 위해 저장된 메모리들:

- `project_hosting.md` — GitHub Pages 배포 결정
- `project_data_model_academy.md` — 합숙도 academy 귀속, 기출만 null
- `project_data_normalization.md` — 회차 -N 접미사, ID에 cert 슬러그, 소문제 N.M, 옛 회차 단답형 자동 순번
- `feedback_git_author.md` — git commit author 이메일 ksujae@gmail.com 사용
