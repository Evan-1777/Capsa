# 阶段一：构建前端静态产物（最终镜像不保留 Node 运行时）
FROM node:20-alpine AS web-builder
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
# 产物目录与本阶段的拷贝源必须一致：Vite 只在 outDir 位于项目根内时自建目录，
# /build 越出 web/，因此先显式创建。
ENV CAPSA_STATIC_DIR=/build/static
RUN mkdir -p $CAPSA_STATIC_DIR && npm run build

# 阶段二：Python 运行时
FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    CAPSA_DB_PATH=/data/capsa.db

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

RUN useradd -m -u 1000 -s /bin/bash capsa \
    && mkdir -p /data /backup /app/capsa/static \
    && chown -R capsa:capsa /app /data /backup

COPY --chown=capsa:capsa pyproject.toml ./
COPY --chown=capsa:capsa capsa/ capsa/
COPY --from=web-builder --chown=capsa:capsa /build/static/ capsa/static/

RUN pip install --no-cache-dir .

USER capsa
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:8000/healthz || exit 1

CMD ["uvicorn", "capsa.server:app", "--host", "0.0.0.0", "--port", "8000"]
