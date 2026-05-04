# kpcitpe-search

정보관리 / 컴시응 기술사 기출·합숙·모의 통합 검색 정적 웹앱.

## 개발

```bash
npm install
npm run build:data   # data/source/* → data/problems.json
npm run dev          # Astro dev 서버
npm run build        # 데이터 빌드 + 정적 사이트 빌드
```

## 배포

GitHub Pages — `.github/workflows/build-and-deploy.yml` 참고.

자세한 설계는 `requirements.md` 참고.
