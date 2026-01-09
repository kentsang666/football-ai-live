/**
 * QuantPredict v2.0 - 足球滚球预测引擎
 * 
 * 核心逻辑：寻找"市场赔率"与"模型真实概率"之间的偏差
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
  red_cards: -2.0,
};

const MOMENTUM_SMOOTHING = 0.3;
const DEFAULT_HOME_XG = 1.45;
const DEFAULT_AWAY_XG = 1.15;
const VALUE_THRESHOLD = 0.05;
const MIN_ODDS = 1.10;
const MAX_ODDS = 20.0;

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

  constructor(weights?: Partial<typeof WEIGHTS>) {
    this.weights = { ...WEIGHTS, ...weights };
    this.momentumHistory = { home: [], away: [] };
  }

  /**
   * 计算原始压力值
   */
  calculateRawPressure(stats: MatchStats): [number, number] {
    const recentHomeDangerousAttacks = stats.recentHomeDangerousAttacks || 0;
    const recentAwayDangerousAttacks = stats.recentAwayDangerousAttacks || 0;
    const recentHomeShotsOnTarget = stats.recentHomeShotsOnTarget || 0;
    const recentAwayShotsOnTarget = stats.recentAwayShotsOnTarget || 0;
    const recentHomeCorners = stats.recentHomeCorners || 0;
    const recentAwayCorners = stats.recentAwayCorners || 0;
    const homePossession = stats.homePossession || 50;
    const awayPossession = stats.awayPossession || 50;
    const homeRedCards = stats.homeRedCards || 0;
    const awayRedCards = stats.awayRedCards || 0;

    // 主队压力计算
    let homePressure =
      recentHomeDangerousAttacks * this.weights.dangerous_attacks +
      recentHomeShotsOnTarget * this.weights.shots_on_target +
      (stats.homeShotsOffTarget || 0) * this.weights.shots_off_target * 0.5 +
      recentHomeCorners * this.weights.corners +
      (homePossession - 50) * this.weights.possession;

    // 客队压力计算
    let awayPressure =
      recentAwayDangerousAttacks * this.weights.dangerous_attacks +
      recentAwayShotsOnTarget * this.weights.shots_on_target +
      (stats.awayShotsOffTarget || 0) * this.weights.shots_off_target * 0.5 +
      recentAwayCorners * this.weights.corners +
      (awayPossession - 50) * this.weights.possession;

    // 红牌惩罚
    if (homeRedCards > 0) {
      awayPressure += homeRedCards * Math.abs(this.weights.red_cards);
      homePressure -= homeRedCards * Math.abs(this.weights.red_cards) * 0.5;
    }
    if (awayRedCards > 0) {
      homePressure += awayRedCards * Math.abs(this.weights.red_cards);
      awayPressure -= awayRedCards * Math.abs(this.weights.red_cards) * 0.5;
    }

    return [Math.max(0, homePressure), Math.max(0, awayPressure)];
  }

  /**
   * 归一化压力值到 0-100
   */
  normalizePressure(homePressure: number, awayPressure: number): [number, number] {
    const total = homePressure + awayPressure;
    if (total === 0) return [50, 50];
    return [(homePressure / total) * 100, (awayPressure / total) * 100];
  }

  /**
   * 计算动量系数
   */
  calculateMomentumFactor(stats: MatchStats): [number, number] {
    const [homePressure, awayPressure] = this.calculateRawPressure(stats);
    const [homeNorm, awayNorm] = this.normalizePressure(homePressure, awayPressure);

    // 存储历史
    this.momentumHistory.home.push(homeNorm);
    this.momentumHistory.away.push(awayNorm);

    // 保持最近10个数据点
    if (this.momentumHistory.home.length > 10) {
      this.momentumHistory.home = this.momentumHistory.home.slice(-10);
      this.momentumHistory.away = this.momentumHistory.away.slice(-10);
    }

    // 指数移动平均平滑
    let homeSmoothed = homeNorm;
    let awaySmoothed = awayNorm;

    if (this.momentumHistory.home.length > 1) {
      const homeHistoryAvg =
        this.momentumHistory.home.slice(0, -1).reduce((a, b) => a + b, 0) /
        (this.momentumHistory.home.length - 1);
      const awayHistoryAvg =
        this.momentumHistory.away.slice(0, -1).reduce((a, b) => a + b, 0) /
        (this.momentumHistory.away.length - 1);

      homeSmoothed = MOMENTUM_SMOOTHING * homeNorm + (1 - MOMENTUM_SMOOTHING) * homeHistoryAvg;
      awaySmoothed = MOMENTUM_SMOOTHING * awayNorm + (1 - MOMENTUM_SMOOTHING) * awayHistoryAvg;
    }

    // 转换为动量系数 (0.7 - 1.3)
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

  constructor(homeXG = DEFAULT_HOME_XG, awayXG = DEFAULT_AWAY_XG, maxGoals = 10) {
    this.initialHomeXG = homeXG;
    this.initialAwayXG = awayXG;
    this.maxGoals = maxGoals;
    this.pressureIndex = new PressureIndex();
  }

  /**
   * 计算时间衰减系数
   */
  calculateTimeDecay(currentMinute: number, totalMinutes = 90, decayType = 'linear'): number {
    const remainingTime = Math.max(0, totalMinutes - currentMinute);
    const timeRatio = remainingTime / totalMinutes;

    switch (decayType) {
      case 'exponential':
        return Math.exp(-0.5 * (1 - timeRatio));
      case 'sqrt':
        return Math.sqrt(timeRatio);
      default:
        return timeRatio;
    }
  }

  /**
   * 计算当前 Lambda 值
   */
  calculateCurrentLambda(stats: MatchStats, decayType = 'linear'): [number, number] {
    const timeDecay = this.calculateTimeDecay(stats.minute, 90, decayType);
    let [homeMomentum, awayMomentum] = this.pressureIndex.calculateMomentumFactor(stats);

    // 比分影响调整
    const scoreDiff = stats.homeScore - stats.awayScore;
    if (Math.abs(scoreDiff) >= 2) {
      if (scoreDiff > 0) {
        awayMomentum *= 1.1;
        homeMomentum *= 0.95;
      } else {
        homeMomentum *= 1.1;
        awayMomentum *= 0.95;
      }
    }

    let homeLambda = this.initialHomeXG * timeDecay * homeMomentum;
    let awayLambda = this.initialAwayXG * timeDecay * awayMomentum;

    // 限制范围
    homeLambda = Math.max(0.01, Math.min(5.0, homeLambda));
    awayLambda = Math.max(0.01, Math.min(5.0, awayLambda));

    return [homeLambda, awayLambda];
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
   */
  predict(stats: MatchStats): PredictionResult {
    const [homeLambda, awayLambda] = this.calculateCurrentLambda(stats);
    const [homeWin, draw, awayWin] = this.calculateMatchOutcomeProbabilities(stats);
    const [homeMomentum, awayMomentum] = this.pressureIndex.calculateMomentumFactor(stats);
    const pressureSummary = this.pressureIndex.getPressureSummary(stats);

    // 计算置信度
    const timeConfidence = Math.min(1.0, stats.minute / 45);
    const dataConfidence = Math.min(
      1.0,
      ((stats.homeShotsOnTarget || 0) +
        (stats.awayShotsOnTarget || 0) +
        (stats.homeCorners || 0) +
        (stats.awayCorners || 0)) /
        10
    );
    const confidence = 0.5 + 0.3 * timeConfidence + 0.2 * dataConfidence;

    return {
      homeWinProb: Math.round(homeWin * 10000) / 10000,
      drawProb: Math.round(draw * 10000) / 10000,
      awayWinProb: Math.round(awayWin * 10000) / 10000,
      homeExpectedGoals: Math.round(homeLambda * 1000) / 1000,
      awayExpectedGoals: Math.round(awayLambda * 1000) / 1000,
      homeMomentum: Math.round(homeMomentum * 1000) / 1000,
      awayMomentum: Math.round(awayMomentum * 1000) / 1000,
      confidence: Math.round(confidence * 1000) / 1000,
      algorithm: 'QuantPredict-v2.0',
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

    for (let addHome = 0; addHome <= 10; addHome++) {
      for (let addAway = 0; addAway <= 10; addAway++) {
        const finalHome = stats.homeScore + addHome;
        const finalAway = stats.awayScore + addAway;
        const prob = probMatrix[addHome]![addAway] || 0;

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

export interface GoalBettingTips {
  overUnder: GoalPrediction[];     // 大小球预测
  nextGoal: NextGoalPrediction;    // 下一球预测
  totalExpectedGoals: number;      // 预期总进球数
  remainingExpectedGoals: number;  // 剩余时间预期进球
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

  constructor(maxGoals = 10) {
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
    
    // 计算剩余进球数的概率
    for (let addHome = 0; addHome <= this.maxGoals; addHome++) {
      for (let addAway = 0; addAway <= this.maxGoals; addAway++) {
        const totalGoals = stats.homeScore + stats.awayScore + addHome + addAway;
        const prob = probMatrix[addHome]![addAway] || 0;
        
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
   */
  generateGoalBettingTips(stats: MatchStats): GoalBettingTips {
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
    
    return {
      overUnder,
      nextGoal,
      totalExpectedGoals: Math.round(totalExpectedGoals * 100) / 100,
      remainingExpectedGoals: Math.round(remainingExpectedGoals * 100) / 100,
      highConfidenceTip,
    };
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
