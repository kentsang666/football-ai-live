import numpy as np
from typing import Dict, Tuple, List

# 配置常量
WEIGHTS = {
    'dangerous_attacks': 0.1,   # 危险进攻
    'shots_on_target': 1.0,     # 射正
    'shots_off_target': 0.4,    # 射偏
    'corners': 0.3,             # 角球
    'possession': 0.05,         # 控球率（每1%）
    'red_cards': -2.0,          # 红牌（负面影响）
}

MOMENTUM_SMOOTHING = 0.3   # 平滑系数

# 数据类定义 (Minimal needed for PressureIndex)
class MatchStats:
    # This is just a type hint interface basically, 
    # but since Python is duck-typed, we might not strictly need it 
    # if we pass objects that have these attributes.
    # However, for clarity I will expect the object passed to have these.
    pass

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
    
    def calculate_raw_pressure(self, stats) -> Tuple[float, float]:
        """
        计算原始压力值
        
        Args:
            stats: 比赛统计数据 object
            
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
    
    def calculate_momentum_factor(self, stats) -> Tuple[float, float]:
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

    def get_pressure_summary(self, stats) -> Dict:
        """
        获取压力分析摘要
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
