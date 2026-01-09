/**
 * 结算服务 (Settlement Service)
 * 
 * 功能：
 * 1. 获取已结束比赛的完场比分
 * 2. 根据完场比分结算让球盘/大小球推荐
 */

import axios from 'axios';

// ===========================================
// 类型定义
// ===========================================

export interface SettlementRequest {
  matchId: string;
  type: 'HANDICAP' | 'OVER_UNDER';
  selection: string;  // 如 "主队 -0.5" 或 "大 2.5"
  scoreWhenTip: string;  // 推荐时比分 "1-0"
}

export interface SettlementResult {
  matchId: string;
  finalScore: string;  // 完场比分 "2-1"
  homeScore: number;
  awayScore: number;
  result: 'WIN' | 'LOSS' | 'PUSH' | 'PENDING';
  reason: string;
}

export interface FixtureResult {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  status: string;
  league: string;
}

// ===========================================
// 结算服务类
// ===========================================

class SettlementService {
  private apiKey: string;
  private apiUrl: string;

  constructor() {
    this.apiKey = process.env.API_FOOTBALL_KEY || '';
    this.apiUrl = process.env.API_FOOTBALL_URL || 'https://v3.football.api-sports.io';
  }

  /**
   * 获取单场比赛的完场比分
   */
  async getFixtureResult(fixtureId: string): Promise<FixtureResult | null> {
    try {
      const response = await axios.get(`${this.apiUrl}/fixtures`, {
        params: { id: fixtureId },
        headers: {
          'x-apisports-key': this.apiKey,
        },
      });

      const fixture = response.data.response?.[0];
      if (!fixture) {
        console.log(`[Settlement] 未找到比赛: ${fixtureId}`);
        return null;
      }

      const status = fixture.fixture.status.short;
      
      // 只返回已结束的比赛
      if (!['FT', 'AET', 'PEN'].includes(status)) {
        console.log(`[Settlement] 比赛未结束: ${fixtureId}, 状态: ${status}`);
        return {
          matchId: fixtureId,
          homeTeam: fixture.teams.home.name,
          awayTeam: fixture.teams.away.name,
          homeScore: fixture.goals.home ?? 0,
          awayScore: fixture.goals.away ?? 0,
          status: status,
          league: fixture.league.name,
        };
      }

      return {
        matchId: fixtureId,
        homeTeam: fixture.teams.home.name,
        awayTeam: fixture.teams.away.name,
        homeScore: fixture.goals.home,
        awayScore: fixture.goals.away,
        status: 'FT',
        league: fixture.league.name,
      };
    } catch (error: any) {
      console.error(`[Settlement] 获取比赛结果失败: ${fixtureId}`, error.message);
      return null;
    }
  }

  /**
   * 批量获取比赛结果
   */
  async getMultipleFixtureResults(fixtureIds: string[]): Promise<Map<string, FixtureResult>> {
    const results = new Map<string, FixtureResult>();
    
    // 并行请求，但限制并发数
    const batchSize = 5;
    for (let i = 0; i < fixtureIds.length; i += batchSize) {
      const batch = fixtureIds.slice(i, i + batchSize);
      const promises = batch.map(id => this.getFixtureResult(id));
      const batchResults = await Promise.all(promises);
      
      batchResults.forEach((result, index) => {
        if (result) {
          const batchId = batch[index];
          if (batchId) {
            results.set(batchId, result);
          }
        }
      });
      
      // 避免 API 限流
      if (i + batchSize < fixtureIds.length) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }
    
    return results;
  }

