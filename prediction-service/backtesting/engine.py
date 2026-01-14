from core.goal_predictor import GoalPredictor
from core.game_state import GameStateAdjuster
from core.monte_carlo import MonteCarloSimulator

class BacktestEngine:
    def __init__(self, data_loader, portfolio, strategies):
        self.loader = data_loader
        self.portfolio = portfolio
        self.strategies = strategies # 策略列表，例如 ['OverUnder', 'NextGoal']
        self.predictor = GoalPredictor() # 你的核心预测类
        self.mc_simulator = MonteCarloSimulator(simulations=5000) # 初始化蒙特卡洛引擎

    def run(self):
        print("开始回测...")
        
        # 1. 遍历每一场历史比赛
        for match_timeline in self.loader.get_matches():
            if match_timeline.empty:
                continue
                
            match_id = match_timeline.iloc[0]['match_id']
            
            # 标记是否已经在这场比赛下过注 (防止同一信号重复下注)
            active_bets = set() 

            # 2. 遍历这场比赛的每一分钟 (重演)
            for _, tick in match_timeline.iterrows():
                minute = tick['minute']
                current_score = (tick['home_score'], tick['away_score'])
                
                # --- 核心预测逻辑接入 ---
                
                # A. 提取基础 Lambda (模拟从动量引擎获取)
                # 假设CSV中有这些特征列
                raw_h_lambda = tick.get('feature_momentum_home', 1.0) # Default if missing
                raw_a_lambda = tick.get('feature_momentum_away', 1.0)
                
                # B. 应用心理修正 (GameStateAdjuster)
                red_cards_home = tick.get('red_cards_home', 0)
                red_cards_away = tick.get('red_cards_away', 0)
                
                adj_h_lambda, adj_a_lambda = GameStateAdjuster.adjust_lambdas(
                    raw_h_lambda, raw_a_lambda, 
                    current_score[0], current_score[1], 
                    minute, 
                    red_cards_home, red_cards_away
                )
                
                # C. [旧] 生成概率矩阵
                # probs = self.predictor.calculate_probabilities(adj_h_lambda, adj_a_lambda, minute)
                
                # C. [新] 使用蒙特卡洛引擎进行向量化模拟
                remaining_mins = 95 - minute # 剩余时间 (含补时)
                sim_results = self.mc_simulator.run_simulation(
                    current_home_score=current_score[0],
                    current_away_score=current_score[1],
                    home_lambda_per_min=adj_h_lambda,
                    away_lambda_per_min=adj_a_lambda,
                    remaining_minutes=remaining_mins
                )

                # --- 策略触发检查 ---
                
                # 示例：检查大小球策略 (Over 2.5) 与 复杂过滤
                if 'OverUnder' in self.strategies:
                    # 获取当前市场赔率
                    market_odds_over = tick.get('odds_over_2.5', 0)
                    
                    # 获取压力指数 (如果没有则默认为50)
                    p_h = tick.get('pressure_index_h', 50)
                    p_a = tick.get('pressure_index_a', 50)
                    momentum_diff = abs(p_h - p_a)
                    
                    # 获取危险进攻和VAR
                    dangerous_attacks_h = tick.get('dangerous_attacks_home', 0)
                    var_status = tick.get('var_event', 0)

                    # 策略：只有当 势能差 > 15 且 赔率 > 1.80 且 正在发生危险进攻 且 无VAR打扰 时才考虑入场
                    if market_odds_over > 1.80 and momentum_diff > 15 and dangerous_attacks_h >= 2 and var_status == 0:
                        
                        # [新] 直接使用蒙特卡洛计算出的真实胜率
                        ai_prob_over = sim_results['over_under']['over_2.5']
                        
                        # 计算 Edge (凯利值前提)
                        implied_prob = 1.0 / market_odds_over if market_odds_over > 0 else 0.99
                        edge = ai_prob_over - implied_prob
                        
                        # 仅当 Edge > 5% 且 胜率 > 60% 时下注
                        if edge > 0.05 and ai_prob_over > 0.60:
                             if 'Over 2.5' not in active_bets:
                                stake = self.portfolio.calculate_stake(edge, market_odds_over)
                                if stake > 0:
                                    self.portfolio.place_bet(
                                        match_id, minute, 'OverUnder', 'Over 2.5', 
                                        market_odds_over, stake, 'Algo_MC_v2'
                                    )
                                    active_bets.add('Over 2.5')
                                # print(f"信号触发: 比赛{match_id} 第{minute}分钟 买入大球")

            # 3. 比赛结束，结算
            final_h = match_timeline.iloc[-1]['home_score']
            final_a = match_timeline.iloc[-1]['away_score']
            self.portfolio.settle_bets(final_h, final_a)

        print("回测结束。")
