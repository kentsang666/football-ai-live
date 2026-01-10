/**
 * Bet365 亚洲滚球盘口服务
 * 
 * 专门获取 Bet365 的亚洲盘口（Asian Handicap）和大小球（Over/Under）滚球赔率
 * 
 * 数据来源：API-Football /odds/live 接口
 * 更新频率：每 5 秒
 */

import axios, { AxiosInstance } from 'axios';

// ===========================================
// 类型定义
// ===========================================

/**
 * Bet365 亚洲滚球盘口数据
 */
export interface Bet365LiveOdds {
    // 数据来源标识
    bookmaker: 'Bet365';
    updateTime: string;
    
    // 比赛状态
    status?: {
        elapsed: number;      // 已进行分钟数
        seconds: string;      // 精确时间 "43:13"
        stopped: boolean;     // 是否暂停
        blocked: boolean;     // 是否封盘
        finished: boolean;    // 是否结束
    };
    
    // 🔴 亚洲让球盘 (Asian Handicap) - 核心数据
    asianHandicap?: {
        line: string;         // 盘口线: "-0.5", "+0.5", "-1", "-1.25"...
        home: number;         // 主队赔率
        away: number;         // 客队赔率
        main: boolean;        // 是否主盘
        suspended: boolean;   // 是否暂停
    }[];
    
    // 🔴 大小球盘 (Over/Under) - 核心数据
    overUnder?: {
        line: number;         // 盘口线: 0.5, 1.5, 2.5, 2.75, 3, 3.5...
        over: number;         // 大球赔率
        under: number;        // 小球赔率
        main: boolean;        // 是否主盘
        suspended: boolean;   // 是否暂停
    }[];
    
    // 🔴 赛前原始盘口 (用于对比分析)
    preMatchAsianHandicap?: {
        line: string;
        home: number;
        away: number;
    };
    preMatchOverUnder?: {
        line: number;
        over: number;
        under: number;
    };
}

/**
 * API-Football 滚球赔率响应结构
 */
interface APILiveOddsResponse {
    get: string;
    parameters: any;
    errors: any[];
    results: number;
    response: {
        fixture: {
            id: number;
            status: {
                elapsed: number;
                seconds: string;
                stopped: boolean;
                blocked: boolean;
                finished: boolean;
            };
        };
        odds: {
            id: number;
            name: string;
            values: {
                value: string;
                odd: string;
                handicap?: string;
                main?: boolean;
                suspended?: boolean;
            }[];
        }[];
    }[];
}

// ===========================================
// Bet365 盘口服务类
// ===========================================

export class Bet365OddsService {
    private apiClient: AxiosInstance;
    
    // 滚球赔率缓存
    private liveOddsCache: Map<number, { data: Bet365LiveOdds; timestamp: number }> = new Map();
    private readonly CACHE_TTL = 5000; // 5秒缓存
    
    // 赛前盘口缓存（整场比赛不变）
    private preMatchCache: Map<number, {
        asianHandicap?: { line: string; home: number; away: number };
        overUnder?: { line: number; over: number; under: number };
    }> = new Map();
    
    // 全量滚球赔率缓存（减少 API 调用）
    private allLiveOddsCache: { data: any[]; timestamp: number } | null = null;
    private readonly ALL_ODDS_CACHE_TTL = 3000; // 3秒缓存

    constructor(apiKey: string, apiUrl: string) {
        this.apiClient = axios.create({
            baseURL: apiUrl,
            headers: {
                'x-apisports-key': apiKey
            },
            timeout: 10000
        });
    }

    // ===========================================
    // 核心方法：获取 Bet365 滚球盘口
    // ===========================================