  /**
   * 结算让球盘推荐
   * 
   * 让球盘规则：
   * - 主队 -0.5: 主队净胜 >= 1 球赢
   * - 主队 -1: 主队净胜 >= 2 球赢，净胜 1 球走盘
   * - 主队 -1.5: 主队净胜 >= 2 球赢
   * - 主队 +0.5: 主队不输即赢
   * - 客队类似
   */
  settleHandicap(
    homeScore: number,
    awayScore: number,
    selection: string,
    scoreWhenTip: string
  ): { result: 'WIN' | 'LOSS' | 'PUSH'; reason: string } {
    // 解析推荐时的比分
    const parts = scoreWhenTip.split('-').map(Number);
    const tipHome = parts[0] || 0;
    const tipAway = parts[1] || 0;
    
    // 计算推荐后的进球
    const goalsAfterTip = {
      home: homeScore - tipHome,
      away: awayScore - tipAway,
    };
    
    // 解析让球盘选择
    // 格式: "主队 -0.5" 或 "客队 +1" 或 "主队 受让 0.5"
    const isHome = selection.includes('主队');
    const isReceiving = selection.includes('受让') || selection.includes('+');
    
    // 提取让球数
    const handicapMatch = selection.match(/([+-]?\d+\.?\d*)/);
    if (!handicapMatch || !handicapMatch[1]) {
      return { result: 'PUSH', reason: '无法解析让球数' };
    }
    
    let handicap = parseFloat(handicapMatch[1]);
    if (isReceiving && handicap > 0) {
      handicap = handicap; // 受让方，盘口为正
    } else if (!isReceiving && !selection.includes('-')) {
      handicap = -handicap; // 让球方，盘口为负
    }
    
    // 计算让球后的净胜球
    const netGoals = goalsAfterTip.home - goalsAfterTip.away;
    const adjustedNet = isHome ? netGoals + handicap : -netGoals + handicap;
    
    console.log(`[Settlement] 让球盘结算: ${selection}, 推荐后进球 ${goalsAfterTip.home}-${goalsAfterTip.away}, 让球 ${handicap}, 调整后净胜 ${adjustedNet}`);
    
    if (adjustedNet > 0) {
      return { result: 'WIN', reason: `让球后净胜 ${adjustedNet.toFixed(2)} 球` };
    } else if (adjustedNet < 0) {
      return { result: 'LOSS', reason: `让球后净负 ${Math.abs(adjustedNet).toFixed(2)} 球` };
    } else {
      return { result: 'PUSH', reason: '让球后平局，走盘' };
    }
  }

  /**
   * 结算大小球推荐
   * 
   * 大小球规则：
   * - 大 2.5: 总进球 >= 3 赢
   * - 小 2.5: 总进球 <= 2 赢
   * - 大 2: 总进球 >= 3 赢，= 2 走盘
   */
  settleOverUnder(
    homeScore: number,
    awayScore: number,
    selection: string,
    scoreWhenTip: string
  ): { result: 'WIN' | 'LOSS' | 'PUSH'; reason: string } {
    // 解析推荐时的比分
    const parts = scoreWhenTip.split('-').map(Number);
    const tipHome = parts[0] || 0;
    const tipAway = parts[1] || 0;
    
    // 计算推荐后的总进球
    const goalsAfterTip = (homeScore - tipHome) + (awayScore - tipAway);
    
    // 解析大小球选择
    // 格式: "大 2.5" 或 "小 2.5" 或 "OVER 2.5" 或 "UNDER 2.5"
    const isOver = selection.includes('大') || selection.toUpperCase().includes('OVER');
    
    // 提取盘口
    const lineMatch = selection.match(/(\d+\.?\d*)/);
    if (!lineMatch || !lineMatch[1]) {
      return { result: 'PUSH', reason: '无法解析大小球盘口' };
    }
    
    const line = parseFloat(lineMatch[1]);
    
    console.log(`[Settlement] 大小球结算: ${selection}, 推荐后进球 ${goalsAfterTip}, 盘口 ${line}`);
    
    if (isOver) {
      if (goalsAfterTip > line) {
        return { result: 'WIN', reason: `推荐后进 ${goalsAfterTip} 球 > ${line}` };
      } else if (goalsAfterTip < line) {
        return { result: 'LOSS', reason: `推荐后进 ${goalsAfterTip} 球 < ${line}` };
      } else {
        return { result: 'PUSH', reason: `推荐后进 ${goalsAfterTip} 球 = ${line}，走盘` };
      }
    } else {
      if (goalsAfterTip < line) {
        return { result: 'WIN', reason: `推荐后进 ${goalsAfterTip} 球 < ${line}` };
      } else if (goalsAfterTip > line) {
        return { result: 'LOSS', reason: `推荐后进 ${goalsAfterTip} 球 > ${line}` };
      } else {
        return { result: 'PUSH', reason: `推荐后进 ${goalsAfterTip} 球 = ${line}，走盘` };
      }
    }
  }

