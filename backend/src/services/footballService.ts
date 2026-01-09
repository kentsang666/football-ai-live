import axios, { AxiosInstance } from 'axios';
// Redis 类型在运行时动态处理
import { Server } from 'socket.io';
import { getTeamChineseName } from '../data/teamNames';

// ===========================================
// 类型定义
// ===========================================

// 我们系统内部使用的简化比赛数据格式
// 🟢 实时滚球赔率数据 (Live/In-Play Odds)
export interface LiveOdds {
    // 胜平负赔率 (1x2)
    matchWinner?: {
        home: number;
        draw: number;
        away: number;
        bookmaker: string;
        updateTime: string;
        suspended?: boolean;  // 是否暂停接受投注
    };
    // 大小球赔率 (Over/Under) - 滚球盘口
    overUnder?: {
        line: number;      // 盘口线: 0.5, 1.5, 2.5, 2.75, 3, 3.5...
        over: number;      // 大球赔率
        under: number;     // 小球赔率
        main?: boolean;    // 是否主盘
        suspended?: boolean;
    }[];
    // 亚洲盘口 (Asian Handicap) - 滚球盘口
    asianHandicap?: {
        line: string;      // 盘口线: "-0.5", "+0.5", "-1", "-1.25"...
        home: number;      // 主队赔率
        away: number;      // 客队赔率
        main?: boolean;    // 是否主盘
        suspended?: boolean;
    }[];
    // 🟢 原始赛前盘口 (Pre-match Odds) - 基于 0-0 开球
    preMatchAsianHandicap?: {
        line: string;      // 原始盘口线: "-0.5", "+0.5", "-1"...
        home: number;      // 主队赔率
        away: number;      // 客队赔率
    };
    preMatchOverUnder?: {
        line: number;      // 原始大小球盘口线
        over: number;      // 大球赔率
        under: number;     // 小球赔率
    };
    bookmaker?: string;
    updateTime?: string;
    // 比赛状态
    status?: {
        elapsed: number;   // 已进行分钟数
        seconds: string;   // 精确时间 "43:13"
    };
}

export interface MatchData {
    match_id: string;
    home_team: string;
    away_team: string;
    home_score: number;
    away_score: number;
    minute: number;
    status: 'live' | 'halftime' | 'finished' | 'not_started';
    league: string;
    league_id: number;  // 新增：联赛ID用于过滤
    timestamp: string;
    liveOdds?: LiveOdds;  // 🟢 新增：实时赔率数据
    // 🟢 新增：红牌数据
    home_red_cards?: number | undefined;
    away_red_cards?: number | undefined;
    // 🟢 新增：比赛统计数据（用于 AI 分析）
    home_shots_on_target?: number | undefined;
    away_shots_on_target?: number | undefined;
    home_shots_off_target?: number | undefined;
    away_shots_off_target?: number | undefined;
    home_corners?: number | undefined;
    away_corners?: number | undefined;
    home_possession?: number | undefined;
    away_possession?: number | undefined;
    home_dangerous_attacks?: number | undefined;
    away_dangerous_attacks?: number | undefined;
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
        id: number;     // 联赛ID
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
    // 🟢 新增：红牌数据
    statistics?: Array<{
        team: { id: number; name: string; };
        statistics: Array<{
            type: string;
            value: number | string | null;
        }>;
    }>;
    // 🟢 新增：比赛事件（包含红牌）
    events?: Array<{
        time: { elapsed: number; extra: number | null };
        team: { id: number; name: string; };
        player: { id: number; name: string; };
        type: string;  // 'Card', 'Goal', 'subst', etc.
        detail: string;  // 'Red Card', 'Yellow Card', 'Normal Goal', etc.
    }>;
}

interface APIFootballResponse {
    response: APIFootballFixture[];
}

// ===========================================
// 联赛名称映射表（用于日志和前端显示）
// ===========================================

// 联赛信息接口
interface LeagueInfo {
    name: string;      // 中文名称（用于前端显示）
    fullName: string;  // 完整名称（带emoji，用于日志）
    country: string;   // 国家/地区中文名
}

