# 어댑터 가이드

각 데이터 소스(엑셀 형식)별로 `SourceAdapter` 인터페이스를 구현한다.
모든 어댑터는 `Problem[]` 표준 스키마로 출력하며, `scripts/build.ts`에서 등록되어 병합된다.

- `types.ts` — `Problem`, `SourceAdapter` 인터페이스
- `kpc-xls-adapter.ts` — KPC 통합 엑셀(`기출`, `모의`, `합숙` 시트)
- `standard-template-adapter.ts` — 자체 출제용 표준 템플릿 (Phase 5)
- `itpe-xlsx-adapter.ts` — ITPE 데이터 확보 시 추가