    /**
     * 获取指定比赛的 Bet365 亚洲滚球盘口
     * @param fixtureId 比赛 ID
     * @returns Bet365 滚球盘口数据
     */
    async getLiveOdds(fixtureId: number): Promise<Bet365LiveOdds | null> {
        try {
            // 1. 检查缓存
            const cached = this.liveOddsCache.get(fixtureId);
            if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
                return cached.data;
            }

            // 2. 获取全量滚球赔率（使用缓存减少 API 调用）
            const allLiveOdds = await this.fetchAllLiveOdds();
            if (!allLiveOdds || allLiveOdds.length === 0) {
                return null;
            }

            // 3. 找到对应比赛的赔率
            const fixtureOdds = allLiveOdds.find((item: any) => item.fixture?.id === fixtureId);
            if (!fixtureOdds || !fixtureOdds.odds || fixtureOdds.odds.length === 0) {
                return null;
            }

            // 4. 解析 Bet365 盘口数据
            const bet365Odds = this.parseBet365Odds(fixtureOdds);

            // 5. 获取赛前盘口（用于对比）
            const preMatchOdds = await this.getPreMatchOdds(fixtureId);
            if (preMatchOdds) {
                if (preMatchOdds.asianHandicap) {
                    bet365Odds.preMatchAsianHandicap = preMatchOdds.asianHandicap;
                }
                if (preMatchOdds.overUnder) {
                    bet365Odds.preMatchOverUnder = preMatchOdds.overUnder;
                }
            }

            // 6. 缓存结果
            this.liveOddsCache.set(fixtureId, { data: bet365Odds, timestamp: Date.now() });

            console.log(`[Bet365] fixture=${fixtureId} 亚盘=${bet365Odds.asianHandicap?.length || 0}个 大小球=${bet365Odds.overUnder?.length || 0}个`);

            return bet365Odds;
        } catch (error: any) {
            console.warn(`[Bet365] 获取滚球盘口失败 fixture=${fixtureId}: ${error.message}`);
            return null;
        }
    }

    // ===========================================
    // 内部方法：获取全量滚球赔率
    // ===========================================

    private async fetchAllLiveOdds(): Promise<any[]> {
        // 使用缓存减少 API 调用
        if (this.allLiveOddsCache && Date.now() - this.allLiveOddsCache.timestamp < this.ALL_ODDS_CACHE_TTL) {
            return this.allLiveOddsCache.data;
        }

        try {
            const response = await this.apiClient.get<APILiveOddsResponse>('/odds/live');
            const data = response.data.response || [];
            
            // 缓存全量数据
            this.allLiveOddsCache = { data, timestamp: Date.now() };
            
            console.log(`[Bet365] 获取全量滚球赔率: ${data.length} 场比赛`);
            
            return data;
        } catch (error: any) {
            console.error(`[Bet365] 获取全量滚球赔率失败: ${error.message}`);
            return [];
        }
    }

    // ===========================================
    // 内部方法：解析 Bet365 盘口数据
    // ===========================================

    private parseBet365Odds(fixtureOdds: any): Bet365LiveOdds {
        const odds = fixtureOdds.odds || [];
        const status = fixtureOdds.fixture?.status;

        const result: Bet365LiveOdds = {
            bookmaker: 'Bet365',
            updateTime: new Date().toISOString()
        };

        // 添加比赛状态
        if (status) {
            result.status = {
                elapsed: status.elapsed || 0,
                seconds: status.seconds || '',
                stopped: status.stopped || false,
                blocked: status.blocked || false,
                finished: status.finished || false
            };
        }

        // 🔴 解析亚洲让球盘 (Asian Handicap - id: 33)
        const asianHandicapBet = odds.find((b: any) => b.id === 33 || b.name === 'Asian Handicap');
        if (asianHandicapBet) {
            const parsedAH = this.parseAsianHandicap(asianHandicapBet.values);
            if (parsedAH && parsedAH.length > 0) {
                result.asianHandicap = parsedAH;
            }
        }

        // 🔴 解析大小球盘 (Over/Under Line - id: 36)
        const overUnderBet = odds.find((b: any) => b.id === 36 || b.name === 'Over/Under Line');
        if (overUnderBet) {
            const parsedOU = this.parseOverUnder(overUnderBet.values);
            if (parsedOU && parsedOU.length > 0) {
                result.overUnder = parsedOU;
            }
        }

        return result;
    }

    /**
     * 解析亚洲让球盘数据
     */
    private parseAsianHandicap(values: any[]): NonNullable<Bet365LiveOdds['asianHandicap']> | undefined {
        const asianHandicapOdds: NonNullable<Bet365LiveOdds['asianHandicap']> = [];
        
        const homeValues = values.filter((v: any) => v.value === 'Home');
        const awayValues = values.filter((v: any) => v.value === 'Away');

        for (const homeVal of homeValues) {
            const handicap = homeVal.handicap;
            if (!handicap) continue;

            // 找到对应的客队盘口（handicap 符号相反）
            const awayHandicap = handicap.startsWith('-') 
                ? handicap.replace('-', '') 
                : handicap.startsWith('+') 
                    ? handicap.replace('+', '-')
                    : '-' + handicap;
            
            const awayVal = awayValues.find((v: any) => 
                v.handicap === awayHandicap || 
                v.handicap === handicap.replace('-', '+') ||
                v.handicap === handicap.replace('+', '-')
            );

            if (awayVal) {
                asianHandicapOdds.push({
                    line: handicap,
                    home: parseFloat(homeVal.odd),
                    away: parseFloat(awayVal.odd),
                    main: homeVal.main === true,
                    suspended: homeVal.suspended === true || awayVal.suspended === true
                });
            }
        }

        // 按盘口线排序
        asianHandicapOdds.sort((a, b) => parseFloat(a.line) - parseFloat(b.line));

        return asianHandicapOdds.length > 0 ? asianHandicapOdds : undefined;
    }

    /**
     * 解析大小球盘数据
     */
    private parseOverUnder(values: any[]): NonNullable<Bet365LiveOdds['overUnder']> | undefined {
        const overUnderOdds: NonNullable<Bet365LiveOdds['overUnder']> = [];
        
        const overValues = values.filter((v: any) => v.value === 'Over');
        const underValues = values.filter((v: any) => v.value === 'Under');

        // 获取所有盘口线
        const handicaps = [...new Set(overValues.map((v: any) => v.handicap))];

        for (const handicap of handicaps) {
            if (!handicap) continue;

            const overVal = overValues.find((v: any) => v.handicap === handicap);
            const underVal = underValues.find((v: any) => v.handicap === handicap);

            if (overVal && underVal) {
                overUnderOdds.push({
                    line: parseFloat(handicap),
                    over: parseFloat(overVal.odd),
                    under: parseFloat(underVal.odd),
                    main: overVal.main === true,
                    suspended: overVal.suspended === true || underVal.suspended === true
                });
            }
        }

        // 按盘口线排序
        overUnderOdds.sort((a, b) => a.line - b.line);

        return overUnderOdds.length > 0 ? overUnderOdds : undefined;
    }

    // ===========================================
    // 获取赛前盘口（用于对比分析）
    // ===========================================

    private async getPreMatchOdds(fixtureId: number): Promise<{
        asianHandicap?: { line: string; home: number; away: number };
        overUnder?: { line: number; over: number; under: number };
    } | null> {
        // 检查缓存
        const cached = this.preMatchCache.get(fixtureId);
        if (cached) {
            return cached;
        }

        try {
            // 使用 Bet365 (bookmaker=8) 获取赛前盘口
            const response = await this.apiClient.get('/odds', {
                params: {
                    fixture: fixtureId,
                    bookmaker: 8  // Bet365
                }
            });

            const bets = response.data.response?.[0]?.bookmakers?.[0]?.bets;
            if (!bets || bets.length === 0) {
                return null;
            }

            const result: {
                asianHandicap?: { line: string; home: number; away: number };
                overUnder?: { line: number; over: number; under: number };
            } = {};

            // 解析亚洲让球盘 (id: 4)
            const asianHandicapBet = bets.find((b: any) => b.id === 4 || b.name === 'Asian Handicap');
            if (asianHandicapBet) {
                const mainOdds = this.findMainAsianHandicap(asianHandicapBet.values);
                if (mainOdds) {
                    result.asianHandicap = mainOdds;
                }
            }

            // 解析大小球 (id: 5)
            const overUnderBet = bets.find((b: any) => b.id === 5 || b.name === 'Goals Over/Under');
            if (overUnderBet) {
                const mainOdds = this.findMainOverUnder(overUnderBet.values);
                if (mainOdds) {
                    result.overUnder = mainOdds;
                }
            }

            // 缓存结果
            this.preMatchCache.set(fixtureId, result);

            return result;
        } catch (error: any) {
            console.warn(`[Bet365] 获取赛前盘口失败 fixture=${fixtureId}: ${error.message}`);
            return null;
        }
    }

    /**
     * 找到主盘亚洲让球盘（赔率最平衡的）
     */
    private findMainAsianHandicap(values: any[]): { line: string; home: number; away: number } | null {
        const homeValues: { handicap: string; odd: number }[] = [];
        const awayValues: { handicap: string; odd: number }[] = [];

        for (const v of values) {
            const valueStr = v.value || '';
            const odd = parseFloat(v.odd);

            if (valueStr.startsWith('Home')) {
                const handicap = valueStr.replace('Home', '').trim();
                homeValues.push({ handicap, odd });
            } else if (valueStr.startsWith('Away')) {
                const handicap = valueStr.replace('Away', '').trim();
                awayValues.push({ handicap, odd });
            }
        }

        // 找赔率最平衡的盘口
        let bestPair: { line: string; home: number; away: number } | null = null;
        let minDiff = Infinity;

        for (const homeVal of homeValues) {
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

        return bestPair;
    }

    /**
     * 找到主盘大小球（通常是 2.5）
     */
    private findMainOverUnder(values: any[]): { line: number; over: number; under: number } | null {
        const overValues: { line: number; odd: number }[] = [];
        const underValues: { line: number; odd: number }[] = [];

        for (const v of values) {
            const valueStr = v.value || '';
            const odd = parseFloat(v.odd);

            if (valueStr.startsWith('Over')) {
                const line = parseFloat(valueStr.replace('Over', '').trim());
                if (!isNaN(line)) {
                    overValues.push({ line, odd });
                }
            } else if (valueStr.startsWith('Under')) {
                const line = parseFloat(valueStr.replace('Under', '').trim());
                if (!isNaN(line)) {
                    underValues.push({ line, odd });
                }
            }
        }

        // 优先找 2.5 盘口
        const preferredLines = [2.5, 2.25, 2.75, 2, 3];
        for (const targetLine of preferredLines) {
            const overVal = overValues.find((v) => v.line === targetLine);
            const underVal = underValues.find((v) => v.line === targetLine);
            if (overVal && underVal) {
                return {
                    line: targetLine,
                    over: overVal.odd,
                    under: underVal.odd
                };
            }
        }

        // 找赔率最平衡的
        let bestPair: { line: number; over: number; under: number } | null = null;
        let minDiff = Infinity;

        for (const overVal of overValues) {
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

        return bestPair;
    }

    // ===========================================
    // 清理缓存
    // ===========================================

    clearCache(): void {
        this.liveOddsCache.clear();
        this.preMatchCache.clear();
        this.allLiveOddsCache = null;
        console.log('[Bet365] 缓存已清理');
    }
}

// 导出单例工厂函数
let bet365ServiceInstance: Bet365OddsService | null = null;

export function getBet365OddsService(apiKey: string, apiUrl: string): Bet365OddsService {
    if (!bet365ServiceInstance) {
        bet365ServiceInstance = new Bet365OddsService(apiKey, apiUrl);
    }
    return bet365ServiceInstance;
}
