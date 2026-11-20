from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql+psycopg://crowdfix:crowdfix@localhost:5432/crowdfix"
    jwt_secret: str = "change-me-demo-only"
    jwt_expire_minutes: int = 60 * 12
    buildings_csv: str = "../data/skku_natural_campus_buildings.csv"
    upload_dir: str = "./uploads"
    # 사진 첨부 제한 (데모 문서 TBD-09): JPG·PNG, 장당 5MB 이하, Report당 1장
    photo_max_bytes: int = 5 * 1024 * 1024
    photo_max_count: int = 1

    # 자동 전달 기준값 T (SRS BR-07). 시연 환경은 두 유형 모두 3명.
    threshold_issue: int = 3
    threshold_proposal: int = 3

    smtp_host: str = "localhost"
    smtp_port: int = 1025
    report_mail_from: str = "crowdfix@demo.local"
    report_mail_to: str = "facility-team@demo.local"
    # 보고서 메일의 '원문 보기' 링크 주소
    public_base_url: str = "http://localhost:5173"

    # 다국어 문장 임베딩 모델 (SRS 2.4, TBD-06). Dockerfile에서 이미지에 미리 받아 둔다.
    embedding_model: str = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
    embedding_dim: int = 384

    # 유사 의제 판정 기준 (TBD-06). AI 테스트 문장으로 정한 값이다. README 'AI 추천 기준' 참고.
    similar_min_text: int = 5          # 본문이 이보다 짧으면 검색하지 않는다
    # 본문에서 뽑은 대상(프린터·Wi-Fi 등)이 후보와 같을 때
    similar_same_target: float = 0.55      # 이 이상이면 '같음'
    similar_related_target: float = 0.40   # 이 이상이면 '관련 있음'
    # 대상을 알 수 없을 때는 문장 유사도만으로 판단하므로 더 높게 잡는다
    similar_same: float = 0.85
    similar_related: float = 0.80
    similar_max_candidates: int = 3


settings = Settings()
