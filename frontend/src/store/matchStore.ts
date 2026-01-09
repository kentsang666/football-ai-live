// ===========================================
// 多场比赛状态管理
// ===========================================

import type { PressureAnalysis, Momentum, GoalBettingTips, LiveOdds } from '../types/prediction';

// 赔率变动方向
export type OddsDirection = 'up' | 'down' | 'same';

// 赔率变动追踪
export interface OddsChange {
  matchWinner?: {
    home: OddsDirection;
    draw: OddsDirection;
    away: OddsDirection;
  };
  asianHandicap?: {
    home: OddsDirection;
    away: OddsDirection;
  };
  overUnder?: {
    over: OddsDirection;
    under: OddsDirection;
  };
}

// 比赛数据类型
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
  // 🟢 新增：红牌数据
  home_red_cards?: number;
  away_red_cards?: number;
}

// AI 预测数据类型 (v2.1 更新)
export interface PredictionData {
  match_id: string;
  probabilities: {
    home: number;
    draw: number;
    away: number;
  };
  timestamp: string;
  // v2.1 新增字段
  momentum?: Momentum;
  pressureAnalysis?: PressureAnalysis;
  confidence?: number;
  // v2.2 新增：进球投注建议
  goalBettingTips?: GoalBettingTips;
}

// 比赛事件类型
export interface MatchEvent {
  match_id: string;
  type: 'goal' | 'score_update' | 'status_change' | 'shot_on_target';
  home_team?: string;
  away_team?: string;
  home_score: number;
  away_score: number;
  minute: number;
  timestamp: string;
}

// 完整的比赛状态（包含预测和事件历史）
export interface MatchState extends MatchData {
  prediction?: {
    home: number;
    draw: number;
    away: number;
    // v2.1 新增字段
    momentum?: Momentum;
    pressureAnalysis?: PressureAnalysis;
    confidence?: number;
    // v2.2 新增：进球投注建议
    goalBettingTips?: GoalBettingTips;
  };
  // 🟢 v2.3 新增：实时赔率数据
  liveOdds?: LiveOdds;
  // 🟢 v2.4 新增：上一次赔率数据（用于变动比较）
  prevLiveOdds?: LiveOdds;
  // 🟢 v2.4 新增：赔率变动方向
  oddsChange?: OddsChange;
  events: MatchEvent[];
}

// ===========================================
// MatchStore 类 - 管理多场比赛状态
// ===========================================

export class MatchStore {
  // 使用 Map 存储所有比赛，key 为 match_id
  private matches: Map<string, MatchState> = new Map();
  
  // 状态变化监听器
  private listeners: Set<() => void> = new Set();

  // 订阅状态变化
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // 通知所有监听器
  private notify(): void {
    this.listeners.forEach(listener => listener());
  }

  // 获取所有比赛列表
  getAllMatches(): MatchState[] {
    return Array.from(this.matches.values())
      .sort((a, b) => {
        // 优先显示进行中的比赛
        if (a.status === 'live' && b.status !== 'live') return -1;
        if (a.status !== 'live' && b.status === 'live') return 1;
        // 然后按时间排序
        return b.minute - a.minute;
      });
  }

  // 获取单场比赛
  getMatch(matchId: string): MatchState | undefined {
    return this.matches.get(matchId);
  }

  // 获取正在进行的比赛数量
  getLiveCount(): number {
    return Array.from(this.matches.values())
      .filter(m => m.status === 'live' || m.status === 'halftime').length;
  }

  // 更新比赛数据（来自 score_update 事件）
  updateMatch(event: MatchEvent): void {
    const matchId = event.match_id;
    const existing = this.matches.get(matchId);

    if (existing) {
      // 更新现有比赛
      existing.home_score = event.home_score;
      existing.away_score = event.away_score;
      existing.minute = event.minute;
      existing.timestamp = event.timestamp;
      
      // 如果是进球事件，添加到事件历史
      if (event.type === 'goal') {
        existing.events.unshift(event);
        // 只保留最近 10 个事件
        if (existing.events.length > 10) {
          existing.events.pop();
        }
      }
    } else {
      // 新比赛
      this.matches.set(matchId, {
        match_id: matchId,
        home_team: event.home_team || '主队',
        away_team: event.away_team || '客队',
        home_score: event.home_score,
        away_score: event.away_score,
        minute: event.minute,
        status: 'live',
        league: '未知联赛',
        timestamp: event.timestamp,
        events: event.type === 'goal' ? [event] : []
      });
    }

    this.notify();
  }

  // 更新预测数据（来自 prediction_update 事件）- v2.1 更新
  updatePrediction(prediction: PredictionData): void {
    const match = this.matches.get(prediction.match_id);
    if (match) {
      match.prediction = {
        ...prediction.probabilities,
        // v2.1 新增字段
        momentum: prediction.momentum,
        pressureAnalysis: prediction.pressureAnalysis,
        confidence: prediction.confidence,
        // v2.2 新增：进球投注建议
        goalBettingTips: prediction.goalBettingTips,
      };
      this.notify();
    }
  }

