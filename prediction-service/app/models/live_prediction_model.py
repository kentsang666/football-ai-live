"""
足球滚球（In-Play）比分预测系统
================================

核心逻辑：寻找"市场赔率"与"模型真实概率"之间的偏差

模块：
1. PressureIndex - 实时动量引擎
2. LiveProbability - 动态泊松模型
3. AsianHandicapPricer - 亚洲盘口转换器
4. TradingSignalGenerator - 交易信号生成器

作者：AI Football Prediction System
版本：2.0.0 (QuantPredict)
"""

import numpy as np
import pandas as pd
from scipy.stats import poisson
from typing import Dict, Tuple, List, Optional
from dataclasses import dataclass
from enum import Enum


# =============================================================================
# 配置常量
# =============================================================================

# 事件权重配置 - 基于研究报告的最优权重
WEIGHTS = {
    'dangerous_attacks': 0.1,   # 危险进攻
    'shots_on_target': 1.0,     # 射正
    'shots_off_target': 0.4,    # 射偏
    'corners': 0.3,             # 角球
    'possession': 0.05,         # 控球率（每1%）
    'red_cards': -2.0,          # 红牌（负面影响）
}

# 动量衰减配置
MOMENTUM_DECAY_WINDOW = 5  # 分钟窗口
MOMENTUM_SMOOTHING = 0.3   # 平滑系数

# 泊松模型配置
DEFAULT_HOME_XG = 1.45     # 主场预期进球
DEFAULT_AWAY_XG = 1.15     # 客场预期进球
HOME_ADVANTAGE = 0.15      # 主场优势系数

# 交易信号配置
VALUE_THRESHOLD = 0.05     # 5% 价值空间阈值
MIN_ODDS = 1.10            # 最小赔率
MAX_ODDS = 20.0            # 最大赔率


# =============================================================================
# 数据类定义
# =============================================================================

class SignalType(Enum):
    """交易信号类型"""
    VALUE_BET = "VALUE_BET"
    NO_VALUE = "NO_VALUE"
    AVOID = "AVOID"


@dataclass
class MatchStats:
    """比赛实时统计数据"""
    minute: int
    home_score: int
    away_score: int
    home_dangerous_attacks: int = 0
    away_dangerous_attacks: int = 0
    home_shots_on_target: int = 0
    away_shots_on_target: int = 0
    home_shots_off_target: int = 0
    away_shots_off_target: int = 0
    home_corners: int = 0
    away_corners: int = 0
    home_possession: float = 50.0
    away_possession: float = 50.0
    home_red_cards: int = 0
    away_red_cards: int = 0
    
    # 最近5分钟的统计（用于动量计算）
    recent_home_dangerous_attacks: int = 0
    recent_away_dangerous_attacks: int = 0
    recent_home_shots_on_target: int = 0
    recent_away_shots_on_target: int = 0
    recent_home_corners: int = 0
    recent_away_corners: int = 0


@dataclass
class PredictionResult:
    """预测结果"""
    home_win_prob: float
    draw_prob: float
    away_win_prob: float
    home_expected_goals: float
    away_expected_goals: float
    home_momentum: float
    away_momentum: float
    confidence: float
    algorithm: str = "QuantPredict-v2.0"


@dataclass
class TradingSignal:
    """交易信号"""
    signal_type: SignalType
    market: str  # "1X2", "AH-0.5", "AH-0.25", etc.
    selection: str  # "HOME", "DRAW", "AWAY"
    fair_odds: float
    market_odds: float
    edge: float  # 价值空间
    confidence: float
    kelly_stake: float = 0.0


# =============================================================================
# 1. 实时动量引擎 (Momentum Engine)
# =============================================================================

