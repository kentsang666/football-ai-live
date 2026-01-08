"""
足球比赛预测服务 - 云端部署版本
支持 Railway / Heroku / Docker 等平台
"""

import asyncio
import json
import os
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import redis.asyncio as redis
import numpy as np

# 尝试导入 joblib（用于加载模型）
try:
    import joblib
    JOBLIB_AVAILABLE = True
except ImportError:
    JOBLIB_AVAILABLE = False
    print("⚠️ joblib 未安装，将使用简单算法")

# ===========================================
# 云端部署配置
# ===========================================

# 端口：优先使用环境变量 PORT
PORT = int(os.getenv("PORT", "8000"))

# Redis URL：支持多种环境变量名
REDIS_URL = (
    os.getenv("REDIS_URL") or 
    os.getenv("REDIS_PRIVATE_URL") or 
    os.getenv("REDISCLOUD_URL") or 
    "redis://localhost:6379"
)

# 数据库 URL
DATABASE_URL = (
    os.getenv("DATABASE_URL") or 
    os.getenv("DATABASE_PRIVATE_URL") or 
    "postgresql://football_user:football_pass@localhost:5432/football_db"
)

# 前端 URL（用于 CORS）
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173")

# 模型路径
MODEL_PATH = Path(__file__).parent.parent / "ml" / "model_v1.pkl"

# 环境
ENVIRONMENT = os.getenv("RAILWAY_ENVIRONMENT") or os.getenv("NODE_ENV") or "development"

# ===========================================
# 全局变量
# ===========================================

redis_client = None
ml_model = None
model_metadata = None

# 数据库连接
DB_ENABLED = os.getenv("DB_ENABLED", "false").lower() == "true"
database = None

if DB_ENABLED:
    try:
        from databases import Database
        database = Database(DATABASE_URL)
    except ImportError:
        print("⚠️ databases 库未安装，跳过数据库功能")
        DB_ENABLED = False


# ===========================================
# Redis 连接
# ===========================================

async def get_redis_client():
    """获取 Redis 客户端，支持云端 TLS 连接"""
    global redis_client
    
    if redis_client is not None:
        return redis_client
    
    # 解析 Redis URL，处理云端 TLS
    redis_kwargs = {
        "encoding": "utf-8",
        "decode_responses": True
    }
    
    # Railway Redis 使用 rediss:// 协议表示 TLS
    if REDIS_URL.startswith("rediss://"):
        redis_kwargs["ssl"] = True
        redis_kwargs["ssl_cert_reqs"] = None  # 跳过证书验证（Railway 需要）
    
    redis_client = redis.from_url(REDIS_URL, **redis_kwargs)
    return redis_client


# ===========================================
# 模型加载
# ===========================================

def load_ml_model() -> bool:
    """加载机器学习模型"""
    global ml_model, model_metadata
    
    if not JOBLIB_AVAILABLE:
        print("⚠️ joblib 不可用，跳过模型加载")
        return False
    
    if not MODEL_PATH.exists():
        print(f"⚠️ 模型文件不存在: {MODEL_PATH}")
        print("   请先运行训练脚本: python ml/train_model.py")
        return False
    
    try:
        print(f"📂 加载模型: {MODEL_PATH}")
        model_data = joblib.load(MODEL_PATH)
        
        ml_model = model_data['model']
        model_metadata = {
            'version': model_data.get('version', 'unknown'),
            'feature_columns': model_data.get('feature_columns', []),
            'classes': model_data.get('classes', ['home_win', 'draw', 'away_win'])
        }
        
        print(f"✅ 模型加载成功 (版本: {model_metadata['version']})")
        print(f"   特征列: {model_metadata['feature_columns']}")
        return True
        
    except Exception as e:
        print(f"❌ 模型加载失败: {e}")
        return False


# ===========================================
# 预测算法
# ===========================================

