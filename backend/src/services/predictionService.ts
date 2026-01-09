/**
 * 预测服务 - 使用 QuantPredict v2.0 算法
 * 
 * 这是一个高级足球滚球预测引擎，包含：
 * - 动量引擎 (Pressure Index)
 * - 动态泊松模型 (Dynamic Poisson)
 * - 亚洲盘口转换器 (Asian Handicap Pricer)
 * - 交易信号生成器 (Trading Signal Generator)
 * 
 * 🟢 v2.1 更新：添加比赛状态管理，每场比赛有专属的 LiveProbability 实例
 */

import {
  predictMatch,
  LiveProbability,
  AsianHandicapPricer,
  TradingSignalGenerator,
  GoalPredictor,
  MatchStats,
  AsianHandicapOdds,
  PredictionResult,
  GoalBettingTips,
  GoalPrediction,
  NextGoalPrediction,
  LiveAsianHandicap,  // 🟢 新增：实时亚洲盘口类型
} from './quantPredictService';

export interface MatchData {
  match_id: string;
  home_team: string;
  away_team: string;
  home_score: number;
  away_score: number;
  minute: number;
  status?: string | undefined;
  league?: string | undefined;
  home_shots_on_target?: number | undefined;
  away_shots_on_target?: number | undefined;
  home_shots_off_target?: number | undefined;
  away_shots_off_target?: number | undefined;
  home_possession?: number | undefined;
  away_possession?: number | undefined;
  home_corners?: number | undefined;
  away_corners?: number | undefined;
  home_red_cards?: number | undefined;
  away_red_cards?: number | undefined;
  home_dangerous_attacks?: number | undefined;
  away_dangerous_attacks?: number | undefined;
  stats?: any; // 原始统计数据对象
  liveAsianHandicap?: LiveAsianHandicap[] | undefined;  // 🟢 新增：实时亚洲盘口数据
}

export interface Prediction {
  match_id: string;
  home_team: string;
  away_team: string;
  probabilities: {
    home: number;
    draw: number;
    away: number;
  };
  algorithm: string;
  confidence: number;
  timestamp: string;
  momentum?: {
    home: number;
    away: number;
  };
  expectedGoals?: {
    home: number;
    away: number;
  };
  pressureAnalysis?: {
    homeNormalized: number;
    awayNormalized: number;
    dominantTeam: string;
  };
  asianHandicap?: AsianHandicapOdds[];
  goalBettingTips?: GoalBettingTips;  // 🟢 新增：进球投注建议
}

/**
 * 将 MatchData 转换为 MatchStats 格式
 */
function convertToMatchStats(match: MatchData): MatchStats {
  const stats: MatchStats = {
    minute: match.minute || 0,
    homeScore: match.home_score || 0,
    awayScore: match.away_score || 0,
  };

  // 只有在有值时才设置可选属性
  if (match.home_shots_on_target !== undefined) stats.homeShotsOnTarget = match.home_shots_on_target;
  if (match.away_shots_on_target !== undefined) stats.awayShotsOnTarget = match.away_shots_on_target;
  if (match.home_shots_off_target !== undefined) stats.homeShotsOffTarget = match.home_shots_off_target;
  if (match.away_shots_off_target !== undefined) stats.awayShotsOffTarget = match.away_shots_off_target;
  if (match.home_corners !== undefined) stats.homeCorners = match.home_corners;
  if (match.away_corners !== undefined) stats.awayCorners = match.away_corners;
  if (match.home_possession !== undefined) stats.homePossession = match.home_possession;
  if (match.away_possession !== undefined) stats.awayPossession = match.away_possession;
  if (match.home_red_cards !== undefined) stats.homeRedCards = match.home_red_cards;
  if (match.away_red_cards !== undefined) stats.awayRedCards = match.away_red_cards;
  if (match.home_dangerous_attacks !== undefined) stats.homeDangerousAttacks = match.home_dangerous_attacks;
  if (match.away_dangerous_attacks !== undefined) stats.awayDangerousAttacks = match.away_dangerous_attacks;

  // 🟢 注意：最近5分钟的统计增量由 calculateRecentStats() 方法通过时间滑窗算法计算
  // 这里只初始化为 0，实际值会在 calculatePrediction() 中被覆盖
  stats.recentHomeDangerousAttacks = 0;
  stats.recentAwayDangerousAttacks = 0;
  stats.recentHomeShotsOnTarget = 0;
  stats.recentAwayShotsOnTarget = 0;
  stats.recentHomeCorners = 0;
  stats.recentAwayCorners = 0;

  return stats;
}

