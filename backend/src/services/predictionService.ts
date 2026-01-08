/**
 * 足球比赛预测服务
 * 基于比赛状态实时计算胜负概率
 */

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
    home_possession?: number;
    away_possession?: number;
    home_corners?: number;
    away_corners?: number;
    home_red_cards?: number;
    away_red_cards?: number;
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
}

/**
 * 预测服务类
 */
export class PredictionService {
    private readonly VERSION = '1.0.0';
    
    /**
     * 计算比赛预测概率
     */
    calculatePrediction(match: MatchData): Prediction {
        const probs = this.calculateProbabilities(match);
        const confidence = this.calculateConfidence(match);
        
        return {
            match_id: match.match_id,
            home_team: match.home_team,
            away_team: match.away_team,
            probabilities: probs,
            algorithm: 'SmartPredict-v1',
            confidence,
            timestamp: new Date().toISOString()
        };
    }
    
    /**
     * 智能概率计算算法
     * 考虑因素：比分、时间、射门、控球率、红牌等
     */
    private calculateProbabilities(match: MatchData): { home: number; draw: number; away: number } {
        // 基础概率（根据历史数据，主场略有优势）
        let pHome = 0.40;
        let pDraw = 0.28;
        let pAway = 0.32;
        
        const homeScore = match.home_score || 0;
        const awayScore = match.away_score || 0;
        const minute = match.minute || 45;
        const goalDiff = homeScore - awayScore;
        
        // 1. 比分影响（最重要的因素）
        if (goalDiff !== 0) {
            const scoreFactor = Math.min(Math.abs(goalDiff), 4) * 0.12;
            if (goalDiff > 0) {
                pHome += scoreFactor;
                pDraw -= scoreFactor * 0.4;
                pAway -= scoreFactor * 0.6;
            } else {
                pAway += scoreFactor;
                pDraw -= scoreFactor * 0.4;
                pHome -= scoreFactor * 0.6;
            }
        }
        
        // 2. 时间因素（比赛越接近结束，领先方优势越大）
        const timeProgress = Math.min(minute / 90, 1);
        if (goalDiff !== 0) {
            const timeFactor = timeProgress * 0.15;
            if (goalDiff > 0) {
                pHome += timeFactor;
                pDraw -= timeFactor * 0.5;
                pAway -= timeFactor * 0.5;
            } else {
                pAway += timeFactor;
                pDraw -= timeFactor * 0.5;
                pHome -= timeFactor * 0.5;
            }
        } else {
            // 0-0 平局，随着时间推移平局概率增加
            const drawBoost = timeProgress * 0.08;
            pDraw += drawBoost;
            pHome -= drawBoost * 0.5;
            pAway -= drawBoost * 0.5;
        }
        
        // 3. 射门数据（如果有）
        if (match.home_shots_on_target !== undefined && match.away_shots_on_target !== undefined) {
            const shotDiff = match.home_shots_on_target - match.away_shots_on_target;
            const shotFactor = Math.min(Math.abs(shotDiff), 5) * 0.02;
            if (shotDiff > 0) {
                pHome += shotFactor;
                pAway -= shotFactor;
            } else if (shotDiff < 0) {
                pAway += shotFactor;
                pHome -= shotFactor;
            }
        }
        
        // 4. 控球率（如果有）
        if (match.home_possession !== undefined && match.away_possession !== undefined) {
            const possessionDiff = match.home_possession - match.away_possession;
            const possessionFactor = possessionDiff * 0.002; // 每1%控球率影响0.2%概率
            pHome += possessionFactor;
            pAway -= possessionFactor;
        }
        
        // 5. 红牌影响（如果有）
        if (match.home_red_cards !== undefined && match.away_red_cards !== undefined) {
            const redCardDiff = match.home_red_cards - match.away_red_cards;
            if (redCardDiff > 0) {
                // 主队有红牌，客队优势
                pAway += 0.08 * redCardDiff;
                pHome -= 0.06 * redCardDiff;
                pDraw -= 0.02 * redCardDiff;
            } else if (redCardDiff < 0) {
                // 客队有红牌，主队优势
                pHome += 0.08 * Math.abs(redCardDiff);
                pAway -= 0.06 * Math.abs(redCardDiff);
                pDraw -= 0.02 * Math.abs(redCardDiff);
            }
        }
        
        // 6. 特殊情况处理
        // 大比分领先（3球以上）
        if (Math.abs(goalDiff) >= 3) {
            if (goalDiff > 0) {
                pHome = Math.min(pHome + 0.15, 0.95);
                pDraw = Math.max(pDraw - 0.10, 0.02);
                pAway = Math.max(pAway - 0.05, 0.02);
            } else {
                pAway = Math.min(pAway + 0.15, 0.95);
                pDraw = Math.max(pDraw - 0.10, 0.02);
                pHome = Math.max(pHome - 0.05, 0.02);
            }
        }
        
        // 7. 比赛末段（85分钟以后）
        if (minute >= 85) {
            if (goalDiff > 0) {
                pHome = Math.min(pHome * 1.1, 0.95);
            } else if (goalDiff < 0) {
                pAway = Math.min(pAway * 1.1, 0.95);
            } else {
                pDraw = Math.min(pDraw * 1.15, 0.80);
            }
        }
        
        // 归一化确保概率和为1
        const total = pHome + pDraw + pAway;
        pHome = pHome / total;
        pDraw = pDraw / total;
        pAway = pAway / total;
        
        // 确保概率在合理范围内
        pHome = Math.max(0.01, Math.min(0.98, pHome));
        pDraw = Math.max(0.01, Math.min(0.98, pDraw));
        pAway = Math.max(0.01, Math.min(0.98, pAway));
        
        // 再次归一化
        const finalTotal = pHome + pDraw + pAway;
        
        return {
            home: Math.round((pHome / finalTotal) * 10000) / 10000,
            draw: Math.round((pDraw / finalTotal) * 10000) / 10000,
            away: Math.round((pAway / finalTotal) * 10000) / 10000
        };
    }
    
    /**
     * 计算预测置信度
     */
    private calculateConfidence(match: MatchData): number {
        let confidence = 0.6; // 基础置信度
        
        const minute = match.minute || 45;
        const goalDiff = Math.abs((match.home_score || 0) - (match.away_score || 0));
        
        // 比赛进行时间越长，置信度越高
        confidence += (minute / 90) * 0.2;
        
        // 比分差距越大，置信度越高
        confidence += Math.min(goalDiff * 0.05, 0.15);
        
        // 有更多数据时置信度更高
        if (match.home_shots_on_target !== undefined) confidence += 0.03;
        if (match.home_possession !== undefined) confidence += 0.02;
        
        return Math.min(Math.round(confidence * 100) / 100, 0.95);
    }
    
    /**
     * 批量计算预测
     */
    calculatePredictions(matches: MatchData[]): Prediction[] {
        return matches.map(match => this.calculatePrediction(match));
    }
    
    /**
     * 获取服务版本
     */
    getVersion(): string {
        return this.VERSION;
    }
}

// 导出单例
export const predictionService = new PredictionService();
