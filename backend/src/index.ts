import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { createClient } from 'redis';
import cors from 'cors';
import 'dotenv/config';

// 导入真实数据服务
import { createFootballService, FootballService } from './services/footballService';

// ===========================================
// 云端部署配置
// ===========================================

// 端口：优先使用环境变量 PORT（Railway/Heroku 等平台会自动设置）
const PORT = parseInt(process.env.PORT || '4000', 10);

// Redis URL：从环境变量读取
const REDIS_URL = process.env.REDIS_URL || process.env.REDIS_PRIVATE_URL || 'redis://localhost:6379';

// 数据模式
const DATA_MODE = process.env.DATA_MODE || 'mock';

// CORS 配置：从环境变量读取前端 URL
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const ALLOWED_ORIGINS = [
    FRONTEND_URL,
    'http://localhost:5173',
    'http://localhost:3000',
    // Vercel 预览 URL 模式
    /\.vercel\.app$/,
    // 允许所有 https 来源（生产环境可以更严格）
    ...(process.env.NODE_ENV === 'production' ? [] : ['*'])
].filter(Boolean);

// ===========================================
// 初始化服务
// ===========================================

const app = express();

// CORS 中间件配置
app.use(cors({
    origin: (origin, callback) => {
        // 允许无 origin 的请求（如移动端或 Postman）
        if (!origin) return callback(null, true);
        
        // 检查是否在允许列表中
        const isAllowed = ALLOWED_ORIGINS.some(allowed => {
            if (typeof allowed === 'string') {
                return allowed === '*' || allowed === origin;
            }
            if (allowed instanceof RegExp) {
                return allowed.test(origin);
            }
            return false;
        });
        
        if (isAllowed) {
            callback(null, true);
        } else {
            console.warn(`⚠️ CORS blocked origin: ${origin}`);
            callback(null, true); // 暂时允许所有，生产环境可改为 callback(new Error('Not allowed'))
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

const httpServer = createServer(app);

// Socket.IO 配置
const io = new Server(httpServer, {
    cors: {
        origin: (origin, callback) => {
            // 与 Express CORS 保持一致
            callback(null, true);
        },
        credentials: true,
        methods: ['GET', 'POST']
    },
    // 云端部署优化
    transports: ['websocket', 'polling'],
    pingTimeout: 60000,
    pingInterval: 25000
});

// Redis 客户端配置
const getRedisConfig = () => {
    const config: { url: string; socket?: { tls: boolean; rejectUnauthorized: boolean } } = {
        url: REDIS_URL
    };
    
    // 云端 Redis 可能需要 TLS (rediss:// 协议)
    if (REDIS_URL.startsWith('rediss://')) {
        config.socket = {
            tls: true,
            rejectUnauthorized: false
        };
    }
    
    return config;
};

const redisPub = createClient(getRedisConfig());
const redisSub = createClient(getRedisConfig());

// Redis 错误处理
redisPub.on('error', (err) => console.error('Redis Pub Error:', err));
redisSub.on('error', (err) => console.error('Redis Sub Error:', err));

// 真实数据服务实例
let footballService: FootballService | null = null;

// --- 模拟比赛状态 (仅在 mock 模式下使用) ---
let matchState = {
    match_id: "test-match-001",
    home_score: 0,
    away_score: 0,
    minute: 0,
    is_live: true
};

// ===========================================
// 启动服务器
// ===========================================

async function startServer() {
    try {
        // 1. 连接 Redis
        await redisPub.connect();
        await redisSub.connect();
        console.log("✅ Node.js: 已连接到 Redis");
        console.log(`   Redis URL: ${REDIS_URL.replace(/\/\/.*@/, '//***@')}`); // 隐藏密码

        // 2. 监听 Python 发回来的预测结果
        await redisSub.subscribe('predictions', (message) => {
            try {
                const data = JSON.parse(message);
                console.log(`🤖 [AI Prediction Recv] Home Win: ${(data.probabilities.home * 100).toFixed(1)}%`);
                io.emit('prediction_update', data);
            } catch (e) {
                console.error('Failed to parse prediction:', e);
            }
        });

        // 3. 启动 Web 服务 - 绑定到 0.0.0.0
        httpServer.listen(PORT, '0.0.0.0', () => {
            console.log(`🚀 Backend running on http://0.0.0.0:${PORT}`);
            console.log(`📡 数据模式: ${DATA_MODE.toUpperCase()}`);
            console.log(`🌐 CORS 允许来源: ${FRONTEND_URL}`);
            console.log(`🔧 环境: ${process.env.NODE_ENV || 'development'}`);
            
            if (DATA_MODE === 'live') {
                startLiveDataService();
            } else {
                startMatchSimulation();
            }
        });

    } catch (error) {
        console.error('❌ 启动失败:', error);
        process.exit(1);
    }
}

// ===========================================
// 真实数据模式：接入 API-Football
// ===========================================
function startLiveDataService() {
    console.log("🌐 启动真实数据服务 (API-Football)");
    
    footballService = createFootballService(redisPub as any, io);
    footballService.startPolling();
    
    setInterval(() => {
        footballService?.cleanupFinishedMatches();
    }, 3600000);
}

// ===========================================
// 模拟数据模式
// ===========================================
function startMatchSimulation() {
    console.log("⚽ 模拟比赛开始：曼城 vs 阿森纳");
    
    setInterval(async () => {
        if (!matchState.is_live || matchState.minute >= 90) return;
        
        matchState.minute += 1;
        
        const rand = Math.random();
        let eventType: string | null = null;
        
        if (rand < 0.02) {
            matchState.home_score++;
            eventType = 'goal';
            console.log(`\n⚽ GOAL! Man City Scores! [${matchState.home_score}-${matchState.away_score}]`);
        } else if (rand > 0.98) {
            matchState.away_score++;
            eventType = 'goal';
            console.log(`\n⚽ GOAL! Arsenal Scores! [${matchState.home_score}-${matchState.away_score}]`);
        } else if (rand < 0.1) {
            eventType = 'shot_on_target';
        }
        
        if (eventType) {
            const eventPayload = {
                match_id: matchState.match_id,
                type: eventType,
                home_team: 'Man City',
                away_team: 'Arsenal',
                home_score: matchState.home_score,
                away_score: matchState.away_score,
                minute: matchState.minute,
                timestamp: new Date().toISOString()
            };
            
            io.emit('score_update', eventPayload);
            await redisPub.publish('match_events', JSON.stringify(eventPayload));
            console.log(`📤 [Event Sent] Type: ${eventType} -> Sent to AI`);
        }
    }, 2000);
}

// ===========================================
// API 端点
// ===========================================

app.get('/api/matches/live', (req, res) => {
    if (DATA_MODE === 'live' && footballService) {
        res.json({
            mode: 'live',
            matches: footballService.getLiveMatches()
        });
    } else {
        res.json({
            mode: 'mock',
            matches: [{
                match_id: matchState.match_id,
                home_team: 'Man City',
                away_team: 'Arsenal',
                home_score: matchState.home_score,
                away_score: matchState.away_score,
                minute: matchState.minute,
                status: matchState.is_live ? 'live' : 'finished',
                league: 'England - Premier League',
                timestamp: new Date().toISOString()
            }]
        });
    }
});

app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        mode: DATA_MODE,
        uptime: process.uptime(),
        environment: process.env.NODE_ENV || 'development',
        redis: redisPub.isReady ? 'connected' : 'disconnected'
    });
});

// 根路径
app.get('/', (req, res) => {
    res.json({
        service: 'Football Prediction Backend',
        version: '2.0.0',
        status: 'running',
        endpoints: {
            health: '/health',
            liveMatches: '/api/matches/live',
            websocket: 'ws://[host]/socket.io'
        }
    });
});

// ===========================================
// 优雅关闭
// ===========================================

process.on('SIGTERM', async () => {
    console.log('🛑 收到 SIGTERM 信号，正在优雅关闭...');
    
    footballService?.stopPolling();
    
    await redisPub.quit();
    await redisSub.quit();
    
    httpServer.close(() => {
        console.log('👋 服务已关闭');
        process.exit(0);
    });
});

// 启动服务器
startServer();
