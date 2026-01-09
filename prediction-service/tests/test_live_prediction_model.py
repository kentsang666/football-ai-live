"""
QuantPredict v2.0 预测模型单元测试
"""

import numpy as np
import sys
sys.path.insert(0, '/home/ubuntu/football-prediction-system/prediction-service')

from app.models.live_prediction_model import (
    PressureIndex,
    LiveProbability,
    AsianHandicapPricer,
    TradingSignalGenerator,
    MatchStats,
    SignalType
)


class TestPressureIndex:
    """测试动量引擎"""
    
    def test_balanced_pressure(self):
        """测试平衡状态下的压力值"""
        stats = MatchStats(
            minute=45,
            home_score=0,
            away_score=0,
            home_possession=50.0,
            away_possession=50.0,
            recent_home_dangerous_attacks=5,
            recent_away_dangerous_attacks=5,
            recent_home_shots_on_target=2,
            recent_away_shots_on_target=2,
            recent_home_corners=2,
            recent_away_corners=2
        )
        
        pressure_index = PressureIndex()
        home_factor, away_factor = pressure_index.calculate_momentum_factor(stats)
        
        # 平衡状态下，两队动量系数应该接近
        assert abs(home_factor - away_factor) < 0.1
        assert 0.9 < home_factor < 1.1
        assert 0.9 < away_factor < 1.1
    
    def test_home_dominant_pressure(self):
        """测试主队主导时的压力值"""
        stats = MatchStats(
            minute=60,
            home_score=0,
            away_score=0,
            home_possession=65.0,
            away_possession=35.0,
            recent_home_dangerous_attacks=10,
            recent_away_dangerous_attacks=2,
            recent_home_shots_on_target=4,
            recent_away_shots_on_target=0,
            recent_home_corners=3,
            recent_away_corners=0
        )
        
        pressure_index = PressureIndex()
        home_factor, away_factor = pressure_index.calculate_momentum_factor(stats)
        
        # 主队主导时，主队动量系数应该更高
        assert home_factor > away_factor
        assert home_factor > 1.0
    
    def test_red_card_impact(self):
        """测试红牌对压力值的影响"""
        stats_no_red = MatchStats(
            minute=70,
            home_score=0,
            away_score=0,
            home_red_cards=0,
            away_red_cards=0,
            recent_home_shots_on_target=2,
            recent_away_shots_on_target=2
        )
        
        stats_home_red = MatchStats(
            minute=70,
            home_score=0,
            away_score=0,
            home_red_cards=1,
            away_red_cards=0,
            recent_home_shots_on_target=2,
            recent_away_shots_on_target=2
        )
        
        pressure_index = PressureIndex()
        
        _, away_factor_no_red = pressure_index.calculate_momentum_factor(stats_no_red)
        pressure_index_2 = PressureIndex()  # 新实例避免历史影响
        _, away_factor_with_red = pressure_index_2.calculate_momentum_factor(stats_home_red)
        
        # 主队红牌后，客队动量应该增加
        assert away_factor_with_red > away_factor_no_red


class TestLiveProbability:
    """测试动态泊松模型"""
    
    def test_time_decay(self):
        """测试时间衰减"""
        model = LiveProbability()
        
        # 比赛开始时
        decay_start = model.calculate_time_decay(0)
        assert decay_start == 1.0
        
        # 比赛中场
        decay_half = model.calculate_time_decay(45)
        assert 0.45 < decay_half < 0.55
        
        # 比赛结束时
        decay_end = model.calculate_time_decay(90)
        assert decay_end == 0.0
    
    def test_score_affects_probability(self):
        """测试比分对概率的影响"""
        model = LiveProbability()
        
        # 0-0 平局
        stats_draw = MatchStats(minute=45, home_score=0, away_score=0)
        home_win_draw, draw_prob_draw, away_win_draw = model.calculate_match_outcome_probabilities(stats_draw)
        
        # 1-0 主队领先
        stats_home_lead = MatchStats(minute=45, home_score=1, away_score=0)
        home_win_lead, draw_prob_lead, away_win_lead = model.calculate_match_outcome_probabilities(stats_home_lead)
        
        # 主队领先时，主胜概率应该更高
        assert home_win_lead > home_win_draw
        assert away_win_lead < away_win_draw
    
    def test_late_game_certainty(self):
        """测试比赛末段的确定性增加"""
        model = LiveProbability()
        
        # 第45分钟 1-0
        stats_45 = MatchStats(minute=45, home_score=1, away_score=0)
        home_win_45, _, away_win_45 = model.calculate_match_outcome_probabilities(stats_45)
        
        # 第85分钟 1-0
        stats_85 = MatchStats(minute=85, home_score=1, away_score=0)
        home_win_85, _, away_win_85 = model.calculate_match_outcome_probabilities(stats_85)
        
        # 比赛越接近结束，领先方胜率越高
        assert home_win_85 > home_win_45
        assert away_win_85 < away_win_45
    
    def test_probability_sum_to_one(self):
        """测试概率之和为1"""
        model = LiveProbability()
        
        stats = MatchStats(minute=60, home_score=1, away_score=1)
        home_win, draw, away_win = model.calculate_match_outcome_probabilities(stats)
        
        total = home_win + draw + away_win
        assert abs(total - 1.0) < 0.001


