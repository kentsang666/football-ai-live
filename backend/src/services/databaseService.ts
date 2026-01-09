/**
 * 数据库服务 - PostgreSQL 预测历史记录
 * 
 * 功能：
 * - 保存预测快照到数据库
 * - 获取比赛历史预测记录
 * - 计算预测准确率统计
 */

import { Pool, PoolClient } from 'pg';

// =============================================================================
// 类型定义
// =============================================================================

export interface AsianHandicapOdds {
  handicap: number;
  homeProbability: number;
  awayProbability: number;
  homeFairOdds: number;
  awayFairOdds: number;
}

export interface FeaturesSnapshot {
  momentum?: {
    home: number;
    away: number;
  };
  pressureAnalysis?: {
    homeNormalized: number;
    awayNormalized: number;
    dominantTeam: string;
  };
  expectedGoals?: {
    home: number;
    away: number;
  };
  asianHandicap?: AsianHandicapOdds[];
}

export interface PredictionSnapshot {
  id?: number;
  match_id: string;
  home_team: string;
  away_team: string;
  home_score: number;
  away_score: number;
  minute: number;
  match_status: string;
  home_win_prob: number;
  draw_prob: number;
  away_win_prob: number;
  confidence: number;
  algorithm: string;
  features_snapshot: FeaturesSnapshot;
  created_at?: Date;
}

export interface MatchHistoryRecord {
  id: number;
  minute: number;
  home_score: number;
  away_score: number;
  home_win_prob: number;
  draw_prob: number;
  away_win_prob: number;
  confidence: number;
  momentum_home: number;
  momentum_away: number;
  pressure_home: number;
  pressure_away: number;
  created_at: Date;
}

export interface PerformanceStats {
  total_predictions: number;
  correct_predictions: number;
  accuracy_rate: number;
  home_win_accuracy: number;
  draw_accuracy: number;
  away_win_accuracy: number;
  avg_confidence: number;
  high_confidence_accuracy: number;
  period: string;
}

// =============================================================================
// 数据库服务类
// =============================================================================

export class DatabaseService {
  private pool: Pool | null = null;
  private isConnected: boolean = false;
  private connectionRetries: number = 0;
  private maxRetries: number = 3;

  constructor() {
    this.initializeConnection();
  }

  /**
   * 初始化数据库连接
   */
  private async initializeConnection(): Promise<void> {
    const databaseUrl = process.env.DATABASE_URL;
    
    if (!databaseUrl) {
      console.log('⚠️ [DB] DATABASE_URL 未设置，数据库服务禁用');
      return;
    }

    try {
      this.pool = new Pool({
        connectionString: databaseUrl,
        ssl: databaseUrl.includes('railway') || databaseUrl.includes('neon') 
          ? { rejectUnauthorized: false } 
          : undefined,
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000,
      });

      // 测试连接
      const client = await this.pool.connect();
      await client.query('SELECT NOW()');
      client.release();
      
      this.isConnected = true;
      console.log('✅ [DB] PostgreSQL 连接成功');
      
      // 初始化表结构
      await this.initializeTables();
      
    } catch (error: any) {
      console.error('❌ [DB] PostgreSQL 连接失败:', error.message);
      this.isConnected = false;
      
      // 重试连接
      if (this.connectionRetries < this.maxRetries) {
        this.connectionRetries++;
        console.log(`🔄 [DB] 重试连接 (${this.connectionRetries}/${this.maxRetries})...`);
        setTimeout(() => this.initializeConnection(), 5000);
      }
    }
  }

