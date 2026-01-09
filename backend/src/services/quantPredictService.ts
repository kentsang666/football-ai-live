/**
 * QuantPredict v2.1 - 增强版足球滚球预测引擎
 * 
 * 核心逻辑：寻找“市场赔率”与“模型真实概率”之间的偏差
 * 
 * v2.1 修改日志：
 * 1. 修复 PressureIndex 的状态污染问题（增加分钟级防抖）
 * 2. 增强红牌逻辑（直接影响 Lambda）
 * 3. 优化时间衰减模型（最后10分钟进球提升）
 * 4. 增加输入数据健壮性检查
 * 
 * 模块：
 * 1. PressureIndex - 实时动量引擎
 * 2. LiveProbability - 动态泊松模型
 * 3. AsianHandicapPricer - 亚洲盘口转换器
 * 4. TradingSignalGenerator - 交易信号生成器
 */

// =============================================================================
// 配置常量
// =============================================================================

const WEIGHTS = {
  dangerous_attacks: 0.1,
  shots_on_target: 1.0,
  shots_off_target: 0.4,
  corners: 0.3,
  possession: 0.05,
  red_cards_pressure: -2.0,  // 仅影响压力的红牌权重
};

const CONFIG = {
  MOMENTUM_SMOOTHING: 0.3,
  DEFAULT_HOME_XG: 1.45,
  DEFAULT_AWAY_XG: 1.15,
  RED_CARD_LAMBDA_FACTOR: 0.65,  // 红牌对预期进球的直接削减系数 (少一人约降低35%攻击力)
  NON_LINEAR_TIME_BOOST: 1.1,    // 比赛末段进球概率提升系数
  VALUE_THRESHOLD: 0.05,
  MIN_ODDS: 1.10,
  MAX_ODDS: 20.0,
};

// 兼容旧版本的常量引用
const MOMENTUM_SMOOTHING = CONFIG.MOMENTUM_SMOOTHING;
const DEFAULT_HOME_XG = CONFIG.DEFAULT_HOME_XG;
const DEFAULT_AWAY_XG = CONFIG.DEFAULT_AWAY_XG;
const VALUE_THRESHOLD = CONFIG.VALUE_THRESHOLD;
const MIN_ODDS = CONFIG.MIN_ODDS;
const MAX_ODDS = CONFIG.MAX_ODDS;

// =============================================================================
// 类型定义
// =============================================================================

export interface MatchStats {
  minute: number;
  homeScore: number;
  awayScore: number;
  homeDangerousAttacks?: number;
  awayDangerousAttacks?: number;
  homeShotsOnTarget?: number;
  awayShotsOnTarget?: number;
  homeShotsOffTarget?: number;
  awayShotsOffTarget?: number;
  homeCorners?: number;
  awayCorners?: number;
  homePossession?: number;
  awayPossession?: number;
  homeRedCards?: number;
  awayRedCards?: number;
  // 最近5分钟统计
  recentHomeDangerousAttacks?: number;
  recentAwayDangerousAttacks?: number;
  recentHomeShotsOnTarget?: number;
  recentAwayShotsOnTarget?: number;
  recentHomeCorners?: number;
  recentAwayCorners?: number;
}

export interface PredictionResult {
  homeWinProb: number;
  drawProb: number;
  awayWinProb: number;
  homeExpectedGoals: number;
  awayExpectedGoals: number;
  homeMomentum: number;
  awayMomentum: number;
  confidence: number;
  algorithm: string;
  pressureAnalysis: {
    homeNormalized: number;
    awayNormalized: number;
    dominantTeam: string;
  };
}

export interface AsianHandicapOdds {
  handicap: number;
  homeProbability: number;
  awayProbability: number;
  homeFairOdds: number;
  awayFairOdds: number;
}

export interface TradingSignal {
  signalType: 'VALUE_BET' | 'NO_VALUE' | 'AVOID';
  market: string;
  selection: string;
  fairOdds: number;
  marketOdds: number;
  edge: number;
  confidence: number;
}

// =============================================================================
// 数学工具函数
// =============================================================================

/**
 * 计算泊松分布的概率质量函数
 */
function poissonPMF(k: number, lambda: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  if (k < 0) return 0;
  
  let result = Math.exp(-lambda);
  for (let i = 1; i <= k; i++) {
    result *= lambda / i;
  }
  return result;
}

/**
 * 计算阶乘
 */
function factorial(n: number): number {
  if (n <= 1) return 1;
  let result = 1;
  for (let i = 2; i <= n; i++) {
    result *= i;
  }
  return result;
}

// =============================================================================
// 1. 实时动量引擎 (Pressure Index)
// =============================================================================

export class PressureIndex {
  private weights: typeof WEIGHTS;
  private momentumHistory: { home: number[]; away: number[] };
  private lastProcessedMinute: number = -1;  // [v2.1] 增加防抖标记

  constructor(weights?: Partial<typeof WEIGHTS>) {
    this.weights = { ...WEIGHTS, ...weights };
    this.momentumHistory = { home: [], away: [] };
  }

  /**
   * 计算原始压力值
   * [v2.1] 优化控球率计算，只计算优势方的压力
   */
  calculateRawPressure(stats: MatchStats): [number, number] {
    // 使用默认值处理 undefined
    const rHDA = stats.recentHomeDangerousAttacks || 0;
    const rADA = stats.recentAwayDangerousAttacks || 0;
    const rHST = stats.recentHomeShotsOnTarget || 0;
    const rAST = stats.recentAwayShotsOnTarget || 0;
    const rHC = stats.recentHomeCorners || 0;
    const rAC = stats.recentAwayCorners || 0;
    const hPoss = stats.homePossession || 50;
    const aPoss = stats.awayPossession || 50;

    // 基础压力计算
    let homePressure =
      rHDA * this.weights.dangerous_attacks +
      rHST * this.weights.shots_on_target +
      (stats.homeShotsOffTarget || 0) * 0.1 * this.weights.shots_off_target +  // [v2.1] 射偏权重降低
      rHC * this.weights.corners +
      Math.max(0, hPoss - 50) * this.weights.possession;  // [v2.1] 只计算优势方的控球压力

    let awayPressure =
      rADA * this.weights.dangerous_attacks +
      rAST * this.weights.shots_on_target +
      (stats.awayShotsOffTarget || 0) * 0.1 * this.weights.shots_off_target +
      rAC * this.weights.corners +
      Math.max(0, aPoss - 50) * this.weights.possession;

    // 动量中的红牌影响（心理层面）
    const hRed = stats.homeRedCards || 0;
    const aRed = stats.awayRedCards || 0;
    
    if (hRed > 0) awayPressure += hRed * Math.abs(this.weights.red_cards_pressure);
    if (aRed > 0) homePressure += aRed * Math.abs(this.weights.red_cards_pressure);

    return [Math.max(0, homePressure), Math.max(0, awayPressure)];
  }

