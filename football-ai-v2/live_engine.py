import numpy as np
import pandas as pd
from scipy.stats import poisson
import json
import os
import time

# --- Transformer Attention Module ---
class TransformerMomentum:
    """
    轻量级 Transformer Attention 模型
    用于捕捉比赛动量的时间序列特征 (Time-Series Activity Recognition)
    
    Architecture:
    Input: Sequence of Attack Vectors [DA, SoT, Corners] (Window Size N)
    Layer: Single Head Self-Attention
    Output: Context-Aware Momentum Score (Enhanced "Sustained Pressure" metric)
    """
    def __init__(self, window_size=5):
        self.window_size = window_size
        self.history = {} # { match_id: { 'last_stats': dict, 'sequence': list_of_vectors } }
        
        # Simulated Pre-trained Weights (for Attention Query/Key/Value projection)
        # In a real scenario, these would be loaded from a .pth file
        self.W_Q = np.array([[1.2, 0.1, 0.0], [0.1, 1.0, 0.0], [0.0, 0.0, 1.0]]) # Encourage recent
        self.W_K = np.eye(3)
        self.W_V = np.eye(3)

    def softmax(self, x):
        e_x = np.exp(x - np.max(x))
        return e_x / e_x.sum(axis=0)

    def process_match(self, match_id, stats):
        """
        stats: {'home_da': 50, ...} (Cumulative)
        Returns: (home_momentum_score, away_momentum_score)
        """
        if match_id not in self.history:
            self.history[match_id] = {
                'last_stats': stats,
                'home_seq': [], # List of [DA, SoT, Corner] deltas
                'away_seq': []
            }
            return 0.0, 0.0 # No history yet

        state = self.history[match_id]
        prev = state['last_stats']
        
        # 1. Calculate Deltas (Instant Velocity)
        # Prevent negative deltas (data correction)
        h_vec = np.array([
            max(0, stats.get('home_da', 0) - prev.get('home_da', 0)),
            max(0, stats.get('home_sot', 0) - prev.get('home_sot', 0)),
            max(0, stats.get('home_corners', 0) - prev.get('home_corners', 0))
        ])
        
        a_vec = np.array([
            max(0, stats.get('away_da', 0) - prev.get('away_da', 0)),
            max(0, stats.get('away_sot', 0) - prev.get('away_sot', 0)),
            max(0, stats.get('away_corners', 0) - prev.get('away_corners', 0))
        ])
        
        # Update Last Stats
        # Only update if stats changed (to avoid duplicate zero vectors in slow polling)
        if h_vec.sum() > 0 or a_vec.sum() > 0:
            state['last_stats'] = stats
            
            # 2. Update Sequences (Sliding Window)
            state['home_seq'].append(h_vec)
            state['away_seq'].append(a_vec)
            
            if len(state['home_seq']) > self.window_size:
                state['home_seq'].pop(0)
                state['away_seq'].pop(0)
            
        # 3. Apply Attention Mechanism
        # Only run if we have enough data
        if len(state['home_seq']) < 2:
            return 0.0, 0.0
            
        h_mom = self._calculate_attention_score(np.array(state['home_seq']))
        a_mom = self._calculate_attention_score(np.array(state['away_seq']))
        
        return h_mom, a_mom

    def _calculate_attention_score(self, sequence):
        """
        sequence: (T, 3) matrix
        """
        # Simple Self-Attention
        # Q = Current (Last) State * W_Q
        # K, V = Entire Sequence * W_K, W_V
        
        current = sequence[-1] # Shape (3,)
        
        Q = np.dot(current, self.W_Q)
        K = np.dot(sequence, self.W_K.T) # (T, 3)
        V = np.dot(sequence, self.W_V.T) # (T, 3)
        
        # Attention Scores = Softmax(Q * K.T / sqrt(d))
        current_reshaped = Q.reshape(1, -1) # (1, 3)
        
        # Dot Product Similarity
        # (1, 3) dot (3, T) -> (1, T)
        attn_logits = np.dot(current_reshaped, K.T) 
        d_k = 3.0
        attn_logits = attn_logits / np.sqrt(d_k)
        
        weights = self.softmax(attn_logits.flatten()) # (T,)
        
        # Weighted Sum of Values
        # weights (T,) dot V (T, 3) -> (3,)
        context_vector = np.dot(weights, V)
        
        # Compress to scalar score (Weighted Sum of features)
        # Weights: DA=1, SoT=5, Corner=2
        feature_importance = np.array([1.0, 5.0, 2.0])
        score = np.dot(context_vector, feature_importance)
        
        return score

# --- Expected Threat (xT) Spatial Engine ---
class ExpectedThreatModel:
    """
    xT (Expected Threat) 模型
    基于 '隐式区域' (Implicit Zones) 估算统计事件的空间价值。
    
    Grid Logic (Simplified 3 Zones):
    Zone A (Build-up): Low xT (0.01) - General Play
    Zone B (Creation): Mid xT (0.05) - Dangerous Attacks
    Zone C (Finishing): High xT (0.15++ ) - Corners / SoT
    """
    def __init__(self):
        # xT Surface Values (Flattened Logic for Stats)
        self.xt_map = {
            'possession': 0.001,      # 每次控球微小威胁
            'dangerous_attack': 0.06, # 进入 Zone 14 或 边路深处
            'corner': 0.12,           # 定位球高威胁区
            'shot_on_target': 0.35,   # 极高威胁动作
            'shot_off_target': 0.15   # 射门尝试本身代表处于好位置
        }
        self.history = {} # { match_id: { 'last_stats': dict } }

    def calculate_xt(self, match_id, stats):
        """
        计算近期生成的累计 xT (Cumulative Expected Threat)
        """
        if match_id not in self.history:
            self.history[match_id] = {'last_stats': stats}
            return 0.0, 0.0 # No Delta yet

        prev = self.history[match_id]['last_stats']
        
        # Calculate Deltas (Actions happening NOW)
        h_deltas = {
            'dangerous_attack': max(0, stats.get('home_da', 0) - prev.get('home_da', 0)),
            'shot_on_target': max(0, stats.get('home_sot', 0) - prev.get('home_sot', 0)),
            'corner': max(0, stats.get('home_corners', 0) - prev.get('home_corners', 0)),
            # Not strictly tracking possession counts usually, ignore for now
        }
        
        a_deltas = {
            'dangerous_attack': max(0, stats.get('away_da', 0) - prev.get('away_da', 0)),
            'shot_on_target': max(0, stats.get('away_sot', 0) - prev.get('away_sot', 0)),
            'corner': max(0, stats.get('away_corners', 0) - prev.get('away_corners', 0)),
        }
        
        # If no new data, don't update last_stats to keep tracking delta correctly? 
        # Actually standard practice is update and return 0
        self.history[match_id]['last_stats'] = stats
        
        # Sum xT Value
        h_xt_val = sum([count * self.xt_map.get(k, 0) for k, count in h_deltas.items()])
        a_xt_val = sum([count * self.xt_map.get(k, 0) for k, count in a_deltas.items()])
        
        return h_xt_val, a_xt_val

