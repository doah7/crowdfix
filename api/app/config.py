from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql+psycopg://crowdfix:crowdfix@localhost:5432/crowdfix"
    jwt_secret: str = "change-me-demo-only"
    jwt_expire_minutes: int = 60 * 12
    buildings_csv: str = "../data/skku_natural_campus_buildings.csv"
    upload_dir: str = "./uploads"

    # 자동 전달 기준값 T (SRS BR-07). 시연 환경은 두 유형 모두 3명.
    threshold_issue: int = 3
    threshold_proposal: int = 3

    smtp_host: str = "localhost"
    smtp_port: int = 1025
    report_mail_from: str = "crowdfix@demo.local"
    report_mail_to: str = "facility-team@demo.local"

    # 임베딩 벡터 차원 (Increment 3에서 사용할 다국어 모델 기준)
    embedding_dim: int = 384


settings = Settings()
