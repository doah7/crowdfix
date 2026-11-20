FROM python:3.12-slim

WORKDIR /srv
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    HF_HOME=/models \
    EMBEDDING_MODEL=sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2

# CPU 전용 PyTorch (GPU용보다 이미지가 훨씬 작다)
RUN pip install --no-cache-dir torch==2.5.1 --index-url https://download.pytorch.org/whl/cpu

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 다국어 임베딩 모델을 이미지에 미리 받아 둔다. 실행 중에는 인터넷이 없어도 된다.
RUN python -c "import os; from sentence_transformers import SentenceTransformer; SentenceTransformer(os.environ['EMBEDDING_MODEL'])"

COPY app ./app

# 처음 띄울 때 DB가 비어 있으면 시연 데이터를 넣고 서버를 시작한다.
CMD ["sh", "-c", "python -m app.seed --if-empty && uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload --reload-dir app"]
