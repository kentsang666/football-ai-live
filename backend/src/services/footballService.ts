import axios, { AxiosInstance } from 'axios';
import { createClient, RedisClientType } from 'redis';
import { Server } from 'socket.io';

// ===========================================
// 类型定义
// ===========================================

// 我们系统内部使用的简化比赛数据格式
export interface MatchData {
    match_id: string;
    home_team: string;
    away_team: string;
    home_score: number;
    away_score: number;
    minute: number;
    status: 'live' | 'halftime' | 'finished' | 'not_started';
    league: string;
    timestamp: string;
}

// 比赛事件（用于发送给 AI 和前端）
export interface MatchEvent {
    match_id: string;
    type: 'goal' | 'score_update' | 'status_change';
    home_team: string;
    away_team: string;
    home_score: number;
    away_score: number;
    minute: number;
    timestamp: string;
}

// API-Football 返回的原始数据结构（简化版）
interface APIFootballFixture {
    fixture: {
        id: number;
        status: {
            short: string;  // '1H', '2H', 'HT', 'FT', 'NS', etc.
            elapsed: number | null;
        };
    };
    league: {
        name: string;
        country: string;
    };
    teams: {
        home: { id: number; name: string; };
        away: { id: number; name: string; };
    };
    goals: {
        home: number | null;
        away: number | null;
    };
}

interface APIFootballResponse {
    response: APIFootballFixture[];
}

// ===========================================
// FootballService 类
// ===========================================

export class FootballService {
    private apiClient: AxiosInstance;
    private redisPub: RedisClientType;
    private io: Server;
    private pollInterval: number;
    private isPolling: boolean = false;
    private pollTimer: NodeJS.Timeout | null = null;
    
    // 缓存上一次的比赛状态，用于差异检测
    private matchCache: Map<string, MatchData> = new Map();

    constructor(
        apiKey: string,
        apiUrl: string,
        redisPub: RedisClientType,
        io: Server,
        pollInterval: number = 15
    ) {
        // 初始化 API 客户端
        this.apiClient = axios.create({
            baseURL: apiUrl,
            headers: {
                'x-rapidapi-key': apiKey,
                'x-rapidapi-host': 'v3.football.api-sports.io'
            },
            timeout: 10000
        });

        this.redisPub = redisPub;
        this.io = io;
        this.pollInterval = pollInterval * 1000; // 转换为毫秒
    }

    // ===========================================
    // 核心方法：启动轮询
    // ===========================================
    
    public startPolling(): void {
        if (this.isPolling) {
            console.log('⚠️ 轮询已在运行中');
            return;
        }

        this.isPolling = true;
        console.log(`🔄 开始轮询真实比赛数据 (间隔: ${this.pollInterval / 1000}秒)`);
        
        // 立即执行一次
        this.fetchAndProcessLiveMatches();
        
        // 设置定时轮询
        this.pollTimer = setInterval(() => {
            this.fetchAndProcessLiveMatches();
        }, this.pollInterval);
    }