class TestAsianHandicapPricer:
    """测试亚洲盘口转换器"""
    
    def test_probability_to_odds(self):
        """测试概率转赔率"""
        pricer = AsianHandicapPricer()
        
        # 50% 概率 = 2.0 赔率
        odds_50 = pricer.probability_to_odds(0.5)
        assert abs(odds_50 - 2.0) < 0.01
        
        # 25% 概率 = 4.0 赔率
        odds_25 = pricer.probability_to_odds(0.25)
        assert abs(odds_25 - 4.0) < 0.01
    
    def test_handicap_symmetry(self):
        """测试盘口对称性"""
        pricer = AsianHandicapPricer()
        
        stats = MatchStats(minute=45, home_score=0, away_score=0)
        
        # -0.5 盘口的主队概率 + 客队概率应该接近 1
        odds = pricer.get_asian_handicap_odds(stats, -0.5)
        total_prob = odds['home_probability'] + odds['away_probability']
        assert abs(total_prob - 1.0) < 0.01
    
    def test_split_handicap(self):
        """测试四分之一盘口"""
        pricer = AsianHandicapPricer()
        
        stats = MatchStats(minute=60, home_score=1, away_score=0)
        
        # -0.25 盘口应该介于 0 和 -0.5 之间
        odds_0 = pricer.get_asian_handicap_odds(stats, 0)
        odds_025 = pricer.get_asian_handicap_odds(stats, -0.25)
        odds_05 = pricer.get_asian_handicap_odds(stats, -0.5)
        
        # 主队在 -0.25 盘的概率应该介于 0 和 -0.5 之间
        assert odds_0['home_probability'] >= odds_025['home_probability'] >= odds_05['home_probability']


class TestTradingSignalGenerator:
    """测试交易信号生成器"""
    
    def test_value_bet_detection(self):
        """测试 VALUE BET 检测"""
        generator = TradingSignalGenerator(value_threshold=0.05)
        
        stats = MatchStats(minute=70, home_score=1, away_score=0)
        
        # 市场赔率明显高于公平赔率
        market_odds = {
            'home': 2.0,  # 假设公平赔率约 1.3，这里给 2.0
            'draw': 3.0,
            'away': 5.0
        }
        
        signals = generator.generate_1x2_signals(stats, market_odds)
        
        # 应该检测到主胜的 VALUE BET
        home_signal = next(s for s in signals if s.selection == 'HOME')
        assert home_signal.signal_type == SignalType.VALUE_BET
        assert home_signal.edge > 0.05
    
    def test_avoid_signal(self):
        """测试 AVOID 信号"""
        generator = TradingSignalGenerator()
        
        stats = MatchStats(minute=70, home_score=1, away_score=0)
        
        # 市场赔率明显低于公平赔率
        market_odds = {
            'home': 1.1,  # 假设公平赔率约 1.3，这里给 1.1
            'draw': 3.0,
            'away': 5.0
        }
        
        signals = generator.generate_1x2_signals(stats, market_odds)
        
        # 应该检测到主胜的 AVOID 信号
        home_signal = next(s for s in signals if s.selection == 'HOME')
        assert home_signal.signal_type == SignalType.AVOID
        assert home_signal.edge < -0.1
    
    def test_all_signals_generation(self):
        """测试完整信号生成"""
        generator = TradingSignalGenerator()
        
        stats = MatchStats(
            minute=60,
            home_score=1,
            away_score=0,
            home_shots_on_target=4,
            away_shots_on_target=3,
            home_corners=5,
            away_corners=4
        )
        
        market_data = {
            '1x2': {'home': 1.5, 'draw': 4.0, 'away': 6.0},
            'asian_handicap': {
                '-0.5': {'home': 1.8, 'away': 2.1}
            }
        }
        
        all_signals = generator.generate_all_signals(stats, market_data)
        
        # 验证输出结构
        assert 'match_info' in all_signals
        assert 'prediction' in all_signals
        assert 'signals' in all_signals
        assert 'value_bets' in all_signals
        
        # 验证预测结果
        assert all_signals['prediction']['algorithm'] == 'QuantPredict-v2.0'
        assert 0 <= all_signals['prediction']['home_win'] <= 1
        assert 0 <= all_signals['prediction']['draw'] <= 1
        assert 0 <= all_signals['prediction']['away_win'] <= 1