  /**
   * 归一化压力值到 0-100
   */
  normalizePressure(homePressure: number, awayPressure: number): [number, number] {
    const total = homePressure + awayPressure;
    if (total === 0) return [50, 50];  // 势均力敌
    return [(homePressure / total) * 100, (awayPressure / total) * 100];
  }

  /**
   * 计算动量系数
   * [v2.1] 增加防抖机制，防止同一分钟多次调用导致历史数据堆积
   */
  calculateMomentumFactor(stats: MatchStats): [number, number] {
    const [homePressure, awayPressure] = this.calculateRawPressure(stats);
    const [homeNorm, awayNorm] = this.normalizePressure(homePressure, awayPressure);

    // [v2.1] 状态更新防抖：只有当分钟数改变时，才推入历史数组
    if (stats.minute > this.lastProcessedMinute) {
      this.momentumHistory.home.push(homeNorm);
      this.momentumHistory.away.push(awayNorm);
      this.lastProcessedMinute = stats.minute;

      // 保持最近10分钟窗口
      if (this.momentumHistory.home.length > 10) {
        this.momentumHistory.home.shift();  // [v2.1] 性能优化：shift比slice更符合队列语义
        this.momentumHistory.away.shift();
      }
    }

    // 移动平均计算
    let homeSmoothed = homeNorm;
    let awaySmoothed = awayNorm;

    if (this.momentumHistory.home.length > 0) {
      // 计算简单平均值作为基准
      const homeAvg = this.momentumHistory.home.reduce((a, b) => a + b, 0) / this.momentumHistory.home.length;
      const awayAvg = this.momentumHistory.away.reduce((a, b) => a + b, 0) / this.momentumHistory.away.length;
      
      // 动量平滑：当前值占30%，历史平均占70%
      homeSmoothed = CONFIG.MOMENTUM_SMOOTHING * homeNorm + (1 - CONFIG.MOMENTUM_SMOOTHING) * homeAvg;
      awaySmoothed = CONFIG.MOMENTUM_SMOOTHING * awayNorm + (1 - CONFIG.MOMENTUM_SMOOTHING) * awayAvg;
    }

    // 映射到 0.7 - 1.3 区间
    // 50分 -> 1.0 (正常)
    // 100分 -> 1.3 (极强)
    // 0分 -> 0.7 (极弱)
    const homeFactor = 0.7 + (homeSmoothed / 100) * 0.6;
    const awayFactor = 0.7 + (awaySmoothed / 100) * 0.6;

    return [homeFactor, awayFactor];
  }

  /**
   * 获取压力分析摘要
   */
  getPressureSummary(stats: MatchStats): {
    homeRawPressure: number;
    awayRawPressure: number;
    homeNormalized: number;
    awayNormalized: number;
    homeMomentumFactor: number;
    awayMomentumFactor: number;
    dominantTeam: string;
  } {
    const [homePressure, awayPressure] = this.calculateRawPressure(stats);
    const [homeNorm, awayNorm] = this.normalizePressure(homePressure, awayPressure);
    const [homeFactor, awayFactor] = this.calculateMomentumFactor(stats);

    return {
      homeRawPressure: Math.round(homePressure * 100) / 100,
      awayRawPressure: Math.round(awayPressure * 100) / 100,
      homeNormalized: Math.round(homeNorm * 10) / 10,
      awayNormalized: Math.round(awayNorm * 10) / 10,
      homeMomentumFactor: Math.round(homeFactor * 1000) / 1000,
      awayMomentumFactor: Math.round(awayFactor * 1000) / 1000,
      dominantTeam: homeNorm > awayNorm ? 'HOME' : awayNorm > homeNorm ? 'AWAY' : 'BALANCED',
    };
  }
}

// =============================================================================
// 2. 动态泊松模型 (Live Probability)
// =============================================================================

export class LiveProbability {
  private initialHomeXG: number;
  private initialAwayXG: number;
  private maxGoals: number;
  private pressureIndex: PressureIndex;

  constructor(
    homeXG = CONFIG.DEFAULT_HOME_XG, 
    awayXG = CONFIG.DEFAULT_AWAY_XG, 
    maxGoals = 8  // [v2.1] 优化：足球单队很少超过8球，减小矩阵计算量
  ) {
    this.initialHomeXG = homeXG;
    this.initialAwayXG = awayXG;
    this.maxGoals = maxGoals;
    this.pressureIndex = new PressureIndex();
  }

  /**
   * 计算时间衰减系数
   * [v2.1] 优化时间衰减逻辑，最后10分钟进球意愿提升
   */
  calculateTimeDecay(currentMinute: number, totalMinutes = 90): number {
    const remainingTime = Math.max(0, totalMinutes - currentMinute);
    let decay = remainingTime / totalMinutes;
    
    // [v2.1] 补时/绝杀修正：如果是最后10分钟，进球意愿提升
    if (currentMinute > 80) {
      decay *= CONFIG.NON_LINEAR_TIME_BOOST;
    }
    return decay;
  }

  /**
   * 计算当前 Lambda 值
   * [v2.1] 增强红牌逻辑，直接影响 Lambda
   */
  calculateCurrentLambda(stats: MatchStats): [number, number] {
    const timeDecay = this.calculateTimeDecay(stats.minute);
    let [homeMomentum, awayMomentum] = this.pressureIndex.calculateMomentumFactor(stats);

    // 1. 基础衰减
    let homeLambda = this.initialHomeXG * timeDecay;
    let awayLambda = this.initialAwayXG * timeDecay;

    // 2. 动量修正
    homeLambda *= homeMomentum;
    awayLambda *= awayMomentum;

    // 3. [v2.1] 结构性红牌修正 (Permanent Damage)
    if ((stats.homeRedCards || 0) > 0) {
      // 每张红牌指数级衰减
      homeLambda *= Math.pow(CONFIG.RED_CARD_LAMBDA_FACTOR, stats.homeRedCards || 1);
    }
    if ((stats.awayRedCards || 0) > 0) {
      awayLambda *= Math.pow(CONFIG.RED_CARD_LAMBDA_FACTOR, stats.awayRedCards || 1);
    }

    // 4. [v2.1] 比分战术修正 (Game State) - 任何领先/落后都调整
    const scoreDiff = stats.homeScore - stats.awayScore;
    if (scoreDiff > 0) {
      // 主队领先：主队偏防守(XG降)，客队偏进攻(XG升)
      homeLambda *= 0.85;
      awayLambda *= 1.15;
    } else if (scoreDiff < 0) {
      homeLambda *= 1.15;
      awayLambda *= 0.85;
    }

    return [
      Math.max(0.001, homeLambda),
      Math.max(0.001, awayLambda)
    ];
  }

