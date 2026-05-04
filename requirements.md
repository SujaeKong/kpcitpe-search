# kpcitpe-search 요구사항 정의서

> 정보관리기술사 / 컴퓨터시스템응용기술사 기출문제, 합숙, 모의고사를 통합 검색하고 해설지를 열람할 수 있는 정적 웹 애플리케이션

---

## 0. 프로젝트 식별 정보

| 항목 | 값 |
|---|---|
| 프로젝트명 | `kpcitpe-search` |
| 개발 환경 | macOS (Intel) + Claude Code |
| 데이터 소스 | `KPC_기술사문제검색_v260411.xls` (현행 v20260411) |
| 데이터 규모 | 기출 2,699건 + 모의 5,881건 + 합숙 3,578건 = **약 12,158건** |

---

## 1. 프로젝트 개요

### 1.1 목적
정보관리기술사 / 컴퓨터시스템응용기술사 수험생이 기출문제 · 합숙문제 · 학원 모의고사를 키워드로 통합 검색하고, 해당 문제가 포함된 해설지를 즉시 열람 또는 다운로드할 수 있는 공개 웹 서비스를 구축한다.

### 1.2 핵심 가치
- **빠른 키워드 검색**: 문제 본문 / 주제 텍스트 기반 전문 검색 (최우선)
- **즉시 해설지 접근**: 검색 결과에서 한 번의 클릭으로 해설지 열람 또는 다운로드
- **무료 운영**: 백엔드 서버 없이 정적 사이트로 호스팅 비용 0원 운영
- **확장 가능**: 회차 추가, 학원 추가, 자체 출제 문제 추가 시 유연한 데이터 통합

### 1.3 타겟 사용자
- 정보관리기술사 / 컴퓨터시스템응용기술사 수험생 (불특정 다수, 공개)
- KPC 강의 수강생
- 기출 문제 분석을 원하는 일반 학습자

---

## 2. 원본 데이터 구조 분석 (실측 기반)

### 2.1 엑셀 파일 시트 구성

| 시트명 | 용도 | 행수 | 비고 |
|---|---|---|---|
| `Main` | 도구 메타정보, 검색 UI (엑셀용) | - | 변환 시 무시 |
| `기출` | 정보처리기술사 기출문제 | 2,699 | 80회 ~ 138회 |
| `모의` | 학원 모의고사 (현재 KPC만) | 5,881 | 2010.01 ~ 2026.04 |
| `합숙` | 합숙 문제 | 3,578 | 2011.02 ~ 2026.02 |
| `검색결과` | 엑셀 도구의 결과 시트 | - | 변환 시 무시 |

### 2.2 컬럼 구조 (3개 시트 공통)

| 컬럼 | 타입 | 예시 | 비고 |
|---|---|---|---|
| `회차` | string | `138`, `138회`, `모의_2026.04`, `합숙_2026.02` | **정규화 필요** (§2.4) |
| `종목` | string | `관리`, `응용`, `컴시응`, `공통`, `조직`, `보안` | **3종목으로 통합** (§2.5) |
| `유형` | int/string | `1`,`2`,`3`,`4` (교시) / `Day-1`~`Day-8`, `1일차`~`8일차` (합숙) | 합숙은 정규화 필요 |
| `문제` | string | `1. AI RMF에 대해...` | 번호 + 본문 형식 |
| `Unnamed: 4` | string | `KPC 129회`, `138회 대비` | 출처/대비 회차 메타 (모의/합숙만) |

### 2.3 데이터 품질 이슈 (정규화 작업 필요)

#### 이슈 1: 회차 표기 비일관성
- 기출 시트에 `'105'`와 `'105회'` 혼재
- → **'회' 접미사 제거 후 숫자로 통일**

#### 이슈 2: 합숙 유형 표기 비일관성
- `Day-1` ~ `Day-5` (영문)와 `1일차` ~ `8일차` (한글) 혼재
- → **`1일차` 형식으로 통일** (한글이 더 친숙)

#### 이슈 3: 문제 번호 추출
- `"1. AI RMF에 대해..."` (공백 있음) — 약 70%
- `"1.AI RMF에 대해..."` (공백 없음) — 약 30%
- → 정규식 `^(\d+)\.\s*(.+)` 으로 99% 이상 매칭 가능

