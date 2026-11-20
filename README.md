# CrowdFix — 최종 발표 데모

성균관대학교 캠퍼스 의견 수집·전달 플랫폼 **CrowdFix**의 시연용 웹앱입니다. (Team 13 · 소프트웨어공학)

- 요구사항: `Team_13_SRS_Final (v1.0)`
- 데모 범위: `CrowdFix_데모범위_시나리오` (2026-11-17 확정)

## 바로 실행하기

필요한 것은 [Docker Desktop](https://www.docker.com/products/docker-desktop/) 하나뿐입니다. Python·Node·PostgreSQL은 따로 설치하지 않아도 됩니다.

```bash
git clone https://github.com/doah7/crowdfix.git
cd crowdfix
docker compose up --build
```

처음 실행하면 이미지 빌드에 몇 분이 걸립니다. 다 뜨면:

| 주소 | 내용 |
|---|---|
| http://localhost:5173 | 웹앱 (학생 화면은 모바일 폭으로 보입니다) |
| http://localhost:8000/api/docs | API 문서 (FastAPI 자동 생성) |
| http://localhost:8025 | 시험 메일 수신함 (Mailpit, 장면 3에서 사용) |

종료할 때는 `Ctrl+C` 또는 `docker compose down`을 실행합니다. DB와 업로드한 사진은 Docker 볼륨에 남습니다.

### 시연용 계정

비밀번호는 모두 `demo1234`입니다. 로그인 화면의 버튼으로 바로 들어갈 수도 있습니다.

| 아이디 | 역할 |
|---|---|
| `studentA` | 학생 A: 탐색, 디도 프린터 이슈 최초 등록, 완료 알림 확인 |
| `studentB` | 학생 B: AI 추천으로 A의 의제에 참여 |
| `seedC1` | 학생 C1: 장면 1과 2 사이에 화면 밖에서 참여 |
| `operator` | 운영자: 상태 변경과 결과 입력 |

### 시연 데이터 초기화

리허설 전에 아래 명령을 실행하면 데모 문서 2.4의 시작 상태로 돌아갑니다. 메인 의제(디도 B1 프린터)는 없고, 학생 A의 알림함은 비어 있습니다.

```bash
docker compose exec api python -m app.seed
```

DB까지 완전히 지우고 처음부터 다시 만들려면 `docker compose down -v` 후 다시 `up` 합니다.

### 시연 진행 보조

장면 1과 2 사이에 시드 계정 C1이 화면 밖에서 메인 의제에 참여합니다 (고유 참여 1 → 2). 화면의 '나도 겪었어요' 버튼과 같은 코드로 처리됩니다.

```bash
docker compose exec api python -m app.demo c1-join
```

장면 1에서 첨부할 리허설용 사진은 `data/demo/printer_error.png`에 있습니다. 발표 때는 실제 프린터 오류 화면 사진으로 바꿔도 됩니다.

### 입력 규칙 (데모 기준)

| 항목 | 규칙 |
|---|---|
| 의제 유형 | 등록은 Issue만 (Proposal은 목록에서 조회만) |
| 장소 | 필수. 자연과학캠퍼스 53곳 중 선택 (별칭 검색: 디도 → 삼성학술정보관) |
| 층·위치 | 선택. 비우면 본문의 `B1`, `3층`, `3F`를 층으로 사용 |
| 제목 | 선택. 비우면 본문 첫 줄 |
| 본문 | 필수, 5~2000자 |
| 사진 | 선택. JPG·PNG, 5MB 이하, 1장. 저장할 때 EXIF(GPS 포함)를 지우고 Docker 볼륨에 저장 |

## 구성

```
crowdfix/
├─ docker-compose.yml   db(PostgreSQL+pgvector) · api(FastAPI) · web(React) · mailpit
├─ data/                자연과학캠퍼스 건물·장소 CSV (성균관대 캠퍼스맵 기준)
├─ api/app/
│  ├─ models.py         DB 스키마 (데모 전체에 쓸 테이블을 먼저 정의)
│  ├─ seed.py           시연 데이터 초기화 스크립트
│  ├─ demo.py           시연 진행 보조 (C1 참여)
│  ├─ auth.py           시연용 계정 로그인, 학생·운영자 권한 구분
│  ├─ photos.py         사진 형식·크기 검사, EXIF/GPS 제거
│  ├─ services.py       참여 집계(고유 인원), 자동 구독 등 공통 로직
│  └─ routers/          API (auth, buildings, topics, reports, notifications)
└─ web/src/
   ├─ pages/            로그인, 탐색(지도·목록), 의제 상세, 글쓰기
   ├─ components/       상단 영역, 캠퍼스 지도, 요약 카드
   └─ labels.ts         표준 표시 명칭 (SRS 표 3-2, 3-3)
```

| 영역 | 기술 (SRS 2.5) |
|---|---|
| 클라이언트 | React, TypeScript, Leaflet (지도 타일: OpenStreetMap) |
| 서버 | FastAPI, SQLAlchemy |
| DB | PostgreSQL 16 + pgvector |
| AI | Sentence Transformers 다국어 임베딩 (Increment 3) |
| 배포 | Docker Compose |

`api/app`과 `web/src`는 컨테이너에 연결되어 있어서, 코드를 고치면 서버와 화면이 자동으로 다시 로드됩니다.

## 진행 상황 (Increment)

| # | 범위 | 데모 장면 | 상태 |
|---|---|---|---|
| 1 | 실행 환경, DB 스키마, 건물·시드 데이터, 초기화 스크립트, 로그인, 지도·필터·목록(Proposal 탭)·의제 상세 조회 | 장면 1의 1~4 | ✅ 완료 |
| 2 | Report 작성, 사진 첨부(1장·5MB, GPS 제거), 새 의제 생성, 참여 버튼·고유 인원 집계, 구독 | 장면 1의 5~6 | ✅ 완료 |
| 3 | 작성 중 AI 유사 의제 추천(건물로 먼저 거름), 기존 의제에 참여 | 장면 2 | 예정 |
| 4 | 기준값 T 도달 시 보고서 메일 1회 발송, 중복 발송 방지 | 장면 3 | 예정 |
| 5 | 운영자 상태 변경·결과 입력, 구독자 알림함 | 장면 4~5 | 예정 |

## 협업 방법

- `main` 브랜치는 항상 `docker compose up`으로 실행되는 상태를 유지합니다.
- 기능마다 브랜치를 만들고(`feat/report-form` 등) Pull Request로 합칩니다.
- DB 스키마(`api/app/models.py`)를 바꿀 때는 PR 설명에 적고, 팀원은 받은 뒤 초기화 스크립트를 한 번 실행합니다.