  /**
   * 计算比分概率矩阵
   */
  calculateScoreProbabilities(homeLambda: number, awayLambda: number): number[][] {
    const probMatrix: number[][] = [];

    for (let homeGoals = 0; homeGoals <= this.maxGoals; homeGoals++) {
      probMatrix[homeGoals] = [];
      for (let awayGoals = 0; awayGoals <= this.maxGoals; awayGoals++) {
        probMatrix[homeGoals]![awayGoals] =
          poissonPMF(homeGoals, homeLambda) * poissonPMF(awayGoals, awayLambda);
      }
    }

    // 归一化
    let total = 0;
    for (let i = 0; i <= this.maxGoals; i++) {
      for (let j = 0; j <= this.maxGoals; j++) {
        total += probMatrix[i]![j]!;
      }
    }
    if (total > 0) {
      for (let i = 0; i <= this.maxGoals; i++) {
        for (let j = 0; j <= this.maxGoals; j++) {
          probMatrix[i]![j]! /= total;
        }
      }
    }

    return probMatrix;
  }

  /**
   * 计算比赛结果概率
   */
  calculateMatchOutcomeProbabilities(stats: MatchStats): [number, number, number] {
    const [homeLambda, awayLambda] = this.calculateCurrentLambda(stats);
    const probMatrix = this.calculateScoreProbabilities(homeLambda, awayLambda);

    let homeWinProb = 0;
    let drawProb = 0;
    let awayWinProb = 0;

    for (let addHome = 0; addHome <= this.maxGoals; addHome++) {
      for (let addAway = 0; addAway <= this.maxGoals; addAway++) {
        const finalHome = stats.homeScore + addHome;
        const finalAway = stats.awayScore + addAway;
        const prob = probMatrix[addHome]![addAway] || 0;

        if (finalHome > finalAway) {
          homeWinProb += prob;
        } else if (finalHome < finalAway) {
          awayWinProb += prob;
        } else {
          drawProb += prob;
        }
      }
    }

    // 归一化
    const total = homeWinProb + drawProb + awayWinProb;
    if (total > 0) {
      homeWinProb /= total;
      drawProb /= total;
      awayWinProb /= total;
    }

    return [homeWinProb, drawProb, awayWinProb];
  }

  /**
   * 生成完整预测结果
   * [v2.1] 优化置信度计算
   */
  predict(stats: MatchStats): PredictionResult {
    const [homeLambda, awayLambda] = this.calculateCurrentLambda(stats);
    const [homeWin, draw, awayWin] = this.calculateMatchOutcomeProbabilities(stats);
    const [homeMomentum, awayMomentum] = this.pressureIndex.calculateMomentumFactor(stats);
    const pressureSummary = this.pressureIndex.getPressureSummary(stats);

    // [v2.1] 优化置信度计算
    // 比赛时间越久，不确定性(Lambda)越小，置信度越高
    const timeProgress = Math.min(1.0, stats.minute / 90);
    const momentumStability = 1.0 - Math.abs(homeMomentum - awayMomentum) * 0.2;
    const confidence = 0.6 + (timeProgress * 0.3) + (momentumStability * 0.1);

    return {
      homeWinProb: parseFloat(homeWin.toFixed(4)),
      drawProb: parseFloat(draw.toFixed(4)),
      awayWinProb: parseFloat(awayWin.toFixed(4)),
      homeExpectedGoals: parseFloat(homeLambda.toFixed(3)),
      awayExpectedGoals: parseFloat(awayLambda.toFixed(3)),
      homeMomentum: parseFloat(homeMomentum.toFixed(2)),
      awayMomentum: parseFloat(awayMomentum.toFixed(2)),
      confidence: parseFloat(confidence.toFixed(2)),
      algorithm: 'QuantPredict-v2.1',
      pressureAnalysis: {
        homeNormalized: pressureSummary.homeNormalized,
        awayNormalized: pressureSummary.awayNormalized,
        dominantTeam: pressureSummary.dominantTeam,
      },
    };
  }
}

// =============================================================================
// 3. 亚洲盘口转换器 (Asian Handicap Pricer)
// =============================================================================

export class AsianHandicapPricer {
  private margin: number;
  private liveProbability: LiveProbability;

  constructor(margin = 0) {
    this.margin = margin;
    this.liveProbability = new LiveProbability();
  }

  /**
   * 概率转赔率
   */
  probabilityToOdds(probability: number): number {
    if (probability <= 0) return MAX_ODDS;
    if (probability >= 1) return MIN_ODDS;

    const fairOdds = 1 / probability;
    const adjustedOdds = fairOdds * (1 - this.margin);

    return Math.max(MIN_ODDS, Math.min(MAX_ODDS, adjustedOdds));
  }

  /**
   * 计算盘口胜出概率
   */
  calculateHandicapProbability(
    stats: MatchStats,
    handicap: number,
    forHome = true
  ): [number, number] {
    const [homeLambda, awayLambda] = this.liveProbability.calculateCurrentLambda(stats);
    const probMatrix = this.liveProbability.calculateScoreProbabilities(homeLambda, awayLambda);

    let winProb = 0;
    let pushProb = 0;

    // [v2.1] 修复：使用 probMatrix 的实际长度，避免越界
    const maxGoals = probMatrix.length - 1;
    for (let addHome = 0; addHome <= maxGoals; addHome++) {
      for (let addAway = 0; addAway <= maxGoals; addAway++) {
        const finalHome = stats.homeScore + addHome;
        const finalAway = stats.awayScore + addAway;
        const prob = probMatrix[addHome]?.[addAway] || 0;

        let adjustedDiff: number;
        if (forHome) {
          adjustedDiff = finalHome - finalAway + handicap;
        } else {
          adjustedDiff = finalAway - finalHome + handicap;
        }

        if (adjustedDiff > 0) {
          winProb += prob;
        } else if (adjustedDiff === 0) {
          pushProb += prob;
        }
      }
    }

    return [winProb, pushProb];
  }

  /**
   * 计算四分之一盘口
   */
  calculateSplitHandicap(stats: MatchStats, handicap: number, forHome = true): number {
    const decimalPart = Math.abs(handicap) % 0.5;

    if (Math.abs(decimalPart - 0.25) < 0.01) {
      const lowerHandicap = handicap - 0.25;
      const upperHandicap = handicap + 0.25;

      const [winProbLower, pushProbLower] = this.calculateHandicapProbability(
        stats,
        lowerHandicap,
        forHome
      );
      const [winProbUpper, pushProbUpper] = this.calculateHandicapProbability(
        stats,
        upperHandicap,
        forHome
      );

      return (
        0.5 * (winProbLower + 0.5 * pushProbLower + (winProbUpper + 0.5 * pushProbUpper))
      );
    } else {
      const [winProb, pushProb] = this.calculateHandicapProbability(stats, handicap, forHome);
      return winProb + 0.5 * pushProb;
    }
  }

