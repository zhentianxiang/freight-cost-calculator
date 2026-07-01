# ── 阶段 1：构建 ──────────────────────────────────────────────────────────
FROM swr.cn-north-4.myhuaweicloud.com/ddn-k8s/docker.io/library/golang:1.25-alpine AS builder
RUN apk add --no-cache ca-certificates
WORKDIR /build

# 先复制 go.mod + go.sum 以利用 Docker 缓存
COPY go.mod go.sum ./
RUN go mod download

# 复制源码并编译
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o quote-service ./cmd/server

# ── 阶段 2：运行 ──────────────────────────────────────────────────────────
FROM swr.cn-north-4.myhuaweicloud.com/ddn-k8s/docker.io/library/alpine:3.21.3-linuxarm64
RUN apk add --no-cache ca-certificates tzdata
WORKDIR /app

# 只复制编译好的二进制，镜像体积极小
COPY --from=builder /build/quote-service .

EXPOSE 8080
ENTRYPOINT ["/app/quote-service"]