# --- Tactical Inertia Module ---
class TacticalInertia:
    """
    战术惯性修正模块 v1.0
    处理进球后的松懈、红牌后的激励效应等非线性时间影响。
    """
    def __init__(self):
        # 记录每场比赛的关键事件时间戳 { fixture_id: { 'last_goal': ts, 'red_card': ts, 'red_card_team': 'home' } }
        self.state = {}
        
    def update_state(self, fixture_id, score_home, score_away, red_cards_home, red_cards_away):
        now = time.time()
        
        # Init
        if fixture_id not in self.state:
            self.state[fixture_id] = {
                'scores': (score_home, score_away),
                'last_goal_time': 0,
                'red_cards': (red_cards_home, red_cards_away),
                'red_card_time': 0
            }
            return

        prev = self.state[fixture_id]
        
        # Check Goal
        if (score_home + score_away) > (prev['scores'][0] + prev['scores'][1]):
            prev['last_goal_time'] = now
            prev['scores'] = (score_home, score_away)
            
        # Check Red Card
        if (red_cards_home + red_cards_away) > (prev['red_cards'][0] + prev['red_cards'][1]):
            prev['red_card_time'] = now
            prev['red_cards'] = (red_cards_home, red_cards_away)

    def get_correction_factor(self, fixture_id, team='home'):
        """
        返回修正系数 Multiplier. >1.0 表示加强(更易进球/更强), <1.0 表示削弱.
        """
        if fixture_id not in self.state:
            return 1.0
            
        data = self.state[fixture_id]
        now = time.time()
        factor = 1.0
        
        # 1. Post-Goal Lull (进球后的松懈)
        # 假设：进球后5分钟(300s)内，进球方防守变差(对方进球率提升)，自身进攻变差。
        time_since_goal = now - data['last_goal_time']
        if time_since_goal < 300 and data['last_goal_time'] > 0:
            # 这是一个混沌期，双方都不稳定，通常意味着波动率增加
            # 这里简单处理：让 xG 预测 slightly damped (更加保守)，因为比赛节奏被打断
            factor *= 0.9 

        # 2. Martyr Effect (哀兵必胜/红牌激励)
        # 假设：红牌后15分钟(900s)内，防守方意志力极强，极难攻破。
        time_since_red = now - data['red_card_time']
        if time_since_red < 900 and data['red_card_time'] > 0:
            # 此时 xG 产生变得非常困难
            factor *= 0.8
            
        return factor

# 模拟配置：不同事件的权重 [1, 2]
DEFAULT_WEIGHTS = {
    'dangerous_attacks': 0.1,
    'shots_on_target': 1.0,
    'shots_off_target': 0.4,
    'corners': 0.3
}
WEIGHTS_FILE = "model_weights.json"

# --- League Volatility Constants ---
# 1.0 = Standard, >1.0 = High Scoring/Volatile, <1.0 = Defensive/Low Volatility
LEAGUE_VOLATILITY = {
    # High Volatility (大球联赛)
    "德甲": 1.15, "德国甲级联赛": 1.15,
    "荷甲": 1.20, "荷兰甲级联赛": 1.20,
    "澳超": 1.15, "澳大利亚超级联赛": 1.15,
    "挪超": 1.12, "挪威超级联赛": 1.12,
    "瑞典超": 1.10, 
    "美职联": 1.10, "MLS": 1.10,
    "瑞士超": 1.12,

    # Low Volatility (小球/防守联赛)
    "法乙": 0.85, "法国乙级联赛": 0.85,
    "意乙": 0.85, "意大利乙级联赛": 0.85,
    "西乙": 0.88, "西班牙乙级联赛": 0.88,
    "阿甲": 0.85, "阿根廷甲级联赛": 0.85,
    "希腊超": 0.82,
    "巴甲": 0.90, "巴西甲级联赛": 0.90,
    "俄超": 0.90,
    
    # Standard/Mixed (Top 5) - Slightly Adjust
    "英超": 1.05, # 英超节奏快
    "西甲": 0.98, # 西甲比较技术流控球
    "意甲": 1.02, # 意甲近年进球变多
    "法甲": 0.95,
}

# --- Star Player Constants (Demo Database) ---
# Format: "Team Name": ["Player A", "Player B"]
STAR_PLAYERS = {
    "Manchester City": ["Haaland", "De Bruyne", "Rodri"],
    "Arsenal": ["Saka", "Odegaard", "Rice"],
    "Liverpool": ["Salah", "Van Dijk", "Alisson"],
    "Bayern Munich": ["Kane", "Musiala", "Neuer"],
    "Real Madrid": ["Vinicius Jr", "Bellingham", "Mbappe"],
    "Barcelona": ["Lewandowski", "Yamal", "Pedri"],
    "PSG": ["Dembele", "Hakimi", "Marquinhos"],
    "Inter": ["Lautaro", "Barella", "Calhanoglu"],
    "Juventus": ["Vlahovic", "Bremer"],
    "AC Milan": ["Leao", "Theo Hernandez", "Pulisic"],
    "Leverkusen": ["Wirtz", "Xhaka", "Grimaldo"],
}

