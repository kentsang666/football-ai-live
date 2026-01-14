import pandas as pd
import numpy as np
import random
import os

def generate_synthetic_matches(num_matches=20, output_path='prediction-service/backtesting/data/synthetic_data.csv'):
    """
    生成用于回测的合成比赛数据 (分钟级)
    模拟真实的滚球数据流，包括比分变化、动量波动和赔率衰减。
    """
    all_data = []

    print(f"正在生成 {num_matches} 场合成比赛数据...")

    for i in range(num_matches):
        match_id = f"mock_match_{1000+i}"
        
        # 初始状态
        home_score = 0
        away_score = 0
        home_red = 0
        away_red = 0
        
        # 设定双方实力 (Expected Goals)
        home_xg = np.random.uniform(1.2, 2.5)
        away_xg = np.random.uniform(0.8, 1.8)
        
        # 初始动量
        mom_h = 1.0
        mom_a = 1.0
        
        # 模拟 0-95 分钟 (含补时)
        for minute in range(96):
            # 1. 动量随机游走 (Mean Reversion to 1.0)
            mom_h += np.random.normal(0, 0.05) + 0.05 * (1.0 - mom_h)
            mom_a += np.random.normal(0, 0.05) + 0.05 * (1.0 - mom_a)
            
            # 限制范围
            mom_h = max(0.6, min(1.4, mom_h))
            mom_a = max(0.6, min(1.4, mom_a))

            # 生成"压力指数" (Pressure Index 0-100) 用于策略以此为信号
            # 1.0 -> 50, 1.4 -> 90, 0.6 -> 10
            pressure_h = 50 + (mom_h - 1.0) * 100 + np.random.normal(0, 2)
            pressure_a = 50 + (mom_a - 1.0) * 100 + np.random.normal(0, 2)
            
            # 2. 进球模拟 (Poisson Process per minute)
            # 基础进球率/分钟
            lambda_h = (home_xg / 90.0) * mom_h
            lambda_a = (away_xg / 90.0) * mom_a
            
            # 红牌影响
            if home_red > 0: lambda_h *= 0.5
            if away_red > 0: lambda_a *= 0.5
            
            goal_h = 0
            goal_a = 0
            
            if np.random.random() < lambda_h:
                home_score += 1
                goal_h = 1
                # 进球后动量爆发
                mom_h = 1.3 
                mom_a = 0.8
                
            if np.random.random() < lambda_a:
                away_score += 1
                goal_a = 1
                mom_a = 1.3
                mom_h = 0.8

            # 3. 红牌模拟 (很低的概率)
            if np.random.random() < 0.0005: home_red = 1
            if np.random.random() < 0.0005: away_red = 1

            # 4. 生成 VAR 和 危险球 (Dangerous Attacks) 数据
            # VAR: 随机在进球前后发生，或者独立发生
            var_event = 0 # 0=None, 1=Goal Check, 2=Penalty Check
            if (goal_h or goal_a) and np.random.random() < 0.2:
                var_event = 1 # 进球后 VAR 检查
            elif np.random.random() < 0.005:
                var_event = 2 # 独立的点球/红牌 VAR 检查

            # 危险球: 与动量强相关
            # 基础值 + 动量加成 + 随机波动
            da_h = int(np.random.poisson(0.5) + (mom_h - 1.0) * 2)
            da_a = int(np.random.poisson(0.5) + (mom_a - 1.0) * 2)
            da_h = max(0, da_h)
            da_a = max(0, da_a)
            
            # 5. 赔率模拟 (Over 2.5 Goals)
            # 简化模型：赔率随时间衰减，进球时跳升
            remaining_time = 90 - minute
            if remaining_time < 0: remaining_time = 0
            
            current_goals = home_score + away_score
            
            # 估算剩余进球
            exp_remaining = (home_xg + away_xg) * (remaining_time / 90.0)
            total_exp = current_goals + exp_remaining
            
            # 计算 Over 2.5 概率 (Rough approx using Poisson cumulative)
            # Prob(X > 2.5 - current)
            needed = 2.5 - current_goals
            
            if needed < 0:
                # 已经是大球，赔率极低 (1.01)
                prob_over = 0.99
            else:
                # 还需要进球
                # 使用简单的指数分布估算概率: P(X >= k)
                if exp_remaining <= 0:
                    prob_over = 0.001
                else:
                    # Very rough heuristic for probability
                    prob_over = 1.0 - np.exp(-exp_remaining * 0.8) # Tuning factor
                    # Adjust for how many goals needed
                    if needed > 0.5: prob_over *= 0.8
                    if needed > 1.5: prob_over *= 0.5
                    if needed > 2.5: prob_over *= 0.2
            
            odds_over = 1.0 / prob_over if prob_over > 0.01 else 101.0
            odds_over = max(1.01, min(101.0, odds_over))
            
            # 添加一点市场噪音
            odds_over *= np.random.uniform(0.98, 1.02)
            
            row = {
                'match_id': match_id,
                'minute': minute,
                'home_score': home_score,
                'away_score': away_score,
                'feature_momentum_home': round(mom_h, 3),
                'feature_momentum_away': round(mom_a, 3),
                'pressure_index_h': round(pressure_h, 1),
                'pressure_index_a': round(pressure_a, 1),
                'dangerous_attacks_home': da_h,
                'dangerous_attacks_away': da_a,
                'var_event': var_event,
                'red_cards_home': home_red,
                'red_cards_away': away_red,
                'odds_over_2.5': round(odds_over, 3)
            }
            all_data.append(row)

    df = pd.DataFrame(all_data)
    
    # 确保目录存在
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    
    df.to_csv(output_path, index=False)
    print(f"生成完毕: {output_path} ({len(df)} 行)")
    return output_path

if __name__ == "__main__":
    generate_synthetic_matches()