  /**
   * 获取亚洲盘口赔率
   */
  getAsianHandicapOdds(stats: MatchStats, handicap: number): AsianHandicapOdds {
    const homeProb = this.calculateSplitHandicap(stats, handicap, true);
    let awayProb = this.calculateSplitHandicap(stats, -handicap, false);

    // 归一化
    const total = homeProb + awayProb;
    const normalizedHomeProb = total > 0 ? homeProb / total : 0.5;
    const normalizedAwayProb = total > 0 ? awayProb / total : 0.5;

    return {
      handicap,
      homeProbability: Math.round(normalizedHomeProb * 10000) / 10000,
      awayProbability: Math.round(normalizedAwayProb * 10000) / 10000,
      homeFairOdds: Math.round(this.probabilityToOdds(normalizedHomeProb) * 1000) / 1000,
      awayFairOdds: Math.round(this.probabilityToOdds(normalizedAwayProb) * 1000) / 1000,
    };
  }

  /**
   * 获取所有常用盘口线
   */
  getAllHandicapLines(stats: MatchStats): AsianHandicapOdds[] {
    const handicapLines = [-1.5, -1.25, -1.0, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1.0, 1.25, 1.5];
    return handicapLines.map((handicap) => this.getAsianHandicapOdds(stats, handicap));
  }
}

// =============================================================================
// 4. 大小球预测器 (Over/Under Predictor)
// =============================================================================

export interface GoalPrediction {
  line: number;           // 盘口线 (0.5, 1.5, 2.5, 3.5, 4.5)
  overProb: number;       // 大于该线的概率
  underProb: number;      // 小于该线的概率
  overOdds: number;       // 大球赔率
  underOdds: number;      // 小球赔率
  recommendation: 'OVER' | 'UNDER' | 'NEUTRAL';  // 推荐
  confidence: number;     // 置信度
}

export interface NextGoalPrediction {
  homeProb: number;       // 主队进下一球概率
  awayProb: number;       // 客队进下一球概率
  noGoalProb: number;     // 不再进球概率
  recommendation: 'HOME' | 'AWAY' | 'NO_GOAL' | 'NEUTRAL';
  confidence: number;
  expectedMinutes: number; // 预计下一球时间（分钟）
}

// 实时亚洲盘口数据接口（从 footballService 传入）
export interface LiveAsianHandicap {
  line: string;      // 盘口线: "-0.5", "+0.5", "-1", "-1.25"...
  home: number;      // 主队赔率
  away: number;      // 客队赔率
  main?: boolean;    // 是否主盘
  suspended?: boolean;
}

// 让球盘推荐接口
export interface HandicapRecommendation {
  recommendedLine: string;         // 实时主盘口（如 "-1", "+0.5"）
  recommendedSide: 'HOME' | 'AWAY'; // 推荐方向
  predictedMargin: number;         // AI 预测分差（正数=主队赢）
  edgeValue: number;               // 优势值
  winProbability: number;          // 赢盘概率
  confidence: number;              // 置信度
  reason: string;                  // 推荐理由
  marketOdds: number;              // 推荐方向的市场赔率
  fairOdds: number;                // AI 计算的公平赔率
  valueEdge: number;               // 价值边际（市场赔率/公平赔率 - 1）
}

export interface GoalBettingTips {
  overUnder: GoalPrediction[];     // 大小球预测
  nextGoal: NextGoalPrediction;    // 下一球预测
  totalExpectedGoals: number;      // 预期总进球数
  remainingExpectedGoals: number;  // 剩余时间预期进球
  handicapRecommendation: HandicapRecommendation | null;  // 🟢 新增：让球盘推荐
  highConfidenceTip: {
    type: 'OVER' | 'UNDER' | 'NEXT_GOAL_HOME' | 'NEXT_GOAL_AWAY' | 'NONE';
    line?: number;
    probability: number;
    confidence: number;
    description: string;
  } | null;
}

export class GoalPredictor {
  private liveProbability: LiveProbability;
  private maxGoals: number;

  constructor(maxGoals = 8) {  // [v2.1] 与 LiveProbability 保持一致
    this.liveProbability = new LiveProbability();
    this.maxGoals = maxGoals;
  }

  /**
   * 计算大小球概率
   */
  calculateOverUnder(stats: MatchStats, line: number): GoalPrediction {
    const [homeLambda, awayLambda] = this.liveProbability.calculateCurrentLambda(stats);
    const probMatrix = this.liveProbability.calculateScoreProbabilities(homeLambda, awayLambda);
    
    let overProb = 0;
    let underProb = 0;
    
    // [v2.1] 修复：使用 probMatrix 的实际长度，避免越界
    const actualMaxGoals = probMatrix.length - 1;
    // 计算剩余进球数的概率
    for (let addHome = 0; addHome <= actualMaxGoals; addHome++) {
      for (let addAway = 0; addAway <= actualMaxGoals; addAway++) {
        const totalGoals = stats.homeScore + stats.awayScore + addHome + addAway;
        const prob = probMatrix[addHome]?.[addAway] || 0;
        
        if (totalGoals > line) {
          overProb += prob;
        } else if (totalGoals < line) {
          underProb += prob;
        }
        // 刚好等于 line 的情况不计入（走盘）
      }
    }
    
    // 归一化
    const total = overProb + underProb;
    if (total > 0) {
      overProb /= total;
      underProb /= total;
    }
    
    // 计算赔率
    const overOdds = overProb > 0 ? Math.min(MAX_ODDS, Math.max(MIN_ODDS, 1 / overProb)) : MAX_ODDS;
    const underOdds = underProb > 0 ? Math.min(MAX_ODDS, Math.max(MIN_ODDS, 1 / underProb)) : MAX_ODDS;
    
    // 确定推荐
    let recommendation: 'OVER' | 'UNDER' | 'NEUTRAL' = 'NEUTRAL';
    const probDiff = Math.abs(overProb - underProb);
    if (probDiff > 0.15) {
      recommendation = overProb > underProb ? 'OVER' : 'UNDER';
    }
    
    // 计算置信度
    const confidence = 0.5 + probDiff * 0.5;
    
    return {
      line,
      overProb: Math.round(overProb * 10000) / 10000,
      underProb: Math.round(underProb * 10000) / 10000,
      overOdds: Math.round(overOdds * 100) / 100,
      underOdds: Math.round(underOdds * 100) / 100,
      recommendation,
      confidence: Math.round(confidence * 1000) / 1000,
    };
  }