const LEAGUE_INFO: Record<number, LeagueInfo> = {
    // 五大联赛
    39: { name: '英超', fullName: '🏴󠁧󠁢󠁥󠁮󠁧󠁿 英超 (Premier League)', country: '英格兰' },
    140: { name: '西甲', fullName: '🇪🇸 西甲 (La Liga)', country: '西班牙' },
    135: { name: '意甲', fullName: '🇮🇹 意甲 (Serie A)', country: '意大利' },
    78: { name: '德甲', fullName: '🇩🇪 德甲 (Bundesliga)', country: '德国' },
    61: { name: '法甲', fullName: '🇫🇷 法甲 (Ligue 1)', country: '法国' },
    
    // 欧洲赛事
    2: { name: '欧冠', fullName: '🏆 欧冠 (UEFA Champions League)', country: '欧洲' },
    3: { name: '欧联杯', fullName: '🏆 欧联杯 (UEFA Europa League)', country: '欧洲' },
    5: { name: '欧洲国联', fullName: '🏆 欧洲国联 (UEFA Nations League)', country: '欧洲' },
    4: { name: '欧洲杯', fullName: '🏆 欧洲杯 (Euro Championship)', country: '欧洲' },
    848: { name: '欧会杯', fullName: '🏆 欧会杯 (Conference League)', country: '欧洲' },
    45: { name: '英足总杯', fullName: '🏆 英足总杯 (FA Cup)', country: '英格兰' },
    
    // 其他欧洲联赛
    88: { name: '荷甲', fullName: '🇳🇱 荷甲 (Eredivisie)', country: '荷兰' },
    94: { name: '葡超', fullName: '🇵🇹 葡超 (Primeira Liga)', country: '葡萄牙' },
    203: { name: '土超', fullName: '🇹🇷 土超 (Süper Lig)', country: '土耳其' },
    144: { name: '比甲', fullName: '🇧🇪 比甲 (Pro League)', country: '比利时' },
    179: { name: '苏超', fullName: '🏴󠁧󠁢󠁳󠁣󠁴󠁿 苏超 (Premiership)', country: '苏格兰' },
    235: { name: '俄超', fullName: '🇷🇺 俄超 (Premier League)', country: '俄罗斯' },
    197: { name: '希腔超', fullName: '🇬🇷 希腔超 (Super League 1)', country: '希腊' },
    207: { name: '瑞士超', fullName: '🇨🇭 瑞士超 (Super League)', country: '瑞士' },
    218: { name: '奥甲', fullName: '🇦🇹 奥甲 (Bundesliga)', country: '奥地利' },
    383: { name: '以超', fullName: '🇮🇱 以超 (Ligat Ha\'al)', country: '以色列' },
    
    // 欧洲乙级联赛
    40: { name: '英冠', fullName: '🏴󠁧󠁢󠁥󠁮󠁧󠁿 英冠 (Championship)', country: '英格兰' },
    79: { name: '德乙', fullName: '🇩🇪 德乙 (2. Bundesliga)', country: '德国' },
    141: { name: '西乙', fullName: '🇪🇸 西乙 (Segunda División)', country: '西班牙' },
    136: { name: '意乙', fullName: '🇮🇹 意乙 (Serie B)', country: '意大利' },
    62: { name: '法乙', fullName: '🇫🇷 法乙 (Ligue 2)', country: '法国' },
    
    // 美洲联赛
    71: { name: '巴甲', fullName: '🇧🇷 巴甲 (Brasileirão Serie A)', country: '巴西' },
    253: { name: '美职联', fullName: '🇺🇸 美职联 (MLS)', country: '美国' },
    128: { name: '阿甲', fullName: '🇦🇷 阿甲 (Liga Profesional)', country: '阿根廷' },
    239: { name: '哥伦比亚甲', fullName: '🇨🇴 哥伦比亚甲 (Primera A)', country: '哥伦比亚' },
    265: { name: '智利甲', fullName: '🇨🇱 智利甲 (Primera División)', country: '智利' },
    
    // 亚洲/中东/大洋洲联赛
    169: { name: '中超', fullName: '🇨🇳 中超 (Chinese Super League)', country: '中国' },
    98: { name: '日职联', fullName: '🇯🇵 日职联 (J1 League)', country: '日本' },
    292: { name: 'K联赛1', fullName: '🇰🇷 K联赛1 (K League 1)', country: '韩国' },
    307: { name: '沙特超', fullName: '🇸🇦 沙特超 (Saudi Pro League)', country: '沙特阿拉伯' },
    188: { name: '澳超', fullName: '🇦🇺 澳超 (A-League)', country: '澳大利亚' },
    305: { name: '卡塔尔联赛', fullName: '🇶🇦 卡塔尔联赛 (Stars League)', country: '卡塔尔' },
    233: { name: '埃及超', fullName: '🇪🇬 埃及超 (Premier League)', country: '埃及' },
    
    // 国际赛事
    1: { name: '世界杯', fullName: '🌍 世界杯 (FIFA World Cup)', country: '国际' },
    7: { name: '亚洲杯', fullName: '🌏 亚洲杯 (AFC Asian Cup)', country: '亚洲' },
    // 667: { name: '球会友谊', fullName: '⚽ 球会友谊 (Club Friendlies)', country: '国际' }, // 已移除，不监听友谊赛
};

// 兼容旧的 LEAGUE_NAMES 格式（用于日志显示）
const LEAGUE_NAMES: Record<number, string> = Object.fromEntries(
    Object.entries(LEAGUE_INFO).map(([id, info]) => [Number(id), info.fullName])
);

/**
 * 获取联赛中文名称（用于前端显示）
 * @param leagueId 联赛 ID
 * @param fallbackName 备用名称（英文）
 * @returns 中文联赛名称
 */
function getLeagueChineseName(leagueId: number, fallbackName?: string): string {
    const info = LEAGUE_INFO[leagueId];
    if (info) {
        return info.name;
    }
    // 如果没有映射，返回原始名称
    return fallbackName || `联赛${leagueId}`;
}

