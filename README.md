# 전자금융감독규정 변경 모니터 (프로토타입)

법제처 국가법령정보 OPEN API로 **전자금융감독규정(행정규칙)** 의 변경을 매월 자동 수집하고,
변경 본문을 조문 단위로 비교(diff)해 **월간 다이제스트 + 아카이브 뷰어**로 보여주는 스캐폴드입니다.

```
collector/   수집기 (법제처 API 호출 · 변경 감지 · diff)
  fetch.mjs    API 호출/파싱
  run.mjs      오케스트레이션 → web/data 생성
  fixtures/    오프라인 테스트용 목 데이터
web/         Vercel 정적 사이트 (이 폴더가 배포 루트)
  index.html   아카이브 뷰어
  data/        수집 산출물 (자동 생성, git 커밋 = 증빙)
.github/workflows/monitor.yml   월간 스케줄 실행
```

## 동작 방식
1. 매월 `lawSearch.do`(목록) → `lawService.do`(본문)로 현재 전금감을 가져온다.
2. 직전 스냅샷(`web/data/current.json`)과 비교한다. 변경 판정 기준:
   - 행정규칙일련번호가 바뀌었거나
   - 본문 텍스트 해시가 바뀐 경우
3. 변경 시 직전 본문과 조문 단위 diff를 만들고, `web/data/monthly/YYYY-MM.json` + 다이제스트 HTML을 생성한다.
4. GitHub Actions가 `web/data`를 커밋·푸시한다. **이 git 히스토리가 "언제 무엇을 인지했는지" 증빙이 된다.**
5. 푸시되면 Vercel이 자동 재배포한다.

## 설정
### 1) 법제처 OC 키 발급
- open.law.go.kr 회원가입 → OPEN API 사용 신청(보통 1~2일 내 승인).
- `OC` 값은 **등록한 이메일의 @ 앞부분**. (소량 테스트는 `OC=test`도 동작)
- GitHub 저장소 → Settings → Secrets and variables → Actions 에 `LAW_OC` 등록.

### 2) 로컬 실행
```bash
npm install
LAW_OC=발급받은값 npm run collect     # 실제 수집
npm run collect:mock                   # 네트워크 없이 목 데이터로 동작 확인
# 뷰어는 정적 서버로 열어야 함(파일 직접 열기는 CORS로 fetch 불가)
npx serve web        # 또는  python3 -m http.server -d web 8080
```

### 3) Vercel 배포
- Vercel 새 프로젝트 → 이 저장소 연결.
- **Root Directory 를 `web` 으로 설정**, 빌드 명령 없음(정적).
- 이후 Actions가 푸시할 때마다 자동 배포.

### 4) 이메일(선택)
- `.github/workflows/monitor.yml` 의 Email 단계 주석 해제 + `SMTP_*`, `MAIL_TO` Secrets 등록.

## 알아둘 한계 (중요)
- **예고 단계는 안 잡힘**: 법제처에는 시행·확정된 규정만 등록된다. 개정안 *예고* 시점의 조기경보는
  금융위 입법예고/규정변경예고 채널을 별도로 모니터링해야 한다(다음 프로토타입).
- **자동 추출 ≠ 최종 판단**: diff는 후보 제시일 뿐, 영향·시행시점·경과규정은 담당자가 원문으로 확인해야 한다.
- **금감원 자체점검 지시**는 공문/행정지도로 오므로 웹 자동 감지가 안 된다. 사람이 채워 넣는 칸이 별도로 필요하다.
- 샌드박스에서 law.go.kr 직접 호출 검증은 못 했고, 문서화된 엔드포인트 스펙대로 작성했다.
  최초 1회는 `LAW_OC`로 실제 응답 구조(태그명)를 확인하고 필요 시 `fetch.mjs`의 필드 매핑만 조정하면 된다.
