/**
 * 预测服务 - 使用 QuantPredict v2.0 算法
 * 
 * 这是一个高级足球滚球预测引擎，包含：
 * - 动量引擎 (Pressure Index)
 * - 动态泊松模型 (Dynamic Poisson)
 * - 亚洲盘口转换器 (Asian Handicap Pricer)
 * - 交易信号生成器 (Trading Signal Generator)
 */

import {
  predictMatch,
  LiveProbability,
  AsianHandicapPricer,
  TradingSignalGenerator,
  MatchStats,
  AsianHandicapOdds,
} from './quantPredictService';

export interface MatchData {
  match_id: string;
  home_team: string;
  away_team: string;
  home_score: number;
  away_score: number;
  minute: number;
  status?: string;
  league?: string;
  home_shots_on_target?: number;
  away_shots_on_target?: number;
  home_shots_off_target?: number;
  away_shots_off_target?: number;
  home_possession?: number;
  away_possession?: number;
  home_corners?: number;
  away_corners?: number;
  home_red_cards?: number;
  away_red_cards?: number;
  home_dangerous_attacks?: number;
  away_dangerous_attacks?: number;
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

  // 估算最近5分钟的统计（基于全场数据的比例）
  const minuteRatio = Math.min(1, 5 / Math.max(1, match.minute));
  stats.recentHomeDangerousAttacks = Math.round((match.home_dangerous_attacks || 0) * minuteRatio);
  stats.recentAwayDangerousAttacks = Math.round((match.away_dangerous_attacks || 0) * minuteRatio);
  stats.recentHomeShotsOnTarget = Math.round((match.home_shots_on_target || 0) * minuteRatio);
  stats.recentAwayShotsOnTarget = Math.round((match.away_shots_on_target || 0) * minuteRatio);
  stats.recentHomeCorners = Math.round((match.home_corners || 0) * minuteRatio);
  stats.recentAwayCorners = Math.round((match.away_corners || 0) * minuteRatio);

  return stats;
}

/**
 * 预测服务类 - QuantPredict v2.0
 */
export class PredictionService {
  private readonly VERSION = '2.0.0';
  private readonly ALGORITHM = 'QuantPredict-v2.0';
  private liveProbability: LiveProbability;
  private handicapPricer: AsianHandicapPricer;
  private signalGenerator: TradingSignalGenerator;

  constructor() {
    this.liveProbability = new LiveProbability();
    this.handicapPricer = new AsianHandicapPricer();
    this.signalGenerator = new TradingSignalGenerator();
  }

  /**
   * 计算比赛预测概率
   */
  calculatePrediction(match: MatchData): Prediction {
    const stats = convertToMatchStats(match);
    const prediction = predictMatch({
      minute: stats.minute,
      homeScore: stats.homeScore,
      awayScore: stats.awayScore,
      stats,
    });

    // 获取亚洲盘口数据
    const asianHandicap = this.handicapPricer.getAllHandicapLines(stats);

    return {
      match_id: match.match_id,
      home_team: match.home_team,
      away_team: match.away_team,
      probabilities: {
        home: prediction.home,
        draw: prediction.draw,
        away: prediction.away,
      },
      algorithm: this.ALGORITHM,
      confidence: prediction.confidence,
      timestamp: new Date().toISOString(),
      momentum: prediction.momentum,
      expectedGoals: prediction.expectedGoals,
      pressureAnalysis: prediction.pressureAnalysis,
      asianHandicap,
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
   * 获取服务信息
   */
  getServiceInfo() {
    return {
      name: 'QuantPredict',
      version: this.VERSION,
      algorithm: this.ALGORITHM,
      features: [
        'Dynamic Poisson Model',
        'Pressure Index (Momentum Engine)',
        'Asian Handicap Pricer',
        'Trading Signal Generator',
        'Time Decay Analysis',
        'Split Handicap Support',
      ],
    };
  }
}

// 导出单例
export const predictionService = new PredictionService();