  /**
   * 计算下一球预测
   */
  calculateNextGoal(stats: MatchStats): NextGoalPrediction {
    const [homeLambda, awayLambda] = this.liveProbability.calculateCurrentLambda(stats);
    const remainingMinutes = Math.max(0, 90 - stats.minute);
    
    // 计算剩余时间内的进球概率
    const timeRatio = remainingMinutes / 90;
    const adjustedHomeLambda = homeLambda * timeRatio;
    const adjustedAwayLambda = awayLambda * timeRatio;
    
    // 使用泊松分布计算下一球概率
    // P(主队进下一球) = P(主队至少进1球) * P(主队先进球|都进球)
    const homeAtLeastOne = 1 - poissonPMF(0, adjustedHomeLambda);
    const awayAtLeastOne = 1 - poissonPMF(0, adjustedAwayLambda);
    const noGoal = poissonPMF(0, adjustedHomeLambda) * poissonPMF(0, adjustedAwayLambda);
    
    // 简化计算：根据 lambda 比例分配
    const totalLambda = adjustedHomeLambda + adjustedAwayLambda;
    let homeProb = 0;
    let awayProb = 0;
    
    if (totalLambda > 0) {
      const goalProb = 1 - noGoal;
      homeProb = goalProb * (adjustedHomeLambda / totalLambda);
      awayProb = goalProb * (adjustedAwayLambda / totalLambda);
    }
    
    // 归一化
    const total = homeProb + awayProb + noGoal;
    homeProb /= total;
    awayProb /= total;
    const noGoalProb = noGoal / total;
    
    // 确定推荐
    let recommendation: 'HOME' | 'AWAY' | 'NO_GOAL' | 'NEUTRAL' = 'NEUTRAL';
    const maxProb = Math.max(homeProb, awayProb, noGoalProb);
    if (maxProb > 0.45) {
      if (homeProb === maxProb) recommendation = 'HOME';
      else if (awayProb === maxProb) recommendation = 'AWAY';
      else recommendation = 'NO_GOAL';
    }
    
    // 预计下一球时间
    const expectedMinutes = totalLambda > 0 
      ? Math.round(stats.minute + remainingMinutes / (totalLambda * 2))
      : 90;
    
    return {
      homeProb: Math.round(homeProb * 10000) / 10000,
      awayProb: Math.round(awayProb * 10000) / 10000,
      noGoalProb: Math.round(noGoalProb * 10000) / 10000,
      recommendation,
      confidence: Math.round(maxProb * 1000) / 1000,
      expectedMinutes: Math.min(90, expectedMinutes),
    };
  }

  /**
   * 生成完整的进球投注建议
   * @param stats 比赛统计数据
   * @param liveAsianHandicap 实时亚洲盘口数据（可选）
   */
  generateGoalBettingTips(stats: MatchStats, liveAsianHandicap?: LiveAsianHandicap[]): GoalBettingTips {
    const [homeLambda, awayLambda] = this.liveProbability.calculateCurrentLambda(stats);
    const currentGoals = stats.homeScore + stats.awayScore;
    
    // 计算各个大小球盘口
    const lines = [0.5, 1.5, 2.5, 3.5, 4.5];
    const overUnder = lines.map(line => this.calculateOverUnder(stats, line));
    
    // 计算下一球预测
    const nextGoal = this.calculateNextGoal(stats);
    
    // 计算预期进球
    const totalExpectedGoals = homeLambda + awayLambda + stats.homeScore + stats.awayScore;
    const remainingExpectedGoals = homeLambda + awayLambda;
    
    // 找出高置信度推荐
    // 🟢 修复：过滤掉无意义的推荐（如已经超过的盘口）
    let highConfidenceTip: GoalBettingTips['highConfidenceTip'] = null;
    
    // 检查大小球推荐
    for (const ou of overUnder) {
      // 🟢 跳过已经确定的盘口（当前进球数已经超过盘口线）
      if (currentGoals > ou.line) {
        continue; // 这个盘口已经确定为大球，不需要推荐
      }
      
      // 🟢 跳过概率过于极端的推荐（>95% 或 <5%）
      const prob = ou.recommendation === 'OVER' ? ou.overProb : ou.underProb;
      if (prob > 0.95 || prob < 0.05) {
        continue; // 概率过于极端，没有投注价值
      }
      
      // 🟢 只推荐有实际投注价值的盘口（概率在 55%-85% 之间）
      if (ou.confidence >= 0.55 && ou.recommendation !== 'NEUTRAL' && prob >= 0.55 && prob <= 0.85) {
        if (!highConfidenceTip || prob > highConfidenceTip.probability) {
          highConfidenceTip = {
            type: ou.recommendation,
            line: ou.line,
            probability: prob,
            confidence: ou.confidence,
            description: ou.recommendation === 'OVER' 
              ? `大${ou.line}球 (概率 ${(prob * 100).toFixed(1)}%)`
              : `小${ou.line}球 (概率 ${(prob * 100).toFixed(1)}%)`,
          };
        }
      }
    }
    
    // 检查下一球推荐
    // 🟢 只在比赛进行中且有明确优势时推荐
    if (stats.minute > 0 && stats.minute < 85 && nextGoal.confidence >= 0.6 && nextGoal.recommendation !== 'NEUTRAL' && nextGoal.recommendation !== 'NO_GOAL') {
      const prob = nextGoal.recommendation === 'HOME' ? nextGoal.homeProb : nextGoal.awayProb;
      
      // 🟢 只推荐概率在 45%-75% 之间的下一球预测
      if (prob >= 0.45 && prob <= 0.75) {
        if (!highConfidenceTip || prob > highConfidenceTip.probability) {
          const typeMap = {
            'HOME': 'NEXT_GOAL_HOME' as const,
            'AWAY': 'NEXT_GOAL_AWAY' as const,
            'NO_GOAL': 'NONE' as const,
            'NEUTRAL': 'NONE' as const,
          };
          
          highConfidenceTip = {
            type: typeMap[nextGoal.recommendation],
            probability: prob,
            confidence: nextGoal.confidence,
            description: nextGoal.recommendation === 'HOME' 
              ? `主队进下一球 (概率 ${(prob * 100).toFixed(1)}%)`
              : `客队进下一球 (概率 ${(prob * 100).toFixed(1)}%)`,
          };
        }
      }
    }
    
    // 🟢 新增：基于实时盘口计算让球盘推荐
    const handicapRecommendation = this.calculateHandicapRecommendationFromLiveOdds(
      stats, 
      homeLambda, 
      awayLambda, 
      liveAsianHandicap
    );
    
    return {
      overUnder,
      nextGoal,
      totalExpectedGoals: Math.round(totalExpectedGoals * 100) / 100,
      remainingExpectedGoals: Math.round(remainingExpectedGoals * 100) / 100,
      handicapRecommendation,
      highConfidenceTip,
    };
  }
  
