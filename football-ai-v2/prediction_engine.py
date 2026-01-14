import math

class FootballPredictionSystem:
    def __init__(self):
        # 模拟一些联赛平均数据，实际使用时需要从数据库读取
        self.league_avg_goals = 2.5 

    # ===========================
    # 1. 赛前模型 (Pre-Match)
    # ===========================
    def calculate_prematch_lambda(self, home_stats, away_stats):
        """
        计算两队预期的进球数 (Lambda)
        兼容 model_utils 中的 {att: x, def: y} 结构
        """
        # 默认值
        h_att = home_stats.get('att', 1.0) if isinstance(home_stats, dict) else 1.0
        a_def = away_stats.get('def', 1.0) if isinstance(away_stats, dict) else 1.0
        
        a_att = away_stats.get('att', 1.0) if isinstance(away_stats, dict) else 1.0
        h_def = home_stats.get('def', 1.0) if isinstance(home_stats, dict) else 1.0

        # 估算 Lambda: 假设平均进球分布
        league_avg_per_team = self.league_avg_goals / 2.0
        
        home_exp_goals = h_att * a_def * league_avg_per_team * 1.1 # 主场优势
        away_exp_goals = a_att * h_def * league_avg_per_team
        
        return home_exp_goals, away_exp_goals

    def get_match_probabilities(self, home_exp, away_exp):
        """
        使用泊松分布计算胜平负概率
        """
        max_goals = 10
        home_win_prob = 0
        draw_prob = 0
        away_win_prob = 0
        
        def poisson_pmf(k, lam):
            return (lam ** k * math.exp(-lam)) / math.factorial(k)

        for h in range(max_goals):
            for a in range(max_goals):
                p = poisson_pmf(h, home_exp) * poisson_pmf(a, away_exp)
                if h > a:
                    home_win_prob += p
                elif h == a:
                    draw_prob += p
                else:
                    away_win_prob += p
                    
        return home_win_prob, draw_prob, away_win_prob

    # ===========================
    # 2. 滚球/即时模型 (In-Play)
    # ===========================
    def calculate_live_odds(self, home_prematch_exp, away_prematch_exp, 
                            current_minute, current_score_home, current_score_away, 
                            red_cards_home=0, red_cards_away=0,
                            ref_factor=0.0, # -0.2 (Strict/Under) to +0.2 (Loose/Over)
                            fatigue_home=1.0, fatigue_away=1.0 # 0.8 (Tired) to 1.2 (Rested)
                            ):
        """
        核心算法：根据剩余时间衰减进攻能力，并重新模拟比赛结果
        """
        
        # A. 计算剩余时间比例 (例如：80分钟时，只剩下 10/90 = 0.11 的时间进球)
        time_remaining = 90 - current_minute
        if time_remaining < 0: time_remaining = 0
        time_ratio = time_remaining / 90.0

        # B. 调整进攻能力 (红牌惩罚 & 疲劳 & 裁判)
        # 红牌会让该队的剩余进攻能力变为原来的 60%
        # 裁判因子: ref_factor > 0 (宽松) -> 进球更容易? let's say loose refs allow flow -> more goals
        # 疲劳因子: tired -> less goals produced
        
        home_rc_factor = 0.6 if red_cards_home > 0 else 1.0
        away_rc_factor = 0.6 if red_cards_away > 0 else 1.0

        # C. 计算“余下时间内”双方还能进几个球 (Rest of Match Expectation)
        # 赛前期望 * 时间比例 * 红牌系数 * 疲劳 * 裁判微调
        live_home_exp_remainder = home_prematch_exp * time_ratio * home_rc_factor * fatigue_home * (1 + ref_factor)
        live_away_exp_remainder = away_prematch_exp * time_ratio * away_rc_factor * fatigue_away * (1 + ref_factor)

        # D. 重新模拟最终比分
        # 最终比分 = 当前比分 + 余下时间进球
        
        live_home_win = 0
        live_draw = 0
        live_away_win = 0
        
        prob_over_2_5 = 0
        prob_under_2_5 = 0

        # 手动实现泊松 PMF
        def poisson_pmf(k, lam):
            return (lam ** k * math.exp(-lam)) / math.factorial(k)

        # 遍历余下时间可能发生的进球 (0-6球)
        for h_new in range(7):
            for a_new in range(7):
                # 计算发生这组"新进球"的概率
                prob = poisson_pmf(h_new, live_home_exp_remainder) * poisson_pmf(a_new, live_away_exp_remainder)
                
                # 预测的全场比分
                final_h = current_score_home + h_new
                final_a = current_score_away + a_new

                if final_h > final_a:
                    live_home_win += prob
                elif final_h == final_a:
                    live_draw += prob
                else:
                    live_away_win += prob
                
                # 大小球判断
                total_goals = final_h + final_a
                if total_goals > 2.5:
                    prob_over_2_5 += prob
                else:
                    prob_under_2_5 += prob

        # 归一化 (确保加起来是 100%)
        total_prob = live_home_win + live_draw + live_away_win
        if total_prob == 0: total_prob = 1
        
        norm_over = prob_over_2_5 / total_prob
        norm_under = prob_under_2_5 / total_prob

        return {
            "home_prob": round(live_home_win / total_prob * 100, 1),
            "draw_prob": round(live_draw / total_prob * 100, 1),
            "away_prob": round(live_away_win / total_prob * 100, 1),
            "over_2_5_prob": round(norm_over * 100, 1),
            "under_2_5_prob": round(norm_under * 100, 1),
            "home_xg_remain": round(live_home_exp_remainder, 2),
            "away_xg_remain": round(live_away_exp_remainder, 2)
        }