/**
 * 获取国家/地区中文名称
 * @param leagueId 联赛 ID
 * @param fallbackCountry 备用国家名（英文）
 * @returns 中文国家名
 */
function getCountryChineseName(leagueId: number, fallbackCountry?: string): string {
    const info = LEAGUE_INFO[leagueId];
    if (info) {
        return info.country;
    }
    // 常见国家名称映射
    const countryMap: Record<string, string> = {
        'England': '英格兰',
        'Spain': '西班牙',
        'Italy': '意大利',
        'Germany': '德国',
        'France': '法国',
        'Netherlands': '荷兰',
        'Portugal': '葡萄牙',
        'Turkey': '土耳其',
        'Belgium': '比利时',
        'Scotland': '苏格兰',
        'Russia': '俄罗斯',
        'Greece': '希腊',
        'Switzerland': '瑞士',
        'Austria': '奥地利',
        'Israel': '以色列',
        'Brazil': '巴西',
        'USA': '美国',
        'Argentina': '阿根廷',
        'Colombia': '哥伦比亚',
        'Chile': '智利',
        'China': '中国',
        'Japan': '日本',
        'South-Korea': '韩国',
        'Korea': '韩国',
        'Saudi-Arabia': '沙特阿拉伯',
        'Australia': '澳大利亚',
        'Qatar': '卡塔尔',
        'Egypt': '埃及',
        'World': '国际',
        'Europe': '欧洲',
        'Asia': '亚洲',
        'Africa': '非洲',
        'South-America': '南美洲',
        'North-America': '北美洲',
        'Mexico': '墨西哥',
        'Indonesia': '印度尼西亚',
        'Thailand': '泰国',
        'Vietnam': '越南',
        'Malaysia': '马来西亚',
        'India': '印度',
        'UAE': '阿联酋',
        'Iran': '伊朗',
        'Poland': '波兰',
        'Ukraine': '乌克兰',
        'Czech-Republic': '捷克',
        'Croatia': '克罗地亚',
        'Serbia': '塞尔维亚',
        'Denmark': '丹麦',
        'Sweden': '瑞典',
        'Norway': '挪威',
        'Finland': '芬兰',
    };
    return countryMap[fallbackCountry || ''] || fallbackCountry || '未知';
}

// ===========================================
// FootballService 类
// ===========================================

export class FootballService {
    private apiClient: AxiosInstance;
    private redisPub: any; // 使用 any 避免类型兼容问题
    private io: Server;
    private pollInterval: number;
    private isPolling: boolean = false;
    private pollTimer: NodeJS.Timeout | null = null;
    
    // 缓存上一次的比赛状态，用于差异检测
    private matchCache: Map<string, MatchData> = new Map();
    
    // 联赛白名单
    private allowedLeagues: number[] = [];

    constructor(
        apiKey: string,
        apiUrl: string,
        redisPub: any,
        io: Server,
        pollInterval: number = 15,
        allowedLeagues: number[] = []
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
        this.allowedLeagues = allowedLeagues;
        
        // 启动时打印联赛白名单配置
        this.logLeagueFilterConfig();
    }

    // ===========================================
    // 打印联赛白名单配置
    // ===========================================
    
    private logLeagueFilterConfig(): void {
        console.log('\n' + '='.repeat(60));
        console.log('⚽ 联赛过滤配置');
        console.log('='.repeat(60));
        
        // 显示黑名单
        if (FootballService.LEAGUE_BLACKLIST.length > 0) {
            console.log('🚫 黑名单 (永不监听):');
            FootballService.LEAGUE_BLACKLIST.forEach(leagueId => {
                console.log(`   ❌ ${leagueId}: 球会友谊 (Club Friendlies)`);
            });
        }
        
        if (this.allowedLeagues.length === 0) {
            console.log('📋 模式: 监听所有联赛 (除黑名单外)');
        } else {
            console.log(`📋 模式: 白名单过滤 (仅监听 ${this.allowedLeagues.length} 个联赛)`);
            console.log('📋 监听的联赛列表:');
            this.allowedLeagues.forEach(leagueId => {
                const leagueName = LEAGUE_NAMES[leagueId] || `未知联赛 (ID: ${leagueId})`;
                console.log(`   ✅ ${leagueId}: ${leagueName}`);
            });
        }
        
        console.log('='.repeat(60) + '\n');
    }

    // ===========================================
    // 检查联赛是否在白名单中
    // ===========================================
    
    // 联赛黑名单 - 这些联赛永远不会被监听
    private static readonly LEAGUE_BLACKLIST: number[] = [
        667,  // 球会友谊 (Club Friendlies)
    ];
    