  /**
   * 初始化数据库表结构
   */
  private async initializeTables(): Promise<void> {
    if (!this.pool) return;

    const createPredictionsTable = `
      CREATE TABLE IF NOT EXISTS predictions (
        id SERIAL PRIMARY KEY,
        match_id VARCHAR(100) NOT NULL,
        home_team VARCHAR(100) NOT NULL,
        away_team VARCHAR(100) NOT NULL,
        home_score INTEGER NOT NULL,
        away_score INTEGER NOT NULL,
        minute INTEGER NOT NULL,
        match_status VARCHAR(50) NOT NULL,
        home_win_prob DECIMAL(5,4) NOT NULL,
        draw_prob DECIMAL(5,4) NOT NULL,
        away_win_prob DECIMAL(5,4) NOT NULL,
        confidence DECIMAL(5,4) NOT NULL,
        algorithm VARCHAR(50) NOT NULL,
        features_snapshot JSONB,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        
        -- 索引优化
        CONSTRAINT predictions_match_minute_unique UNIQUE (match_id, minute, home_score, away_score)
      );
      
      -- 创建索引
      CREATE INDEX IF NOT EXISTS idx_predictions_match_id ON predictions(match_id);
      CREATE INDEX IF NOT EXISTS idx_predictions_created_at ON predictions(created_at);
      CREATE INDEX IF NOT EXISTS idx_predictions_match_status ON predictions(match_status);
    `;

    const createMatchResultsTable = `
      CREATE TABLE IF NOT EXISTS match_results (
        id SERIAL PRIMARY KEY,
        match_id VARCHAR(100) UNIQUE NOT NULL,
        home_team VARCHAR(100) NOT NULL,
        away_team VARCHAR(100) NOT NULL,
        final_home_score INTEGER NOT NULL,
        final_away_score INTEGER NOT NULL,
        result VARCHAR(10) NOT NULL, -- 'home', 'draw', 'away'
        league VARCHAR(200),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE INDEX IF NOT EXISTS idx_match_results_match_id ON match_results(match_id);
      CREATE INDEX IF NOT EXISTS idx_match_results_created_at ON match_results(created_at);
    `;

    try {
      await this.pool.query(createPredictionsTable);
      await this.pool.query(createMatchResultsTable);
      console.log('✅ [DB] 数据库表初始化完成');
    } catch (error: any) {
      console.error('❌ [DB] 表初始化失败:', error.message);
    }
  }

  /**
   * 检查数据库是否可用
   */
  isAvailable(): boolean {
    return this.isConnected && this.pool !== null;
  }

  /**
   * 保存预测快照到数据库
   */
  async savePredictionSnapshot(snapshot: PredictionSnapshot): Promise<number | null> {
    if (!this.isAvailable()) return null;

    const query = `
      INSERT INTO predictions (
        match_id, home_team, away_team, home_score, away_score,
        minute, match_status, home_win_prob, draw_prob, away_win_prob,
        confidence, algorithm, features_snapshot
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      ON CONFLICT (match_id, minute, home_score, away_score) 
      DO UPDATE SET
        home_win_prob = EXCLUDED.home_win_prob,
        draw_prob = EXCLUDED.draw_prob,
        away_win_prob = EXCLUDED.away_win_prob,
        confidence = EXCLUDED.confidence,
        features_snapshot = EXCLUDED.features_snapshot,
        created_at = CURRENT_TIMESTAMP
      RETURNING id
    `;

    const values = [
      snapshot.match_id,
      snapshot.home_team,
      snapshot.away_team,
      snapshot.home_score,
      snapshot.away_score,
      snapshot.minute,
      snapshot.match_status,
      snapshot.home_win_prob,
      snapshot.draw_prob,
      snapshot.away_win_prob,
      snapshot.confidence,
      snapshot.algorithm,
      JSON.stringify(snapshot.features_snapshot),
    ];

    try {
      const result = await this.pool!.query(query, values);
      return result.rows[0]?.id || null;
    } catch (error: any) {
      console.error('❌ [DB] 保存预测快照失败:', error.message);
      return null;
    }
  }

  /**
   * 保存比赛最终结果
   */
  async saveMatchResult(
    matchId: string,
    homeTeam: string,
    awayTeam: string,
    homeScore: number,
    awayScore: number,
    league?: string
  ): Promise<boolean> {
    if (!this.isAvailable()) return false;

    const result = homeScore > awayScore ? 'home' : homeScore < awayScore ? 'away' : 'draw';

    const query = `
      INSERT INTO match_results (
        match_id, home_team, away_team, final_home_score, final_away_score, result, league
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (match_id) DO UPDATE SET
        final_home_score = EXCLUDED.final_home_score,
        final_away_score = EXCLUDED.final_away_score,
        result = EXCLUDED.result
      RETURNING id
    `;

    try {
      await this.pool!.query(query, [matchId, homeTeam, awayTeam, homeScore, awayScore, result, league]);
      console.log(`✅ [DB] 保存比赛结果: ${homeTeam} ${homeScore}-${awayScore} ${awayTeam}`);
      return true;
    } catch (error: any) {
      console.error('❌ [DB] 保存比赛结果失败:', error.message);
      return false;
    }
  }

