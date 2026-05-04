# 해설지 매핑

`explanation-files.json` 은 (회차, 교시/일차) 단위로 Google Drive 파일 ID를 매핑한다.
**자동 동기화** — `scripts/sync-drive-mappings.ts` 가 Drive 폴더 트리를 탐색해 자동 갱신.

## 키 구조

```
기출:  {round} → {session}_{certScope}    예: "138" → "1_정보관리"
합숙:  {round} → {session}_{sessionPart}   예: "2026.02" → "1일차_1교시"
모의:  {academy} → {round} → {session}     예: "KPC" → "2026.04" → "1"
자체:  {academy} → {round} → {session}
```

`session` 값은 `Problem.session` 그대로.

## 자동 동기화 셋업 (1회)

### 1. Google Cloud — Service Account 만들기

1. https://console.cloud.google.com 접속 → 새 프로젝트 (예: `kpcitpe-search`)
2. **APIs & Services → Library → "Google Drive API" 사용 설정**
3. **APIs & Services → Credentials → CREATE CREDENTIALS → Service account**
   - Name: `kpc-drive-bot` (자유)
   - Role: 비워둠 (Drive 폴더에 직접 공유로 권한 부여)
4. 생성된 서비스 계정 클릭 → **KEYS → ADD KEY → Create new key → JSON** → 다운로드
5. JSON 안의 `client_email` 값 복사 (예: `kpc-drive-bot@kpcitpe-search.iam.gserviceaccount.com`)

### 2. Drive 폴더 공유

해설지 루트 폴더(`01. 기출문제 & 모의고사`)를 위 `client_email` 로 **"보기 권한"** 공유.

### 3. GitHub Secrets 등록

레포 **Settings → Secrets and variables → Actions → New repository secret**:

- `GOOGLE_SERVICE_ACCOUNT_JSON` = 다운로드한 JSON 파일 **전체 내용** (그대로 붙여넣기)
- `DRIVE_ROOT_FOLDER_ID` = `1gKPEW_eVdR086KXwPDZIeUfPvlQp9-rV` (해설지 루트 폴더 ID)

### 4. 동작 확인

- Actions 탭 → **Sync Drive Mappings** → **Run workflow**
- 매일 새벽 3시(KST) 자동 실행. Drive에 변경이 있으면 commit → 자동 빌드/배포.

## 로컬에서 실행 (선택)

```bash
# .env 파일에 두기
export GOOGLE_SERVICE_ACCOUNT_JSON=/path/to/key.json   # JSON 문자열 또는 파일경로 둘 다 가능
export DRIVE_ROOT_FOLDER_ID=1gKPEW_eVdR086KXwPDZIeUfPvlQp9-rV

npm run sync:drive
```

## 카테고리 자동 인식 규칙

`scripts/sync-drive-mappings.ts` 의 `classifyCategory()` 가 루트 자식 폴더명으로 분류:

| 폴더명 패턴 | 처리 |
|---|---|
| `01. 기출문제` | 기출 → `기출/{round}/{session}_{certScope}` |
| `03. KPC 모의고사(해설집)` | 모의 KPC → `모의/KPC/{round}/{session}` |
| `04. KPC 합숙` | 합숙 → `합숙/{round}/{session}_{sessionPart}` |
| `02. KPC 모의고사(모범답안)` | **무시** (해설집만 사용) |
| `05. JUD`, `06. 타학원` | **무시** |

## 파일명 패턴 (파서)

| 카테고리 | 패턴 |
|---|---|
| 합숙 | `KPC {N}회 대비 합숙해설집_{D}일차_{P}교시[_접미사].pdf` |
| 모의 신형 | `[KPC기술사IMPACT실전모의고사]_제{N}회_해설집_{YYYYMM}_{S}교시.pdf` |
| 모의 구형 | `{S}교시해설-제{N}회({YYYY}년{MM}월)KPC기술사IMPACT실전모의고사_*.pdf` |
| 기출 신형 | `{N}회_기출풀이_{종목} {S}교시[_보완].pdf` |
| 기출 중형 | `{S}교시_KPC[_]제{N}회_기출문제풀이_{종목}_*.pdf` |
| 기출 구형 | `제{N}회정보처리기술사기출문제풀이-{종목}기술사 {S}교시.pdf` |

종목 정규화: 정보관리 / (컴퓨터시스템응용·컴시응 → 컴시응) / 공통

## 매핑 안 되는 케이스

- 합숙 폴더명에 연월이 없는 옛 회차 (예: `095회합숙`) — 무시
- 합숙 108회처럼 교시 구분 없는 통합본만 있는 폴더 — 매핑 실패 (수동 보강 필요)
- zip 파일 / 문제지 / 모범답안 — 파서가 무시
