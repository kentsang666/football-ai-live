from typing import Tuple

class GameStateAdjuster:
    @staticmethod
    def adjust_lambdas(home_lambda: float, away_lambda: float, 
                      home_score: int, away_score: int, 
                      minute: int, 
                      home_red_cards: int, away_red_cards: int) -> Tuple[float, float]:
        """
        [v2.7] 心理修正系数 (Psychological Adjustment Factor)
        负责根据比赛实时状况（比分、时间、红卡）修正球队的攻击力
        """
        # 时间压力因子：0 -> 0.0, 90 -> 1.0 (修正力度随时间增强)
        time_factor = min(minute / 90.0, 1.0)
        
        h_multiplier = 1.0
        a_multiplier = 1.0
        
        score_diff = home_score - away_score
        
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
        if home_red_cards > 0:
            h_multiplier *= (0.6 ** home_red_cards) # 少一人大损
            a_multiplier *= (1.2 ** home_red_cards) # 对手获利
            
        if away_red_cards > 0:
            a_multiplier *= (0.6 ** away_red_cards)
            h_multiplier *= (1.2 ** away_red_cards)

        # --- C. 应用并防止负值 ---
        # 至少保留10%攻击力
        adj_home_lambda = home_lambda * max(h_multiplier, 0.1)
        adj_away_lambda = away_lambda * max(a_multiplier, 0.1)

        return adj_home_lambda, adj_away_lambda