KEY_PLAYER_PENALTY = 0.82 # 18% reduction in xG if key players missing (heuristic)

# --- Referee Style Constants (Demo Database) ---
# strictness: Red Card probability multiplier (Affects Volatility)
# penalty: Penalty kick probability multiplier (Affects xG directly)
REFEREE_STYLES = {
    "Anthony Taylor": {"strictness": 1.1, "penalty": 1.2}, # 英超名哨，点球多
    "Michael Oliver": {"strictness": 0.9, "penalty": 1.1}, # 相对宽松
    "Mateu Lahoz": {"strictness": 1.8, "penalty": 1.4},    # 西甲卡牌大师 (已退役，作Demo)
    "Daniele Orsato": {"strictness": 1.2, "penalty": 0.9}, # 意甲严谨型
    "Szymon Marciniak": {"strictness": 1.0, "penalty": 1.3}, # 世界杯决赛裁判，敢吹点球
    "Clement Turpin": {"strictness": 1.3, "penalty": 1.1}, # 法甲红牌多
}

# --- Fatigue & Travel Constants ---
# 疲劳主要影响防守专注度（导致丢球增加）和体能（进攻效率略降）
# 这里只做 Demo 简化：疲劳系数 (Fatigue Score) 0.0 ~ 1.0
# 1.0 满疲劳 = 进攻 x 0.85, 防守(给对方送xG) x 1.15
FATIGUE_MAX_ATT_DROP = 0.85 
FATIGUE_MAX_DEF_LEAK = 1.15

# --- Motivation Context Constants ---
MOTIVATION_FACTORS = {
    "TITLE_RACE": 1.12,      # 争冠 (进攻++ 专注++)
    "RELEGATION": 1.08,      # 保级 (拼命)
    "EUROPE_SPOT": 1.05,     # 争欧战
    "MID_TABLE": 0.90,       # 中游无欲无求 (划水)
    "FRIENDLY": 0.85,        # 友谊赛 (防守松懈，进攻随缘，总体略降)
    "DERBY": 1.10,           # 德比 (肾上腺素)
}

# Simple Context Database (Demo)
# Team Name -> Context Code
TEAM_CONTEXT_DB = {
    "Manchester City": "TITLE_RACE",
    "Liverpool": "TITLE_RACE",
    "Arsenal": "TITLE_RACE",
    "Sheffield United": "RELEGATION",
    "Burnley": "RELEGATION",
    "Luton": "RELEGATION",
    "Real Madrid": "TITLE_RACE",
    "Girona": "EUROPE_SPOT",
    "Chelsea": "MID_TABLE", # 仅作示例
    "Crystal Palace": "MID_TABLE",
}

# --- Tactical Style & Clash Matrix ---
STYLE_POSSESSION = "POSSESSION"      # 传控 (e.g. Man City)
STYLE_COUNTER = "COUNTER"            # 防反 (e.g. Real Madrid)
STYLE_HIGH_PRESS = "HIGH_PRESS"      # 高压 (e.g. Liverpool)
STYLE_LOW_BLOCK = "LOW_BLOCK"        # 低位防守/大巴
STYLE_BALANCED = "BALANCED"          # 均衡

# Demo Team Styles
TEAM_STYLE_DB = {
    "Manchester City": STYLE_POSSESSION,
    "Arsenal": STYLE_POSSESSION,
    "Barcelona": STYLE_POSSESSION,
    "Real Madrid": STYLE_COUNTER,
    "Inter": STYLE_COUNTER,
    "Atletico Madrid": STYLE_LOW_BLOCK,
    "Liverpool": STYLE_HIGH_PRESS,
    "Leverkusen": STYLE_HIGH_PRESS,
    "Burnley": STYLE_LOW_BLOCK,
}

# Matrix: (TeamA_Style, TeamB_Style) -> (TeamA_Mod, TeamB_Mod)
# Key Logic: 
# - Counter beats High Line (Possession/Press)
# - Possession struggles vs Low Block
# - Press beats Possession (Disruption)
CLASH_MATRIX = {
    (STYLE_POSSESSION, STYLE_COUNTER): (0.95, 1.15),   # 传控被防反克
    (STYLE_COUNTER, STYLE_POSSESSION): (1.15, 0.95),
    
    (STYLE_POSSESSION, STYLE_LOW_BLOCK): (0.88, 0.90), # 攻坚战，进球都难
    (STYLE_LOW_BLOCK, STYLE_POSSESSION): (0.90, 0.88),
    
    (STYLE_HIGH_PRESS, STYLE_POSSESSION): (1.12, 0.92), # 疯狗流抢断传控
    (STYLE_POSSESSION, STYLE_HIGH_PRESS): (0.92, 1.12),
    
    (STYLE_HIGH_PRESS, STYLE_LOW_BLOCK): (1.05, 0.90), # 高压能压死大巴
    (STYLE_LOW_BLOCK, STYLE_HIGH_PRESS): (0.90, 1.05),
    
    (STYLE_COUNTER, STYLE_HIGH_PRESS): (1.10, 1.10),   # 互爆局 (身后全是空档)
    (STYLE_HIGH_PRESS, STYLE_COUNTER): (1.10, 1.10),
}