  /**
   * 结算单条推荐
   */
  async settleRecommendation(request: SettlementRequest): Promise<SettlementResult> {
    const fixtureResult = await this.getFixtureResult(request.matchId);
    
    if (!fixtureResult) {
      return {
        matchId: request.matchId,
        finalScore: '',
        homeScore: 0,
        awayScore: 0,
        result: 'PENDING',
        reason: '无法获取比赛结果',
      };
    }
    
    if (fixtureResult.status !== 'FT') {
      return {
        matchId: request.matchId,
        finalScore: `${fixtureResult.homeScore}-${fixtureResult.awayScore}`,
        homeScore: fixtureResult.homeScore,
        awayScore: fixtureResult.awayScore,
        result: 'PENDING',
        reason: `比赛未结束，当前状态: ${fixtureResult.status}`,
      };
    }
    
    let settlement: { result: 'WIN' | 'LOSS' | 'PUSH'; reason: string };
    
    if (request.type === 'HANDICAP') {
      settlement = this.settleHandicap(
        fixtureResult.homeScore,
        fixtureResult.awayScore,
        request.selection,
        request.scoreWhenTip
      );
    } else {
      settlement = this.settleOverUnder(
        fixtureResult.homeScore,
        fixtureResult.awayScore,
        request.selection,
        request.scoreWhenTip
      );
    }
    
    return {
      matchId: request.matchId,
      finalScore: `${fixtureResult.homeScore}-${fixtureResult.awayScore}`,
      homeScore: fixtureResult.homeScore,
      awayScore: fixtureResult.awayScore,
      result: settlement.result,
      reason: settlement.reason,
    };
  }

  /**
   * 批量结算推荐
   */
  async settleMultipleRecommendations(
    requests: SettlementRequest[]
  ): Promise<SettlementResult[]> {
    // 先批量获取所有比赛结果
    const matchIds = [...new Set(requests.map(r => r.matchId))];
    const fixtureResults = await this.getMultipleFixtureResults(matchIds);
    
    // 结算每条推荐
    const results: SettlementResult[] = [];
    
    for (const request of requests) {
      const fixtureResult = fixtureResults.get(request.matchId);
      
      if (!fixtureResult) {
        results.push({
          matchId: request.matchId,
          finalScore: '',
          homeScore: 0,
          awayScore: 0,
          result: 'PENDING',
          reason: '无法获取比赛结果',
        });
        continue;
      }
      
      if (fixtureResult.status !== 'FT') {
        results.push({
          matchId: request.matchId,
          finalScore: `${fixtureResult.homeScore}-${fixtureResult.awayScore}`,
          homeScore: fixtureResult.homeScore,
          awayScore: fixtureResult.awayScore,
          result: 'PENDING',
          reason: `比赛未结束，当前状态: ${fixtureResult.status}`,
        });
        continue;
      }
      
      let settlement: { result: 'WIN' | 'LOSS' | 'PUSH'; reason: string };
      
      if (request.type === 'HANDICAP') {
        settlement = this.settleHandicap(
          fixtureResult.homeScore,
          fixtureResult.awayScore,
          request.selection,
          request.scoreWhenTip
        );
      } else {
        settlement = this.settleOverUnder(
          fixtureResult.homeScore,
          fixtureResult.awayScore,
          request.selection,
          request.scoreWhenTip
        );
      }
      
      results.push({
        matchId: request.matchId,
        finalScore: `${fixtureResult.homeScore}-${fixtureResult.awayScore}`,
        homeScore: fixtureResult.homeScore,
        awayScore: fixtureResult.awayScore,
        result: settlement.result,
        reason: settlement.reason,
      });
    }
    
    return results;
  }
}

// 导出单例
export const settlementService = new SettlementService();
export default settlementService;