class TestEdgeCases:
    """测试边界情况"""
    
    def test_zero_minute(self):
        """测试比赛开始时"""
        model = LiveProbability()
        stats = MatchStats(minute=0, home_score=0, away_score=0)
        
        prediction = model.predict(stats)
        
        # 比赛开始时，预测应该接近赛前预期
        assert prediction.home_win_prob > 0
        assert prediction.draw_prob > 0
        assert prediction.away_win_prob > 0
    
    def test_90_minute(self):
        """测试比赛结束时"""
        model = LiveProbability()
        stats = MatchStats(minute=90, home_score=2, away_score=1)
        
        prediction = model.predict(stats)
        
        # 比赛结束时，领先方胜率应该接近 100%
        assert prediction.home_win_prob > 0.95
    
    def test_high_score(self):
        """测试高比分情况"""
        model = LiveProbability()
        stats = MatchStats(minute=60, home_score=5, away_score=0)
        
        prediction = model.predict(stats)
        
        # 大比分领先，胜率应该非常高
        assert prediction.home_win_prob > 0.99
        assert prediction.away_win_prob < 0.001
    
    def test_extreme_possession(self):
        """测试极端控球率"""
        pressure_index = PressureIndex()
        
        stats = MatchStats(
            minute=45,
            home_score=0,
            away_score=0,
            home_possession=80.0,
            away_possession=20.0
        )
        
        home_factor, away_factor = pressure_index.calculate_momentum_factor(stats)
        
        # 高控球率应该增加动量
        assert home_factor > away_factor


def run_all_tests():
    """运行所有测试"""
    print("=" * 60)
    print("QuantPredict v2.0 单元测试")
    print("=" * 60)
    
    # 收集测试类
    test_classes = [
        TestPressureIndex,
        TestLiveProbability,
        TestAsianHandicapPricer,
        TestTradingSignalGenerator,
        TestEdgeCases
    ]
    
    total_tests = 0
    passed_tests = 0
    failed_tests = []
    
    for test_class in test_classes:
        print(f"\n📋 {test_class.__name__}")
        print("-" * 40)
        
        instance = test_class()
        methods = [m for m in dir(instance) if m.startswith('test_')]
        
        for method_name in methods:
            total_tests += 1
            try:
                method = getattr(instance, method_name)
                method()
                print(f"  ✅ {method_name}")
                passed_tests += 1
            except Exception as e:
                print(f"  ❌ {method_name}: {str(e)}")
                failed_tests.append((test_class.__name__, method_name, str(e)))
    
    print("\n" + "=" * 60)
    print(f"测试结果: {passed_tests}/{total_tests} 通过")
    
    if failed_tests:
        print("\n失败的测试:")
        for class_name, method_name, error in failed_tests:
            print(f"  - {class_name}.{method_name}: {error}")
    else:
        print("\n🎉 所有测试通过!")
    
    print("=" * 60)
    
    return len(failed_tests) == 0


if __name__ == "__main__":
    success = run_all_tests()
    exit(0 if success else 1)
