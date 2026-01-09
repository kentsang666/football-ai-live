import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { createClient } from 'redis';
import cors from 'cors';
import 'dotenv/config';

// 导入真实数据服务
import { createFootballService, FootballService } from './services/footballService';
// 导入预测服务
import { predictionService, MatchData, Prediction } from './services/predictionService';
// 导入数据库服务
import { databaseService, PredictionSnapshot } from './services/databaseService';

// ===========================================
// 云端部署配置
// ===========================================

// 端口：优先使用环境变量 PORT（Railway/Heroku 等平台会自动设置）
const PORT = parseInt(process.env.PORT || '4000', 10);

// Redis URL：从环境变量读取
const REDIS_URL = process.env.REDIS_URL || process.env.REDIS_PRIVATE_URL || 'redis://localhost:6379';
console.log('🔧 Environment check:');
console.log('  - REDIS_URL:', process.env.REDIS_URL ? 'SET' : 'NOT SET');
console.log('  - DATABASE_URL:', process.env.DATABASE_URL ? 'SET' : 'NOT SET');
console.log('  - Using Redis URL:', REDIS_URL.replace(/\/\/.*@/, '//***@'));

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
const getRedisConfig = (): any => {
    // 云端 Redis 可能需要 TLS (rediss:// 协议)
    if (REDIS_URL.startsWith('rediss://')) {
        return {
            url: REDIS_URL,
            socket: {
                tls: true as const,
                rejectUnauthorized: false
            }
        };
    }
    return { url: REDIS_URL };
};

const redisPub = createClient(getRedisConfig());
const redisSub = createClient(getRedisConfig());

// Redis 错误处理
redisPub.on('error', (err) => console.error('Redis Pub Error:', err));
redisSub.on('error', (err) => console.error('Redis Sub Error:', err));

// 真实数据服务实例
let footballService: FootballService | null = null;

// 预测缓存
const predictionCache: Map<string, Prediction> = new Map();

// ===========================================
// 🟢 节流写入机制 - 防止数据库爆炸
// ===========================================

interface MatchSaveState {
    lastSaveTime: Date;
    lastScore: string;  // "home-away" 格式
    lastStatus: string;
    savedCount: number;
}

// 记录每场比赛的保存状态
const matchSaveStates: Map<string, MatchSaveState> = new Map();

// 节流配置
const SAVE_INTERVAL_MS = 5 * 60 * 1000; // 5分钟
const MIN_SAVE_INTERVAL_MS = 30 * 1000;  // 最小间隔30秒（用于重要事件）

/**
 * 检查是否应该保存预测快照
 * 
 * 规则：
 * A. 如果距离上次保存超过5分钟，则保存
 * B. 如果发生了进球或红牌（比分变化），立即保存
 * C. 如果比赛状态变为 FINISHED，执行最后一次保存
 */
function shouldSavePrediction(
    matchId: string,
    currentScore: string,
    currentStatus: string
): { shouldSave: boolean; reason: string } {
    const now = new Date();
    const state = matchSaveStates.get(matchId);
    
    // 新比赛，第一次保存
    if (!state) {
        return { shouldSave: true, reason: 'first_save' };
    }
    
    // 规则 C：比赛结束，最后一次保存
    if (currentStatus === 'finished' && state.lastStatus !== 'finished') {
        return { shouldSave: true, reason: 'match_finished' };
    }
    
    // 规则 B：比分变化（进球）
    if (currentScore !== state.lastScore) {
        const timeSinceLastSave = now.getTime() - state.lastSaveTime.getTime();
        // 确保至少间隔30秒，避免短时间内多次保存
        if (timeSinceLastSave >= MIN_SAVE_INTERVAL_MS) {
            return { shouldSave: true, reason: 'score_changed' };
        }
    }
    
    // 规则 A：超过5分钟
    const timeSinceLastSave = now.getTime() - state.lastSaveTime.getTime();
    if (timeSinceLastSave >= SAVE_INTERVAL_MS) {
        return { shouldSave: true, reason: 'interval_save' };
    }
    
    return { shouldSave: false, reason: 'throttled' };
}

/**
 * 保存预测快照到数据库
 */