# --- Weather & Environment Constants ---
# xG Multipliers based on conditions
WEATHER_IMPACT = {
    "RAIN": 1.05,       # 雨战，球皮湿滑，低级失误多，远射易进 -> 进球略多
    "HEAVY_RAIN": 0.90, # 积水严重，球传不起来 -> 进球少
    "SNOW": 0.85,       # 雪战，视野受阻，动作僵硬 -> 小球
    "HEAT": 0.92,       # 高温，体力消耗大，下半场节奏崩 -> 进球少
    "PERFECT": 1.00     # 完美草皮
}

# Hostile Environments (Mega Home Advantage)
# Multiplier for Home Team xG
FORTRESS_BONUS = {
    "Liverpool": 1.15,      # Anfield
    "Dortmund": 1.15,       # Signal Iduna Park (Yellow Wall)
    "Galatasaray": 1.20,    # Welcome to Hell
    "Boca Juniors": 1.18,   # La Bombonera
    "Napoli": 1.12,         # Maradona Stadium
    "Man Utd": 1.05,        # Old Trafford (Legacy buff decreasing...)
    "Real Madrid": 1.10,    # Bernabeu European Nights
}

class LatencyGuard:
    """
    延迟套利保护 (Latency Arbitrage Protection)
    功能：
    1. 监测数据流新鲜度，过滤过期数据 (Stale Data)。
    2. 进球/红牌后冻结窗口 (Freeze Window)，防止在市场未反应前进行误判。
    3. 识别盘口封盘状态 (Market Suspension)。
    """
    def __init__(self, max_latency=30, freeze_time=60):
        self.max_latency = max_latency # 秒
        self.freeze_time = freeze_time # 进球后冻结秒数
        
        # State Tracking
        self.match_states = {} # { id: { 'last_score': (0,0), 'last_event_ts': 0 } }

    def check_safety(self, match_id, current_score, data_timestamp):
        """
        Check if it's safe to price this match.
        Returns: (is_safe: bool, reason: str)
        """
        now = time.time()
        
        # 1. Data Freshness Check
        # data_timestamp is Unix Epoch from API
        latency = now - data_timestamp
        if latency > self.max_latency:
            return False, f"🚫 数据严重延迟 ({int(latency)}s) - 拒绝交易"
            
        # 2. Event Freeze Check
        if match_id not in self.match_states:
            self.match_states[match_id] = {
                'last_score': current_score,
                'last_event_ts': 0
            }
            return True, "OK" # First see is safe
            
        state = self.match_states[match_id]
        
        # Detect Score Change
        if current_score != state['last_score']:
            state['last_score'] = current_score
            state['last_event_ts'] = now
            return False, "⚽ 进球发生 - 冻结保护中"
            
        # Check Time since last event
        time_since = now - state['last_event_ts']
        if time_since < self.freeze_time:
            remaining = int(self.freeze_time - time_since)
            return False, f"❄️ 市场结算冷却中 (余 {remaining}s)"
            
        return True, "✅ 信号安全"

class KellyStaking:
    """
    凯利公式资金管理引擎 (The Kelly Staking Engine)
    逻辑：根据优势大小 (Edge) 动态计算最佳下注比例。
    
    Formula: f = (bp - q) / b
    where:
        f = fraction of bankroll to bet
        b = net odds (decimal odds - 1)
        p = probability of winning (AI Model)
        q = probability of losing (1 - p)
        
    Risk Management:
    - Uses "Fractional Kelly" (default 0.25) to reduce variance.
    - Caps max stake to avoid ruin (e.g. max 5% of bankroll).
    """
    def __init__(self, fraction=0.25, max_stake=0.05):
        self.fraction = fraction
        self.max_stake = max_stake # 5% cap

    def calculate_stake(self, model_prob, market_odds):
        """
        Returns: Stake percentage (e.g. 2.5 means 2.5% of bankroll)
        """
        if market_odds <= 1.01 or model_prob <= 0:
            return 0.0
            
        b = market_odds - 1.0
        p = model_prob
        q = 1.0 - p
        
        # Standard Kelly Formula
        # f* = (p * (b + 1) - 1) / b
        # or (bp - q) / b
        
        full_kelly = (b * p - q) / b
        
        # If Edge is negative, Kelly says don't bet
        if full_kelly <= 0:
            return 0.0
            
        # Apply Fraction (Safety)
        rec_stake = full_kelly * self.fraction
        
        # Apply Cap (Risk Management)
        final_stake = min(rec_stake, self.max_stake)
        
        # Return formatted
        return round(final_stake * 100, 2) # e.g. 3.25%

class ConsensusOracle:
    """
    多源数据共识引擎 (Consensus Oracle / The Oracle Problem)
    
    Problem:
    API providers (even expensive ones) have glitches. A "Ghost Goal" or wrong card 
    can trigger a massive wrong bet.
    
    Solution:
    Require consensus from multiple independent feeds (Primary + Shadow).
    - If Score disagrees -> BLOCK (Critical Conflict)
    - If Time disagrees -> Use Minimum (Conservative)
    - If Stats disagree -> Average them (Noise Reduction)
    """
    def __init__(self):
        # In a real system, we might connect to:
        # 1. API-Football (Primary)
        # 2. SportMonks (Secondary)
        # 3. FlashScore Scraper (Tertiary)
        pass

    def validate(self, match_id, primary_packet, secondary_packet=None):
        """
        Verify data integrity across sources.
        Returns: (FinalDataset, TrustLevel)
        TrustLevel: 'HIGH_CONSENSUS', 'SINGLE_SOURCE', 'CONFLICT_SCORE', 'CONFLICT_RED_CARD'
        """
        # If no secondary source available, return Primary with lower trust warning
        if secondary_packet is None:
            return primary_packet, "SINGLE_SOURCE"
            
        # 1. Critical Audit: Scoreline
        p_goals = (primary_packet.get('goals', {}).get('home'), primary_packet.get('goals', {}).get('away'))
        s_goals = (secondary_packet.get('goals', {}).get('home'), secondary_packet.get('goals', {}).get('away'))
        
        # Check for None to avoid crash
        if None in p_goals: p_goals = (0,0)
        if None in s_goals: s_goals = (0,0)

        if p_goals != s_goals:
            # 严重冲突：比分不一致 (The Oracle Problem)
            # 策略：立即熔断，直到人工介入或源同步
            return None, "CONFLICT_SCORE"
            
        # 2. Critical Audit: Red Cards (Simulated check, requires event parsing)
        # Assuming we parsed events outside, but here we do raw check if possible
        # Skip for demo simplicity, focus on Score
        
        # 3. Data Fusion: Statistics (Average to remove noise)
        # If primary says 5 shots, secondary says 7, reality is likely 6.
        # This reduces "Stat padding" or "Missed tags" errors.
        
        # We assume standard structure exists. 
        # Deep merge/average logic would go here.
        # For this demo, we trust Primary stats if Score matches.
        
        return primary_packet, "HIGH_CONSENSUS"

