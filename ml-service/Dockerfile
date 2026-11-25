FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    OMP_NUM_THREADS=1 \
    OPENBLAS_NUM_THREADS=1
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 \
    && rm -rf /var/lib/apt/lists/*
COPY requirements.txt ./
RUN python -m pip install --upgrade pip==26.2 \
    && python -m pip install --no-cache-dir -r requirements.txt
COPY app ./app
COPY artifacts/model.joblib artifacts/threshold.json artifacts/metrics.json ./artifacts/
RUN useradd --create-home service
USER service
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