async function savePredictionToDatabase(
    match: any,
    prediction: Prediction,
    reason: string
): Promise<void> {
    if (!databaseService.isAvailable()) {
        return;
    }
    
    const snapshot: PredictionSnapshot = {
        match_id: match.match_id,
        home_team: match.home_team,
        away_team: match.away_team,
        home_score: match.home_score,
        away_score: match.away_score,
        minute: match.minute,
        match_status: match.status || 'live',
        home_win_prob: prediction.probabilities.home,
        draw_prob: prediction.probabilities.draw,
        away_win_prob: prediction.probabilities.away,
        confidence: prediction.confidence,
        algorithm: prediction.algorithm,
        features_snapshot: {
            momentum: prediction.momentum || { home: 0, away: 0 },
            pressureAnalysis: prediction.pressureAnalysis || { homeNormalized: 50, awayNormalized: 50, dominantTeam: 'BALANCED' },
            expectedGoals: prediction.expectedGoals || { home: 0, away: 0 },
            asianHandicap: prediction.asianHandicap || [],
        },
    };
    
    const savedId = await databaseService.savePredictionSnapshot(snapshot);
    
    if (savedId !== null) {
        // 更新保存状态
        const currentScore = `${match.home_score}-${match.away_score}`;
        matchSaveStates.set(match.match_id, {
            lastSaveTime: new Date(),
            lastScore: currentScore,
            lastStatus: match.status || 'live',
            savedCount: (matchSaveStates.get(match.match_id)?.savedCount || 0) + 1,
        });
        
        console.log(`💾 [DB] 保存预测快照: ${match.home_team} vs ${match.away_team} (${reason})`);
        
        // 如果比赛结束，保存最终结果
        if (match.status === 'finished') {
            await databaseService.saveMatchResult(
                match.match_id,
                match.home_team,
                match.away_team,
                match.home_score,
                match.away_score,
                match.league
            );
        }
    }
}

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

        // 2. 监听 Python 发回来的预测结果（如果有外部预测服务）
        await redisSub.subscribe('predictions', (message) => {
            try {
                const data = JSON.parse(message);
                console.log(`🤖 [External AI Prediction] Home Win: ${(data.probabilities.home * 100).toFixed(1)}%`);
                io.emit('prediction_update', data);
            } catch (e) {
                console.error('Failed to parse prediction:', e);
            }
        });

        // 3. 启动 Web 服务 - 绑定到 0.0.0.0
        httpServer.listen(PORT, '0.0.0.0', () => {
            console.log(`🚀 Backend running on http://0.0.0.0:${PORT}`);
            console.log(`📡 数据模式: ${DATA_MODE.toUpperCase()}`);
            console.log(`🤖 AI 预测服务: QuantPredict-v${predictionService.getVersion()}`);
            console.log(`💾 数据库服务: ${databaseService.isAvailable() ? '已连接' : '未连接'}`);
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
    
    // 定期更新预测（每30秒）
    setInterval(() => {
        updateAllPredictions();
    }, 30000);
    
    // 定期清理已结束的比赛（每小时）
    setInterval(() => {
        footballService?.cleanupFinishedMatches();
        cleanupFinishedMatchStates();
    }, 3600000);
    
    // 定期清理旧数据库记录（每天）
    setInterval(() => {
        databaseService.cleanupOldData(30); // 保留30天
    }, 24 * 3600000);
}

/**
 * 清理已结束比赛的保存状态
 */
function cleanupFinishedMatchStates() {
    const now = new Date();
    const maxAge = 4 * 3600000; // 4小时
    
    for (const [matchId, state] of matchSaveStates.entries()) {
        const age = now.getTime() - state.lastSaveTime.getTime();
        if (age > maxAge || state.lastStatus === 'finished') {
            matchSaveStates.delete(matchId);
            console.log(`🧹 清理比赛保存状态: ${matchId}`);
        }
    }
}

// ===========================================
// 🟢 更新所有比赛的预测（带节流写入）
// ===========================================
async function updateAllPredictions() {
    if (!footballService) return;
    
    const matches = footballService.getLiveMatches();
    if (matches.length === 0) return;
    
    console.log(`\n🤖 [AI] 更新 ${matches.length} 场比赛的预测...`);
    
    for (const match of matches) {
        const matchData: MatchData = {
            match_id: match.match_id,
            home_team: match.home_team,
            away_team: match.away_team,
            home_score: match.home_score,
            away_score: match.away_score,
            minute: match.minute,
            status: match.status,
            league: match.league,
            // 统计数据通过 match 对象传递（如果有）
            stats: (match as any).stats,
        };
        
        const prediction = predictionService.calculatePrediction(matchData);
        predictionCache.set(match.match_id, prediction);
        
        // 🟢 节流写入数据库
        const currentScore = `${match.home_score}-${match.away_score}`;
        const { shouldSave, reason } = shouldSavePrediction(
            match.match_id,
            currentScore,
            match.status || 'live'
        );
        
        if (shouldSave) {
            await savePredictionToDatabase(match, prediction, reason);
        }
        
        // 广播预测更新
        io.emit('prediction_update', prediction);
    }
    
    console.log(`✅ [AI] 预测更新完成`);
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
        
        // 计算预测
        const matchData: MatchData = {
            match_id: matchState.match_id,
            home_team: 'Man City',
            away_team: 'Arsenal',
            home_score: matchState.home_score,
            away_score: matchState.away_score,
            minute: matchState.minute
        };
        const prediction = predictionService.calculatePrediction(matchData);
        predictionCache.set(matchState.match_id, prediction);
        
        // 🟢 节流写入数据库（模拟模式）
        const currentScore = `${matchState.home_score}-${matchState.away_score}`;
        const status = matchState.minute >= 90 ? 'finished' : 'live';
        const { shouldSave, reason } = shouldSavePrediction(
            matchState.match_id,
            currentScore,
            status
        );
        
        if (shouldSave) {
            await savePredictionToDatabase(
                {
                    match_id: matchState.match_id,
                    home_team: 'Man City',
                    away_team: 'Arsenal',
                    home_score: matchState.home_score,
                    away_score: matchState.away_score,
                    minute: matchState.minute,
                    status,
                    league: 'England - Premier League',
                },
                prediction,
                reason
            );
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
            io.emit('prediction_update', prediction);
            await redisPub.publish('match_events', JSON.stringify(eventPayload));
            console.log(`📤 [Event Sent] Type: ${eventType}`);
            console.log(`🤖 [AI Prediction] Home: ${(prediction.probabilities.home * 100).toFixed(1)}% | Draw: ${(prediction.probabilities.draw * 100).toFixed(1)}% | Away: ${(prediction.probabilities.away * 100).toFixed(1)}%`);
        }
    }, 2000);
}