class PressureIndex:
    """
    实时动量引擎
    
    计算主客队的"压力值"（0-100），用于调整进球率预期。
    基于最近5分钟的进攻数据，使用加权公式计算动量。
    """
    
    def __init__(self, weights: Dict[str, float] = None):
        """
        初始化动量引擎
        
        Args:
            weights: 事件权重字典
        """
        self.weights = weights or WEIGHTS
        self._momentum_history: Dict[str, List[float]] = {
            'home': [],
            'away': []
        }
    
    def calculate_raw_pressure(self, stats: MatchStats) -> Tuple[float, float]:
        """
        计算原始压力值
        
        Args:
            stats: 比赛统计数据
            
        Returns:
            (主队压力值, 客队压力值)
        """
        # 主队压力计算
        home_pressure = (
            stats.recent_home_dangerous_attacks * self.weights['dangerous_attacks'] +
            stats.recent_home_shots_on_target * self.weights['shots_on_target'] +
            stats.home_shots_off_target * self.weights['shots_off_target'] * 0.5 +  # 全场射偏的一半
            stats.recent_home_corners * self.weights['corners'] +
            (stats.home_possession - 50) * self.weights['possession']  # 控球率偏差
        )
        
        # 客队压力计算
        away_pressure = (
            stats.recent_away_dangerous_attacks * self.weights['dangerous_attacks'] +
            stats.recent_away_shots_on_target * self.weights['shots_on_target'] +
            stats.away_shots_off_target * self.weights['shots_off_target'] * 0.5 +
            stats.recent_away_corners * self.weights['corners'] +
            (stats.away_possession - 50) * self.weights['possession']
        )
        
        # 红牌惩罚（对方获得优势）
        if stats.home_red_cards > 0:
            away_pressure += stats.home_red_cards * abs(self.weights['red_cards'])
            home_pressure -= stats.home_red_cards * abs(self.weights['red_cards']) * 0.5
        
        if stats.away_red_cards > 0:
            home_pressure += stats.away_red_cards * abs(self.weights['red_cards'])
            away_pressure -= stats.away_red_cards * abs(self.weights['red_cards']) * 0.5
        
        return max(0, home_pressure), max(0, away_pressure)
    
    def normalize_pressure(self, home_pressure: float, away_pressure: float) -> Tuple[float, float]:
        """
        将压力值归一化到 0-100 范围
        
        Args:
            home_pressure: 主队原始压力值
            away_pressure: 客队原始压力值
            
        Returns:
            (主队归一化压力, 客队归一化压力)
        """
        total = home_pressure + away_pressure
        if total == 0:
            return 50.0, 50.0
        
        home_normalized = (home_pressure / total) * 100
        away_normalized = (away_pressure / total) * 100
        
        return home_normalized, away_normalized
    
    def calculate_momentum_factor(self, stats: MatchStats) -> Tuple[float, float]:
        """
        计算动量系数
        
        动量系数用于调整泊松模型的 Lambda 值。
        系数范围：0.7 - 1.3（即最多调整 ±30%）
        
        Args:
            stats: 比赛统计数据
            
        Returns:
            (主队动量系数, 客队动量系数)
        """
        home_pressure, away_pressure = self.calculate_raw_pressure(stats)
        home_norm, away_norm = self.normalize_pressure(home_pressure, away_pressure)
        
        # 存储历史动量用于平滑
        self._momentum_history['home'].append(home_norm)
        self._momentum_history['away'].append(away_norm)
        
        # 保持最近10个数据点
        if len(self._momentum_history['home']) > 10:
            self._momentum_history['home'] = self._momentum_history['home'][-10:]
            self._momentum_history['away'] = self._momentum_history['away'][-10:]
        
        # 使用指数移动平均进行平滑
        if len(self._momentum_history['home']) > 1:
            home_smoothed = (
                MOMENTUM_SMOOTHING * home_norm + 
                (1 - MOMENTUM_SMOOTHING) * np.mean(self._momentum_history['home'][:-1])
            )
            away_smoothed = (
                MOMENTUM_SMOOTHING * away_norm + 
                (1 - MOMENTUM_SMOOTHING) * np.mean(self._momentum_history['away'][:-1])
            )
        else:
            home_smoothed = home_norm
            away_smoothed = away_norm
        
        # 转换为动量系数（0.7 - 1.3 范围）
        # 50 为中性值，对应系数 1.0
        home_factor = 0.7 + (home_smoothed / 100) * 0.6
        away_factor = 0.7 + (away_smoothed / 100) * 0.6
        
        return home_factor, away_factor
    
    def get_pressure_summary(self, stats: MatchStats) -> Dict:
        """
        获取压力分析摘要
        
        Args:
            stats: 比赛统计数据
            
        Returns:
            压力分析字典
        """
        home_pressure, away_pressure = self.calculate_raw_pressure(stats)
        home_norm, away_norm = self.normalize_pressure(home_pressure, away_pressure)
        home_factor, away_factor = self.calculate_momentum_factor(stats)
        
        return {
            'home_raw_pressure': round(home_pressure, 2),
            'away_raw_pressure': round(away_pressure, 2),
            'home_normalized': round(home_norm, 1),
            'away_normalized': round(away_norm, 1),
            'home_momentum_factor': round(home_factor, 3),
            'away_momentum_factor': round(away_factor, 3),
            'dominant_team': 'HOME' if home_norm > away_norm else 'AWAY' if away_norm > home_norm else 'BALANCED'
        }


# =============================================================================
# 2. 动态泊松模型 (Dynamic Poisson Model)
# =============================================================================