class MarketPsychology:
    """
    市场心理学分析模块
    检测：过度反应、恐慌抛售、诱盘陷阱
    """
    def detect_overreaction(self, model_prob, market_odd):
        """
        Input:
            model_prob: float (0.0 - 1.0) AI模型的胜率预测
            market_odd: float (e.g. 1.95) 市场赔率
        Return: (Signal_Type, Confidence_Score)
        """
        if market_odd <= 1.01: return None, 0.0
        
        # Implied Probability (without margin removal for raw comparison)
        market_imp_prob = 1.0 / market_odd
        
        # 1. Panic Overreaction (恐慌性抛售)
        # 模型认为有 60% 胜率，市场赔率 4.0 (25% 概率)
        # 常见于：强队红牌后，市场过度看衰
        if model_prob - market_imp_prob > 0.25:
            return "PANIC_OVERREACTION", (model_prob - market_imp_prob)
            
        # 2. Trap / Hype (诱盘/热度过高)
        # 模型认为只有 30% 胜率，市场赔率 1.3 (76% 概率)
        # 常见于：网红球队（如曼联/切尔西）吸筹
        if market_imp_prob - model_prob > 0.30:
            return "HYPE_TRAP", (market_imp_prob - model_prob)
            
        return None, 0.0

class PressureModel:
    def __init__(self, weights=None):
        self.learning_rate = 0.01
        self.weights = DEFAULT_WEIGHTS.copy()
        
        # 尝试加载先前的学习成果
        self.load_weights()
        
        if weights is not None:
             self.weights.update(weights)

    def load_weights(self):
        if os.path.exists(WEIGHTS_FILE):
            try:
                with open(WEIGHTS_FILE, 'r') as f:
                    saved = json.load(f)
                    self.weights.update(saved)
            except: pass

    def save_weights(self):
        try:
            with open(WEIGHTS_FILE, 'w') as f:
                json.dump(self.weights, f, indent=4)
        except: pass

    def learn(self, result, snapshot, is_home_bet):
        """
        在线学习接口 (Online Learning)
        result: 1 (Win), -1 (Loss), 0 (Push)
        snapshot: 推荐时的各项数据 (Diff: Home - Away)
        is_home_bet: True if bet on Home, False if Away
        """
        if result == 0: return # 走水不学习
        
        # 定义方向: 如果是主队注单，主队数据越高应该越容易赢 => 正相关
        # 如果是客队注单，主队数据越高应该越容易输 => 负相关
        # 这里为了简化，我们只调整通用权重 (General Weights)，即 "射正" 到底重不重要
        
        # 逻辑:
        # 如果 赢了 (result=1): 
        #   当时 射正多 (val > 0)，说明射正确实有用 -> 增加权重
        #   当时 射正少 (val < 0)，(这种情况比较少见，通常是主推主胜但主数据差？)
        
        # 简化版梯度下降:
        # 假设 Utility = w1*da + w2*sot...
        # 我们希望 Utility 与 Result (1/-1) 正相关
        
        # 如果 bet on Home:
        #   Features = (Home_DA - Away_DA), ...
        #   Update w += alpha * result * feature
        
        # 如果 bet on Away:
        #   Features = (Away_DA - Home_DA), ...
        #   Update w += alpha * result * feature
        
        diffs = {}
        if is_home_bet:
            diffs['dangerous_attacks'] = snapshot.get('home_da', 0) - snapshot.get('away_da', 0)
            diffs['shots_on_target'] = snapshot.get('home_sot', 0) - snapshot.get('away_sot', 0)
            diffs['shots_off_target'] = 0 # 暂不学习
            diffs['corners'] = snapshot.get('home_corners', 0) - snapshot.get('away_corners', 0)
        else:
            diffs['dangerous_attacks'] = snapshot.get('away_da', 0) - snapshot.get('home_da', 0)
            diffs['shots_on_target'] = snapshot.get('away_sot', 0) - snapshot.get('home_sot', 0)
            diffs['shots_off_target'] = 0
            diffs['corners'] = snapshot.get('away_corners', 0) - snapshot.get('home_corners', 0)
            
        # 归一化 Feature (避免权重爆炸)，简单除以一个常数 (e.g. 10次进攻)
        for k, v in diffs.items():
            # 限制幅度
            val = max(min(v / 10.0, 1.0), -1.0)
            
            # 核心更新公式
            if k in self.weights:
                change = self.learning_rate * result * val
                self.weights[k] += change
                # 保证权重不为负
                self.weights[k] = max(0.01, self.weights[k])
        
        self.save_weights()
        return self.weights

    def calculate_momentum(self, recent_stats):
        """
        计算过去N分钟的压力指数
        recent_stats: 字典，包含主客队的实时数据 (flat keys: home_da, home_sot, home_corners)
        """
        # User defined logic
        home_pressure = (
            recent_stats.get('home_da', 0) * self.weights.get('dangerous_attacks', 0.1) +
            recent_stats.get('home_sot', 0) * self.weights.get('shots_on_target', 1.0) +
            recent_stats.get('home_corners', 0) * self.weights.get('corners', 0.5)
        )
        
        away_pressure = (
            recent_stats.get('away_da', 0) * self.weights.get('dangerous_attacks', 0.1) +
            recent_stats.get('away_sot', 0) * self.weights.get('shots_on_target', 1.0) +
            recent_stats.get('away_corners', 0) * self.weights.get('corners', 0.5)
        )
        
        # 返回一个调整系数，例如 1.2 表示进攻效率提升 20%
        # 这里做一个简单的归一化处理
        # Note: Original code handled 0 case, keeping that safe
        # home_factor = 1 + (home_pressure / 10)  # 简化算法，具体需回归测试
        # away_factor = 1 + (away_pressure / 10)
        
        # To prevent division by zero or weirdness if needed, though formula is additive.
        # Returning explicit factors as per user code
        
        home_factor = 1 + (home_pressure / 10.0)
        away_factor = 1 + (away_pressure / 10.0)
        
        # EXTENSION: Returning raw pressure as well for UI display
        # Scale for UI bar (approx 0-100 range)
        # Assuming pressure around 5-10 is "high", we multiply by 10 to fill the bar
        return home_factor, away_factor, home_pressure * 10, away_pressure * 10



