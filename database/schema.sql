-- ============================================================
-- Football Prediction System - PostgreSQL Database Schema
-- ============================================================
-- 本文件定义了系统的核心数据库结构
-- 与 docs/api-spec.yaml 中的数据模型保持一致
-- ============================================================

-- 启用 UUID 扩展
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- 枚举类型定义
-- ============================================================

-- 比赛状态
CREATE TYPE match_status AS ENUM (
    'scheduled',    -- 已安排
    'live',         -- 进行中
    'half_time',    -- 中场休息
    'finished',     -- 已结束
    'postponed',    -- 延期
    'cancelled'     -- 取消
);

-- 比赛事件类型
CREATE TYPE event_type AS ENUM (
    'goal',             -- 进球
    'own_goal',         -- 乌龙球
    'penalty_goal',     -- 点球进球
    'penalty_missed',   -- 点球未进
    'yellow_card',      -- 黄牌
    'red_card',         -- 红牌
    'second_yellow',    -- 两黄变红
    'substitution',     -- 换人
    'var_decision',     -- VAR判罚
    'injury',           -- 受伤
    'kick_off',         -- 开球
    'half_time',        -- 中场
    'full_time'         -- 终场
);

-- ============================================================
-- 核心表定义
-- ============================================================

-- 联赛表
CREATE TABLE leagues (
    id              VARCHAR(50) PRIMARY KEY,            -- 联赛标识符 (如 'premier-league')
    name            VARCHAR(255) NOT NULL,              -- 联赛名称
    country         VARCHAR(100),                       -- 所属国家
    logo_url        TEXT,                               -- 联赛徽标 URL
    season          VARCHAR(20),                        -- 当前赛季 (如 '2025-2026')
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 球队表
CREATE TABLE teams (
    id              VARCHAR(50) PRIMARY KEY,            -- 球队标识符 (如 'manchester-united')
    name            VARCHAR(255) NOT NULL,              -- 球队全名
    short_name      VARCHAR(50),                        -- 球队简称
    logo_url        TEXT,                               -- 球队徽标 URL
    league_id       VARCHAR(50) REFERENCES leagues(id), -- 所属联赛
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 比赛表
CREATE TABLE matches (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    external_id     VARCHAR(100) UNIQUE,                -- 外部数据源的比赛 ID
    home_team_id    VARCHAR(50) NOT NULL REFERENCES teams(id),
    away_team_id    VARCHAR(50) NOT NULL REFERENCES teams(id),
    league_id       VARCHAR(50) NOT NULL REFERENCES leagues(id),
    status          match_status NOT NULL DEFAULT 'scheduled',
    
    -- 比分信息
    home_score      INTEGER DEFAULT 0,
    away_score      INTEGER DEFAULT 0,
    home_score_ht   INTEGER,                            -- 半场主队得分
    away_score_ht   INTEGER,                            -- 半场客队得分
    
    -- 时间信息
    scheduled_at    TIMESTAMP WITH TIME ZONE NOT NULL,  -- 预定开始时间
    started_at      TIMESTAMP WITH TIME ZONE,           -- 实际开始时间
    ended_at        TIMESTAMP WITH TIME ZONE,           -- 结束时间
    
    -- 元数据
    venue           VARCHAR(255),                       -- 比赛场地
    referee         VARCHAR(255),                       -- 主裁判
    attendance      INTEGER,                            -- 观众人数
    
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- 索引优化
    CONSTRAINT different_teams CHECK (home_team_id != away_team_id)
);

-- 比赛事件表
CREATE TABLE match_events (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    match_id        UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    type            event_type NOT NULL,
    minute          INTEGER NOT NULL CHECK (minute >= 0 AND minute <= 120),
    extra_minute    INTEGER CHECK (extra_minute >= 0),  -- 补时分钟
    team_id         VARCHAR(50) REFERENCES teams(id),
    player_name     VARCHAR(255),
    detail          TEXT,                               -- 事件详情描述
    occurred_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 预测结果表
CREATE TABLE predictions (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    match_id        UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    
    -- 胜平负概率
    home_win_prob   DECIMAL(5, 4) NOT NULL CHECK (home_win_prob >= 0 AND home_win_prob <= 1),
    draw_prob       DECIMAL(5, 4) NOT NULL CHECK (draw_prob >= 0 AND draw_prob <= 1),
    away_win_prob   DECIMAL(5, 4) NOT NULL CHECK (away_win_prob >= 0 AND away_win_prob <= 1),
    
    -- 其他预测
    over_2_5_prob   DECIMAL(5, 4) CHECK (over_2_5_prob >= 0 AND over_2_5_prob <= 1),
    btts_prob       DECIMAL(5, 4) CHECK (btts_prob >= 0 AND btts_prob <= 1),  -- Both Teams To Score
    
    -- 预测比分
    predicted_home_score INTEGER,
    predicted_away_score INTEGER,
    
    -- 模型信息
    confidence      DECIMAL(5, 4) CHECK (confidence >= 0 AND confidence <= 1),
    model_version   VARCHAR(50) NOT NULL,
    features_snapshot JSONB,                            -- 预测时使用的特征快照
    
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- 概率总和约束 (允许小误差)
    CONSTRAINT prob_sum_check CHECK (
        ABS(home_win_prob + draw_prob + away_win_prob - 1.0) < 0.01
    )
);

-- ============================================================
-- 索引定义
-- ============================================================

-- 比赛表索引
CREATE INDEX idx_matches_status ON matches(status);
CREATE INDEX idx_matches_scheduled_at ON matches(scheduled_at);
CREATE INDEX idx_matches_league_id ON matches(league_id);
CREATE INDEX idx_matches_home_team ON matches(home_team_id);
CREATE INDEX idx_matches_away_team ON matches(away_team_id);
CREATE INDEX idx_matches_status_scheduled ON matches(status, scheduled_at);

-- 比赛事件表索引
CREATE INDEX idx_match_events_match_id ON match_events(match_id);
CREATE INDEX idx_match_events_type ON match_events(type);
CREATE INDEX idx_match_events_occurred_at ON match_events(occurred_at);

-- 预测表索引
CREATE INDEX idx_predictions_match_id ON predictions(match_id);
CREATE INDEX idx_predictions_created_at ON predictions(created_at);
CREATE INDEX idx_predictions_match_latest ON predictions(match_id, created_at DESC);

-- ============================================================
-- 触发器：自动更新 updated_at 字段
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_leagues_updated_at
    BEFORE UPDATE ON leagues
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_teams_updated_at
    BEFORE UPDATE ON teams
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_matches_updated_at
    BEFORE UPDATE ON matches
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 视图定义
-- ============================================================

-- 比赛详情视图（包含球队和联赛信息）
CREATE VIEW match_details AS
SELECT 
    m.id,
    m.external_id,
    m.status,
    m.home_score,
    m.away_score,
    m.home_score_ht,
    m.away_score_ht,
    m.scheduled_at,
    m.started_at,
    m.ended_at,
    m.venue,
    m.referee,
    m.attendance,
    m.created_at,
    m.updated_at,
    -- 主队信息
    ht.id AS home_team_id,
    ht.name AS home_team_name,
    ht.short_name AS home_team_short_name,
    ht.logo_url AS home_team_logo,
    -- 客队信息
    at.id AS away_team_id,
    at.name AS away_team_name,
    at.short_name AS away_team_short_name,
    at.logo_url AS away_team_logo,
    -- 联赛信息
    l.id AS league_id,
    l.name AS league_name,
    l.country AS league_country,
    l.logo_url AS league_logo
FROM matches m
JOIN teams ht ON m.home_team_id = ht.id
JOIN teams at ON m.away_team_id = at.id
JOIN leagues l ON m.league_id = l.id;

-- 最新预测视图（每场比赛只取最新的预测）
CREATE VIEW latest_predictions AS
SELECT DISTINCT ON (match_id)
    id,
    match_id,
    home_win_prob,
    draw_prob,
    away_win_prob,
    over_2_5_prob,
    btts_prob,
    predicted_home_score,
    predicted_away_score,
    confidence,
    model_version,
    features_snapshot,
    created_at
FROM predictions
ORDER BY match_id, created_at DESC;

-- ============================================================
-- 初始化数据（示例）
-- ============================================================

-- 插入示例联赛
INSERT INTO leagues (id, name, country, season) VALUES
    ('premier-league', '英格兰超级联赛', '英格兰', '2025-2026'),
    ('la-liga', '西班牙甲级联赛', '西班牙', '2025-2026'),
    ('bundesliga', '德国甲级联赛', '德国', '2025-2026'),
    ('serie-a', '意大利甲级联赛', '意大利', '2025-2026'),
    ('ligue-1', '法国甲级联赛', '法国', '2025-2026');

-- 插入示例球队
INSERT INTO teams (id, name, short_name, league_id) VALUES
    ('manchester-united', '曼彻斯特联', '曼联', 'premier-league'),
    ('manchester-city', '曼彻斯特城', '曼城', 'premier-league'),
    ('liverpool', '利物浦', '利物浦', 'premier-league'),
    ('arsenal', '阿森纳', '阿森纳', 'premier-league'),
    ('chelsea', '切尔西', '切尔西', 'premier-league'),
    ('real-madrid', '皇家马德里', '皇马', 'la-liga'),
    ('barcelona', '巴塞罗那', '巴萨', 'la-liga'),
    ('bayern-munich', '拜仁慕尼黑', '拜仁', 'bundesliga'),
    ('juventus', '尤文图斯', '尤文', 'serie-a'),
    ('psg', '巴黎圣日耳曼', '大巴黎', 'ligue-1');

-- ============================================================
-- 权限设置（生产环境请根据需要调整）
-- ============================================================

-- 创建应用程序用户（如果不存在）
-- CREATE USER app_user WITH PASSWORD 'your_secure_password';

-- 授予权限
-- GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
-- GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