  /**
   * 🟢 新版：基于实时盘口计算让球盘推荐
   * 
   * 核心逻辑：
   * 1. 使用实时主盘口作为分析基础
   * 2. 计算 AI 预测的赢盘概率
   * 3. 比较市场赔率与公平赔率，找出价值投注
   * 
   * 重要：API-Football 返回的盘口是基于当前比分的（滚球盘）
   * 例如：比分 1-0，盘口 -1.5 表示主队需要再赢 1.5 球（即总比分赢 2.5 球）
   */
  calculateHandicapRecommendationFromLiveOdds(
    stats: MatchStats, 
    homeLambda: number, 
    awayLambda: number,
    liveAsianHandicap?: LiveAsianHandicap[]
  ): HandicapRecommendation | null {
    // 如果没有实时盘口数据，返回 null
    if (!liveAsianHandicap || liveAsianHandicap.length === 0) {
      return null;
    }
    
    // 找到主盘口
    const mainHandicap = liveAsianHandicap.find(h => h.main) || liveAsianHandicap[0];
    if (!mainHandicap || mainHandicap.suspended) {
      return null;
    }
    
    // 解析盘口线（例如 "-0.5", "+0.75", "-1"）
    const handicapLine = parseFloat(mainHandicap.line);
    if (isNaN(handicapLine)) {
      return null;
    }
    
    // 计算 AI 预测的剩余进球差
    // 注意：这是剩余时间的预测，不是从 0-0 开始
    const expectedRemainingMargin = homeLambda - awayLambda;
    
    // 计算主队和客队的赢盘概率
    // 盘口解读：
    // - 盘口 -0.5 表示主队让 0.5 球，主队需要剩余时间净胜 > 0.5 球
    // - 盘口 +0.5 表示主队受让 0.5 球，主队剩余时间净胜 > -0.5 球（即不输 1 球即可）
    const homeWinProb = this.calculateRemainingHandicapWinProb(
      homeLambda, 
      awayLambda, 
      handicapLine, 
      true
    );
    const awayWinProb = this.calculateRemainingHandicapWinProb(
      homeLambda, 
      awayLambda, 
      handicapLine, 
      false
    );
    
    // 计算公平赔率
    const homeFairOdds = homeWinProb > 0 ? 1 / homeWinProb : 20;
    const awayFairOdds = awayWinProb > 0 ? 1 / awayWinProb : 20;
    
    // 计算价值边际（市场赔率 / 公平赔率 - 1）
    const homeValueEdge = mainHandicap.home / homeFairOdds - 1;
    const awayValueEdge = mainHandicap.away / awayFairOdds - 1;
    
    // 选择有价值的方向
    // 条件：赢盘概率 > 50% 且价值边际 > 5%
    const MIN_WIN_PROB = 0.50;
    const MIN_VALUE_EDGE = 0.03; // 3% 价值边际
    
    let recommendation: HandicapRecommendation | null = null;
    
    // 优先选择价值边际更大的方向
    let bestValueEdge = 0;
    
    if (homeWinProb >= MIN_WIN_PROB && homeValueEdge >= MIN_VALUE_EDGE) {
      if (homeValueEdge > bestValueEdge) {
        bestValueEdge = homeValueEdge;
        recommendation = {
          recommendedLine: mainHandicap.line,
          recommendedSide: 'HOME',
          predictedMargin: Math.round(expectedRemainingMargin * 100) / 100,
          edgeValue: Math.round(expectedRemainingMargin * 100) / 100,
          winProbability: Math.round(homeWinProb * 10000) / 10000,
          confidence: Math.min(0.95, 0.5 + homeValueEdge * 0.5 + (homeWinProb - 0.5) * 0.3),
          reason: this.generateLiveHandicapReason(
            'HOME', 
            expectedRemainingMargin, 
            handicapLine, 
            homeWinProb, 
            mainHandicap.home, 
            homeFairOdds,
            homeValueEdge
          ),
          marketOdds: mainHandicap.home,
          fairOdds: Math.round(homeFairOdds * 100) / 100,
          valueEdge: Math.round(homeValueEdge * 10000) / 10000,
        };
      }
    }
    
    if (awayWinProb >= MIN_WIN_PROB && awayValueEdge >= MIN_VALUE_EDGE) {
      if (awayValueEdge > bestValueEdge) {
        bestValueEdge = awayValueEdge;
        recommendation = {
          recommendedLine: mainHandicap.line,
          recommendedSide: 'AWAY',
          predictedMargin: Math.round(expectedRemainingMargin * 100) / 100,
          edgeValue: Math.round(-expectedRemainingMargin * 100) / 100,
          winProbability: Math.round(awayWinProb * 10000) / 10000,
          confidence: Math.min(0.95, 0.5 + awayValueEdge * 0.5 + (awayWinProb - 0.5) * 0.3),
          reason: this.generateLiveHandicapReason(
            'AWAY', 
            expectedRemainingMargin, 
            handicapLine, 
            awayWinProb, 
            mainHandicap.away, 
            awayFairOdds,
            awayValueEdge
          ),
          marketOdds: mainHandicap.away,
          fairOdds: Math.round(awayFairOdds * 100) / 100,
          valueEdge: Math.round(awayValueEdge * 10000) / 10000,
        };
      }
    }
    
    return recommendation;
  }
  
  /**
   * 计算剩余时间内的赢盘概率
   * 
   * @param homeLambda 主队剩余时间预期进球
   * @param awayLambda 客队剩余时间预期进球
   * @param handicapLine 盘口线（负数=主队让球，正数=主队受让）
   * @param isHome 是否计算主队赢盘概率
   */
  private calculateRemainingHandicapWinProb(
    homeLambda: number,
    awayLambda: number,
    handicapLine: number,
    isHome: boolean
  ): number {
    const probMatrix = this.liveProbability.calculateScoreProbabilities(homeLambda, awayLambda);
    let winProb = 0;
    let loseProb = 0;
    
    // [v2.1] 修复：使用 probMatrix 的实际长度，避免越界
    const maxGoals = probMatrix.length - 1;
    for (let addHome = 0; addHome <= maxGoals; addHome++) {
      for (let addAway = 0; addAway <= maxGoals; addAway++) {
        // 剩余时间的进球差
        const remainingMargin = addHome - addAway;
        const prob = probMatrix[addHome]?.[addAway] || 0;
        
        if (isHome) {
          // 主队赢盘：剩余进球差 > -handicapLine
          // 例如：盘口 -0.5，主队需要剩余时间净胜 > 0.5 球（即至少赢 1 球）
          // 例如：盘口 +0.5，主队需要剩余时间净胜 > -0.5 球（即不输 1 球）
          if (remainingMargin > -handicapLine) {
            winProb += prob;
          } else if (remainingMargin < -handicapLine) {
            loseProb += prob;
          }
          // 刚好等于盘口线时为走盘，不计入
        } else {
          // 客队赢盘：剩余进球差 < -handicapLine
          if (remainingMargin < -handicapLine) {
            winProb += prob;
          } else if (remainingMargin > -handicapLine) {
            loseProb += prob;
          }
        }
      }
    }
    
    const total = winProb + loseProb;
    return total > 0 ? winProb / total : 0.5;
  }
  