class LivePricing:
    """
    2. 动态泊松定价 (Pricing Engine) - Replaces LiveProbability
    逻辑：结合 xG、剩余时间、动量系数计算实时胜平负概率及盘口。
    """
    def __init__(self, pre_match_xg_home, pre_match_xg_away):
        self.base_home_xg = pre_match_xg_home
        self.base_away_xg = pre_match_xg_away

    def get_remaining_xg(self, minute, home_factor, away_factor, current_score=(0,0), league_name=None, home_missing_keys=False, away_missing_keys=False, referee_name=None, referee_stats=None, home_fatigue=0.0, away_fatigue=0.0, home_motivation_type=None, away_motivation_type=None, home_style=None, away_style=None, weather_type="PERFECT", home_team_name=None, home_transformer_mom=0.0, away_transformer_mom=0.0, home_xt=0.0, away_xt=0.0):
        """
        根据剩余时间和动量调整期望进球数 (Lambda) - 升级版 V2.0 (全因子集成 + 战意 + 风格 + 天气 + 主场龙 + Transformer + xT + Referee Stats)
        """
        # User defined logic for remaining time
        time_remaining = 90 - minute
        
        # If match is over or time is negative/weird
        if time_remaining <= 0:
            return 0.0, 0.0
        
        # --- 升级 1: 非线性时间衰减 (Non-Linear Time Decay) ---
        # 足球比赛进球率并非均匀分布，上下半场末段进球率通常更高
        # 简单模型：使用幂函数修正。alpha < 1 会让剩余比例在前期下降慢，后期下降快（不符合），
        # 我们需要的是：在比赛末段，进球密度反而可能上升（绝杀），但这里算的是“剩余总量”。
        # 传统的 "剩余" 是线性的。但考虑到体力下降和绝杀心态，剩余 xG 在 80分钟时可能比 剩余时间比例 要高。
        # 这里使用一个简单的 "疲劳/绝杀系数" (Fatigue/Desperation Factor)
        # 假设最后 15 分钟进球概率提升 20%
        
        time_ratio = time_remaining / 90.0
        intensity_mult = 1.0
        
        if minute > 75: 
            intensity_mult = 1.2 # 末段冲刺
        elif minute > 40 and minute <= 45:
            intensity_mult = 1.1 # 半场前
            
        # --- 升级 11: Transformer 动量修正 ---
        # Transformer 捕捉的是 "序列特征"，比单纯的线性压力更敏感于 "趋势"
        # 归一化: 假设 score 范围 0-10, 我们给予 0-20% 的加成
        t_home_mult = 1.0 + (min(home_transformer_mom, 10.0) / 50.0) # max 20% boost
        t_away_mult = 1.0 + (min(away_transformer_mom, 10.0) / 50.0)

        # --- 升级 12 (NEW): xT (Expected Threat) Spatial Correction ---
        # xT 代表的是 "位置质量" (Quality of Pitch Control)。
        # 不同于 Momentum (数量/频率)，xT 奖励的是 "有效推进"。
        # 如果一支球队 xT 很高，说明他们经常打入 "High Value Zones"，进球概率应显著增加。
        # Demo Scaling: xT 累积值通常较小 (e.g. 0.1, 0.5 per sequence). 
        # 这里我们将最近几分钟产生的 xT 直接转化为 xG 的加成。
        
        xt_home_mult = 1.0 + (min(home_xt, 5.0) / 10.0) # 假设 xT 上限 5.0，最大加成 50%
        xt_away_mult = 1.0 + (min(away_xt, 5.0) / 10.0)

        # --- 升级 2: 赛况修正 (Game State Correction) ---
        # 落后的一方通常会投入更多进攻资源 (Game State Effect)
        # 领先的一方通常会收缩 (Parking the Bus)
        
        gs_home_mult = 1.0
        gs_away_mult = 1.0
        
        home_goals, away_goals = current_score
        score_diff = home_goals - away_goals
        
        if minute > 60: # 60分钟后比分效应通过
            if score_diff < 0: # 主队落后
                if score_diff == -1: gs_home_mult = 1.15 # 落后1球最拼
                elif score_diff == -2: gs_home_mult = 1.10
                # 领先方可能降低 xG
                gs_away_mult = 0.9 
            elif score_diff > 0: # 主队领先
                if score_diff == 1: gs_away_mult = 1.15 # 客队拼命
                elif score_diff == 2: gs_away_mult = 1.10
                gs_home_mult = 0.9 # 主队防守
        
        # --- 升级 3: 联赛波动率因子 (League Volatility Factor) ---
        league_volatility = 1.0
        if league_name:
            # 模糊匹配或直接匹配
            for key, val in LEAGUE_VOLATILITY.items():
                if key in league_name:
                    league_volatility = val
                    break
        
        # --- 升级 5: 关键球员缺席惩罚 (Star Player Absence Penalty) ---
        star_penalty_home = KEY_PLAYER_PENALTY if home_missing_keys else 1.0
        star_penalty_away = KEY_PLAYER_PENALTY if away_missing_keys else 1.0
        
        # --- 升级 6: 裁判偏见 (Referee Bias) ---
        # Updated: accept external dynamic stats
        ref_modifier = 1.0
        if referee_stats:
             # referee_stats: {'penalty': 1.2, 'card_avg': 4.5}
             ref_modifier = referee_stats.get('penalty', 1.0)
        elif referee_name:
             # Fallback to static DB
             for r_name, traits in REFEREE_STYLES.items():
                 if r_name in referee_name:
                     ref_modifier = traits.get('penalty', 1.0)
                     break

        # --- 升级 7: 疲劳与飞行距离修正 (Fatigue & Travel) ---
        # 疲劳主要导致：进攻效率下降 (Att Drop) + 防守漏洞增加 (Def Leak)
        # 自身进球 lambda *= (1 - fatigue * (1 - MAX_ATT))
        # 对方进球 lambda *= (1 + fatigue * (MAX_DEF - 1))
        
        # Home Fatigue Effect
        # 主队疲劳 -> 主队进球少，客队进球多
        h_att_mod = 1.0 - (home_fatigue * (1.0 - FATIGUE_MAX_ATT_DROP))
        h_def_mod = 1.0 + (home_fatigue * (FATIGUE_MAX_DEF_LEAK - 1.0)) # 让客队进球变多
        
        # Away Fatigue Effect
        # 客队疲劳 -> 客队进球少，主队进球多
        a_att_mod = 1.0 - (away_fatigue * (1.0 - FATIGUE_MAX_ATT_DROP))
        a_def_mod = 1.0 + (away_fatigue * (FATIGUE_MAX_DEF_LEAK - 1.0)) # 让主队进球变多

        # --- 升级 8: 战意与背景修正 (Motivation & Context) ---
        h_mot_mod = MOTIVATION_FACTORS.get(home_motivation_type, 1.0)
        a_mot_mod = MOTIVATION_FACTORS.get(away_motivation_type, 1.0)

        # --- 升级 9: 风格克制矩阵 (Style Clash Matrix) ---
        # Matrix: (H_Style, A_Style) -> (H_Mod, A_Mod)
        # Default: 1.0, 1.0
        h_style_mod = 1.0
        a_style_mod = 1.0
        
        if home_style and away_style:
            # Look up clash tuple
            clash_tuple = CLASH_MATRIX.get((home_style, away_style))
            if clash_tuple:
                h_style_mod, a_style_mod = clash_tuple

        # --- 升级 10: 天气与主场龙加成 (Weather & Fortress) ---
        weather_mod = WEATHER_IMPACT.get(weather_type, 1.0)
        
        fortress_mod = 1.0
        if home_team_name:
            # 简单模糊匹配
            for fortress, bonus in FORTRESS_BONUS.items():
                if fortress in home_team_name:
                    fortress_mod = bonus
                    break
        
        # 综合计算 (Ultimate Formula)
        # Lambad Home = Base * (Time) * (Momentum) * (GameState) * (League) * (Star) * (Ref) * (Fatigue) * (Mot) * (Style) * (Weather) * (Fortress) * (Transformer) * (xT)
        live_lambda_home = self.base_home_xg * time_ratio * home_factor * intensity_mult * gs_home_mult * league_volatility * star_penalty_home * ref_modifier * h_att_mod * a_def_mod * h_mot_mod * h_style_mod * weather_mod * fortress_mod * t_home_mult * xt_home_mult
        
        live_lambda_away = self.base_away_xg * time_ratio * away_factor * intensity_mult * gs_away_mult * league_volatility * star_penalty_away * ref_modifier * a_att_mod * h_def_mod * a_mot_mod * a_style_mod * weather_mod * t_away_mult * xt_away_mult
        # 客队当然不享受魔鬼主场加成，甚至应该受惩罚(暂不减)，这里只加成主队
        
        return live_lambda_home, live_lambda_away
        
        # Apply Inertia factor if injected (dirty hack for demo: pass as kwargs or update globally)
        # 更好的方式是在 LivePricing 初始化时持有 inertia 实例
        # if self.inertia:
        #     f = self.inertia.get_correction_factor(fixture_id)
        #     live_lambda_home *= f
        #     live_lambda_away *= f
        
        return live_lambda_home, live_lambda_away

    def calculate_asian_handicap_prob(self, lambda_h, lambda_a, line, current_score=(0,0)):
        """
        计算特定盘口的期望胜率 (支持软盘口/四分盘)
        line: 盘口值，例如 -0.5, -0.25, +0.25
        Return: Expected Win Probability (Weighted for Half-Win)
        """
        max_goals = 10
        cur_h, cur_a = current_score
        
        # Precompute PMFs
        h_pmf = [poisson.pmf(i, lambda_h) for i in range(max_goals)]
        a_pmf = [poisson.pmf(i, lambda_a) for i in range(max_goals)]
        
        # 累加符合盘口的概率
        # Win = 1.0, Half Win = 0.5, Push = 0.0, Half Loss = 0.0, Loss = 0.0 (For simple Prob)
        # But wait, purely for "Probability of winning bet", we need to define what we return.
        # Usually: Return the expected payout ratio or equivalent Win%
        # Here we return "Equivalent Win Probability" -> Full Win + 0.5 * Half Win
        
        expected_value_prob = 0.0
        
        for h in range(max_goals):
            for a in range(max_goals):
                joint_prob = h_pmf[h] * a_pmf[a]
                
                # Final score
                final_h = cur_h + h
                final_a = cur_a + a
                diff = final_h - final_a
                
                # Handicap Result Logic
                # result = diff + line
                
                # Integer Lines (0, -1, -2...)
                if line % 0.5 == 0:
                    val = diff + line
                    if val > 0: expected_value_prob += joint_prob * 1.0 # Win
                    # if val == 0: Push (0 benefit)
                    
                # Quarter Lines (-0.25, -0.75...)
                else: 
                    # Split into two bets: (line - 0.25) and (line + 0.25)
                    # e.g. -0.25 -> bets on 0 and -0.5
                    
                    # Logic 2: Direct calculation
                    # If Line = -0.25. Setup: Home vs Away.
                    # Win by 1: (-0.25 + 1) = 0.75 > 0. Win.
                    # Draw: (-0.25 + 0) = -0.25. Loss Half.
                    
                    val = diff + line
                    
                    if val >= 0.5: # Clear Win
                        expected_value_prob += joint_prob * 1.0
                    elif val <= -0.5: # Clear Loss
                        pass
                    elif abs(val) == 0.25:
                        # Case: 0.25 or -0.25
                        if val > 0: # +0.25 surplus (e.g. bet -0.75, win by 1 -> net +0.25) -> Half Win
                            expected_value_prob += joint_prob * 0.5
                        else: # -0.25 deficit (e.g. bet -0.25, draw -> net -0.25) -> Half Loss
                            pass # 0 value
                            
        return expected_value_prob

    def calculate_1x2_probs(self, lambda_h, lambda_a, current_score=(0,0)):
        """
        Helper for UI to get Win/Draw/Loss probabilities
        """
        max_goals = 10
        cur_h, cur_a = current_score
        
        h_pmf = [poisson.pmf(i, lambda_h) for i in range(max_goals)]
        a_pmf = [poisson.pmf(i, lambda_a) for i in range(max_goals)]
        
        prob_home = 0.0
        prob_draw = 0.0
        prob_away = 0.0
        
        for h in range(max_goals):
            for a in range(max_goals):
                joint_prob = h_pmf[h] * a_pmf[a]
                final_h = cur_h + h
                final_a = cur_a + a
                
                if final_h > final_a:
                    prob_home += joint_prob
                elif final_h == final_a:
                    prob_draw += joint_prob
                else:
                    prob_away += joint_prob
                    
        return prob_home, prob_draw, prob_away



