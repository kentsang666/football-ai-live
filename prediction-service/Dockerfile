FROM python:3.10-slim

WORKDIR /app

# 安装依赖
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 复制应用代码
COPY . .

# 添加 joblib 用于模型加载
RUN pip install --no-cache-dir joblib

# 使用环境变量 PORT (Railway 会自动设置)
ENV PORT=8000

# 启动命令 - 不使用 --reload 在生产环境
CMD uvicorn app.main:app --host 0.0.0.0 --port $PORT
