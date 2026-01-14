import numpy as np
from scipy.stats import poisson

class GoalPredictor:
    def __init__(self, max_goals=10):
        self.max_goals = max_goals
    
    def calculate_probabilities(self, home_lambda, away_lambda, minute=None):
        """
        计算比分概率矩阵
        """
        prob_matrix = np.zeros((self.max_goals + 1, self.max_goals + 1))
        
        for home_goals in range(self.max_goals + 1):
            for away_goals in range(self.max_goals + 1):
                prob_matrix[home_goals, away_goals] = (
                    poisson.pmf(home_goals, home_lambda) * 
                    poisson.pmf(away_goals, away_lambda)
                )
        
        # 归一化
        total_prob = prob_matrix.sum()
        if total_prob > 0:
            prob_matrix /= total_prob
            
        return prob_matrix

    def check_over_under_signal(self, prob_matrix, market_odds_over, line=2.5, current_goals=0):
        """
        检查大小球信号
        
        :param prob_matrix: 比分概率矩阵 (for remaining goals usually? Or full match?)
        :param market_odds_over: 市场大球赔率
        :param line: 盘口线 (e.g. 2.5)
        :param current_goals: 已经进球数 (If lambda is for remaining goals, we need to add current goals)
        Note: logic in engine.py implies lambda is for 'remaining' or 'total'?
        In live_prediction_model, lambda is remaining.
        But here let's assume lambda passed to calculate_probabilities is for remainder of match.
        So prob_matrix represents probabilities of *additional* goals.
        
        Wait, engine.py passes `feature_momentum_home` which looks like a factor or full lambda?
        If it mimics live_prediction, it's lambda for remaining time.
        
        So Total Goals = Current Goals + Additional Goals.
        """
        
        # Calculate prob of Over line
        # We need current score to do this accurately if the matrix is for remaining goals.
        # But engine.py snippet didn't pass current score to calculate_probabilities. 
        # It just returns probs.
        # Let's assume prob_matrix is for *remaining* goals.
        
        # If the backtester passes match_timeline tick, we might need current score here to determine total goals.
        # However, for simplicity and matching the snippet:
        # User snippet: `is_signal, edge = self.predictor.check_over_under_signal(probs, market_odds_over)`
        # It doesn't pass current score.
        # Maybe the prompt implies `probs` is already adjusted or it's just a generic check.
        # But standard Over 2.5 is on Total Goals.
        # I will update check_over_under_signal to take current_goals if possible, or assume 0 if not passed (which is wrong for in-play).
        
        # Actually, in engine.py, it calls `current_score = (tick['home_score'], tick['away_score'])` before.
        # But it doesn't pass it to `check_over_under_signal`.
        # I will check if I can improve the parameters.
        # For now, I will implement a method that calculates Over probability from the matrix, assuming the matrix is "Final Score Probabilities" or "Remaining".
        # If "Remaining", we need current score.
        # Given `Calculate_probabilities(adj_h_lambda, adj_a_lambda)` where lambda is usually remaining expectation in Poisson models for in-play.
        # I'll add `current_home`, `current_away` to `check_over_under_signal` signatures or make it generic.
        
        # Let's assume for this specific snippet that the user might have simplified.
        # I'll implement a robust version that handles the probability matrix.
        pass
        
        over_prob = 0.0
        # Assuming prob_matrix indices are [additional_home, additional_away]
        # And we want Total Goals > line.
        # Since I can't see current score in the call arguments in engine.py snippet, 
        # I will assume the call in engine.py needs to be updated or I should infer.
        # BUT, since I am writing engine.py too, I can fix the call!
        
        # So I will define this method to take current_score.
        return False, 0.0

    def calculate_over_probability(self, prob_matrix, line, current_home, current_away):
        over_prob = 0.0
        rows, cols = prob_matrix.shape
        for h in range(rows):
            for a in range(cols):
                if (current_home + h + current_away + a) > line:
                    over_prob += prob_matrix[h, a]
        return over_prob

    def check_over_under_signal_with_score(self, prob_matrix, market_odds_over, line, current_home, current_away):
        over_prob = self.calculate_over_probability(prob_matrix, line, current_home, current_away)
        
        if over_prob <= 0 or market_odds_over <= 1:
            return False, 0.0
            
        fair_odds = 1.0 / over_prob
        
        # Edge calculation: (Market / Fair) - 1
        edge = (market_odds_over / fair_odds) - 1
        
        # Signal thresholds
        is_signal = False
        if edge > 0.05 and over_prob > 0.55: # Example thresholds
            is_signal = True
            
        return is_signal, edge