#### 이슈 4: 다단 문제 (가/나/다 항목 포함)
- 2~4교시 문제는 본문에 `\n가. ...\n나. ...` 형식으로 부속 항목 포함
- → 검색은 전체 텍스트 대상, 표시는 줄바꿈 보존

### 2.4 회차 정규화 규칙

| 원본 | 정규화 후 형태 | 카테고리 |
|---|---|---|
| `138`, `138회` | `sourceType: "기출"`, `round: "138"` | 기출 회차 |
| `모의_2026.04` | `sourceType: "모의"`, `round: "2026.04"` | 학원 모의고사 |
| `합숙_2026.02` | `sourceType: "합숙"`, `round: "2026.02"` | 합숙 |

### 2.5 종목 정규화 규칙 (3종목으로 통합)

엑셀에는 6가지 종목 표기가 등장하지만, 실제로는 3가지로 충분:

| 원본 표기 | 정규화 후 | 의미 | 사례 (분포) |
|---|---|---|---|
| `관리` | **정보관리** | 정보관리기술사 | 4,625건 (전체) |
| `응용`, `컴시응` | **컴시응** | 컴퓨터시스템응용기술사 | 3,692건 (전체) |
| `공통`, `조직`, `보안` | **공통** | 양쪽 자격증에 공통으로 사용 | 3,841건 (전체) |

**왜 `조직`, `보안`을 `공통`으로 흡수하는가?**
- `조직` 278건: 2010~2011년 초창기 KPC 모의에서 쓰던 임시 카테고리. 이후 사라짐.
- `보안` 4건: 2010년 모의에 4건만 등장한 일회성 표기.
- 둘 다 특정 자격증을 지칭하지 않으므로 `공통` 처리가 타당.

---

## 3. 향후 데이터 확장 전략 (핵심 설계)

본 프로젝트는 **단일 KPC 엑셀**로 시작하지만, 향후 다음 3가지 확장이 예상됨:
- KPC 신규 회차 추가 (정기, 같은 형식)
- ITPE / 타학원 데이터 추가 (형식 다를 수 있음)
- 자체 출제 문제 추가 (수재님 KPC 콘텐츠 제작)

### 3.1 어댑터 패턴 (Adapter Pattern) 채택

**핵심 아이디어**: 데이터 소스마다 변환 어댑터를 분리하고, 모두 동일한 `Problem` 스키마로 변환한 뒤 병합한다.

```
scripts/
├── adapters/
│   ├── kpc-xls-adapter.ts          # KPC 통합 엑셀 (3시트) → Problem[]
│   ├── itpe-xlsx-adapter.ts        # ITPE 엑셀 → Problem[] (향후)
│   ├── standard-template-adapter.ts # 표준 템플릿 → Problem[] (자체 출제용)
│   └── README.md                   # 새 어댑터 추가 가이드
├── merge-sources.ts                # 모든 어댑터 결과 병합 + 중복 제거
├── normalize.ts                    # 공통 정규화 로직 (회차/종목/문제번호)
├── validate-data.ts                # 스키마 검증
└── build.ts                        # 전체 파이프라인 실행
```

**파이프라인 흐름:**
```
data/source/
├── kpc/                            # KPC 원본 엑셀들 (이력 보존)
│   └── KPC_기술사문제검색_v260411.xls
├── itpe/                           # ITPE 원본 (향후)
│   └── ITPE_2025.xlsx
└── custom/                         # 자체 출제 (표준 템플릿)
    └── custom_2026Q2.xlsx

      ↓ (각 어댑터가 변환)

scripts/build.ts 실행
      ↓

data/
├── problems.json                   # 통합된 단일 데이터
├── problems.min.json               # 검색 인덱스용 경량화
└── stats.json                      # 통계
```

### 3.2 어댑터 인터페이스 표준

모든 어댑터는 동일한 인터페이스를 따른다:

```typescript
interface SourceAdapter {
  /** 어댑터 이름 (로그/디버깅용) */
  name: string;
  
  /** 어떤 source 식별자를 만들어내는지 */
  sourceTag: "KPC" | "ITPE" | "CUSTOM" | string;
  
  /** 파일을 읽어 표준 Problem 배열로 변환 */
  parse(filePath: string): Promise<Problem[]>;
  
  /** 사전 검증 (선택): 파일이 이 어댑터로 처리 가능한지 확인 */
  canHandle?(filePath: string): boolean;
}
```

### 3.3 표준 입력 템플릿 (자체 출제 / 형식 통일이 가능한 경우)

신규 학원이나 자체 출제 문제를 추가할 때 사용할 **표준 엑셀 템플릿**:

| 컬럼명 | 필수 | 타입 | 예시 | 설명 |
|---|---|---|---|---|
| `sourceType` | ✅ | enum | `기출`, `모의`, `합숙`, `자체` | 출처 유형 |
| `academy` | 조건부 | string | `KPC`, `ITPE` | 모의/자체 시 필수 |
| `certScope` | ✅ | enum | `정보관리`, `컴시응`, `공통` | 종목 |
| `round` | ✅ | string | `138`, `2026.04` | 회차 |
| `session` | ✅ | string | `1`, `2`, `1일차` | 교시/일차 |
| `questionNumber` | ✅ | int | `3` | 문항번호 |
| `title` | ❌ | string | `ISO/IEC 42001:2023` | 제목 (자동 추출 가능) |
| `content` | ✅ | string | 전체 문제 본문 | |
| `preparingFor` | ❌ | string | `138회 대비`, `KPC 129회` | 출처 메모 |
| `explanationFileId` | ❌ | string | Google Drive ID | 해설지 직접 매핑 |

→ `scripts/adapters/standard-template-adapter.ts`로 처리.

### 3.4 시나리오별 운영 워크플로우

#### 시나리오 A: KPC 신규 회차 추가 (정기, 2개월 주기)
1. KPC 신규 엑셀 (`KPC_기술사문제검색_v260612.xls`)을 `data/source/kpc/`에 추가
2. (옵션) 기존 엑셀은 보존 (이력 관리, Git에서 diff 추적)
3. `npm run build:data` 실행
4. `kpc-xls-adapter`가 최신 버전 파일을 자동 인식하여 처리
5. 신규 회차 해설지 PDF를 Google Drive 업로드 → ID 매핑 추가
6. `git push` → 자동 배포

#### 시나리오 B: ITPE 모의고사 데이터 확보 시
1. `data/source/itpe/ITPE_2025.xlsx` 추가
2. `scripts/adapters/itpe-xlsx-adapter.ts` 신규 작성 (1회성)
   - ITPE 엑셀 컬럼명을 표준 스키마로 매핑
3. `scripts/build.ts`에 어댑터 등록
4. 빌드 시 자동 통합

#### 시나리오 C: 자체 출제 문제 추가
1. `templates/standard-template.xlsx` 다운로드
2. 문제 작성 후 `data/source/custom/`에 저장
3. 빌드 실행 → `standard-template-adapter`가 처리

### 3.5 중복 처리 정책

여러 출처에서 같은 문제가 등장할 수 있음 (예: KPC 모의에 출제된 문제가 이후 기출에 재등장).
- **기본 정책**: ID가 다르면 별개 문제로 취급 (둘 다 표시)
- **`preparingFor`나 검색 시 표시**: "이 문제는 138회 기출에도 출제됨" 등 관계 표시 (향후 개선)

---

## 4. 기술 스택 결정사항

### 4.1 데이터 저장: GitHub 기반 정적 파일 (DB 미사용)

**결정: JSON 파일 기반 정적 데이터**

데이터 규모가 약 12,000건이지만 다음 이유로 JSON으로 충분:
- 텍스트 데이터 평균 100~300바이트 → 전체 약 5~10MB JSON
- gzip 압축 시 1~2MB → 초기 로드 1초 이내 가능
- 클라이언트 사이드 검색(Fuse.js)으로 200ms 이내 응답

**최적화 전략:**
- 메인 페이지는 검색 인덱스만 로드 (제목+키워드만 추출, ~1MB)
- 검색 결과 클릭 시 상세 본문 별도 fetch
- 또는 전체 데이터를 한 번에 로드 후 메모리 검색 (5MB 허용)

