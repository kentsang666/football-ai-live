CREATE DATABASE IF NOT EXISTS football_db;
USE football_db;

CREATE TABLE IF NOT EXISTS matches (
    match_id INT PRIMARY KEY,                 -- 比赛ID
    league_id INT,                            -- 联赛ID
    start_time DATETIME,                      -- 开赛时间
    pre_match_home_lambda FLOAT,              -- 核心: 中午计算出的主队期望进球
    pre_match_away_lambda FLOAT,              -- 核心: 中午计算出的客队期望进球
    current_home_score INT DEFAULT 0,         -- 实时主队比分
    current_away_score INT DEFAULT 0,         -- 实时客队比分
    current_minute INT DEFAULT 0,             -- 比赛进行时间
    live_home_win_prob FLOAT DEFAULT NULL,    -- 实时计算出的主胜率
    status VARCHAR(20) DEFAULT 'NS',          -- 比赛状态: NS(未开始), 1H(上半场), FT(完场)等
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