/**
 * 比赛状态信息（用于跟踪每场比赛的历史）
 */
interface MatchState {
  liveProbEngine: LiveProbability;
  lastUpdate: Date;
  updateCount: number;
}

/**
 * 🟢 统计数据快照（用于时间滑窗计算）
 * 记录某一时刻的比赛统计数据，用于计算真实的增量
 */
interface StatsSnapshot {
  timestamp: number;
  homeDangerousAttacks: number;
  awayDangerousAttacks: number;
  homeShotsOnTarget: number;
  awayShotsOnTarget: number;
  homeCorners: number;
  awayCorners: number;
}

/**
 * 预测服务类 - QuantPredict v2.1
 * 
 * 🟢 新增功能：
 * - 每场比赛有专属的 LiveProbability 实例
 * - 跟踪历史动量数据
 * - 自动清理结束比赛的内存
 */
export class PredictionService {
  private readonly VERSION = '2.1.3';  // 🟢 版本升级：修复动量计算
  private readonly ALGORITHM = 'QuantPredict-v2.1.3';
  
  // 🟢 新增：用来“记住”每场比赛状态的 Map
  private matchStates: Map<string, MatchState> = new Map();
  
  // 🟢 新增：统计数据历史记录（用于时间滑窗计算真实增量）
  private matchStatsHistory: Map<string, StatsSnapshot[]> = new Map();
  
  // 🟢 时间滑窗配置
  private readonly SLIDING_WINDOW_MS = 5 * 60 * 1000; // 5分钟滑窗
  private readonly WINDOW_BUFFER_MS = 30 * 1000; // 30秒缓冲
  
  // 共享的盘口转换器和信号生成器（无状态）
  private handicapPricer: AsianHandicapPricer;
  private signalGenerator: TradingSignalGenerator;
  
  // 🟢 新增：内存清理配置
  private readonly MAX_MATCH_AGE_MS = 4 * 60 * 60 * 1000; // 4小时
  private readonly CLEANUP_INTERVAL_MS = 30 * 60 * 1000; // 30分钟清理一次
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.handicapPricer = new AsianHandicapPricer();
    this.signalGenerator = new TradingSignalGenerator();
    