**DB 도입 트리거 (현재 미해당):**
- 사용자 계정 / 즐겨찾기 / 학습 이력 추가 시
- 데이터가 5만 건 이상으로 증가 시
- → 이때 Supabase 또는 Cloudflare D1 도입 검토

### 4.2 해설지 저장: Google Drive

**결정: 네이버 마이박스 → Google Drive 마이그레이션**

| 기능 | 마이박스 | Google Drive |
|---|---|---|
| iframe 임베드 | 제약 큼 | `/preview` URL로 가능 |
| 직접 다운로드 링크 | 제약 큼 | `/uc?export=download` 가능 |
| API 접근 | 비공식 | 공식 API + MCP 지원 |

**Google Drive 폴더 구조:**
```
KPCITPE_해설지/
├── 기출/
│   ├── 정보관리/
│   │   ├── 138회_1교시.pdf
│   │   └── ...
│   └── 컴시응/
├── 합숙/
│   └── 합숙_2026.02_1일차.pdf
└── 모의고사/
    ├── KPC/
    │   └── 모의_2026.04_1교시.pdf
    └── ITPE/
```

**공유 권한:** 링크가 있는 모든 사용자 - 보기 권한

### 4.3 호스팅: Cloudflare Pages

| 항목 | Cloudflare Pages | GitHub Pages |
|---|---|---|
| 빌드 속도 | ⭐⭐⭐ 빠름 | ⭐⭐ 보통 |
| 한국 응답 속도 | ⭐⭐⭐ 인천 PoP 보유 | ⭐⭐ 미국 위주 |
| 향후 백엔드 확장 | Workers로 자연스럽게 | 별도 호스팅 필요 |
| 비용 | 무료 (충분한 한도) | 무료 |

**도메인:** 1단계 `kpcitpe-search.pages.dev` → 필요시 자체 도메인 연결

### 4.4 프론트엔드 스택

| 항목 | 선택 | 사유 |
|---|---|---|
| 프레임워크 | **Astro** | 정적 사이트 최적화, JS 번들 최소화, Islands Architecture |
| 검색 라이브러리 | **Fuse.js** | 한글 fuzzy matching, ~10KB |
| UI 인터랙션 | **React (Astro Islands)** | 검색/필터 컴포넌트만 부분 hydration |
| 스타일 | **Tailwind CSS** | 빠른 프로토타이핑 |
| PDF 임베드 | **iframe + Google Drive `/preview`** | 라이브러리 불필요 |
| 언어 | **TypeScript** | 데이터 스키마 타입 안정성 |
| 변환 스크립트 | **TypeScript + xlsx 패키지** | Node.js 일관 환경 |

---

## 5. 데이터 모델

### 5.1 통합 문제 스키마 (TypeScript)

```typescript
type CertScope = "정보관리" | "컴시응" | "공통";
type SourceType = "기출" | "합숙" | "모의" | "자체";
type Academy = "KPC" | "ITPE" | null;

interface Problem {
  // ===== 식별자 =====
  id: string;                    // 예: "kichul-138-1-3", "moui-kpc-2026.04-1-3"
  
  // ===== 출처 분류 =====
  sourceType: SourceType;        // 기출 / 합숙 / 모의 / 자체
  academy: Academy;              // 모의/자체 시 KPC|ITPE, 그 외 null
  
  // ===== 자격증 분류 =====
  certScope: CertScope;          // 정보관리 / 컴시응 / 공통
  
  // ===== 회차 정보 =====
  round: string;                 // "138" | "2026.04" | "2026.02"
  roundLabel: string;            // 표시용: "138회" | "모의_2026.04" | "합숙_2026.02"
  roundOrder: number;            // 정렬용: 138 (기출) | 202604 (모의/합숙 YYYYMM)
  
  // ===== 교시/일차 =====
  session: string;               // "1", "2", "3", "4", "1일차"~"8일차"
  sessionType: "교시" | "일차";  // 합숙은 일차, 그 외 교시
  
  // ===== 문제 내용 =====
  questionNumber: number | null; // 1~13 (보통), 추출 실패 시 null
  title: string;                 // 본문에서 첫 줄만 추출
  content: string;               // 전체 본문 (다단 항목 포함)
  
  // ===== 메타 =====
  preparingFor?: string | null;  // "138회 대비" (합숙) | "KPC 129회" (모의 출처)
  
  // ===== 출처 추적 =====
  sourceFile: string;            // 변환된 원본 파일명 (디버깅용)
  
  // ===== 해설지 =====
  explanationFileId?: string | null;
  explanationFileName?: string | null;
}
```

