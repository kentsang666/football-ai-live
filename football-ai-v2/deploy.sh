#!/bin/bash

# 部署脚本 automated deployment script

echo ">>> 开始部署 Football AI System..."

# 1. 检查 Docker 环境
if ! command -v docker &> /dev/null
then
    echo "❌ 错误: 未检测到 Docker。请先在服务器上安装 Docker。"
    echo "   Ubuntu/Debian: curl -fsSL https://get.docker.com | bash"
    exit 1
fi

if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null
then
    echo "⚠️  警告: 未检测到 docker-compose。将尝试使用 'docker compose'..."
fi

# 2. 构建并启动容器
echo ">>> 正在构建 Docker 镜像并启动服务..."
if command -v docker-compose &> /dev/null; then
    docker-compose up -d --build
else
    docker compose up -d --build
fi

# 3. 检查状态
if [ $? -eq 0 ]; then
    echo "✅ 部署成功！服务正在运行于端口 8000"
    echo ">>> 显示最近 20 行日志 (按 Ctrl+C 退出日志查看)..."
    if command -v docker-compose &> /dev/null; then
        docker-compose logs -f --tail=20
    else
        docker compose logs -f --tail=20
    fi
else
    echo "❌ 部署失败，请检查上方错误信息。"
fi