    private isLeagueAllowed(leagueId: number): boolean {
        // 首先检查黑名单 - 黑名单中的联赛永远不允许
        if (FootballService.LEAGUE_BLACKLIST.includes(leagueId)) {
            return false;
        }
        
        // 如果白名单为空，允许所有联赛（除了黑名单）
        if (this.allowedLeagues.length === 0) {
            return true;
        }
        return this.allowedLeagues.includes(leagueId);
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
            const totalCount = fixtures.length;
            
            // 🟢 调试：查看第一场比赛的原始数据结构
            if (fixtures.length > 0) {
                const firstFixture = fixtures[0] as any;
                if (firstFixture) {
                    console.log(`[调试] 第一场比赛数据结构: ${Object.keys(firstFixture).join(', ')}`);
                    if (firstFixture.events) {
                        console.log(`[调试] events 字段存在，包含 ${firstFixture.events.length} 个事件`);
                    } else {
                        console.log(`[调试] events 字段不存在`);
                    }
                    if (firstFixture.statistics) {
                        console.log(`[调试] statistics 字段存在`);
                    } else {
                        console.log(`[调试] statistics 字段不存在`);
                    }
                }
            }
            
            // 统计过滤结果
            let processedCount = 0;
            let skippedCount = 0;
            const skippedLeagues = new Set<string>();

            // 处理每场比赛
            for (const fixture of fixtures) {
                // 联赛白名单过滤
                if (!this.isLeagueAllowed(fixture.league.id)) {
                    skippedCount++;
                    skippedLeagues.add(`${fixture.league.country} - ${fixture.league.name}`);
                    continue; // 跳过不在白名单中的联赛
                }
                
                await this.processFixture(fixture);
                processedCount++;
            }

            // 打印过滤统计
            if (this.allowedLeagues.length > 0) {
                console.log(`📊 获取到 ${totalCount} 场比赛 | ✅ 处理: ${processedCount} | ⏭️ 跳过: ${skippedCount}`);
                if (skippedLeagues.size > 0 && skippedLeagues.size <= 5) {
                    // 只在跳过的联赛较少时显示详情
                    console.log(`   跳过的联赛: ${Array.from(skippedLeagues).join(', ')}`);
                }
            } else {
                console.log(`📊 获取到 ${totalCount} 场正在进行的比赛`);
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
        
        // 🟢 2. 获取实时赔率数据
        let liveOdds: any = null;
        try {
            liveOdds = await this.fetchLiveOdds(fixture.fixture.id);
            if (liveOdds) {
                matchData.liveOdds = liveOdds;
            }
        } catch (error) {
            // 赔率获取失败不影响主流程
            console.warn(`⚠️ 获取赔率失败 [${matchData.match_id}]:`, error);
        }
        
        // 3. 差异检测：检查是否有变化
        const cachedMatch = this.matchCache.get(matchData.match_id);
        const hasChanged = this.detectChanges(cachedMatch, matchData);

        // 🟢 关键修复：无论比赛数据是否变化，都要更新缓存中的 liveOdds
        // 因为赔率是实时变化的，而 hasChanged 只检测比分/时间变化
        if (cachedMatch) {
            // 已存在缓存：只更新 liveOdds 字段
            if (liveOdds) {
                cachedMatch.liveOdds = liveOdds;
            }
            
            if (!hasChanged) {
                return; // 比赛数据没变化，跳过事件发送
            }
        }

        // 4. 更新缓存（首次添加或有变化时）
        // 🟢 确保 matchData 包含最新的 liveOdds
        if (liveOdds) {
            matchData.liveOdds = liveOdds;
        }
        this.matchCache.set(matchData.match_id, matchData);

        // 5. 构建事件
        const event = this.buildMatchEvent(cachedMatch, matchData);

        // 6. 发送事件
        await this.emitEvent(event);
    }

    // ===========================================
    // 🟢 获取实时滚球赔率数据 (Live/In-Play Odds)
    // ===========================================

    // 缓存滚球赔率数据，避免重复请求
    private liveOddsCache: Map<number, { data: LiveOdds; timestamp: number }> = new Map();
    private readonly LIVE_ODDS_CACHE_TTL = 5000; // 5秒缓存

    private async fetchLiveOdds(fixtureId: number): Promise<LiveOdds | null> {
        try {
            // 检查缓存
            const cached = this.liveOddsCache.get(fixtureId);
            if (cached && Date.now() - cached.timestamp < this.LIVE_ODDS_CACHE_TTL) {
                console.log(`[滑球赔率] 使用缓存: fixture=${fixtureId}, 有赛前亚盘=${!!cached.data.preMatchAsianHandicap}`);
                // 🟢 确保赛前盘口数据始终被包含（即使从缓存返回）
                if (!cached.data.preMatchAsianHandicap || !cached.data.preMatchOverUnder) {
                    console.log(`[滑球赔率] 缓存缺少赛前盘口，补充获取: fixture=${fixtureId}`);
                    const preMatchOdds = await this.fetchPreMatchOdds(fixtureId);
                    if (preMatchOdds) {
                        if (preMatchOdds.asianHandicap) {
                            cached.data.preMatchAsianHandicap = preMatchOdds.asianHandicap;
                            console.log(`[滑球赔率] 已补充赛前亚盘: fixture=${fixtureId}`);
                        }
                        if (preMatchOdds.overUnder) {
                            cached.data.preMatchOverUnder = preMatchOdds.overUnder;
                        }
                    }
                }
                return cached.data;
            }

            // 🟢 使用滚球赔率接口 /odds/live
            const response = await this.apiClient.get('/odds/live');
            const allLiveOdds = response.data.response || [];
            
            // 找到对应比赛的赔率数据
            const fixtureOdds = allLiveOdds.find((item: any) => item.fixture?.id === fixtureId);
            if (!fixtureOdds || !fixtureOdds.odds || fixtureOdds.odds.length === 0) {
                return null;
            }

            const odds = fixtureOdds.odds;
            const status = fixtureOdds.fixture?.status;

            const liveOdds: LiveOdds = {
                bookmaker: 'Live',
                updateTime: new Date().toISOString()
            };
            
            // 添加比赛状态
            if (status && status.elapsed !== undefined && status.seconds) {
                liveOdds.status = {
                    elapsed: status.elapsed,
                    seconds: status.seconds
                };
            }

            // 🟢 解析实时胜平负赔率 (1x2)
            const matchWinnerBet = odds.find((b: any) => b.id === 1 || b.name === '1x2');
            if (matchWinnerBet) {
                const homeOdd = matchWinnerBet.values.find((v: any) => v.value === 'Home');
                const drawOdd = matchWinnerBet.values.find((v: any) => v.value === 'Draw');
                const awayOdd = matchWinnerBet.values.find((v: any) => v.value === 'Away');
                
                if (homeOdd && drawOdd && awayOdd) {
                    liveOdds.matchWinner = {
                        home: parseFloat(homeOdd.odd),
                        draw: parseFloat(drawOdd.odd),
                        away: parseFloat(awayOdd.odd),
                        bookmaker: 'Live',
                        updateTime: new Date().toISOString(),
                        suspended: homeOdd.suspended || drawOdd.suspended || awayOdd.suspended
                    };
                }
            }

            // 🟢 解析实时大小球赔率 (Over/Under Line - id: 36)
            const overUnderBet = odds.find((b: any) => b.id === 36 || b.name === 'Over/Under Line');
            if (overUnderBet) {
                const overUnderOdds: LiveOdds['overUnder'] = [];
                const overValues = overUnderBet.values.filter((v: any) => v.value === 'Over');
                const underValues = overUnderBet.values.filter((v: any) => v.value === 'Under');
                
                // 按 handicap 分组配对
                const handicaps = [...new Set(overValues.map((v: any) => v.handicap))];
                
                for (const handicap of handicaps) {
                    const overVal = overValues.find((v: any) => v.handicap === handicap);
                    const underVal = underValues.find((v: any) => v.handicap === handicap);
                    
                    if (overVal && underVal && typeof handicap === 'string') {
                        overUnderOdds.push({
                            line: parseFloat(handicap),
                            over: parseFloat(overVal.odd),
                            under: parseFloat(underVal.odd),
                            main: overVal.main || false,
                            suspended: overVal.suspended || underVal.suspended
                        });
                    }
                }
                
                // 按盘口线排序
                overUnderOdds.sort((a, b) => a.line - b.line);
                
                if (overUnderOdds.length > 0) {
                    liveOdds.overUnder = overUnderOdds;
                }
            }

            // 🟢 解析实时亚洲盘口 (Asian Handicap - id: 33)
            const asianHandicapBet = odds.find((b: any) => b.id === 33 || b.name === 'Asian Handicap');
            if (asianHandicapBet) {
                const asianHandicapOdds: LiveOdds['asianHandicap'] = [];
                const homeValues = asianHandicapBet.values.filter((v: any) => v.value === 'Home');
                const awayValues = asianHandicapBet.values.filter((v: any) => v.value === 'Away');
                
                // 按 handicap 分组配对
                for (const homeVal of homeValues) {
                    const handicap = homeVal.handicap;
                    // 找到对应的客队盘口（handicap 符号相反）
                    const awayHandicap = handicap.startsWith('-') 
                        ? handicap.replace('-', '') 
                        : '-' + handicap;
                    const awayVal = awayValues.find((v: any) => v.handicap === awayHandicap);
                    
                    if (awayVal) {
                        asianHandicapOdds.push({
                            line: handicap,
                            home: parseFloat(homeVal.odd),
                            away: parseFloat(awayVal.odd),
                            main: homeVal.main || false,
                            suspended: homeVal.suspended || awayVal.suspended
                        });
                    }
                }
                
                // 按盘口线排序
                asianHandicapOdds.sort((a, b) => parseFloat(a.line) - parseFloat(b.line));
                
                if (asianHandicapOdds.length > 0) {
                    liveOdds.asianHandicap = asianHandicapOdds;
                }
            }

            // 🟢 获取并缓存赛前原始盘口
            const preMatchOdds = await this.fetchPreMatchOdds(fixtureId);
            console.log(`[赛前盘口] fixture=${fixtureId} 返回结果: ${JSON.stringify(preMatchOdds)}`);
            if (preMatchOdds) {
                if (preMatchOdds.asianHandicap) {
                    liveOdds.preMatchAsianHandicap = preMatchOdds.asianHandicap;
                    console.log(`[赛前盘口] 已赋值亚盘: ${JSON.stringify(preMatchOdds.asianHandicap)}`);
                }
                if (preMatchOdds.overUnder) {
                    liveOdds.preMatchOverUnder = preMatchOdds.overUnder;
                    console.log(`[赛前盘口] 已赋值大小球: ${JSON.stringify(preMatchOdds.overUnder)}`);
                }
            }

            // 缓存结果
            console.log(`[滑球赔率] 缓存前 liveOdds keys: ${Object.keys(liveOdds).join(', ')}`);
            console.log(`[滑球赔率] preMatchAsianHandicap: ${JSON.stringify(liveOdds.preMatchAsianHandicap)}`);
            this.liveOddsCache.set(fixtureId, { data: liveOdds, timestamp: Date.now() });

            return liveOdds;
        } catch (error) {
            // 静默失败，返回 null
            return null;
        }
    }

    // ===========================================
    // 🟢 获取赛前原始盘口 (Pre-match Odds)
    // ===========================================

    // 赛前盘口缓存 - 整场比赛不变
    private preMatchOddsCache: Map<number, {
        asianHandicap?: { line: string; home: number; away: number };
        overUnder?: { line: number; over: number; under: number };
    }> = new Map();

    private async fetchPreMatchOdds(fixtureId: number): Promise<{
        asianHandicap?: { line: string; home: number; away: number };
        overUnder?: { line: number; over: number; under: number };
    } | null> {
        try {
            // 检查缓存 - 赛前盘口整场比赛不变，不需要过期
            const cached = this.preMatchOddsCache.get(fixtureId);
            if (cached) {
                console.log(`[赛前盘口] 使用缓存: fixture=${fixtureId}`);
                return cached;
            }

            console.log(`[赛前盘口] 获取赛前盘口: fixture=${fixtureId}`);

            // 🟢 使用赛前赔率接口 /odds
            const response = await this.apiClient.get('/odds', {
                params: {
                    fixture: fixtureId,
                    bookmaker: 8  // Bet365
                }
            });

            console.log(`[赛前盘口] Bet365 响应: ${response.data.response?.length || 0} 条记录`);

            const oddsData = response.data.response?.[0]?.bookmakers?.[0]?.bets;
            if (!oddsData || oddsData.length === 0) {
                console.log(`[赛前盘口] Bet365 无数据，尝试 Bwin...`);
                // 尝试其他博彩公司
                const fallbackResponse = await this.apiClient.get('/odds', {
                    params: {
                        fixture: fixtureId,
                        bookmaker: 6  // Bwin
                    }
                });
                const fallbackOdds = fallbackResponse.data.response?.[0]?.bookmakers?.[0]?.bets;
                if (!fallbackOdds || fallbackOdds.length === 0) {
                    console.log(`[赛前盘口] Bwin 也无数据`);
                    return null;
                }
                return this.parsePreMatchOdds(fallbackOdds, fixtureId);
            }

            return this.parsePreMatchOdds(oddsData, fixtureId);
        } catch (error: any) {
            console.log(`[赛前盘口] 获取失败: ${error.message}`);
            return null;
        }
    }

    private parsePreMatchOdds(bets: any[], fixtureId: number): {
        asianHandicap?: { line: string; home: number; away: number };
        overUnder?: { line: number; over: number; under: number };
    } | null {
        console.log(`[赛前盘口] 解析数据: fixture=${fixtureId}, bets=${bets.length}种类型`);
        console.log(`[赛前盘口] 投注类型: ${bets.map((b: any) => `${b.id}:${b.name}`).join(', ')}`);
        
        const result: {
            asianHandicap?: { line: string; home: number; away: number };
            overUnder?: { line: number; over: number; under: number };
        } = {};

        // 🟢 解析亚洲让球盘 (Asian Handicap - id: 4)
        const asianHandicapBet = bets.find((b: any) => b.id === 4 || b.name === 'Asian Handicap');
        console.log(`[赛前盘口] 亚盘数据: ${JSON.stringify(asianHandicapBet?.values?.slice(0, 4))}`);
        if (asianHandicapBet && asianHandicapBet.values && asianHandicapBet.values.length > 0) {
            // 🟢 新格式: value 是 "Home -1.25" 或 "Away -1.25"
            const homeValues: { handicap: string; odd: number }[] = [];
            const awayValues: { handicap: string; odd: number }[] = [];
            
            for (const v of asianHandicapBet.values) {
                const valueStr = v.value || '';
                const odd = parseFloat(v.odd);
                
                if (valueStr.startsWith('Home')) {
                    // 提取盘口值: "Home -1.25" -> "-1.25"
                    const handicap = valueStr.replace('Home', '').trim();
                    homeValues.push({ handicap, odd });
                } else if (valueStr.startsWith('Away')) {
                    // 提取盘口值: "Away -1.25" -> "-1.25" (客队视角)
                    const handicap = valueStr.replace('Away', '').trim();
                    awayValues.push({ handicap, odd });
                }
            }
            
            console.log(`[赛前盘口] 解析后: home=${homeValues.length}个, away=${awayValues.length}个`);
            
            // 找赔率最平衡的盘口（主客赔率最接近）
            let bestPair: { line: string; home: number; away: number } | null = null;
            let minDiff = Infinity;
            
            for (const homeVal of homeValues) {
                // 找到对应的客队盘口 (同样的盘口值)
                const awayVal = awayValues.find((a) => a.handicap === homeVal.handicap);
                
                if (awayVal) {
                    const diff = Math.abs(homeVal.odd - awayVal.odd);
                    
                    if (diff < minDiff) {
                        minDiff = diff;
                        bestPair = {
                            line: homeVal.handicap,
                            home: homeVal.odd,
                            away: awayVal.odd
                        };
                    }
                }
            }
            
            if (bestPair) {
                result.asianHandicap = bestPair;
                console.log(`[赛前盘口] 亚盘主盘: ${bestPair.line}, home=${bestPair.home}, away=${bestPair.away}`);
            }
        }

        // 🟢 解析大小球 (Over/Under - id: 5)
        const overUnderBet = bets.find((b: any) => b.id === 5 || b.name === 'Goals Over/Under');
        console.log(`[赛前盘口] 大小球数据: ${JSON.stringify(overUnderBet?.values?.slice(0, 4))}`);
        if (overUnderBet && overUnderBet.values && overUnderBet.values.length > 0) {
            // 🟢 新格式: value 是 "Over 2.5" 或 "Under 2.5"
            const overValues: { line: number; odd: number }[] = [];
            const underValues: { line: number; odd: number }[] = [];
            
            for (const v of overUnderBet.values) {
                const valueStr = v.value || '';
                const odd = parseFloat(v.odd);
                
                if (valueStr.startsWith('Over')) {
                    // 提取盘口值: "Over 2.5" -> 2.5
                    const line = parseFloat(valueStr.replace('Over', '').trim());
                    if (!isNaN(line)) {
                        overValues.push({ line, odd });
                    }
                } else if (valueStr.startsWith('Under')) {
                    // 提取盘口值: "Under 2.5" -> 2.5
                    const line = parseFloat(valueStr.replace('Under', '').trim());
                    if (!isNaN(line)) {
                        underValues.push({ line, odd });
                    }
                }
            }
            
            console.log(`[赛前盘口] 大小球解析后: over=${overValues.length}个, under=${underValues.length}个`);
            
            // 找赔率最平衡的盘口
            let bestPair: { line: number; over: number; under: number } | null = null;
            let minDiff = Infinity;
            
            for (const overVal of overValues) {
                // 找到对应的 Under 盘口 (同样的盘口值)
                const underVal = underValues.find((u) => u.line === overVal.line);
                
                if (underVal) {
                    const diff = Math.abs(overVal.odd - underVal.odd);
                    
                    if (diff < minDiff) {
                        minDiff = diff;
                        bestPair = {
                            line: overVal.line,
                            over: overVal.odd,
                            under: underVal.odd
                        };
                    }
                }
            }
            
            if (bestPair) {
                result.overUnder = bestPair;
                console.log(`[赛前盘口] 大小球主盘: ${bestPair.line}, over=${bestPair.over}, under=${bestPair.under}`);
            }
        }

        // 缓存结果
        if (result.asianHandicap || result.overUnder) {
            console.log(`[赛前盘口] 解析成功: fixture=${fixtureId}, 亚盘=${result.asianHandicap?.line || '无'}, 大小球=${result.overUnder?.line || '无'}`);
            this.preMatchOddsCache.set(fixtureId, result);
            return result;
        }

        console.log(`[赛前盘口] 解析失败: fixture=${fixtureId}, 未找到亚盘或大小球数据`);
        return null;
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

        // 获取中文联赛名称和国家名
        const leagueId = fixture.league.id;
        const chineseLeagueName = getLeagueChineseName(leagueId, fixture.league.name);
        const chineseCountry = getCountryChineseName(leagueId, fixture.league.country);
        
        // 获取中文球队名称
        const homeTeamChinese = getTeamChineseName(fixture.teams.home.name);
        const awayTeamChinese = getTeamChineseName(fixture.teams.away.name);
        
        // 🟢 新增：从比赛事件中统计红牌数
        let homeRedCards = 0;
        let awayRedCards = 0;
        
        if (fixture.events && fixture.events.length > 0) {
            for (const event of fixture.events) {
                if (event.type === 'Card' && event.detail === 'Red Card') {
                    if (event.team.id === fixture.teams.home.id) {
                        homeRedCards++;
                    } else if (event.team.id === fixture.teams.away.id) {
                        awayRedCards++;
                    }
                }
            }
        }
        
        // 🟢 新增：解析比赛统计数据
        let homeShotsOnTarget: number | undefined;
        let awayShotsOnTarget: number | undefined;
        let homeShotsOffTarget: number | undefined;
        let awayShotsOffTarget: number | undefined;
        let homeCorners: number | undefined;
        let awayCorners: number | undefined;
        let homePossession: number | undefined;
        let awayPossession: number | undefined;
        let homeDangerousAttacks: number | undefined;
        let awayDangerousAttacks: number | undefined;
        
        if (fixture.statistics && fixture.statistics.length >= 2) {
            // API-Football 返回的 statistics 数组包含两个元素：[0] 是主队，[1] 是客队
            const homeStats = fixture.statistics.find(s => s.team.id === fixture.teams.home.id);
            const awayStats = fixture.statistics.find(s => s.team.id === fixture.teams.away.id);
            
            // 辅助函数：从统计数组中获取指定类型的值
            const getStatValue = (stats: typeof homeStats, type: string): number | undefined => {
                if (!stats) return undefined;
                const stat = stats.statistics.find(s => s.type === type);
                if (!stat || stat.value === null) return undefined;
                // 处理百分比字符串（如 "65%"）
                if (typeof stat.value === 'string') {
                    const numValue = parseFloat(stat.value.replace('%', ''));
                    return isNaN(numValue) ? undefined : numValue;
                }
                return typeof stat.value === 'number' ? stat.value : undefined;
            };
            
            // 解析各项统计数据
            homeShotsOnTarget = getStatValue(homeStats, 'Shots on Goal');
            awayShotsOnTarget = getStatValue(awayStats, 'Shots on Goal');
            homeShotsOffTarget = getStatValue(homeStats, 'Shots off Goal');
            awayShotsOffTarget = getStatValue(awayStats, 'Shots off Goal');
            homeCorners = getStatValue(homeStats, 'Corner Kicks');
            awayCorners = getStatValue(awayStats, 'Corner Kicks');
            homePossession = getStatValue(homeStats, 'Ball Possession');
            awayPossession = getStatValue(awayStats, 'Ball Possession');
            // 危险进攻可能叫 "Dangerous Attacks" 或不存在
            homeDangerousAttacks = getStatValue(homeStats, 'Dangerous Attacks');
            awayDangerousAttacks = getStatValue(awayStats, 'Dangerous Attacks');
            
            // 🟢 调试日志：输出解析到的统计数据
            if (homeShotsOnTarget !== undefined || homeCorners !== undefined) {
                console.log(`[统计数据] ${fixture.teams.home.name}: 射正=${homeShotsOnTarget}, 角球=${homeCorners}, 控球=${homePossession}%`);
                console.log(`[统计数据] ${fixture.teams.away.name}: 射正=${awayShotsOnTarget}, 角球=${awayCorners}, 控球=${awayPossession}%`);
            }
        }
        
        return {
            match_id: `api-${fixture.fixture.id}`,
            home_team: homeTeamChinese,  // 使用中文球队名
            away_team: awayTeamChinese,  // 使用中文球队名
            home_score: fixture.goals.home ?? 0,
            away_score: fixture.goals.away ?? 0,
            minute: fixture.fixture.status.elapsed ?? 0,
            status: statusMap[fixture.fixture.status.short] || 'live',
            league: `${chineseCountry} - ${chineseLeagueName}`,  // 使用中文名称
            league_id: fixture.league.id,  // 保存联赛ID
            timestamp: new Date().toISOString(),
            // 🟢 红牌数据
            home_red_cards: homeRedCards,
            away_red_cards: awayRedCards,
            // 🟢 比赛统计数据
            home_shots_on_target: homeShotsOnTarget,
            away_shots_on_target: awayShotsOnTarget,
            home_shots_off_target: homeShotsOffTarget,
            away_shots_off_target: awayShotsOffTarget,
            home_corners: homeCorners,
            away_corners: awayCorners,
            home_possession: homePossession,
            away_possession: awayPossession,
            home_dangerous_attacks: homeDangerousAttacks,
            away_dangerous_attacks: awayDangerousAttacks
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
    
    // ===========================================
    // 获取当前联赛白名单配置
    // ===========================================
    
    public getAllowedLeagues(): number[] {
        return [...this.allowedLeagues];
    }
}

// ===========================================
// 工厂函数：创建服务实例
// ===========================================

export function createFootballService(
    redisPub: any, // 使用 any 避免类型兼容问题
    io: Server
): FootballService {
    const apiKey = process.env.API_FOOTBALL_KEY || '';
    const apiUrl = process.env.API_FOOTBALL_URL || 'https://v3.football.api-sports.io';
    const pollInterval = parseInt(process.env.POLL_INTERVAL || '15', 10);
    
    // 解析联赛白名单
    const allowedLeagues = process.env.ALLOWED_LEAGUE_IDS 
        ? process.env.ALLOWED_LEAGUE_IDS.split(',').map(id => parseInt(id.trim(), 10)).filter(id => !isNaN(id))
        : [];

    if (!apiKey || apiKey === 'your_api_key_here') {
        console.warn('⚠️ API_FOOTBALL_KEY 未配置，请在 .env 文件中设置');
    }

    return new FootballService(apiKey, apiUrl, redisPub, io, pollInterval, allowedLeagues);
}