  // 批量更新比赛列表（来自 API 初始加载）
  setMatches(matches: (MatchData & { liveOdds?: LiveOdds; prediction?: any })[]): void {
    matches.forEach(match => {
      const existing = this.matches.get(match.match_id);
      if (existing) {
        // 保留现有的事件历史，更新其他数据
        existing.home_team = match.home_team;
        existing.away_team = match.away_team;
        existing.home_score = match.home_score;
        existing.away_score = match.away_score;
        existing.minute = match.minute;
        existing.status = match.status;
        existing.league = match.league;
        existing.timestamp = match.timestamp;
        // 🟢 更新实时赔率数据，并追踪变动
        if (match.liveOdds) {
          // 保存上一次赔率
          if (existing.liveOdds) {
            existing.prevLiveOdds = existing.liveOdds;
            // 计算赔率变动方向
            existing.oddsChange = this.calculateOddsChange(existing.liveOdds, match.liveOdds);
          }
          existing.liveOdds = match.liveOdds;
        }
        // 更新预测数据
        if (match.prediction) {
          existing.prediction = {
            home: match.prediction.probabilities?.home ?? existing.prediction?.home ?? 0.33,
            draw: match.prediction.probabilities?.draw ?? existing.prediction?.draw ?? 0.34,
            away: match.prediction.probabilities?.away ?? existing.prediction?.away ?? 0.33,
            momentum: match.prediction.momentum ?? existing.prediction?.momentum,
            pressureAnalysis: match.prediction.pressureAnalysis ?? existing.prediction?.pressureAnalysis,
            confidence: match.prediction.confidence ?? existing.prediction?.confidence,
            goalBettingTips: match.prediction.goalBettingTips ?? existing.prediction?.goalBettingTips,
          };
        }
      } else {
        // 新比赛
        const newMatch: MatchState = {
          match_id: match.match_id,
          home_team: match.home_team,
          away_team: match.away_team,
          home_score: match.home_score,
          away_score: match.away_score,
          minute: match.minute,
          status: match.status,
          league: match.league,
          timestamp: match.timestamp,
          events: [],
          // 🟢 保存实时赔率数据
          liveOdds: match.liveOdds,
        };
        // 保存预测数据
        if (match.prediction) {
          newMatch.prediction = {
            home: match.prediction.probabilities?.home ?? 0.33,
            draw: match.prediction.probabilities?.draw ?? 0.34,
            away: match.prediction.probabilities?.away ?? 0.33,
            momentum: match.prediction.momentum,
            pressureAnalysis: match.prediction.pressureAnalysis,
            confidence: match.prediction.confidence,
            goalBettingTips: match.prediction.goalBettingTips,
          };
        }
        this.matches.set(match.match_id, newMatch);
      }
    });
    this.notify();
  }

  // 🟢 v2.4 新增：计算赔率变动方向
  private calculateOddsChange(prev: LiveOdds, current: LiveOdds): OddsChange {
    const getDirection = (prevVal: number | undefined, currVal: number | undefined): OddsDirection => {
      if (prevVal === undefined || currVal === undefined) return 'same';
      if (currVal > prevVal + 0.01) return 'up';
      if (currVal < prevVal - 0.01) return 'down';
      return 'same';
    };

    const change: OddsChange = {};

    // 胜平负赔率变动
    if (prev.matchWinner && current.matchWinner) {
      change.matchWinner = {
        home: getDirection(prev.matchWinner.home, current.matchWinner.home),
        draw: getDirection(prev.matchWinner.draw, current.matchWinner.draw),
        away: getDirection(prev.matchWinner.away, current.matchWinner.away),
      };
    }

    // 亚洲盘口赔率变动（只比较主盘）
    const prevMainAH = prev.asianHandicap?.find(ah => ah.main);
    const currMainAH = current.asianHandicap?.find(ah => ah.main);
    if (prevMainAH && currMainAH) {
      change.asianHandicap = {
        home: getDirection(prevMainAH.home, currMainAH.home),
        away: getDirection(prevMainAH.away, currMainAH.away),
      };
    }

    // 大小球赔率变动（只比较主盘）
    const prevMainOU = prev.overUnder?.find(ou => ou.main);
    const currMainOU = current.overUnder?.find(ou => ou.main);
    if (prevMainOU && currMainOU) {
      change.overUnder = {
        over: getDirection(prevMainOU.over, currMainOU.over),
        under: getDirection(prevMainOU.under, currMainOU.under),
      };
    }

    return change;
  }

  // 清理已结束的比赛
  cleanupFinished(): void {
    const now = Date.now();
    for (const [matchId, match] of this.matches.entries()) {
      if (match.status === 'finished') {
        const matchTime = new Date(match.timestamp).getTime();
        // 比赛结束 30 分钟后清理
        if (now - matchTime > 1800000) {
          this.matches.delete(matchId);
        }
      }
    }
    this.notify();
  }

  // 清空所有数据
  clear(): void {
    this.matches.clear();
    this.notify();
  }
}

// 创建全局单例
export const matchStore = new MatchStore();