def calculate_probabilities_ml(match_data: dict) -> dict:
    """使用机器学习模型计算预测概率"""
    global ml_model
    
    home_goals = match_data.get('home_score', 0)
    away_goals = match_data.get('away_score', 0)
    minute = match_data.get('minute', 45)
    home_shots = match_data.get('home_shots_on_target', home_goals * 3 + minute // 15)
    away_shots = match_data.get('away_shots_on_target', away_goals * 3 + minute // 15)
    red_cards = match_data.get('red_cards', 0)
    
    features = np.array([[
        home_goals, away_goals, minute,
        home_shots, away_shots, red_cards
    ]])
    
    probabilities = ml_model.predict_proba(features)[0]
    
    return {
        "home": round(float(probabilities[0]), 4),
        "draw": round(float(probabilities[1]), 4),
        "away": round(float(probabilities[2]), 4)
    }


def calculate_probabilities_simple(match_data: dict) -> dict:
    """简单算法（回退方案）"""
    p_home, p_draw, p_away = 0.33, 0.34, 0.33
    
    home_score = match_data.get('home_score', 0)
    away_score = match_data.get('away_score', 0)
    minute = match_data.get('minute', 45)
    
    goal_diff = home_score - away_score
    
    if goal_diff > 0:
        p_home += 0.15 * min(goal_diff, 3)
        p_draw -= 0.08 * min(goal_diff, 3)
        p_away -= 0.07 * min(goal_diff, 3)
    elif goal_diff < 0:
        p_away += 0.15 * min(-goal_diff, 3)
        p_draw -= 0.08 * min(-goal_diff, 3)
        p_home -= 0.07 * min(-goal_diff, 3)
    
    time_factor = minute / 90
    if goal_diff != 0:
        leading_boost = 0.1 * time_factor
        if goal_diff > 0:
            p_home += leading_boost
            p_draw -= leading_boost * 0.5
            p_away -= leading_boost * 0.5
        else:
            p_away += leading_boost
            p_draw -= leading_boost * 0.5
            p_home -= leading_boost * 0.5
    
    total = p_home + p_draw + p_away
    return {
        "home": round(p_home / total, 4),
        "draw": round(p_draw / total, 4),
        "away": round(p_away / total, 4)
    }


def calculate_probabilities(match_data: dict) -> dict:
    """计算预测概率（自动选择算法）"""
    global ml_model
    
    if ml_model is not None:
        try:
            return calculate_probabilities_ml(match_data)
        except Exception as e:
            print(f"⚠️ ML 预测失败，回退到简单算法: {e}")
            return calculate_probabilities_simple(match_data)
    else:
        return calculate_probabilities_simple(match_data)


# ===========================================
# 业务逻辑
# ===========================================

async def process_match_event(event_data: dict):
    """处理比赛事件"""
    match_id = event_data.get('match_id')
    home_team = event_data.get('home_team', '主队')
    away_team = event_data.get('away_team', '客队')
    home_score = event_data.get('home_score', 0)
    away_score = event_data.get('away_score', 0)
    minute = event_data.get('minute', 0)
    
    print(f"⚡ [Event] {home_team} {home_score}-{away_score} {away_team} ({minute}')")

    probs = calculate_probabilities(event_data)
    algo = "ML" if ml_model is not None else "Simple"
    
    payload = {
        "match_id": match_id,
        "probabilities": probs,
        "algorithm": algo,
        "model_version": model_metadata.get('version', 'N/A') if model_metadata else 'N/A',
        "timestamp": datetime.utcnow().isoformat()
    }
    
    client = await get_redis_client()
    await client.publish("predictions", json.dumps(payload))
    print(f"🚀 [发布] 新赔率 ({algo}): 主胜 {probs['home']*100:.1f}% | 平 {probs['draw']*100:.1f}% | 客胜 {probs['away']*100:.1f}%")

    asyncio.create_task(save_to_db(match_id, probs, event_data))


async def save_to_db(match_id: str, probs: dict, event_data: dict = None):
    """异步保存到数据库"""
    if not DB_ENABLED or not database:
        print(f"💾 [DB] Saved prediction (模拟模式 - 跳过实际写入)")
        return
    
    query = """
        INSERT INTO predictions (match_id, home_win_prob, draw_prob, away_win_prob, model_version)
        VALUES (:match_id, :home, :draw, :away, :version)
    """
    try:
        version = model_metadata.get('version', 'v1.0') if model_metadata else 'simple'
        await database.execute(query=query, values={
            "match_id": match_id,
            "home": probs['home'],
            "draw": probs['draw'],
            "away": probs['away'],
            "version": version
        })
        print(f"💾 [DB] Saved prediction")
    except Exception as e:
        print(f"❌ DB Error: {e}")


async def listen_to_match_events():
    """监听 Redis 比赛事件频道"""
    try:
        client = await get_redis_client()
        pubsub = client.pubsub()
        await pubsub.subscribe("match_events")
        print("👂 Python AI: Listening on channel 'match_events'...")
        
        async for message in pubsub.listen():
            if message['type'] == 'message':
                try:
                    event_data = json.loads(message['data'])
                    await process_match_event(event_data)
                except json.JSONDecodeError as e:
                    print(f"❌ JSON 解析错误: {e}")
                except Exception as e:
                    print(f"❌ 处理事件错误: {e}")
    except Exception as e:
        print(f"❌ Redis 监听错误: {e}")
        # 重试连接
        await asyncio.sleep(5)
        asyncio.create_task(listen_to_match_events())


# ===========================================
# FastAPI 应用
# ===========================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期管理 - 最小化启动时间"""
    print("=" * 50)
    print("🚀 足球预测服务启动中...")
    print(f"🔧 环境: {ENVIRONMENT}")
    print(f"🌐 端口: {PORT}")
    print("=" * 50)
    print("✅ 服务已就绪 - 健康检查可用")
    
    # 后台初始化（不阻塞健康检查）
    async def background_init():
        await asyncio.sleep(3)  # 等待健康检查通过
        
        # 加载 ML 模型
        model_loaded = load_ml_model()
        if model_loaded:
            print("🤖 使用机器学习模型进行预测")
        else:
            print("📊 使用简单算法进行预测（回退模式）")
        
        # 连接数据库
        if DB_ENABLED and database:
            try:
                await database.connect()
                print("✅ Python AI: 数据库已连接")
            except Exception as e:
                print(f"⚠️ 数据库连接失败: {e}")
        
        # 启动 Redis 监听
        print(f"📡 连接 Redis: {REDIS_URL.split('@')[-1] if '@' in REDIS_URL else REDIS_URL}")
        asyncio.create_task(listen_to_match_events())
        print("=" * 50)
    
    asyncio.create_task(background_init())
    
    yield
    
    # 关闭时
    global redis_client
    if DB_ENABLED and database:
        await database.disconnect()
    if redis_client:
        await redis_client.close()
    print("👋 服务已关闭")


app = FastAPI(
    title="Football Prediction Service",
    description="实时足球比赛结果预测 API - 云端部署版本",
    version="2.0.0",
    lifespan=lifespan
)

# CORS 中间件
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        FRONTEND_URL,
        "http://localhost:5173",
        "http://localhost:3000",
        "https://*.vercel.app",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ===========================================
# API 端点
# ===========================================

class PredictionRequest(BaseModel):
    home_score: int = 0
    away_score: int = 0
    minute: int = 45
    home_shots_on_target: Optional[int] = None
    away_shots_on_target: Optional[int] = None
    red_cards: int = 0


class PredictionResponse(BaseModel):
    home: float
    draw: float
    away: float
    algorithm: str
    model_version: str


@app.get("/")
async def root():
    """服务状态"""
    return {
        "service": "Football Prediction Service",
        "version": "2.0.0",
        "environment": ENVIRONMENT,
        "model_loaded": ml_model is not None,
        "model_version": model_metadata.get('version') if model_metadata else None,
        "algorithm": "RandomForest" if ml_model else "Simple"
    }


@app.post("/predict", response_model=PredictionResponse)
async def predict(request: PredictionRequest):
    """手动预测接口"""
    match_data = request.model_dump()
    probs = calculate_probabilities(match_data)
    
    return PredictionResponse(
        home=probs['home'],
        draw=probs['draw'],
        away=probs['away'],
        algorithm="ML" if ml_model else "Simple",
        model_version=model_metadata.get('version', 'N/A') if model_metadata else 'N/A'
    )


@app.get("/health")
async def health():
    """健康检查"""
    return {
        "status": "healthy",
        "environment": ENVIRONMENT,
        "model_loaded": ml_model is not None,
        "algorithm": "RandomForest" if ml_model else "Simple"
    }


@app.get("/api/v1/health")
async def health_check_v1():
    """健康检查 (v1 兼容)"""
    return {
        "status": "healthy", 
        "service": "prediction-service", 
        "version": "v2.0",
        "model_loaded": ml_model is not None
    }


# ===========================================
# 启动入口（用于直接运行）
# ===========================================

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=PORT,
        reload=ENVIRONMENT == "development"
    )