class LiveProbability:
    """
    动态泊松模型
    
    基于泊松分布计算比赛剩余时间内的进球概率分布，
    并结合动量系数进行动态调整。
    """
    
    def __init__(self, 
                 home_xg: float = DEFAULT_HOME_XG, 
                 away_xg: float = DEFAULT_AWAY_XG,
                 max_goals: int = 10):
        """
        初始化泊松模型
        
        Args:
            home_xg: 主队赛前预期进球数
            away_xg: 客队赛前预期进球数
            max_goals: 计算的最大进球数
        """
        self.initial_home_xg = home_xg
        self.initial_away_xg = away_xg
        self.max_goals = max_goals
        self.pressure_index = PressureIndex()
    
    def calculate_time_decay(self, 
                            current_minute: int, 
                            total_minutes: int = 90,
                            decay_type: str = 'linear') -> float:
        """
        计算时间衰减系数
        
        Args:
            current_minute: 当前比赛分钟
            total_minutes: 总比赛时间
            decay_type: 衰减类型 ('linear', 'exponential', 'sqrt')
            
        Returns:
            时间衰减系数 (0-1)
        """
        remaining_time = max(0, total_minutes - current_minute)
        time_ratio = remaining_time / total_minutes
        
        if decay_type == 'linear':
            return time_ratio
        elif decay_type == 'exponential':
            # 指数衰减，比赛末段衰减更快
            return np.exp(-0.5 * (1 - time_ratio))
        elif decay_type == 'sqrt':
            # 平方根衰减，比赛初期衰减较慢
            return np.sqrt(time_ratio)
        else:
            return time_ratio
    
    def calculate_current_lambda(self,
                                 stats: MatchStats,
                                 decay_type: str = 'linear') -> Tuple[float, float]:
        """
        计算当前的 Lambda 值（预期进球率）
        
        Lambda = Initial_XG * Time_Decay * Momentum_Factor * Game_State_Adjustment
        
        Args:
            stats: 比赛统计数据
            decay_type: 时间衰减类型
            
        Returns:
            (主队Lambda, 客队Lambda)
        """
        # 1. 时间衰减
        time_decay = self.calculate_time_decay(stats.minute, decay_type=decay_type)
        
        # 2. 动量系数
        home_momentum, away_momentum = self.pressure_index.calculate_momentum_factor(stats)
        
        # 3. 基础 Lambda 计算 (含动量)
        home_lambda = self.initial_home_xg * time_decay * home_momentum
        away_lambda = self.initial_away_xg * time_decay * away_momentum

        # 4. [v2.7] 心理修正系数 (Psychological Adjustment Factor)
        # 替代原有简单的比分修正，引入更复杂的赛况心态模型
        final_home_lambda, final_away_lambda = self._apply_psychological_factor(
            home_lambda, away_lambda, stats
        )
        
        # 确保 Lambda 在合理范围内 (0.001 - 5.0)
        final_home_lambda = max(0.001, min(5.0, final_home_lambda))
        final_away_lambda = max(0.001, min(5.0, final_away_lambda))
        
        return final_home_lambda, final_away_lambda

    def _apply_psychological_factor(self, home_lambda, away_lambda, stats: MatchStats) -> Tuple[float, float]:
        """
        [v2.7] 心理修正系数 (Psychological Adjustment Factor)
        负责根据比赛实时状况（比分、时间、红卡）修正球队的攻击力
        
        逻辑包括：
        1. 时间压力因子
        2. 比分情境修正 (如领先方"摆大巴"，落后方"狂攻")
        3. 红牌双向影响
        """
        minute = stats.minute
        # 时间压力因子：0 -> 0.0, 90 -> 1.0 (修正力度随时间增强)
        time_factor = min(minute / 90.0, 1.0)
        
        h_multiplier = 1.0
        a_multiplier = 1.0
        
        score_diff = stats.home_score - stats.away_score
        
        # --- A. 比分情境修正 ---
        if score_diff == 0:
            # [平局]
            if minute > 80:
                # 比赛末段平局 -> 趋向保守 (降 15%)
                caution_factor = 0.15 * time_factor
                h_multiplier -= caution_factor
                a_multiplier -= caution_factor
            else:
                # 早期平局 -> 正常进攻 (略微提升 5%)
                h_multiplier += 0.05
                a_multiplier += 0.05
                
        elif score_diff > 0:
            # [主队领先]
            if score_diff == 1:
                # 1球差距：主队苟 (Max -35%)，客队拼 (Max +40%)
                h_multiplier -= (0.35 * time_factor)
                a_multiplier += (0.40 * time_factor)
            elif score_diff >= 2:
                # 2球+：垃圾时间，双方均懈怠
                h_multiplier -= 0.2
                a_multiplier -= 0.1
                
        else: # score_diff < 0
            # [客队领先]
            abs_diff = abs(score_diff)
            if abs_diff == 1:
                # 1球差距：客队苟 (Max -35%)，主队拼 (Max +45% 主场加成)
                a_multiplier -= (0.35 * time_factor)
                h_multiplier += (0.45 * time_factor)
            elif abs_diff >= 2:
                # 2球+
                a_multiplier -= 0.2
                h_multiplier -= 0.1

        # --- B. 红牌修正 (双向) ---
        if stats.home_red_cards > 0:
            h_multiplier *= (0.6 ** stats.home_red_cards) # 少一人大损
            a_multiplier *= (1.2 ** stats.home_red_cards) # 对手获利
            
        if stats.away_red_cards > 0:
            a_multiplier *= (0.6 ** stats.away_red_cards)
            h_multiplier *= (1.2 ** stats.away_red_cards)

        # --- C. 应用并防止负值 ---
        # 至少保留10%攻击力
        adj_home_lambda = home_lambda * max(h_multiplier, 0.1)
        adj_away_lambda = away_lambda * max(a_multiplier, 0.1)

        return adj_home_lambda, adj_away_lambda
    
    def calculate_score_probabilities(self,
                                      home_lambda: float,
                                      away_lambda: float) -> np.ndarray:
        """
        计算各种比分的概率矩阵
        
        Args:
            home_lambda: 主队 Lambda
            away_lambda: 客队 Lambda
            
        Returns:
            比分概率矩阵 [home_goals, away_goals]
        """
        prob_matrix = np.zeros((self.max_goals + 1, self.max_goals + 1))
        
        for home_goals in range(self.max_goals + 1):
            for away_goals in range(self.max_goals + 1):
                prob_matrix[home_goals, away_goals] = (
                    poisson.pmf(home_goals, home_lambda) * 
                    poisson.pmf(away_goals, away_lambda)
                )
        
        # 归一化
        prob_matrix /= prob_matrix.sum()
        
        return prob_matrix
    
    def calculate_match_outcome_probabilities(self,
                                              stats: MatchStats) -> Tuple[float, float, float]:
        """
        计算比赛结果概率（胜平负）
        
        考虑当前比分和剩余时间内可能的进球
        
        Args:
            stats: 比赛统计数据
            
        Returns:
            (主胜概率, 平局概率, 客胜概率)
        """
        home_lambda, away_lambda = self.calculate_current_lambda(stats)
        prob_matrix = self.calculate_score_probabilities(home_lambda, away_lambda)
        
        current_home = stats.home_score
        current_away = stats.away_score
        
        home_win_prob = 0.0
        draw_prob = 0.0
        away_win_prob = 0.0
        
        for add_home in range(self.max_goals + 1):
            for add_away in range(self.max_goals + 1):
                final_home = current_home + add_home
                final_away = current_away + add_away
                prob = prob_matrix[add_home, add_away]
                
                if final_home > final_away:
                    home_win_prob += prob
                elif final_home < final_away:
                    away_win_prob += prob
                else:
                    draw_prob += prob
        
        # 归一化
        total = home_win_prob + draw_prob + away_win_prob
        if total > 0:
            home_win_prob /= total
            draw_prob /= total
            away_win_prob /= total
        
        return home_win_prob, draw_prob, away_win_prob
    
    def predict(self, stats: MatchStats) -> PredictionResult:
        """
        生成完整预测结果
        
        Args:
            stats: 比赛统计数据
            
        Returns:
            预测结果对象
        """
        home_lambda, away_lambda = self.calculate_current_lambda(stats)
        home_win, draw, away_win = self.calculate_match_outcome_probabilities(stats)
        home_momentum, away_momentum = self.pressure_index.calculate_momentum_factor(stats)
        
        # 计算置信度
        # 基于比赛进行时间和数据质量
        time_confidence = min(1.0, stats.minute / 45)  # 45分钟后达到最大置信度
        data_confidence = min(1.0, (
            stats.home_shots_on_target + stats.away_shots_on_target +
            stats.home_corners + stats.away_corners
        ) / 10)  # 有足够数据后置信度提高
        
        confidence = 0.5 + 0.3 * time_confidence + 0.2 * data_confidence
        
        return PredictionResult(
            home_win_prob=round(home_win, 4),
            draw_prob=round(draw, 4),
            away_win_prob=round(away_win, 4),
            home_expected_goals=round(home_lambda, 3),
            away_expected_goals=round(away_lambda, 3),
            home_momentum=round(home_momentum, 3),
            away_momentum=round(away_momentum, 3),
            confidence=round(confidence, 3),
            algorithm="QuantPredict-v2.0"
        )