### 5.2 데이터 파일 구조

```
data/
├── source/
│   ├── kpc/
│   │   └── KPC_기술사문제검색_v260411.xls
│   ├── itpe/                              # 향후
│   └── custom/                            # 자체 출제용
├── mappings/
│   ├── explanation-files.json             # 해설지 Drive ID 매핑
│   └── round-aliases.json                 # 회차 표기 통일 (수동 보정용)
├── templates/
│   └── standard-template.xlsx             # 자체 출제용 엑셀 템플릿
├── problems.json                          # 변환된 통합 데이터 (~5MB)
├── problems.min.json                      # 검색 인덱스 경량 버전 (~1MB)
└── stats.json                             # 통계
```

### 5.3 ID 생성 규칙

```
기출:  kichul-{round}-{session}-{questionNumber}
       예: kichul-138-1-3

합숙:  hapsuk-{round}-{session-slug}-{questionNumber}
       예: hapsuk-2026.02-1ilcha-3

모의:  moui-{academy-lower}-{round}-{session}-{questionNumber}
       예: moui-kpc-2026.04-1-3

자체:  custom-{academy-lower}-{round}-{session}-{questionNumber}
       예: custom-kpc-2026Q2-1-3
```

`questionNumber`가 null인 경우 row index 사용 (`-row{N}` 접미사).

### 5.4 해설지 파일 ID 매핑 (별도 관리)

엑셀에 해설지 파일 ID 컬럼이 없으므로 별도 매핑 파일로 관리:

```json
// data/mappings/explanation-files.json
{
  "기출": {
    "138": { "1": "1aBc...XYZ", "2": "1dEf...UVW" },
    "137": { ... }
  },
  "합숙": {
    "2026.02": { "1일차": "...", "2일차": "..." }
  },
  "모의": {
    "KPC": {
      "2026.04": { "1": "...", "2": "..." }
    },
    "ITPE": {}
  }
}
```

(회차, 교시) 단위로 1개 PDF 매핑 — 한 PDF에 해당 교시의 여러 문항이 함께 들어있음.

---

## 6. 기능 요구사항

### 6.1 핵심 기능 (MVP)

#### F1. 키워드 검색 (최우선)
- **입력**: 한글/영문 키워드
- **검색 대상**: `title`, `content`
- **방식**: Fuse.js fuzzy matching, debounce 200ms
- **응답 목표**: 200ms 이내

#### F2. 필터링
- **자격증** (다중): 정보관리 / 컴시응 / 공통
- **출처 유형** (다중): 기출 / 합숙 / 모의 / 자체
- **학원** (모의 선택 시): KPC / ITPE
- **회차 범위**: 슬라이더 또는 드롭다운
- **교시/일차**: 1~4교시, 1~8일차

#### F3. 검색 결과 카드

```
┌──────────────────────────────────────────────────┐
│ [기출] [정보관리] 138회 1교시 3번    📖 보기  ⬇ 다운 │
├──────────────────────────────────────────────────┤
│ ISO/IEC 42001:2023                               │
│                                                  │
│ ISO/IEC 42001:2023에 대하여 설명하시오. 가. ...  │
└──────────────────────────────────────────────────┘
```

- **상단 배지**: 출처유형, 자격증, 회차, 교시, 문항번호
- **본문 미리보기**: 처음 150자 + ellipsis
- **검색어 하이라이트**: `<mark>` 태그
- **액션 버튼**: 보기 / 다운로드 (해설지 매핑 있을 때만 활성)

#### F4. 해설지 뷰어
- **인라인 보기**: iframe `https://drive.google.com/file/d/{ID}/preview`
- **다운로드**: `https://drive.google.com/uc?export=download&id={ID}`
- **모바일**: iframe 대신 새 탭 (iOS Safari 호환)
- **미매핑 시**: "해설지 준비 중" 안내, 버튼 비활성