// ===========================================
// API 端点
// ===========================================

app.get('/api/matches/live', (req, res) => {
    if (DATA_MODE === 'live' && footballService) {
        const matches = footballService.getLiveMatches();
        
        // 为每场比赛添加预测
        const matchesWithPredictions = matches.map((match: any) => {
            let prediction = predictionCache.get(match.match_id);
            
            // 如果没有缓存的预测，实时计算
            if (!prediction) {
                const matchData: MatchData = {
                    match_id: match.match_id,
                    home_team: match.home_team,
                    away_team: match.away_team,
                    home_score: match.home_score,
                    away_score: match.away_score,
                    minute: match.minute
                };
                prediction = predictionService.calculatePrediction(matchData);
                predictionCache.set(match.match_id, prediction);
            }
            
            return {
                ...match,
                prediction: {
                    ...prediction.probabilities,
                    momentum: prediction.momentum,
                    pressureAnalysis: prediction.pressureAnalysis,
                    confidence: prediction.confidence,
                    goalBettingTips: prediction.goalBettingTips,  // 🟢 新增：进球投注建议
                },
                prediction_confidence: prediction.confidence,
                prediction_algorithm: prediction.algorithm
            };
        });
        
        res.json({
            mode: 'live',
            matches: matchesWithPredictions
        });
    } else {
        // 模拟模式
        const matchData: MatchData = {
            match_id: matchState.match_id,
            home_team: 'Man City',
            away_team: 'Arsenal',
            home_score: matchState.home_score,
            away_score: matchState.away_score,
            minute: matchState.minute
        };
        const prediction = predictionService.calculatePrediction(matchData);
        
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
                timestamp: new Date().toISOString(),
                prediction: {
                    ...prediction.probabilities,
                    momentum: prediction.momentum,
                    pressureAnalysis: prediction.pressureAnalysis,
                    confidence: prediction.confidence,
                    goalBettingTips: prediction.goalBettingTips,  // 🟢 新增：进球投注建议
                },
                prediction_confidence: prediction.confidence,
                prediction_algorithm: prediction.algorithm
            }]
        });
    }
});

// 获取单场比赛的预测
app.get('/api/predictions/:matchId', (req, res) => {
    const { matchId } = req.params;
    
    let prediction = predictionCache.get(matchId);
    
    if (!prediction) {
        // 尝试从当前比赛数据计算
        if (DATA_MODE === 'live' && footballService) {
            const matches = footballService.getLiveMatches();
            const match = matches.find((m: any) => m.match_id === matchId);
            if (match) {
                const matchData: MatchData = {
                    match_id: match.match_id,
                    home_team: match.home_team,
                    away_team: match.away_team,
                    home_score: match.home_score,
                    away_score: match.away_score,
                    minute: match.minute
                };
                prediction = predictionService.calculatePrediction(matchData);
                predictionCache.set(matchId, prediction);
            }
        } else if (matchId === matchState.match_id) {
            const matchData: MatchData = {
                match_id: matchState.match_id,
                home_team: 'Man City',
                away_team: 'Arsenal',
                home_score: matchState.home_score,
                away_score: matchState.away_score,
                minute: matchState.minute
            };
            prediction = predictionService.calculatePrediction(matchData);
        }
    }
    
    if (prediction) {
        res.json(prediction);
    } else {
        res.status(404).json({ error: 'Match not found' });
    }
});

