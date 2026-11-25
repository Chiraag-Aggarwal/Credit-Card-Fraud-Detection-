FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1
WORKDIR /app
COPY requirements.txt ./
RUN python -m pip install --upgrade pip==26.2 \
    && python -m pip install --no-cache-dir -r requirements.txt
COPY . .
RUN useradd --create-home service
USER service
EXPOSE 5000
CMD ["sh", "-c", "python scripts/migrate_database.py && exec uvicorn app.main:app --host 0.0.0.0 --port 5000"]
