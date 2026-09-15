FROM node:24-slim AS web
WORKDIR /web
ENV NEXT_TELEMETRY_DISABLED=1
COPY frontend/package*.json ./
RUN npm ci --no-audit --no-fund
COPY frontend ./
RUN npm run build

FROM python:3.12-slim
WORKDIR /app
COPY requirements.lock ./
RUN pip install --no-cache-dir -r requirements.lock && useradd --create-home parking
COPY parking ./parking
COPY migrations ./migrations
COPY scripts ./scripts
COPY --from=web /web/out ./frontend/out
USER parking
EXPOSE 8000
CMD ["uvicorn", "parking.app:app", "--host", "0.0.0.0", "--port", "8000"]