  /**
   * 生成实时盘口推荐理由
   */
  private generateLiveHandicapReason(
    side: 'HOME' | 'AWAY',
    expectedRemainingMargin: number,
    handicapLine: number,
    winProb: number,
    marketOdds: number,
    fairOdds: number,
    valueEdge: number
  ): string {
    const sideText = side === 'HOME' ? '主队' : '客队';
    
    // 盘口解读
    let handicapText: string;
    if (handicapLine < 0) {
      handicapText = `${sideText === '主队' ? '让' : '受让'} ${Math.abs(handicapLine)} 球`;
    } else if (handicapLine > 0) {
      handicapText = `${sideText === '主队' ? '受让' : '让'} ${Math.abs(handicapLine)} 球`;
    } else {
      handicapText = '平手盘';
    }
    
    // AI 预测解读
    const marginText = expectedRemainingMargin > 0.1
      ? `AI 预测主队剩余时间净胜 ${expectedRemainingMargin.toFixed(2)} 球`
      : expectedRemainingMargin < -0.1
        ? `AI 预测客队剩余时间净胜 ${Math.abs(expectedRemainingMargin).toFixed(2)} 球`
        : 'AI 预测剩余时间均势';
    
    // 价值分析
    const valueText = valueEdge > 0.1 
      ? `价值边际 ${(valueEdge * 100).toFixed(1)}%，有明显价值`
      : valueEdge > 0.05
        ? `价值边际 ${(valueEdge * 100).toFixed(1)}%，有一定价值`
        : `价值边际 ${(valueEdge * 100).toFixed(1)}%`;
    
    return `推荐 ${sideText} | 当前盘口${handicapText}，${marginText}。赢盘率 ${(winProb * 100).toFixed(1)}%，市场赔率 ${marketOdds.toFixed(2)} vs 公平赔率 ${fairOdds.toFixed(2)}，${valueText}。`;
  }

  /**
   * 🟢 旧版：计算让球盘推荐（保留作为备用）
   * 核心逻辑：比较 AI 预测分差与实时盘口，找出最优投注方向
   */
  calculateHandicapRecommendation(
    stats: MatchStats, 
    homeLambda: number, 
    awayLambda: number
  ): HandicapRecommendation | null {
    // 计算 AI 预测的最终分差
    // 预测分差 = 当前分差 + 预期剩余进球差
    const currentMargin = stats.homeScore - stats.awayScore;
    const expectedRemainingMargin = homeLambda - awayLambda;
    const predictedMargin = currentMargin + expectedRemainingMargin;
    
    // 常用让球盘口线
    const handicapLines = [-2.5, -2, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2, 2.5];
    
    let bestRecommendation: HandicapRecommendation | null = null;
    let bestEdge = 0;
    
    for (const line of handicapLines) {
      // 计算该盘口的赢盘概率
      // 主队让球 line（负数=主队让球，正数=主队受让）
      // 主队赢盘条件：最终分差 > -line
      // 客队赢盘条件：最终分差 < -line
      
      const homeWinHandicap = this.calculateHandicapWinProb(stats, homeLambda, awayLambda, line, true);
      const awayWinHandicap = this.calculateHandicapWinProb(stats, homeLambda, awayLambda, line, false);
      
      // 计算优势值：AI 预测分差与盘口的差距
      // 如果预测分差 = +2，盘口 = -1（主队让 1 球）
      // 优势值 = 2 - 1 = 1（主队有 1 球优势）
      const homeEdge = predictedMargin - (-line);
      const awayEdge = -predictedMargin - line;
      
      // 选择最佳方向
      if (homeWinHandicap > 0.55 && homeEdge > bestEdge && homeEdge > 0.3) {
        bestEdge = homeEdge;
        const homeFairOdds = homeWinHandicap > 0 ? 1 / homeWinHandicap : 20;
        bestRecommendation = {
          recommendedLine: line >= 0 ? `+${line}` : `${line}`,
          recommendedSide: 'HOME',
          predictedMargin: Math.round(predictedMargin * 100) / 100,
          edgeValue: Math.round(homeEdge * 100) / 100,
          winProbability: Math.round(homeWinHandicap * 10000) / 10000,
          confidence: Math.min(0.95, 0.5 + homeEdge * 0.2 + (homeWinHandicap - 0.5) * 0.3),
          reason: this.generateHandicapReason('HOME', predictedMargin, line, homeEdge, homeWinHandicap),
          marketOdds: 0, // 旧版方法没有市场赔率
          fairOdds: Math.round(homeFairOdds * 100) / 100,
          valueEdge: 0, // 旧版方法没有价值边际
        };
      }
      
      if (awayWinHandicap > 0.55 && awayEdge > bestEdge && awayEdge > 0.3) {
        bestEdge = awayEdge;
        const awayFairOdds = awayWinHandicap > 0 ? 1 / awayWinHandicap : 20;
        bestRecommendation = {
          recommendedLine: line >= 0 ? `+${line}` : `${line}`,
          recommendedSide: 'AWAY',
          predictedMargin: Math.round(predictedMargin * 100) / 100,
          edgeValue: Math.round(awayEdge * 100) / 100,
          winProbability: Math.round(awayWinHandicap * 10000) / 10000,
          confidence: Math.min(0.95, 0.5 + awayEdge * 0.2 + (awayWinHandicap - 0.5) * 0.3),
          reason: this.generateHandicapReason('AWAY', predictedMargin, line, awayEdge, awayWinHandicap),
          marketOdds: 0, // 旧版方法没有市场赔率
          fairOdds: Math.round(awayFairOdds * 100) / 100,
          valueEdge: 0, // 旧版方法没有价值边际
        };
      }
    }
    
    return bestRecommendation;
  }
  
  /**
   * 计算让球盘赢盘概率
   */
  private calculateHandicapWinProb(
    stats: MatchStats,
    homeLambda: number,
    awayLambda: number,
    line: number,
    isHome: boolean
  ): number {
    const probMatrix = this.liveProbability.calculateScoreProbabilities(homeLambda, awayLambda);
    let winProb = 0;
    let loseProb = 0;
    
    // [v2.1] 修复：使用 probMatrix 的实际长度，避免越界
    const maxGoals = probMatrix.length - 1;
    for (let addHome = 0; addHome <= maxGoals; addHome++) {
      for (let addAway = 0; addAway <= maxGoals; addAway++) {
        const finalMargin = (stats.homeScore + addHome) - (stats.awayScore + addAway);
        const prob = probMatrix[addHome]?.[addAway] || 0;
        
        if (isHome) {
          // 主队赢盘：最终分差 > -line
          // 例如：盘口 -1（主队让 1 球），主队赢盘需要分差 > 1
          if (finalMargin > -line) {
            winProb += prob;
          } else if (finalMargin < -line) {
            loseProb += prob;
          }
        } else {
          // 客队赢盘：最终分差 < -line
          if (finalMargin < -line) {
            winProb += prob;
          } else if (finalMargin > -line) {
            loseProb += prob;
          }
        }
      }
    }
    
    const total = winProb + loseProb;
    return total > 0 ? winProb / total : 0.5;
  }
  