// 🟢 获取比赛历史预测记录（用于画趋势图）
app.get('/api/predictions/:matchId/history', async (req, res) => {
    const { matchId } = req.params;
    
    if (!databaseService.isAvailable()) {
        return res.status(503).json({ 
            error: 'Database service unavailable',
            message: '数据库服务未连接，无法获取历史记录'
        });
    }
    
    try {
        const history = await databaseService.getMatchHistory(matchId);
        
        if (history.length === 0) {
            return res.status(404).json({ 
                error: 'No history found',
                message: `未找到比赛 ${matchId} 的历史记录`
            });
        }
        
        // 格式化为前端友好的格式
        const formattedHistory = history.map(record => ({
            minute: record.minute,
            score: {
                home: record.home_score,
                away: record.away_score,
            },
            probabilities: {
                home: record.home_win_prob,
                draw: record.draw_prob,
                away: record.away_win_prob,
            },
            momentum: {
                home: record.momentum_home,
                away: record.momentum_away,
            },
            pressure: {
                home: record.pressure_home,
                away: record.pressure_away,
            },
            confidence: record.confidence,
            timestamp: record.created_at,
        }));
        
        res.json({
            match_id: matchId,
            total_records: history.length,
            history: formattedHistory,
        });
    } catch (error: any) {
        console.error('[API] 获取比赛历史失败:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 🟢 获取预测性能统计
app.get('/api/stats/performance', async (req, res) => {
    const limit = parseInt(req.query.limit as string) || 100;
    
    if (!databaseService.isAvailable()) {
        return res.status(503).json({ 
            error: 'Database service unavailable',
            message: '数据库服务未连接'
        });
    }
    
    try {
        const stats = await databaseService.getPerformanceStats(limit);
        res.json(stats);
    } catch (error: any) {
        console.error('[API] 获取性能统计失败:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 🟢 获取最近的预测记录（调试用）
app.get('/api/predictions/recent', async (req, res) => {
    const limit = parseInt(req.query.limit as string) || 20;
    
    if (!databaseService.isAvailable()) {
        return res.status(503).json({ 
            error: 'Database service unavailable',
            message: '数据库服务未连接'
        });
    }
    
    try {
        const predictions = await databaseService.getRecentPredictions(limit);
        res.json({
            total: predictions.length,
            predictions,
        });
    } catch (error: any) {
        console.error('[API] 获取最近预测失败:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 🟢 获取数据库统计信息
app.get('/api/stats/database', async (req, res) => {
    try {
        const stats = await databaseService.getDatabaseStats();
        res.json(stats);
    } catch (error: any) {
        console.error('[API] 获取数据库统计失败:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 批量获取预测
app.post('/api/predictions/batch', (req, res) => {
    const { matches } = req.body;
    
    if (!Array.isArray(matches)) {
        return res.status(400).json({ error: 'matches must be an array' });
    }
    
    const predictions = predictionService.calculatePredictions(matches);
    res.json({ predictions });
});

app.get('/health', async (req, res) => {
    const dbStats = await databaseService.getDatabaseStats();
    
    res.json({
        status: 'ok',
        mode: DATA_MODE,
        uptime: process.uptime(),
        environment: process.env.NODE_ENV || 'development',
        redis: redisPub.isReady ? 'connected' : 'disconnected',
        database: databaseService.isAvailable() ? 'connected' : 'disconnected',
        database_stats: dbStats,
        prediction_service: `QuantPredict-v${predictionService.getVersion()}`
    });
});

// 根路径
app.get('/', (req, res) => {
    res.json({
        service: 'Football Prediction Backend',
        version: '2.2.0',
        status: 'running',
        prediction_engine: `QuantPredict-v${predictionService.getVersion()}`,
        database: databaseService.isAvailable() ? 'connected' : 'disconnected',
        endpoints: {
            health: '/health',
            liveMatches: '/api/matches/live',
            prediction: '/api/predictions/:matchId',
            predictionHistory: '/api/predictions/:matchId/history',
            recentPredictions: '/api/predictions/recent',
            performanceStats: '/api/stats/performance',
            databaseStats: '/api/stats/database',
            batchPrediction: 'POST /api/predictions/batch',
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
    await databaseService.close();
    
    httpServer.close(() => {
        console.log('👋 服务已关闭');
        process.exit(0);
    });
});

// 启动服务器
startServer();