# =============================================================================
# 3. 亚洲盘口转换器 (Asian Handicap Pricer)
# =============================================================================

class AsianHandicapPricer:
    """
    亚洲盘口转换器
    
    将模型计算出的胜平负概率转换为亚洲盘口赔率，
    支持四分之一盘口（Split Handicap）的处理。
    """
    
    def __init__(self, margin: float = 0.0):
        """
        初始化盘口转换器
        
        Args:
            margin: 庄家利润率（0 表示公平赔率）
        """
        self.margin = margin
        self.live_probability = LiveProbability()
    
    def probability_to_odds(self, probability: float) -> float:
        """
        将概率转换为欧洲赔率
        
        Args:
            probability: 概率值 (0-1)
            
        Returns:
            欧洲赔率
        """
        if probability <= 0:
            return MAX_ODDS
        if probability >= 1:
            return MIN_ODDS
        
        fair_odds = 1 / probability
        # 应用庄家利润率
        adjusted_odds = fair_odds * (1 - self.margin)
        
        return max(MIN_ODDS, min(MAX_ODDS, adjusted_odds))
    
    def calculate_handicap_probability(self,
                                       stats: MatchStats,
                                       handicap: float,
                                       for_home: bool = True) -> float:
        """
        计算亚洲盘口的胜出概率
        
        Args:
            stats: 比赛统计数据
            handicap: 盘口值（如 -0.5, -0.25, +0.5）
            for_home: 是否计算主队概率
            
        Returns:
            胜出概率
        """
        home_lambda, away_lambda = self.live_probability.calculate_current_lambda(stats)
        prob_matrix = self.live_probability.calculate_score_probabilities(home_lambda, away_lambda)
        
        current_home = stats.home_score
        current_away = stats.away_score
        
        win_prob = 0.0
        push_prob = 0.0  # 走水概率
        
        for add_home in range(self.live_probability.max_goals + 1):
            for add_away in range(self.live_probability.max_goals + 1):
                final_home = current_home + add_home
                final_away = current_away + add_away
                prob = prob_matrix[add_home, add_away]
                
                if for_home:
                    # 主队让球
                    adjusted_diff = (final_home - final_away) + handicap
                else:
                    # 客队让球（受让）
                    adjusted_diff = (final_away - final_home) + handicap
                
                if adjusted_diff > 0:
                    win_prob += prob
                elif adjusted_diff == 0:
                    push_prob += prob
        
        return win_prob, push_prob
    
    def calculate_split_handicap(self,
                                 stats: MatchStats,
                                 handicap: float,
                                 for_home: bool = True) -> float:
        """
        计算四分之一盘口（Split Handicap）的概率
        
        例如：-0.25 盘口 = 50% 在 0 盘 + 50% 在 -0.5 盘
        
        Args:
            stats: 比赛统计数据
            handicap: 盘口值（如 -0.25, -0.75）
            for_home: 是否计算主队概率
            
        Returns:
            综合胜出概率
        """
        # 判断是否为四分之一盘
        decimal_part = abs(handicap) % 0.5
        
        if decimal_part == 0.25:
            # 四分之一盘：拆分为两个盘口
            if handicap > 0:
                lower_handicap = handicap - 0.25
                upper_handicap = handicap + 0.25
            else:
                lower_handicap = handicap - 0.25
                upper_handicap = handicap + 0.25
            
            win_prob_lower, push_prob_lower = self.calculate_handicap_probability(
                stats, lower_handicap, for_home
            )
            win_prob_upper, push_prob_upper = self.calculate_handicap_probability(
                stats, upper_handicap, for_home
            )
            
            # 四分之一盘：一半赢全额，一半走水
            # 综合概率 = 0.5 * (赢盘概率 + 0.5 * 走水概率)
            combined_prob = 0.5 * (
                (win_prob_lower + 0.5 * push_prob_lower) +
                (win_prob_upper + 0.5 * push_prob_upper)
            )
            
            return combined_prob
        else:
            # 标准盘口
            win_prob, push_prob = self.calculate_handicap_probability(
                stats, handicap, for_home
            )
            return win_prob + 0.5 * push_prob
    
    def get_asian_handicap_odds(self,
                                stats: MatchStats,
                                handicap: float) -> Dict[str, float]:
        """
        获取亚洲盘口的公平赔率
        
        Args:
            stats: 比赛统计数据
            handicap: 盘口值
            
        Returns:
            包含主客队赔率的字典
        """
        home_prob = self.calculate_split_handicap(stats, handicap, for_home=True)
        away_prob = self.calculate_split_handicap(stats, -handicap, for_home=False)
        
        # 归一化
        total = home_prob + away_prob
        if total > 0:
            home_prob /= total
            away_prob /= total
        
        return {
            'handicap': handicap,
            'home_probability': round(home_prob, 4),
            'away_probability': round(away_prob, 4),
            'home_fair_odds': round(self.probability_to_odds(home_prob), 3),
            'away_fair_odds': round(self.probability_to_odds(away_prob), 3)
        }
    
    def get_all_handicap_lines(self, stats: MatchStats) -> List[Dict]:
        """
        获取所有常用盘口线的赔率
        
        Args:
            stats: 比赛统计数据
            
        Returns:
            所有盘口线的赔率列表
        """
        handicap_lines = [-1.5, -1.25, -1.0, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1.0, 1.25, 1.5]
        
        results = []
        for handicap in handicap_lines:
            results.append(self.get_asian_handicap_odds(stats, handicap))
        
        return results