### 6.2 부가 기능

- **F5. 회차별 브라우징**: `/rounds/[sourceType]/[round]`
- **F6. URL 쿼리 동기화**: `/?q=쿠버네티스&type=기출&cert=정보관리`
- **F7. 통계 페이지** (선택): `/stats`

### 6.3 비기능 요구사항

| 항목 | 목표 |
|---|---|
| 첫 페이지 로드 | 1.5초 이내 |
| 검색 응답 | 200ms 이내 |
| 데이터 로드 | 1초 이내 |
| 모바일 반응형 | 320px 이상 |
| 브라우저 지원 | 최신 2개 버전 |

---

## 7. 프로젝트 구조

```
kpcitpe-search/
├── .github/workflows/build-and-deploy.yml
├── data/
│   ├── source/
│   │   ├── kpc/KPC_기술사문제검색_v260411.xls
│   │   ├── itpe/                          # 향후
│   │   └── custom/                        # 자체 출제
│   ├── mappings/
│   │   ├── explanation-files.json
│   │   └── round-aliases.json
│   ├── templates/
│   │   └── standard-template.xlsx
│   ├── problems.json
│   ├── problems.min.json
│   └── stats.json
├── scripts/
│   ├── adapters/
│   │   ├── kpc-xls-adapter.ts
│   │   ├── itpe-xlsx-adapter.ts           # 향후
│   │   ├── standard-template-adapter.ts
│   │   └── README.md
│   ├── build.ts                           # 메인 빌드 진입점
│   ├── normalize.ts                       # 공통 정규화 (회차/종목/문제번호)
│   ├── validate-data.ts
│   └── merge-sources.ts
├── src/
│   ├── components/
│   │   ├── SearchBar.tsx
│   │   ├── FilterPanel.tsx
│   │   ├── ProblemCard.astro
│   │   ├── ExplanationModal.tsx
│   │   ├── Badge.astro
│   │   └── HighlightedText.tsx
│   ├── layouts/BaseLayout.astro
│   ├── pages/
│   │   ├── index.astro
│   │   ├── rounds/[sourceType]/[round].astro
│   │   ├── stats.astro
│   │   └── about.astro
│   ├── lib/
│   │   ├── search.ts
│   │   ├── google-drive.ts
│   │   └── types.ts
│   └── styles/global.css
├── public/
├── astro.config.mjs
├── tailwind.config.mjs
├── tsconfig.json
├── package.json
├── README.md
└── requirements.md
```

---

## 8. 단계별 개발 로드맵

### Phase 1: 변환 파이프라인 (Day 1-2)
- [ ] Astro + TypeScript + Tailwind 프로젝트 초기 셋업
- [ ] 어댑터 인터페이스 정의 (`scripts/adapters/types.ts`)
- [ ] `kpc-xls-adapter.ts` 구현
  - [ ] 3개 시트 통합 읽기
  - [ ] 회차 정규화 (`105회` → `105`)
  - [ ] 합숙 유형 정규화 (`Day-1` → `1일차`)
  - [ ] 종목 정규화 (`관리`→정보관리, `응용`/`컴시응`→컴시응, `공통`/`조직`/`보안`→공통)
  - [ ] 문제 번호/제목/본문 분리
- [ ] `build.ts` 통합 파이프라인
- [ ] 검증 스크립트 (총 12,158건 변환 확인)
- [ ] `problems.json` 생성

### Phase 2: 검색 UI (Day 3-4)
- [ ] Fuse.js 통합
- [ ] 검색바 + 결과 카드 컴포넌트
- [ ] 필터 패널 (자격증/출처/회차/교시)
- [ ] 검색어 하이라이팅
- [ ] URL 쿼리스트링 동기화

### Phase 3: 해설지 연동 (Day 5)
- [ ] Google Drive 폴더 구조 생성
- [ ] 샘플 PDF 5개 업로드 + ID 매핑
- [ ] `explanation-files.json` 작성
- [ ] iframe 임베드 모달
- [ ] 다운로드 버튼

### Phase 4: 배포 (Day 6)
- [ ] GitHub 레포 생성 + push
- [ ] Cloudflare Pages 연동
- [ ] GitHub Actions 자동 빌드 워크플로우