  /**
   * 生成让球盘推荐理由
   */
  private generateHandicapReason(
    side: 'HOME' | 'AWAY',
    predictedMargin: number,
    line: number,
    edge: number,
    winProb: number
  ): string {
    const sideText = side === 'HOME' ? '主队' : '客队';
    const marginText = predictedMargin > 0 
      ? `主队净胜 ${Math.abs(predictedMargin).toFixed(1)} 球`
      : predictedMargin < 0 
        ? `客队净胜 ${Math.abs(predictedMargin).toFixed(1)} 球`
        : '平局';
    
    const lineText = line >= 0 
      ? `受让 ${Math.abs(line)} 球`
      : `让 ${Math.abs(line)} 球`;
    
    const edgeText = edge > 1 ? '优势明显' : edge > 0.5 ? '有一定优势' : '略有优势';
    
    return `推荐：${sideText} | AI 预测${marginText}，当前盘口${sideText}${lineText}，${edgeText} (赢盘率 ${(winProb * 100).toFixed(1)}%)`;
  }
}

// =============================================================================
// 5. 交易信号生成器 (Trading Signal Generator)
// =============================================================================

export class TradingSignalGenerator {
  private valueThreshold: number;
  private liveProbability: LiveProbability;
  private handicapPricer: AsianHandicapPricer;

  constructor(valueThreshold = VALUE_THRESHOLD) {
    this.valueThreshold = valueThreshold;
    this.liveProbability = new LiveProbability();
    this.handicapPricer = new AsianHandicapPricer();
  }

  /**
   * 计算价值空间
   */
  calculateEdge(fairOdds: number, marketOdds: number): number {
    if (fairOdds <= 0) return 0;
    return marketOdds / fairOdds - 1;
  }

  /**
   * 生成 1X2 信号
   */
  generate1X2Signals(
    stats: MatchStats,
    marketOdds: { home: number; draw: number; away: number }
  ): TradingSignal[] {
    const prediction = this.liveProbability.predict(stats);
    const signals: TradingSignal[] = [];

    const fairOdds = {
      home: prediction.homeWinProb > 0 ? 1 / prediction.homeWinProb : MAX_ODDS,
      draw: prediction.drawProb > 0 ? 1 / prediction.drawProb : MAX_ODDS,
      away: prediction.awayWinProb > 0 ? 1 / prediction.awayWinProb : MAX_ODDS,
    };

    const selections: Array<{ name: string; key: 'home' | 'draw' | 'away' }> = [
      { name: 'HOME', key: 'home' },
      { name: 'DRAW', key: 'draw' },
      { name: 'AWAY', key: 'away' },
    ];

    for (const { name, key } of selections) {
      const edge = this.calculateEdge(fairOdds[key], marketOdds[key]);

      let signalType: 'VALUE_BET' | 'NO_VALUE' | 'AVOID';
      if (edge >= this.valueThreshold) {
        signalType = 'VALUE_BET';
      } else if (edge < -0.1) {
        signalType = 'AVOID';
      } else {
        signalType = 'NO_VALUE';
      }

      signals.push({
        signalType,
        market: '1X2',
        selection: name,
        fairOdds: Math.round(fairOdds[key] * 1000) / 1000,
        marketOdds: marketOdds[key],
        edge: Math.round(edge * 10000) / 10000,
        confidence: prediction.confidence,
      });
    }

    return signals;
  }

  /**
   * 生成完整预测和信号
   */
  generateFullAnalysis(stats: MatchStats, marketData?: {
    '1x2'?: { home: number; draw: number; away: number };
    asianHandicap?: Record<string, { home: number; away: number }>;
  }) {
    const prediction = this.liveProbability.predict(stats);
    const handicapLines = this.handicapPricer.getAllHandicapLines(stats);

    const result = {
      matchInfo: {
        minute: stats.minute,
        score: `${stats.homeScore}-${stats.awayScore}`,
      },
      prediction: {
        homeWin: prediction.homeWinProb,
        draw: prediction.drawProb,
        awayWin: prediction.awayWinProb,
        homeXG: prediction.homeExpectedGoals,
        awayXG: prediction.awayExpectedGoals,
        homeMomentum: prediction.homeMomentum,
        awayMomentum: prediction.awayMomentum,
        confidence: prediction.confidence,
        algorithm: prediction.algorithm,
        pressureAnalysis: prediction.pressureAnalysis,
      },
      asianHandicap: handicapLines,
      signals: [] as TradingSignal[],
      valueBets: [] as TradingSignal[],
    };

    // 如果提供了市场数据，生成交易信号
    if (marketData?.['1x2']) {
      const signals1X2 = this.generate1X2Signals(stats, marketData['1x2']);
      result.signals.push(...signals1X2);
      result.valueBets.push(...signals1X2.filter((s) => s.signalType === 'VALUE_BET'));
    }

    return result;
  }
}

// =============================================================================
// 导出主预测函数
// =============================================================================

/**
 * 主预测函数 - 用于替换 SmartPredict-v1
 */
export function predictMatch(match: {
  minute: number;
  homeScore: number;
  awayScore: number;
  stats?: Partial<MatchStats>;
}): {
  home: number;
  draw: number;
  away: number;
  confidence: number;
  algorithm: string;
  momentum: { home: number; away: number };
  expectedGoals: { home: number; away: number };
  pressureAnalysis: { homeNormalized: number; awayNormalized: number; dominantTeam: string };
} {
  const stats: MatchStats = {
    minute: match.minute,
    homeScore: match.homeScore,
    awayScore: match.awayScore,
    ...match.stats,
  };

  const liveProbability = new LiveProbability();
  const prediction = liveProbability.predict(stats);

  return {
    home: prediction.homeWinProb,
    draw: prediction.drawProb,
    away: prediction.awayWinProb,
    confidence: prediction.confidence,
    algorithm: prediction.algorithm,
    momentum: {
      home: prediction.homeMomentum,
      away: prediction.awayMomentum,
    },
    expectedGoals: {
      home: prediction.homeExpectedGoals,
      away: prediction.awayExpectedGoals,
    },
    pressureAnalysis: prediction.pressureAnalysis,
  };
}

export default {
  PressureIndex,
  LiveProbability,
  AsianHandicapPricer,
  TradingSignalGenerator,
  GoalPredictor,
  predictMatch,
};