# =============================================================================
# 4. 交易信号生成器 (Trading Signal Generator)
# =============================================================================

class TradingSignalGenerator:
    """
    交易信号生成器
    
    对比模型计算的公平赔率和市场赔率，
    当偏差超过阈值时生成 VALUE BET 信号。
    """
    
    def __init__(self, value_threshold: float = VALUE_THRESHOLD):
        """
        初始化信号生成器
        
        Args:
            value_threshold: 价值空间阈值
        """
        self.value_threshold = value_threshold
        self.live_probability = LiveProbability()
        self.handicap_pricer = AsianHandicapPricer()
    
    def calculate_edge(self, fair_odds: float, market_odds: float) -> float:
        """
        计算价值空间（Edge）
        
        Edge = (Market_Odds / Fair_Odds) - 1
        正值表示市场赔率高于公平赔率，存在价值
        
        Args:
            fair_odds: 公平赔率
            market_odds: 市场赔率
            
        Returns:
            价值空间
        """
        if fair_odds <= 0:
            return 0
        return (market_odds / fair_odds) - 1
    
    def calculate_kelly_stake(self, probability: float, market_odds: float) -> float:
        """
        计算凯利公式投注比例
        
        Args:
            probability: 获胜概率 (0-1)
            market_odds: 市场赔率
            
        Returns:
            推荐投注比例 (百分比 0-100)
        """
        if market_odds <= 1:
            return 0.0
            
        b = market_odds - 1
        p = probability
        q = 1 - p
        
        # Kelly Formula: f = (bp - q) / b
        f = (b * p - q) / b
        
        if f <= 0:
            return 0.0
            
        # 30% Half-Kelly (Fractional Kelly) for risk management
        conservative_f = f * 0.3
        
        # Max stake cap (5%)
        max_stake = 0.05
        
        final_stake = min(conservative_f, max_stake)
        
        return round(final_stake * 100, 2)

    def validate_with_market_trend(self,
                                   selection: str,
                                   current_odds: float,
                                   opening_odds: float) -> Tuple[bool, str, bool]:
        """
        [v2.8] 赔率异动监控
        """
        if not opening_odds or opening_odds <= 0:
            return True, "", False
            
        drop_rate = (current_odds - opening_odds) / opening_odds
        DRIFT_THRESHOLD = 0.05
        STEAM_THRESHOLD = -0.10
        
        # 1. Drift
        if drop_rate > DRIFT_THRESHOLD:
            return False, f"Market Drift (+{drop_rate*100:.1f}%)", False
            
        # 2. Steam
        if drop_rate < STEAM_THRESHOLD:
            return True, f"Steam Move ({drop_rate*100:.1f}%)", True
            
        return True, "", False

    def generate_1x2_signals(self,
                             stats: MatchStats,
                             market_odds: Dict[str, float],
                             opening_odds: Dict[str, float] = None) -> List[TradingSignal]:
        """
        生成 1X2（胜平负）市场的交易信号
        """
        prediction = self.live_probability.predict(stats)
        signals = []
        
        # 计算公平赔率
        fair_odds = {
            'home': 1 / prediction.home_win_prob if prediction.home_win_prob > 0 else MAX_ODDS,
            'draw': 1 / prediction.draw_prob if prediction.draw_prob > 0 else MAX_ODDS,
            'away': 1 / prediction.away_win_prob if prediction.away_win_prob > 0 else MAX_ODDS
        }
        
        selections = [
            ('HOME', 'home', prediction.home_win_prob),
            ('DRAW', 'draw', prediction.draw_prob),
            ('AWAY', 'away', prediction.away_win_prob)
        ]
        
        for selection_name, key, prob in selections:
            if key not in market_odds:
                continue
                
            edge = self.calculate_edge(fair_odds[key], market_odds[key])
            
            # [v2.8] 趋势验证
            is_safe = True
            note = ""
            is_steam = False
            
            if opening_odds and key in opening_odds:
                is_safe, note, is_steam = self.validate_with_market_trend(
                    key.upper(), market_odds[key], opening_odds[key]
                )
            
            if edge >= self.value_threshold:
                if not is_safe:
                    signal_type = SignalType.AVOID # 逆势
                else:
                    signal_type = SignalType.VALUE_BET
            elif edge < -0.1:  # 市场赔率明显低于公平赔率
                signal_type = SignalType.AVOID
            else:
                signal_type = SignalType.NO_VALUE
            
            # 若不是 Value Bet 但有 Steam Move，可以考虑提示（此处简化为只在 Value Bet 时附加信息）
            # 或者将其存入 reason 字段（TradingSignal 需要扩展字段，这里暂不改动结构，打印日志或忽略）
            
            kelly_stake = 0.0
            if signal_type == SignalType.VALUE_BET:
                kelly_stake = self.calculate_kelly_stake(prob, market_odds[key])

            signals.append(TradingSignal(
                signal_type=signal_type,
                market="1X2",
                selection=selection_name,
                fair_odds=round(fair_odds[key], 3),
                market_odds=market_odds[key],
                edge=round(edge, 4),
                confidence=prediction.confidence,
                kelly_stake=kelly_stake
            ))
        
        return signals
    
    def generate_asian_handicap_signals(self,
                                        stats: MatchStats,
                                        handicap: float,
                                        market_odds: Dict[str, float]) -> List[TradingSignal]:
        """
        生成亚洲盘口市场的交易信号
        
        Args:
            stats: 比赛统计数据
            handicap: 盘口值
            market_odds: 市场赔率 {'home': x, 'away': x}
            
        Returns:
            交易信号列表
        """
        ah_odds = self.handicap_pricer.get_asian_handicap_odds(stats, handicap)
        signals = []
        
        prediction = self.live_probability.predict(stats)
        
        for selection, key in [('HOME', 'home'), ('AWAY', 'away')]:
            if key not in market_odds:
                continue
            
            fair_key = f'{key}_fair_odds'
            edge = self.calculate_edge(ah_odds[fair_key], market_odds[key])
            
            if edge >= self.value_threshold:
                signal_type = SignalType.VALUE_BET
            elif edge < -0.1:
                signal_type = SignalType.AVOID
            else:
                signal_type = SignalType.NO_VALUE
            
            kelly_stake = 0.0
            if signal_type == SignalType.VALUE_BET:
                prob = 1.0 / ah_odds[fair_key] if ah_odds[fair_key] > 0 else 0
                kelly_stake = self.calculate_kelly_stake(prob, market_odds[key])

            signals.append(TradingSignal(
                signal_type=signal_type,
                market=f"AH{handicap:+.2f}",
                selection=selection,
                fair_odds=ah_odds[fair_key],
                market_odds=market_odds[key],
                edge=round(edge, 4),
                confidence=prediction.confidence,
                kelly_stake=kelly_stake
            ))
        
        return signals
    
    def generate_all_signals(self,
                             stats: MatchStats,
                             market_data: Dict) -> Dict:
        """
        生成所有市场的交易信号
        
        Args:
            stats: 比赛统计数据
            market_data: 市场数据 {
                '1x2': {'home': x, 'draw': x, 'away': x},
                'asian_handicap': {
                    '-0.5': {'home': x, 'away': x},
                    ...
                }
            }
            
        Returns:
            所有信号的汇总
        """
        all_signals = {
            'match_info': {
                'minute': stats.minute,
                'score': f"{stats.home_score}-{stats.away_score}"
            },
            'prediction': None,
            'signals': [],
            'value_bets': []
        }
        
        # 获取预测结果
        prediction = self.live_probability.predict(stats)
        all_signals['prediction'] = {
            'home_win': prediction.home_win_prob,
            'draw': prediction.draw_prob,
            'away_win': prediction.away_win_prob,
            'home_xg': prediction.home_expected_goals,
            'away_xg': prediction.away_expected_goals,
            'confidence': prediction.confidence,
            'algorithm': prediction.algorithm
        }
        
        # 1X2 信号
        if '1x2' in market_data:
            opening_odds = market_data.get('1x2_opening')
            signals_1x2 = self.generate_1x2_signals(stats, market_data['1x2'], opening_odds)
            all_signals['signals'].extend([
                {
                    'market': s.market,
                    'selection': s.selection,
                    'signal': s.signal_type.value,
                    'fair_odds': s.fair_odds,
                    'market_odds': s.market_odds,
                    'edge': s.edge,
                    'confidence': s.confidence,
                    'kelly_stake': s.kelly_stake
                }
                for s in signals_1x2
            ])
            
            # 收集 VALUE BET
            all_signals['value_bets'].extend([
                s for s in signals_1x2 if s.signal_type == SignalType.VALUE_BET
            ])
        
        # 亚洲盘口信号
        if 'asian_handicap' in market_data:
            for handicap_str, odds in market_data['asian_handicap'].items():
                handicap = float(handicap_str)
                signals_ah = self.generate_asian_handicap_signals(stats, handicap, odds)
                all_signals['signals'].extend([
                    {
                        'market': s.market,
                        'selection': s.selection,
                        'signal': s.signal_type.value,
                        'fair_odds': s.fair_odds,
                        'market_odds': s.market_odds,
                        'edge': s.edge,
                        'confidence': s.confidence,
                        'kelly_stake': s.kelly_stake
                    }
                    for s in signals_ah
                ])
                
                all_signals['value_bets'].extend([
                    s for s in signals_ah if s.signal_type == SignalType.VALUE_BET
                ])
        
        # 转换 value_bets 为可序列化格式
        all_signals['value_bets'] = [
            {
                'market': s.market,
                'selection': s.selection,
                'fair_odds': s.fair_odds,
                'market_odds': s.market_odds,
                'edge': s.edge,
                'confidence': s.confidence,
                'kelly_stake': s.kelly_stake
            }
            for s in all_signals['value_bets']
        ]
        
        return all_signals