class AsianHandicapPricer:
    """
    3. 亚洲盘口转换器 (Asian Handicap Pricer)
    逻辑：将概率转化为公平赔率。
    """
    @staticmethod
    def calculate_fair_odds(lambda_home, lambda_away, current_score_diff, line):
        """
        计算特定亚盘 (line) 下的主胜公平赔率 (Decimal Odds)。
        line: 盘口 (针对主队)，如 -0.5, +0.5。
        current_score_diff: 当前主队领先球数 (主 - 客)。
        """
        # 赢盘条件: (未来主 - 未来客) + 当前分差 > -line
        # 即: 净胜球 > 阈值
        threshold = -1 * line - current_score_diff
        
        win_prob = 0.0
        push_prob = 0.0
        
        # 模拟卷积 (可以用 Skellam 分布优化，这里用循环直观演示)
        for i in range(10):
            for j in range(10):
                p = poisson.pmf(i, lambda_home) * poisson.pmf(j, lambda_away)
                diff = i - j
                
                if diff > threshold + 0.1: # Win
                    win_prob += p
                elif abs(diff - threshold) < 0.1: # Draw/Push (走水)
                    push_prob += p
        
        # 计算赔率
        # 对于整数盘 (如 -1.0)，分母通常排除走水概率: P(Win) / (1 - P(Push))
        # 对于半球盘 (如 -0.5)，无走水: P(Win)
        
        effective_win_prob = win_prob
        if push_prob > 0.01:
            effective_win_prob = win_prob / (1.0 - push_prob)
            
        if effective_win_prob < 0.01: return 99.0 # 防止无穷大
        
        return round(1.0 / effective_win_prob, 2)


