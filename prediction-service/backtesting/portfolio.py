class PortfolioManager:
    def __init__(self, initial_capital=10000):
        self.initial_capital = initial_capital
        self.current_capital = initial_capital
        self.bets = [] # 存储历史注单
        self.equity_curve = [initial_capital]

    def calculate_stake(self, edge, odds):
        """
        集成凯利公式资金管理
        """
        if edge <= 0 or odds <= 1: return 0
        
        # 简化版凯利公式 (使用 1/4 凯利降低风险)
        b = odds - 1
        p = (1 / odds) * (1 + edge) # 估算的真实胜率 = 隐含胜率 * (1 + edge) ?? 
        # Wait, usually edge = (odds / fair_odds) - 1. 
        # fair_odds = 1/p. So p = 1/fair_odds.
        # If edge = (market_odds / fair_odds) - 1 => market_odds = fair_odds * (1 + edge)
        # => market_odds = (1/p) * (1+edge) => p = (1+edge)/market_odds.
        p = (1 + edge) / odds

        q = 1 - p
        kelly_fraction = (b * p - q) / b
        
        # 风险控制：单注不超过总资金 5%
        stake_pct = min(kelly_fraction * 0.25, 0.05) 
        
        # 必须大于 0
        stake_pct = max(0, stake_pct)
        
        return max(self.current_capital * stake_pct, 0)

    def place_bet(self, match_id, minute, bet_type, selection, odds, stake, strategy_name):
        """
        下注动作
        """
        bet = {
            "match_id": match_id,
            "minute": minute,
            "type": bet_type,       # e.g., 'OverUnder', 'NextGoal'
            "selection": selection, # e.g., 'Over 2.5', 'Home'
            "odds": odds,
            "stake": stake,
            "strategy": strategy_name,
            "status": "OPEN",
            "profit": 0
        }
        self.current_capital -= stake
        self.bets.append(bet)
        return bet

    def settle_bets(self, final_score_home, final_score_away):
        """
        比赛结束，结算该场比赛所有未结注单
        """
        total_goals = final_score_home + final_score_away
        
        for bet in self.bets:
            if bet['status'] == "OPEN":
                won = False
                
                # --- 结算逻辑示例 ---
                if bet['type'] == 'OverUnder':
                    # 假设 selection 格式为 'Over 2.5' 或 'Under 2.5'
                    try:
                        threshold = float(bet['selection'].split()[1])
                        if 'Over' in bet['selection'] and total_goals > threshold:
                            won = True
                        elif 'Under' in bet['selection'] and total_goals < threshold:
                            won = True
                    except:
                        pass # 格式解析错误
                
                elif bet['type'] == '1X2':
                    if bet['selection'] == 'Home' and final_score_home > final_score_away:
                        won = True
                    elif bet['selection'] == 'Away' and final_score_away > final_score_home:
                        won = True
                    elif bet['selection'] == 'Draw' and final_score_home == final_score_away:
                        won = True

                if won:
                    payout = bet['stake'] * bet['odds']
                    bet['profit'] = payout - bet['stake']
                    self.current_capital += payout
                    bet['status'] = "WON"
                else:
                    bet['profit'] = -bet['stake']
                    bet['status'] = "LOST"
        
        self.equity_curve.append(self.current_capital)
