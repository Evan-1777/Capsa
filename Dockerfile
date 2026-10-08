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

# 阶段二：编译单一静态二进制（无 CGO，无外部运行时）
FROM golang:1.27-alpine AS builder
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd/ cmd/
COPY internal/ internal/
# embed 目录由前端构建阶段注入，编译期必须非空。
COPY --from=web-builder /build/static/ internal/server/static/
RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o /capsa ./cmd/capsa

# 阶段三：Alpine 极简运行时
FROM alpine:latest
ENV CAPSA_DB_PATH=/data/capsa.db

# curl 供 HEALTHCHECK 探活；非 root 用户持有数据与备份目录。
RUN apk add --no-cache curl \
    && adduser -D -u 1000 -s /sbin/nologin capsa \
    && mkdir -p /data /backup \
    && chown -R capsa:capsa /data /backup

COPY --from=builder /capsa /usr/local/bin/capsa

USER capsa
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:8000/healthz || exit 1

CMD ["capsa", "serve", "--host", "0.0.0.0", "--port", "8000"]