### Phase 5: 데이터 보강 (지속)
- [ ] 전체 회차 해설지 ID 매핑 (점진적)
- [ ] **`standard-template-adapter` 구현 + 템플릿 엑셀 작성**
- [ ] **ITPE 모의고사 데이터 확보 시 `itpe-xlsx-adapter` 작성**
- [ ] 분야 태깅 (선택)

---

## 9. 사전 준비사항 (수재님 작업)

### 9.1 즉시 (Phase 1 시작 전)
- 없음 (제공해주신 엑셀로 바로 시작 가능)

### 9.2 Phase 3 전까지
1. **Google Drive 폴더 생성** (§4.2 구조)
2. **샘플 해설지 5개 업로드** (MVP 동작 확인용)

### 9.3 Phase 4 전까지
1. **GitHub 레포지토리 생성**: `kpcitpe-search`
2. **Cloudflare 계정 준비**

### 9.4 점진적 (Phase 5)
1. 전체 해설지 마이박스 → Drive 마이그레이션
2. `explanation-files.json` 매핑 점진적 채우기
3. ITPE 데이터 확보 시 어댑터 추가

---

## 10. 의사결정 요약

| 결정 항목 | 선택 | 핵심 사유 |
|---|---|---|
| 데이터 저장 | GitHub + JSON | 12,000건 규모는 JSON으로 충분 |
| 해설지 저장 | Google Drive | iframe 임베드 + 다운로드 모두 지원 |
| 호스팅 | Cloudflare Pages | 한국 응답속도 + 빌드 속도 |
| 프레임워크 | Astro + Islands | 정적 최적화 + 부분 hydration |
| 검색 엔진 | Fuse.js | 한글 fuzzy 검색, 백엔드 불필요 |
| 회차 표기 | 정규화 후 저장 | 원본의 표기 비일관성 보정 |
| 종목 분류 | 3종 통합 | 정보관리 / 컴시응 / 공통 (조직/보안 흡수) |
| 데이터 확장 | **어댑터 패턴** | 학원별 형식 차이 흡수, 자체 출제 지원 |
| 해설지 매핑 | 별도 JSON | 엑셀 컬럼 추가 없이 분리 관리 |

---

## 11. Claude Code 시작 프롬프트

```bash
mkdir kpcitpe-search && cd kpcitpe-search
mkdir -p data/source/kpc
cp ~/Downloads/requirements.md ./
cp ~/Downloads/KPC_기술사문제검색_v260411.xls ./data/source/kpc/
claude
```

첫 프롬프트:
```
requirements.md를 읽고 Phase 1부터 시작하자.

§7 프로젝트 구조에 따라 Astro + TypeScript + Tailwind로 셋업하고,
§3.1 어댑터 패턴으로 변환 파이프라인을 구축해줘.

1단계: 프로젝트 초기 셋업 + 디렉토리 구조 생성
2단계: scripts/adapters/types.ts 인터페이스 정의
3단계: scripts/adapters/kpc-xls-adapter.ts 구현
       (§2.3 정규화 규칙, §2.4 회차, §2.5 종목 매핑 적용)
4단계: scripts/build.ts로 data/problems.json 생성
5단계: 변환 결과 통계 출력 (시트별/종목별/회차별 건수)

각 단계마다 결과 보여주고 진행 확인 후 다음으로.
```

---

## 12. 알려진 제약 및 추후 검토

- **분야(Category) 정보 부재**: 엑셀에 분야 태그 없음. 향후 키워드 자동 분류 또는 수동 태깅.
- **이미지/표 포함 문제**: Main 시트에 "표·이미지 관련 문제는 직접 확인 필요" 표기. 텍스트 검색 한계 인지.
- **저작권**: KPC 엑셀의 재배포 가능 여부 사전 확인 필요 (수재님이 KPC 운영자라 큰 이슈 없을 것으로 추정).
- **ITPE 데이터 형식**: 확보 시 어댑터 신규 작성 필요. 컬럼 구조 분석 후 매핑 결정.
- **중복 문제 처리**: 같은 문제가 여러 출처에 등장 시 별개로 표시 (향후 관계 표시 기능 검토).
