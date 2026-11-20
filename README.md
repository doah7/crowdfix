# CrowdFix Demo

A campus feedback platform for SKKU students: **CrowdFix** demo web app (Introduction to Software Engineering, Team 13)

- 데모 범위·시연 시나리오: [docs/demo-scope-and-scenario.md](docs/demo-scope-and-scenario.md)

## 실행

[Docker Desktop](https://www.docker.com/products/docker-desktop/)만 있으면 됩니다. 첫 빌드는 AI 모델 포함으로 10분 안팎 걸립니다.

```bash
git clone https://github.com/doah7/crowdfix.git
cd crowdfix
docker compose up --build
```

| 주소 | 내용 |
|---|---|
| http://localhost:5173 | 웹앱 |
| http://localhost:8000/api/docs | API 문서 |
| http://localhost:8025 | 시험 메일 수신함 (Mailpit) |

**시연 계정** (비밀번호 `demo1234`, 로그인 화면 버튼으로도 접속): `studentA` 최초 등록 · `studentB` AI 추천으로 참여 · `seedC1` 화면 밖 참여 · `operator` 운영자

## 시연 명령

```bash
docker compose exec api python -m app.seed        # 시연 시작 상태로 초기화
docker compose exec api python -m app.demo c1-join  # 장면 1→2 사이 C1 참여 (고유 1→2)
docker compose exec api python -m app.check_ai    # AI 테스트 문장 점검
```

리허설용 첨부 사진: `data/demo/printer_error.png`

## AI 유사 의제 추천

글쓰기 중(등록 전) 본문을 5자 이상 쓰면 추천 카드가 뜹니다.

- **선택한 건물로 먼저 거르고**, 다국어 임베딩(`paraphrase-multilingual-MiniLM-L12-v2`) 코사인 유사도로 비교
- 본문에서 대상(프린터·Wi-Fi 등)을 뽑아 **대상이 다르면 제외**, Done 의제도 제외
- 글과 의제 모두 강의실 번호(5~6자리, 예: `26312`, 지하는 `48B07`)가 있으면 **번호가 같아야 추천**
- 기준: 대상이 같으면 0.55↑ '같음', 대상을 모르면 0.85↑. 값은 `api/app/config.py`의 `similar_*`
- 연결은 사용자가 '이 의제에 참여'를 눌러야 되며, 근거(유사도·일치 속성)를 기록

## 구성

| 영역 | 기술 | 위치 |
|---|---|---|
| 클라이언트 | React, TypeScript, Leaflet | `web/src` |
| 서버 | FastAPI, SQLAlchemy | `api/app` |
| DB | PostgreSQL 16 + pgvector | `api/app/models.py` |
| AI | Sentence Transformers | `api/app/ai.py`, `similar.py` |

`api/app`, `web/src`는 컨테이너에 연결돼 있어 수정하면 자동으로 다시 로드됩니다.

## 진행 상황

| # | 범위 | 장면 | 상태 |
|---|---|---|---|
| 1 | 실행 환경, DB·시드, 로그인, 지도·필터·목록·상세 | 1 (1~4) | ✅ |
| 2 | 글쓰기, 사진(1장·5MB·GPS 제거), 새 의제, 참여·구독 | 1 (5~6) | ✅ |
| 3 | 작성 중 AI 추천, 기존 의제 참여 | 2 | ✅ |
| 4 | 기준 도달 시 보고서 메일 1회 발송 | 3 | ✅ |
| 5 | 운영자 상태 변경·결과 입력, 알림함 | 4~5 | ✅ |

## 협업

- `main`은 항상 실행되는 상태로 유지하고, 기능별 브랜치 → Pull Request로 합칩니다.
- DB 스키마를 바꾸면 PR에 적고, 받은 쪽은 `app.seed`를 한 번 실행합니다.