  /**
   * 获取比赛历史预测记录（用于画趋势图）
   */
  async getMatchHistory(matchId: string): Promise<MatchHistoryRecord[]> {
    if (!this.isAvailable()) return [];

    const query = `
      SELECT 
        id,
        minute,
        home_score,
        away_score,
        home_win_prob,
        draw_prob,
        away_win_prob,
        confidence,
        COALESCE((features_snapshot->'momentum'->>'home')::decimal, 0) as momentum_home,
        COALESCE((features_snapshot->'momentum'->>'away')::decimal, 0) as momentum_away,
        COALESCE((features_snapshot->'pressureAnalysis'->>'homeNormalized')::decimal, 50) as pressure_home,
        COALESCE((features_snapshot->'pressureAnalysis'->>'awayNormalized')::decimal, 50) as pressure_away,
        created_at
      FROM predictions
      WHERE match_id = $1
      ORDER BY minute ASC, created_at ASC
    `;

    try {
      const result = await this.pool!.query(query, [matchId]);
      return result.rows.map(row => ({
        id: row.id,
        minute: row.minute,
        home_score: row.home_score,
        away_score: row.away_score,
        home_win_prob: parseFloat(row.home_win_prob),
        draw_prob: parseFloat(row.draw_prob),
        away_win_prob: parseFloat(row.away_win_prob),
        confidence: parseFloat(row.confidence),
        momentum_home: parseFloat(row.momentum_home),
        momentum_away: parseFloat(row.momentum_away),
        pressure_home: parseFloat(row.pressure_home),
        pressure_away: parseFloat(row.pressure_away),
        created_at: row.created_at,
      }));
    } catch (error: any) {
      console.error('❌ [DB] 获取比赛历史失败:', error.message);
      return [];
    }
  }

  /**
   * 获取最近的预测记录（调试用）
   */
  async getRecentPredictions(limit: number = 20): Promise<any[]> {
    if (!this.isAvailable()) return [];

    const query = `
      SELECT 
        p.*,
        mr.result as actual_result
      FROM predictions p
      LEFT JOIN match_results mr ON p.match_id = mr.match_id
      ORDER BY p.created_at DESC
      LIMIT $1
    `;

    try {
      const result = await this.pool!.query(query, [limit]);
      return result.rows;
    } catch (error: any) {
      console.error('❌ [DB] 获取最近预测失败:', error.message);
      return [];
    }
  }

  /**
   * 计算预测准确率统计
   */
  async getPerformanceStats(limit: number = 100): Promise<PerformanceStats> {
    if (!this.isAvailable()) {
      return {
        total_predictions: 0,
        correct_predictions: 0,
        accuracy_rate: 0,
        home_win_accuracy: 0,
        draw_accuracy: 0,
        away_win_accuracy: 0,
        avg_confidence: 0,
        high_confidence_accuracy: 0,
        period: 'N/A',
      };
    }

    // 获取最后一次预测（比赛结束时）与实际结果对比
    const query = `
      WITH final_predictions AS (
        SELECT DISTINCT ON (p.match_id)
          p.match_id,
          p.home_win_prob,
          p.draw_prob,
          p.away_win_prob,
          p.confidence,
          mr.result as actual_result,
          CASE 
            WHEN p.home_win_prob >= p.draw_prob AND p.home_win_prob >= p.away_win_prob THEN 'home'
            WHEN p.draw_prob >= p.home_win_prob AND p.draw_prob >= p.away_win_prob THEN 'draw'
            ELSE 'away'
          END as predicted_result
        FROM predictions p
        INNER JOIN match_results mr ON p.match_id = mr.match_id
        WHERE p.match_status = 'finished' OR p.minute >= 85
        ORDER BY p.match_id, p.minute DESC, p.created_at DESC
      )
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN predicted_result = actual_result THEN 1 ELSE 0 END) as correct,
        AVG(confidence) as avg_confidence,
        SUM(CASE WHEN actual_result = 'home' AND predicted_result = 'home' THEN 1 ELSE 0 END) as home_correct,
        SUM(CASE WHEN actual_result = 'home' THEN 1 ELSE 0 END) as home_total,
        SUM(CASE WHEN actual_result = 'draw' AND predicted_result = 'draw' THEN 1 ELSE 0 END) as draw_correct,
        SUM(CASE WHEN actual_result = 'draw' THEN 1 ELSE 0 END) as draw_total,
        SUM(CASE WHEN actual_result = 'away' AND predicted_result = 'away' THEN 1 ELSE 0 END) as away_correct,
        SUM(CASE WHEN actual_result = 'away' THEN 1 ELSE 0 END) as away_total,
        SUM(CASE WHEN confidence >= 0.7 AND predicted_result = actual_result THEN 1 ELSE 0 END) as high_conf_correct,
        SUM(CASE WHEN confidence >= 0.7 THEN 1 ELSE 0 END) as high_conf_total,
        MIN(p.created_at) as start_date,
        MAX(p.created_at) as end_date
      FROM final_predictions fp
      JOIN predictions p ON fp.match_id = p.match_id
      LIMIT $1
    `;

    try {
      const result = await this.pool!.query(query, [limit]);
      const row = result.rows[0];

      if (!row || row.total === 0) {
        return {
          total_predictions: 0,
          correct_predictions: 0,
          accuracy_rate: 0,
          home_win_accuracy: 0,
          draw_accuracy: 0,
          away_win_accuracy: 0,
          avg_confidence: 0,
          high_confidence_accuracy: 0,
          period: 'No data',
        };
      }

      return {
        total_predictions: parseInt(row.total),
        correct_predictions: parseInt(row.correct),
        accuracy_rate: row.total > 0 ? row.correct / row.total : 0,
        home_win_accuracy: row.home_total > 0 ? row.home_correct / row.home_total : 0,
        draw_accuracy: row.draw_total > 0 ? row.draw_correct / row.draw_total : 0,
        away_win_accuracy: row.away_total > 0 ? row.away_correct / row.away_total : 0,
        avg_confidence: parseFloat(row.avg_confidence) || 0,
        high_confidence_accuracy: row.high_conf_total > 0 ? row.high_conf_correct / row.high_conf_total : 0,
        period: `${row.start_date?.toISOString().split('T')[0] || 'N/A'} - ${row.end_date?.toISOString().split('T')[0] || 'N/A'}`,
      };
    } catch (error: any) {
      console.error('❌ [DB] 获取性能统计失败:', error.message);
      return {
        total_predictions: 0,
        correct_predictions: 0,
        accuracy_rate: 0,
        home_win_accuracy: 0,
        draw_accuracy: 0,
        away_win_accuracy: 0,
        avg_confidence: 0,
        high_confidence_accuracy: 0,
        period: 'Error',
      };
    }
  }

