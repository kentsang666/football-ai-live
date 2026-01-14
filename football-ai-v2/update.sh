#!/bin/bash

echo ">>> ♻️  开始系统更新流程..."

# 1. 获取最新代码
# 如果这是 Git 仓库，自动拉取
if [ -d ".git" ]; then
    echo ">>> ⬇️  正在从 Git 拉取最新代码..."
    git pull
    if [ $? -ne 0 ]; then
        echo "❌ Git 拉取失败，请检查网络或冲突。停止更新。"
        exit 1
    fi
else
    echo ">>> ℹ️  未检测到 Git 仓库，假设您已手动上传了新代码。"
fi

# 2. 平滑重启服务
echo ">>> 🔄 正在重建容器..."

# 判断使用 docker-compose 还是 docker compose
COMPOSE_CMD=""
if command -v docker-compose &> /dev/null; then
    COMPOSE_CMD="docker-compose"
else
    COMPOSE_CMD="docker compose"
fi

# 停止旧服务 (确保数据库连接安全释放)
$COMPOSE_CMD down

# 重新构建镜像 (确保 pip 依赖更新) 并后台运行
# --build: 强制重新构建镜像，以防 Dockerfile 或 requirements.txt 有变动
$COMPOSE_CMD up -d --build

# 3. 清理垃圾
echo ">>> 🧹 清理旧镜像以释放磁盘空间..."
docker image prune -f

# 4. 显示结果
echo ">>> ✅ 更新完成！当前运行状态："
$COMPOSE_CMD ps
echo ">>> 正在显示最新日志 (Ctrl+C 退出)..."
$COMPOSE_CMD logs -f --tail=20