# =============================================================================
# 5. 主函数 - 演示第70分钟的数据输入
# =============================================================================

def main():
    """
    演示代码：模拟第70分钟的比赛数据，输出预测结果
    """
    print("=" * 80)
    print("足球滚球预测系统 - QuantPredict v2.0")
    print("=" * 80)
    
    # 模拟第70分钟的比赛数据
    # 场景：主队 1-0 领先，但客队最近压力很大
    stats = MatchStats(
        minute=70,
        home_score=1,
        away_score=0,
        # 全场统计
        home_dangerous_attacks=45,
        away_dangerous_attacks=52,
        home_shots_on_target=4,
        away_shots_on_target=6,
        home_shots_off_target=3,
        away_shots_off_target=5,
        home_corners=4,
        away_corners=7,
        home_possession=42.0,
        away_possession=58.0,
        home_red_cards=0,
        away_red_cards=0,
        # 最近5分钟统计（用于动量计算）
        recent_home_dangerous_attacks=2,
        recent_away_dangerous_attacks=8,
        recent_home_shots_on_target=0,
        recent_away_shots_on_target=2,
        recent_home_corners=0,
        recent_away_corners=2
    )
    
    print("\n📊 比赛状态（第70分钟）")
    print("-" * 40)
    print(f"比分: 主队 {stats.home_score} - {stats.away_score} 客队")
    print(f"控球率: 主队 {stats.home_possession}% - {stats.away_possession}% 客队")
    print(f"射正: 主队 {stats.home_shots_on_target} - {stats.away_shots_on_target} 客队")
    print(f"角球: 主队 {stats.home_corners} - {stats.away_corners} 客队")
    
    # 1. 动量分析
    print("\n🔥 动量分析 (Pressure Index)")
    print("-" * 40)
    pressure_index = PressureIndex()
    pressure_summary = pressure_index.get_pressure_summary(stats)
    print(f"主队压力值: {pressure_summary['home_normalized']}/100")
    print(f"客队压力值: {pressure_summary['away_normalized']}/100")
    print(f"主队动量系数: {pressure_summary['home_momentum_factor']}")
    print(f"客队动量系数: {pressure_summary['away_momentum_factor']}")
    print(f"场上主导: {pressure_summary['dominant_team']}")
    
    # 2. 概率预测
    print("\n🎯 概率预测 (Dynamic Poisson Model)")
    print("-" * 40)
    live_prob = LiveProbability()
    prediction = live_prob.predict(stats)
    print(f"主胜概率: {prediction.home_win_prob * 100:.1f}%")
    print(f"平局概率: {prediction.draw_prob * 100:.1f}%")
    print(f"客胜概率: {prediction.away_win_prob * 100:.1f}%")
    print(f"主队剩余预期进球: {prediction.home_expected_goals:.3f}")
    print(f"客队剩余预期进球: {prediction.away_expected_goals:.3f}")
    print(f"预测置信度: {prediction.confidence * 100:.1f}%")
    
    # 3. 亚洲盘口
    print("\n📈 亚洲盘口赔率 (Asian Handicap)")
    print("-" * 40)
    ah_pricer = AsianHandicapPricer()
    handicaps = [-0.5, -0.25, 0, 0.25, 0.5]
    for hc in handicaps:
        odds = ah_pricer.get_asian_handicap_odds(stats, hc)
        print(f"盘口 {hc:+.2f}: 主队 {odds['home_fair_odds']:.3f} | 客队 {odds['away_fair_odds']:.3f}")
    
    # 4. 交易信号
    print("\n💰 交易信号 (Trading Signals)")
    print("-" * 40)
    
    # 模拟市场赔率
    market_data = {
        '1x2': {
            'home': 1.45,  # 市场给主队 1.45
            'draw': 4.50,  # 市场给平局 4.50
            'away': 7.00   # 市场给客队 7.00
        },
        'asian_handicap': {
            '-0.5': {'home': 1.85, 'away': 2.05},
            '-0.25': {'home': 1.72, 'away': 2.18}
        }
    }
    
    signal_generator = TradingSignalGenerator()
    all_signals = signal_generator.generate_all_signals(stats, market_data)
    
    print("\n1X2 市场分析:")
    for signal in all_signals['signals']:
        if signal['market'] == '1X2':
            edge_pct = signal['edge'] * 100
            status = "✅ VALUE BET" if signal['signal'] == 'VALUE_BET' else "❌ AVOID" if signal['signal'] == 'AVOID' else "➖ NO VALUE"
            print(f"  {signal['selection']}: 公平赔率 {signal['fair_odds']:.3f} | 市场赔率 {signal['market_odds']:.2f} | Edge {edge_pct:+.1f}% {status}")
    
    print("\n亚洲盘口分析:")
    for signal in all_signals['signals']:
        if signal['market'].startswith('AH'):
            edge_pct = signal['edge'] * 100
            status = "✅ VALUE BET" if signal['signal'] == 'VALUE_BET' else "❌ AVOID" if signal['signal'] == 'AVOID' else "➖ NO VALUE"
            print(f"  {signal['market']} {signal['selection']}: 公平赔率 {signal['fair_odds']:.3f} | 市场赔率 {signal['market_odds']:.2f} | Edge {edge_pct:+.1f}% {status}")
    
    # 5. VALUE BET 汇总
    if all_signals['value_bets']:
        print("\n🎰 发现 VALUE BET!")
        print("-" * 40)
        for vb in all_signals['value_bets']:
            print(f"  ⭐ {vb['market']} - {vb['selection']}")
            print(f"     公平赔率: {vb['fair_odds']:.3f}")
            print(f"     市场赔率: {vb['market_odds']:.2f}")
            print(f"     价值空间: {vb['edge'] * 100:.1f}%")
            print(f"     置信度: {vb['confidence'] * 100:.1f}%")
    else:
        print("\n⚠️ 当前无 VALUE BET 机会")
    
    print("\n" + "=" * 80)
    print("预测算法: " + prediction.algorithm)
    print("=" * 80)
    
    return all_signals


if __name__ == "__main__":
    main()