  /**
   * 获取数据库统计信息
   */
  async getDatabaseStats(): Promise<{
    total_predictions: number;
    total_matches: number;
    total_results: number;
    oldest_record: string | null;
    newest_record: string | null;
  }> {
    if (!this.isAvailable()) {
      return {
        total_predictions: 0,
        total_matches: 0,
        total_results: 0,
        oldest_record: null,
        newest_record: null,
      };
    }

    try {
      const statsQuery = `
        SELECT 
          (SELECT COUNT(*) FROM predictions) as total_predictions,
          (SELECT COUNT(DISTINCT match_id) FROM predictions) as total_matches,
          (SELECT COUNT(*) FROM match_results) as total_results,
          (SELECT MIN(created_at) FROM predictions) as oldest_record,
          (SELECT MAX(created_at) FROM predictions) as newest_record
      `;

      const result = await this.pool!.query(statsQuery);
      const row = result.rows[0];

      return {
        total_predictions: parseInt(row.total_predictions) || 0,
        total_matches: parseInt(row.total_matches) || 0,
        total_results: parseInt(row.total_results) || 0,
        oldest_record: row.oldest_record?.toISOString() || null,
        newest_record: row.newest_record?.toISOString() || null,
      };
    } catch (error: any) {
      console.error('❌ [DB] 获取数据库统计失败:', error.message);
      return {
        total_predictions: 0,
        total_matches: 0,
        total_results: 0,
        oldest_record: null,
        newest_record: null,
      };
    }
  }

  /**
   * 清理旧数据（保留指定天数内的数据）
   */
  async cleanupOldData(retentionDays: number = 30): Promise<number> {
    if (!this.isAvailable()) return 0;

    const query = `
      DELETE FROM predictions
      WHERE created_at < NOW() - INTERVAL '${retentionDays} days'
      RETURNING id
    `;

    try {
      const result = await this.pool!.query(query);
      const deletedCount = result.rowCount || 0;
      if (deletedCount > 0) {
        console.log(`🧹 [DB] 清理了 ${deletedCount} 条旧预测记录`);
      }
      return deletedCount;
    } catch (error: any) {
      console.error('❌ [DB] 清理旧数据失败:', error.message);
      return 0;
    }
  }

  /**
   * 关闭数据库连接
   */
  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.isConnected = false;
      console.log('👋 [DB] PostgreSQL 连接已关闭');
    }
  }
}

// 导出单例实例
export const databaseService = new DatabaseService();
