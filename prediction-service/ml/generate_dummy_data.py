"""
训练数据生成脚本
生成 5000 条带有规律的历史比赛记录，用于训练机器学习模型
"""

import numpy as np
import pandas as pd
from pathlib import Path

# 设置随机种子以保证可重复性
np.random.seed(42)

def generate_match_data(n_samples: int = 5000) -> pd.DataFrame:
    """
    生成模拟的历史比赛数据
    
    特征 (Features):
    - home_goals: 主队进球数 (0-5)
    - away_goals: 客队进球数 (0-5)
    - minute: 比赛进行时间 (1-90)
    - home_shots_on_target: 主队射正次数 (0-15)
    - away_shots_on_target: 客队射正次数 (0-15)
    - red_cards: 红牌总数 (0-3)
    
    目标 (Target):
    - result: 比赛结果 (0=主胜, 1=平, 2=客胜)
    """
    
    print(f"🎲 开始生成 {n_samples} 条训练数据...")
    
    data = []
    
    for i in range(n_samples):
        # 生成基础特征
        minute = np.random.randint(1, 91)  # 1-90 分钟
        
        # 射正次数（与比赛时间正相关）
        base_shots = minute / 10  # 基础射正次数
        home_shots = max(0, int(np.random.normal(base_shots, 2)))
        away_shots = max(0, int(np.random.normal(base_shots, 2)))
        
        # 进球数（与射正次数正相关，但有随机性）
        # 规律：射正越多，进球概率越高
        home_goal_prob = min(0.3, home_shots * 0.03)  # 每次射正约 3% 进球率
        away_goal_prob = min(0.3, away_shots * 0.03)
        
        home_goals = np.random.binomial(home_shots, home_goal_prob) if home_shots > 0 else 0
        away_goals = np.random.binomial(away_shots, away_goal_prob) if away_shots > 0 else 0
        
        # 限制进球数在合理范围
        home_goals = min(home_goals, 5)
        away_goals = min(away_goals, 5)
        
        # 红牌（随机，但会影响结果）
        red_cards = np.random.choice([0, 0, 0, 0, 0, 1, 1, 2, 3], p=[0.7, 0.1, 0.05, 0.05, 0.03, 0.03, 0.02, 0.01, 0.01])
        
        # 确定比赛结果
        # 规律 1：进球多的一方获胜
        # 规律 2：射正多的一方有优势
        # 规律 3：红牌会影响结果
        
        if home_goals > away_goals:
            result = 0  # 主胜
        elif home_goals < away_goals:
            result = 2  # 客胜
        else:
            # 平局情况下，根据射正和其他因素决定最终结果
            # 这里模拟比赛还在进行中，预测最终结果
            home_advantage = home_shots - away_shots + np.random.normal(0.5, 1)  # 主场优势
            
            if minute < 90:  # 比赛未结束
                # 根据射正优势预测
                if home_advantage > 2:
                    result = np.random.choice([0, 1], p=[0.6, 0.4])  # 主队优势大
                elif home_advantage < -2:
                    result = np.random.choice([1, 2], p=[0.4, 0.6])  # 客队优势大
                else:
                    result = np.random.choice([0, 1, 2], p=[0.35, 0.35, 0.30])  # 势均力敌
            else:
                result = 1  # 90分钟平局
        
        data.append({
            'home_goals': home_goals,
            'away_goals': away_goals,
            'minute': minute,
            'home_shots_on_target': home_shots,
            'away_shots_on_target': away_shots,
            'red_cards': red_cards,
            'result': result
        })
        
        if (i + 1) % 1000 == 0:
            print(f"  ✅ 已生成 {i + 1} 条数据...")
    
    df = pd.DataFrame(data)
    
    # 打印数据统计
    print("\n📊 数据统计:")
    print(f"  - 总样本数: {len(df)}")
    print(f"  - 主胜 (0): {(df['result'] == 0).sum()} ({(df['result'] == 0).mean()*100:.1f}%)")
    print(f"  - 平局 (1): {(df['result'] == 1).sum()} ({(df['result'] == 1).mean()*100:.1f}%)")
    print(f"  - 客胜 (2): {(df['result'] == 2).sum()} ({(df['result'] == 2).mean()*100:.1f}%)")
    
    print("\n📈 特征分布:")
    print(df.describe())
    
    return df


def main():
    # 生成数据
    df = generate_match_data(5000)
    
    # 保存到 CSV
    output_path = Path(__file__).parent / "historical_matches.csv"
    df.to_csv(output_path, index=False)
    
    print(f"\n💾 数据已保存到: {output_path}")
    print(f"   文件大小: {output_path.stat().st_size / 1024:.1f} KB")


if __name__ == "__main__":
    main()