    // 🟢 启动定期清理任务
    this.startCleanupTask();
  }

  /**
   * 🟢 获取或创建比赛专属的 LiveProbability 实例
   */
  private getOrCreateMatchEngine(matchId: string): LiveProbability {
    let matchState = this.matchStates.get(matchId);
    
    if (!matchState) {
      // 如果是第一次遇到这场比赛，创建一个新的引擎实例并存起来
      matchState = {
        liveProbEngine: new LiveProbability(),
        lastUpdate: new Date(),
        updateCount: 0,
      };
      this.matchStates.set(matchId, matchState);
      console.log(`[QuantPredict] 创建新的比赛引擎: ${matchId}`);
    } else {
      // 更新最后访问时间和计数
      matchState.lastUpdate = new Date();
      matchState.updateCount++;
    }
    
    return matchState.liveProbEngine;
  }

  /**
   * 🟢 计算真实的最近5分钟统计增量（时间滑窗算法）
   * 
   * 修复了原来的错误逻辑：不再用全场数据的比例来估算，
   * 而是通过记录历史快照，计算“当前总量 - 5分钟前的总量”得到真实增量。
   * 
   * 这样可以正确捕捉比赛的波峰波谷，例如：
   * - 某队前85分钟0射门，最后5分钟5次射门 -> 增量=5（动量爆表）
   * - 某队前85分钟18次射门，最后5分钟0次 -> 增量=0（动量很低）
   */
  private calculateRecentStats(matchId: string, currentMatch: MatchData): {
    recentHomeDangerousAttacks: number;
    recentAwayDangerousAttacks: number;
    recentHomeShotsOnTarget: number;
    recentAwayShotsOnTarget: number;
    recentHomeCorners: number;
    recentAwayCorners: number;
  } {
    const now = Date.now();
    
    // 创建当前时刻的快照
    const currentSnapshot: StatsSnapshot = {
      timestamp: now,
      homeDangerousAttacks: currentMatch.home_dangerous_attacks || 0,
      awayDangerousAttacks: currentMatch.away_dangerous_attacks || 0,
      homeShotsOnTarget: currentMatch.home_shots_on_target || 0,
      awayShotsOnTarget: currentMatch.away_shots_on_target || 0,
      homeCorners: currentMatch.home_corners || 0,
      awayCorners: currentMatch.away_corners || 0,
    };
    
    // 获取该比赛的历史记录
    let history = this.matchStatsHistory.get(matchId) || [];
    history.push(currentSnapshot);
    
    // 移除过期数据（只保留滑窗时间 + 缓冲时间内的数据）
    history = history.filter(s => now - s.timestamp <= this.SLIDING_WINDOW_MS + this.WINDOW_BUFFER_MS);
    
    // 更新历史记录
    this.matchStatsHistory.set(matchId, history);
    
    // 找到最接近 5 分钟前的那个快照
    // 如果比赛刚开始不到 5 分钟，就取最开始的快照（索引 0）
    // 如果历史记录为空，使用当前快照作为基准（增量为0）
    const baseSnapshot: StatsSnapshot = history.find(s => now - s.timestamp >= this.SLIDING_WINDOW_MS) || history[0] || currentSnapshot;
    
    // 计算增量 (Delta)
    const recentStats = {
      recentHomeDangerousAttacks: Math.max(0, currentSnapshot.homeDangerousAttacks - baseSnapshot.homeDangerousAttacks),
      recentAwayDangerousAttacks: Math.max(0, currentSnapshot.awayDangerousAttacks - baseSnapshot.awayDangerousAttacks),
      recentHomeShotsOnTarget: Math.max(0, currentSnapshot.homeShotsOnTarget - baseSnapshot.homeShotsOnTarget),
      recentAwayShotsOnTarget: Math.max(0, currentSnapshot.awayShotsOnTarget - baseSnapshot.awayShotsOnTarget),
      recentHomeCorners: Math.max(0, currentSnapshot.homeCorners - baseSnapshot.homeCorners),
      recentAwayCorners: Math.max(0, currentSnapshot.awayCorners - baseSnapshot.awayCorners),
    };
    
    // 调试日志（每10次输出一次）
    const matchState = this.matchStates.get(matchId);
    if (matchState && matchState.updateCount % 10 === 0) {
      const timeDiff = Math.round((now - baseSnapshot.timestamp) / 1000);
      console.log(`[时间滑窗] ${matchId}: 历史快照=${history.length}, 基准时间=${timeDiff}s前, 射正增量=${recentStats.recentHomeShotsOnTarget}-${recentStats.recentAwayShotsOnTarget}`);
    }
    
    return recentStats;
  }

  /**
   * 计算比赛预测概率
   * 
   * 🟢 v2.1.3 修复：使用时间滑窗计算真实的最近5分钟统计增量
   */
  calculatePrediction(match: MatchData): Prediction {
    // 🟢 先转换基础统计数据
    const stats = convertToMatchStats(match);
    
    // 🟢 计算真实的最近5分钟增量（时间滑窗算法）
    const recentStats = this.calculateRecentStats(match.match_id, match);
    
    // 🟢 用真实增量覆盖错误的估算值
    Object.assign(stats, recentStats);

    // 🟢 获取或创建该比赛专属的计算实例
    const liveProbEngine = this.getOrCreateMatchEngine(match.match_id);

    // 🟢 使用实例方法 predict，而不是无状态的 predictMatch 函数
    // 这样可以保留历史动量数据
    const prediction = liveProbEngine.predict(stats);

    // 获取亚洲盘口数据
    const asianHandicap = this.handicapPricer.getAllHandicapLines(stats);

    // 🟢 [v2.1.1] 修复：注入同一个 LiveProbability 实例到 GoalPredictor
    // 这样可以共享动量历史状态，避免重复创建
    const goalPredictor = new GoalPredictor(liveProbEngine);
    const goalBettingTips = goalPredictor.generateGoalBettingTips(stats, match.liveAsianHandicap);

    return {
      match_id: match.match_id,
      home_team: match.home_team,
      away_team: match.away_team,
      probabilities: {
        home: prediction.homeWinProb,
        draw: prediction.drawProb,
        away: prediction.awayWinProb,
      },
      algorithm: this.ALGORITHM,
      confidence: prediction.confidence,
      timestamp: new Date().toISOString(),
      // 🟢 现在这里会有真正的历史动量了
      momentum: {
        home: prediction.homeMomentum,
        away: prediction.awayMomentum,
      },
      expectedGoals: {
        home: prediction.homeExpectedGoals,
        away: prediction.awayExpectedGoals,
      },
      pressureAnalysis: prediction.pressureAnalysis,
      asianHandicap,
      goalBettingTips,  // 🟢 新增：进球投注建议
    };
  }

  /**
   * 批量计算预测
   */
  calculatePredictions(matches: MatchData[]): Prediction[] {
    return matches.map((match) => {
      try {
        return this.calculatePrediction(match);
      } catch (error) {
        console.error(`预测失败 [${match.match_id}]:`, error);
        // 返回默认预测
        return {
          match_id: match.match_id,
          home_team: match.home_team,
          away_team: match.away_team,
          probabilities: {
            home: 0.33,
            draw: 0.34,
            away: 0.33,
          },
          algorithm: `${this.ALGORITHM}-fallback`,
          confidence: 0.5,
          timestamp: new Date().toISOString(),
        };
      }
    });
  }

  /**
   * 🟢 新增：清理结束比赛的内存，防止内存泄漏
   */
  removeMatch(matchId: string): boolean {
    const existed = this.matchStates.has(matchId);
    if (existed) {
      this.matchStates.delete(matchId);
      console.log(`[QuantPredict] 移除比赛引擎: ${matchId}`);
    }
    return existed;
  }

  /**
   * 🟢 新增：批量清理结束的比赛
   */
  removeMatches(matchIds: string[]): number {
    let removed = 0;
    for (const matchId of matchIds) {
      if (this.removeMatch(matchId)) {
        removed++;
      }
    }
    return removed;
  }

  /**
   * 🟢 新增：清理过期的比赛状态
   */
  cleanupStaleMatches(): number {
    const now = new Date();
    const staleMatchIds: string[] = [];
    
    for (const [matchId, state] of this.matchStates.entries()) {
      const age = now.getTime() - state.lastUpdate.getTime();
      if (age > this.MAX_MATCH_AGE_MS) {
        staleMatchIds.push(matchId);
      }
    }
    
    if (staleMatchIds.length > 0) {
      console.log(`[QuantPredict] 清理 ${staleMatchIds.length} 个过期比赛状态`);
      return this.removeMatches(staleMatchIds);
    }
    
    return 0;
  }

  /**
   * 🟢 新增：启动定期清理任务
   */
  private startCleanupTask(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
    
    this.cleanupTimer = setInterval(() => {
      this.cleanupStaleMatches();
    }, this.CLEANUP_INTERVAL_MS);
    
    console.log(`[QuantPredict] 启动定期清理任务，间隔: ${this.CLEANUP_INTERVAL_MS / 1000}秒`);
  }

  /**
   * 🟢 新增：停止清理任务（用于优雅关闭）
   */
  stopCleanupTask(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
      console.log('[QuantPredict] 停止定期清理任务');
    }
  }

  /**
   * 生成交易信号
   */
  generateTradingSignals(
    match: MatchData,
    marketOdds?: {
      '1x2'?: { home: number; draw: number; away: number };
      asianHandicap?: Record<string, { home: number; away: number }>;
    }
  ) {
    const stats = convertToMatchStats(match);
    return this.signalGenerator.generateFullAnalysis(stats, marketOdds);
  }

  /**
   * 获取服务版本
   */
  getVersion(): string {
    return this.VERSION;
  }

  /**
   * 🟢 新增：获取当前跟踪的比赛数量
   */
  getActiveMatchCount(): number {
    return this.matchStates.size;
  }

  /**
   * 🟢 新增：获取比赛状态统计
   */
  getMatchStateStats(): {
    activeMatches: number;
    matchIds: string[];
    oldestMatch: { id: string; age: number } | null;
    newestMatch: { id: string; age: number } | null;
  } {
    const now = new Date();
    const matchIds = Array.from(this.matchStates.keys());
    
    let oldestMatch: { id: string; age: number } | null = null;
    let newestMatch: { id: string; age: number } | null = null;
    
    for (const [matchId, state] of this.matchStates.entries()) {
      const age = now.getTime() - state.lastUpdate.getTime();
      
      if (!oldestMatch || age > oldestMatch.age) {
        oldestMatch = { id: matchId, age };
      }
      if (!newestMatch || age < newestMatch.age) {
        newestMatch = { id: matchId, age };
      }
    }
    
    return {
      activeMatches: this.matchStates.size,
      matchIds,
      oldestMatch,
      newestMatch,
    };
  }

  /**
   * 获取服务信息
   */
  getServiceInfo() {
    return {
      name: 'QuantPredict',
      version: this.VERSION,
      algorithm: this.ALGORITHM,
      activeMatches: this.matchStates.size,
      features: [
        'Dynamic Poisson Model',
        'Pressure Index (Momentum Engine)',
        'Asian Handicap Pricer',
        'Trading Signal Generator',
        'Time Decay Analysis',
        'Split Handicap Support',
        '🟢 Per-Match State Management',
        '🟢 Historical Momentum Tracking',
        '🟢 Automatic Memory Cleanup',
      ],
    };
  }
}

// 导出单例
export const predictionService = new PredictionService();