class OverUnderPricer:
    """
    3.5 大小球定价器 (Over/Under Pricer)
    """
    @staticmethod
    def calculate_fair_odds(lambda_home, lambda_away, current_total_goals, line):
        """
        计算特定大小盘 (line) 下的大球公平赔率 (Over Odds).
        line: 盘口值 (如 2.5).
        current_total_goals: 当前比赛总进球数.
        """
        # 赢盘条件: (未来主 + 未来客) + 当前总球数 > line
        threshold = line - current_total_goals
        
        over_prob = 0.0
        push_prob = 0.0
        
        # 简单的双重泊松卷积
        for i in range(10):
            for j in range(10):
                p = poisson.pmf(i, lambda_home) * poisson.pmf(j, lambda_away)
                total_future = i + j
                
                if total_future > threshold + 0.1: # Over Win
                    over_prob += p
                elif abs(total_future - threshold) < 0.1: # Push (走水)
                    push_prob += p
                    
        # 计算赔率
        effective_prob = over_prob
        if push_prob > 0.01:
            effective_prob = over_prob / (1.0 - push_prob)
            
        if effective_prob < 0.01: return 99.0
        
        return round(1.0 / effective_prob, 2)


class SignalGenerator:
    """
    4. 交易信号生成器
    逻辑：对比模型赔率与市场赔率，寻找价值。
    """
    @staticmethod
    def analyze(fair_odds, market_odds, threshold=0.05):
        if market_odds == "-" or not market_odds: return None
        
        try:
            m_odd = float(market_odds)
            f_odd = float(fair_odds)
            
            # 价值计算: (市场赔率 / 公平赔率) - 1
            ev = (m_odd / f_odd) - 1.0
            
            if ev > threshold:
                return {
                    "signal": "VALUE BET",
                    "ev": round(ev * 100, 1), # 百分比
                    "fair_odds": f_odd,
                    "market_odds": m_odd
                }
        except:
            pass
        return None
