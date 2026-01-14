import numpy as np

class MonteCarloSimulator:
    """
    使用蒙特卡洛方法模拟比赛剩余时间的进程
    为了保证实时计算的速度（API 响应需在毫秒级），使用 numpy 进行向量化计算。
    """
    
    def __init__(self, simulations=10000):
        self.simulations = simulations

    def run_simulation(self, current_home_score, current_away_score, 
                       home_lambda_per_min, away_lambda_per_min, 
                       remaining_minutes):
        """
        运行模拟
        :param home_lambda_per_min: 主队每分钟进球期望 (经过心理修正后的)
        :param remaining_minutes: 剩余比赛时间
        :return: 包含各种概率统计的字典
        """
        
        # 1. 计算剩余时间内的期望进球数 (Expected Goals)
        # Lambda (per minute) * 剩余分钟 = 剩余总期望
        # 防止负数时间
        remaining_minutes = max(0, remaining_minutes)
        
        exp_goals_home = home_lambda_per_min * remaining_minutes
        exp_goals_away = away_lambda_per_min * remaining_minutes
        
        # 2. 核心魔法：一次性生成 10,000 个平行宇宙的"剩余进球数"
        # 使用 numpy 的泊松生成器，速度极快
        sim_goals_home = np.random.poisson(exp_goals_home, self.simulations)
        sim_goals_away = np.random.poisson(exp_goals_away, self.simulations)
        
        # 3. 计算 10,000 场模拟的最终比分
        final_scores_home = current_home_score + sim_goals_home
        final_scores_away = current_away_score + sim_goals_away
        
        # 4. 统计结果
        # ------------------------------------------------
        
        # A. 胜平负概率 (1X2 Probabilities)
        home_wins = np.sum(final_scores_home > final_scores_away)
        draws = np.sum(final_scores_home == final_scores_away)
        away_wins = np.sum(final_scores_home < final_scores_away)
        
        prob_home = home_wins / self.simulations
        prob_draw = draws / self.simulations
        prob_away = away_wins / self.simulations
        
        # B. 大小球概率 (Over/Under Probabilities)
        total_goals = final_scores_home + final_scores_away
        prob_over_2_5 = np.sum(total_goals > 2.5) / self.simulations
        prob_over_3_5 = np.sum(total_goals > 3.5) / self.simulations
        
        # C. 亚洲让球盘概率 (假设让球为 -0.5，即主胜)
        goal_diffs = final_scores_home - final_scores_away
        
        # D. 波胆/比分矩阵 (Correct Score Matrix) - 提取前5个最可能的比分
        # 将比分对转为字符串 "2-1" 进行统计
        scores_str = [f"{h}-{a}" for h, a in zip(final_scores_home, final_scores_away)]
        unique_scores, counts = np.unique(scores_str, return_counts=True)
        # 排序找到出现次数最多的比分
        top_indices = np.argsort(-counts)[:5] 
        top_correct_scores = []
        for i in top_indices:
            top_correct_scores.append({
                "score": unique_scores[i],
                "probability": float(counts[i] / self.simulations)
            })

        return {
            "1x2": {
                "home_win": float(prob_home),
                "draw": float(prob_draw),
                "away_win": float(prob_away)
            },
            "over_under": {
                "over_2.5": float(prob_over_2_5),
                "over_3.5": float(prob_over_3_5),
                "avg_total_goals": float(np.mean(total_goals))
            },
            "spread": {
                "avg_goal_diff": float(np.mean(goal_diffs)), # 预测净胜球
                "prob_home_cover_minus_0_5": float(prob_home) # 主队-0.5的概率即为主胜概率
            },
            "correct_scores": top_correct_scores
        }
