/**
 * QuantPredict v2.1 预测数据类型定义
 */

/**
 * 压力分析数据
 * 表示主客队的场上压力对比
 */
export interface PressureAnalysis {
  /** 主队归一化压力值 (0-100) */
  homeNormalized: number;
  /** 客队归一化压力值 (0-100) */
  awayNormalized: number;
  /** 场上主导方 */
  dominantTeam: 'HOME' | 'AWAY' | 'BALANCED';
}

/**
 * 动量数据
 * 表示主客队的动量系数
 */
export interface Momentum {
  /** 主队动量系数 (0.7-1.3) */
  home: number;
  /** 客队动量系数 (0.7-1.3) */
  away: number;
}

/**
 * 预期进球数
 */
export interface ExpectedGoals {
  /** 主队预期进球数 */
  home: number;
  /** 客队预期进球数 */
  away: number;
}

/**
 * 亚洲盘口赔率
 */
export interface AsianHandicapOdds {
  /** 盘口值 (如 -0.5, -0.25, 0, +0.5 等) */
  handicap: number;
  /** 主队胜出概率 */
  homeProbability: number;
  /** 客队胜出概率 */
  awayProbability: number;
  /** 主队公平赔率 */
  homeFairOdds: number;
  /** 客队公平赔率 */
  awayFairOdds: number;
}

/**
 * 胜平负概率
 */
export interface Probabilities {
  /** 主胜概率 */
  home: number;
  /** 平局概率 */
  draw: number;
  /** 客胜概率 */
  away: number;
}

/**
 * 完整的预测数据接口
 * 包含 QuantPredict v2.1 返回的所有字段
 */
export interface Prediction {
  /** 比赛 ID */
  match_id: string;
  /** 主队名称 */
  home_team: string;
  /** 客队名称 */
  away_team: string;
  /** 胜平负概率 */
  probabilities: Probabilities;
  /** 预测算法名称 */
  algorithm: string;
  /** 预测置信度 (0-1) */
  confidence: number;
  /** 预测时间戳 */
  timestamp: string;
  /** 动量数据 (v2.1 新增) */
  momentum?: Momentum;
  /** 预期进球数 */
  expectedGoals?: ExpectedGoals;
  /** 压力分析数据 (v2.1 新增) */
  pressureAnalysis?: PressureAnalysis;
  /** 亚洲盘口数据 */
  asianHandicap?: AsianHandicapOdds[];
}

/**
 * 简化的预测概率（用于 MatchState）
 */
export interface SimplePrediction extends Probabilities {
  /** 动量数据 */
  momentum?: Momentum;
  /** 压力分析数据 */
  pressureAnalysis?: PressureAnalysis;
  /** 预测置信度 */
  confidence?: number;
}