    public stopPolling(): void {
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
        }
        this.isPolling = false;
        console.log('⏹️ 已停止轮询');
    }

    // ===========================================
    // 获取并处理实时比赛数据
    // ===========================================

    private async fetchAndProcessLiveMatches(): Promise<void> {
        try {
            console.log('📡 正在获取实时比赛数据...');
            
            const response = await this.apiClient.get<APIFootballResponse>('/fixtures', {
                params: { live: 'all' }
            });

            const fixtures = response.data.response;
            console.log(`📊 获取到 ${fixtures.length} 场正在进行的比赛`);

            // 处理每场比赛
            for (const fixture of fixtures) {
                await this.processFixture(fixture);
            }

        } catch (error) {
            if (axios.isAxiosError(error)) {
                console.error('❌ API 请求失败:', error.response?.status, error.message);
                
                // 如果是 429 (Too Many Requests)，增加等待时间
                if (error.response?.status === 429) {
                    console.warn('⚠️ API 请求频率过高，请检查 POLL_INTERVAL 设置');
                }
            } else {
                console.error('❌ 未知错误:', error);
            }
        }
    }

    // ===========================================
    // 处理单场比赛数据
    // ===========================================

    private async processFixture(fixture: APIFootballFixture): Promise<void> {
        // 1. 转换为我们的内部格式
        const matchData = this.mapExternalData(fixture);
        
        // 2. 差异检测：检查是否有变化
        const cachedMatch = this.matchCache.get(matchData.match_id);
        const hasChanged = this.detectChanges(cachedMatch, matchData);

        if (!hasChanged) {
            return; // 没有变化，跳过
        }

        // 3. 更新缓存
        this.matchCache.set(matchData.match_id, matchData);

        // 4. 构建事件
        const event = this.buildMatchEvent(cachedMatch, matchData);

        // 5. 发送事件
        await this.emitEvent(event);
    }

    // ===========================================
    // 关键函数：数据映射 (API 格式 -> 内部格式)
    // ===========================================

    private mapExternalData(fixture: APIFootballFixture): MatchData {
        // 状态映射
        const statusMap: Record<string, MatchData['status']> = {
            '1H': 'live',      // 上半场
            '2H': 'live',      // 下半场
            'HT': 'halftime',  // 中场休息
            'FT': 'finished',  // 比赛结束
            'AET': 'finished', // 加时赛后结束
            'PEN': 'finished', // 点球大战后结束
            'NS': 'not_started', // 未开始
            'TBD': 'not_started',
            'PST': 'not_started', // 推迟
            'CANC': 'finished',   // 取消
            'ABD': 'finished',    // 中止
            'AWD': 'finished',    // 判定胜
            'WO': 'finished',     // 弃权
            'LIVE': 'live',       // 进行中
            'ET': 'live',         // 加时赛
            'BT': 'halftime',     // 加时赛中场
            'P': 'live',          // 点球大战
            'SUSP': 'halftime',   // 暂停
            'INT': 'halftime',    // 中断
        };

        return {
            match_id: `api-${fixture.fixture.id}`,
            home_team: fixture.teams.home.name,
            away_team: fixture.teams.away.name,
            home_score: fixture.goals.home ?? 0,
            away_score: fixture.goals.away ?? 0,
            minute: fixture.fixture.status.elapsed ?? 0,
            status: statusMap[fixture.fixture.status.short] || 'live',
            league: `${fixture.league.country} - ${fixture.league.name}`,
            timestamp: new Date().toISOString()
        };
    }

    // ===========================================
    // 差异检测：只有变化时才触发事件
    // ===========================================

    private detectChanges(cached: MatchData | undefined, current: MatchData): boolean {
        // 新比赛，一定要处理
        if (!cached) {
            return true;
        }

        // 检查关键字段是否变化
        return (
            cached.home_score !== current.home_score ||
            cached.away_score !== current.away_score ||
            cached.status !== current.status ||
            cached.minute !== current.minute
        );
    }

    // ===========================================
    // 构建比赛事件
    // ===========================================

    private buildMatchEvent(cached: MatchData | undefined, current: MatchData): MatchEvent {
        let eventType: MatchEvent['type'] = 'score_update';

        // 判断事件类型
        if (cached) {
            if (cached.home_score !== current.home_score || 
                cached.away_score !== current.away_score) {
                eventType = 'goal';
            } else if (cached.status !== current.status) {
                eventType = 'status_change';
            }
        }

        return {
            match_id: current.match_id,
            type: eventType,
            home_team: current.home_team,
            away_team: current.away_team,
            home_score: current.home_score,
            away_score: current.away_score,
            minute: current.minute,
            timestamp: current.timestamp
        };
    }

    // ===========================================
    // 发送事件到前端和 AI
    // ===========================================

    private async emitEvent(event: MatchEvent): Promise<void> {
        const logPrefix = event.type === 'goal' ? '⚽ GOAL!' : '📊';
        console.log(`${logPrefix} [${event.home_team} ${event.home_score}-${event.away_score} ${event.away_team}] (${event.minute}')`);

        // 步骤 A: 立即推送到前端 (零延迟)
        this.io.emit('score_update', event);

        // 步骤 B: 发送给 Python AI (异步)
        await this.redisPub.publish('match_events', JSON.stringify(event));
        console.log(`📤 [Event Sent] Type: ${event.type} -> Sent to AI`);
    }

    // ===========================================
    // 获取当前缓存的所有比赛
    // ===========================================

    public getLiveMatches(): MatchData[] {
        return Array.from(this.matchCache.values())
            .filter(m => m.status === 'live' || m.status === 'halftime');
    }

    // ===========================================
    // 清理缓存中已结束的比赛
    // ===========================================

    public cleanupFinishedMatches(): void {
        const now = Date.now();
        for (const [matchId, match] of this.matchCache.entries()) {
            if (match.status === 'finished') {
                const matchTime = new Date(match.timestamp).getTime();
                // 比赛结束 1 小时后清理
                if (now - matchTime > 3600000) {
                    this.matchCache.delete(matchId);
                }
            }
        }
    }
}

// ===========================================
// 工厂函数：创建服务实例
// ===========================================

export function createFootballService(
    redisPub: RedisClientType,
    io: Server
): FootballService {
    const apiKey = process.env.API_FOOTBALL_KEY || '';
    const apiUrl = process.env.API_FOOTBALL_URL || 'https://v3.football.api-sports.io';
    const pollInterval = parseInt(process.env.POLL_INTERVAL || '15', 10);

    if (!apiKey || apiKey === 'your_api_key_here') {
        console.warn('⚠️ API_FOOTBALL_KEY 未配置，请在 .env 文件中设置');
    }

    return new FootballService(apiKey, apiUrl, redisPub, io, pollInterval);
}
