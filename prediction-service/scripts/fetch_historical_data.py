import requests
import pandas as pd
import numpy as np
import time
import os
import json

# ==========================================
# 配置区域
# ==========================================
API_KEY = "a08e877ff4defac2b3abf0f3f12c4e4f"  # 请替换为您的 football-data.org API Key
BASE_URL = "https://api.football-data.org/v4"
OUTPUT_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'backtesting', 'data')
OUTPUT_FILE = os.path.join(OUTPUT_DIR, 'real_match_data.csv')

def fetch_premier_league_matches(season=2023):
    """
    从 API 获取英超(PL)的比赛列表 (仅已完赛)
    """
    if API_KEY == "YOUR_API_KEY_HERE":
        print("警告: 未配置 API_KEY，将使用模拟数据演示转换逻辑。")
        return get_mock_api_response()

    headers = { 'X-Auth-Token': API_KEY }
    url = f"{BASE_URL}/competitions/PL/matches?season={season}&status=FINISHED"
    
    print(f"正在请求: {url}")
    try:
        response = requests.get(url, headers=headers)
        response.raise_for_status()
        return response.json().get('matches', [])
    except Exception as e:
        print(f"API 请求失败: {e}")
        if hasattr(e, 'response') and e.response is not None:
             print(f"API 响应内容: {e.response.text}")
        
        print("尝试使用内置模拟数据进行演示...")
        return get_mock_api_response()

def get_mock_api_response():
    """
    生成模拟的 API 响应结构的比赛列表，用于演示"转换逻辑"
    """
    return [
        {
            "id": 1001,
            "homeTeam": {"name": "Arsenal", "id": 57},
            "awayTeam": {"name": "Chelsea", "id": 61},
            "score": {"fullTime": {"home": 2, "away": 1}},
            "goals": [
                {"minute": 15, "team": {"id": 57}, "type": "REGULAR"}, # Arsenal Goal
                {"minute": 32, "team": {"id": 61}, "type": "REGULAR"}, # Chelsea Goal
                {"minute": 88, "team": {"id": 57}, "type": "PENALTY"}, # Arsenal Goal
            ],
            "bookings": [
                {"minute": 60, "team": {"id": 61}, "card": "RED_CARD"} # Chelsea Red
            ]
        }
    ]

# ==========================================
# 核心逻辑: 事件转分钟级切片
# ==========================================
def convert_match_to_timeseries(match_data):
    """
    将单场比赛的 API 数据转换为 0-95 分钟的时间序列 DataFrame
    适用于 prediction-service 的回测引擎格式
    """
    
    # 1. 提取基础信息
    match_id = match_data['id']
    home_id = match_data['homeTeam']['id']
    away_id = match_data['awayTeam']['id']
    
    # 2. 整理事件 (进球 + 红牌)
    #Football-Data API 的结构通常在 score 或单独的 goals/bookings 字段
    # 如果接口返回了 goals 和 bookings 列表:
    events = []
    
    # 处理进球
    for goal in match_data.get('goals', []):
        # 提取进球类型 (REGULAR, PENALTY, OWN_GOAL)
        g_type = goal.get('type')
        events.append({
            'minute': goal['minute'],
            'type': 'GOAL',
            'subtype': g_type, 
            'team_id': goal['team']['id']
        })
        
    # 处理红牌 (bookings 需要过滤 Red Card)
    for card in match_data.get('bookings', []):
        if card['card'] in ['RED_CARD', 'YELLOW_RED_CARD']:
            events.append({
                'minute': card['minute'],
                'type': 'RED_CARD',
                'team_id': card['team']['id']
            })
            
    # 按时间排序
    events.sort(key=lambda x: x['minute'])
    
    # 3. 生成 0-95 分钟的时间轴
    timeline_rows = []
    
    # 状态追踪器
    current_state = {
        'home_score': 0,
        'away_score': 0,
        'home_red': 0,
        'away_red': 0
    }
    
    # 动量模拟 (因为历史API通常不提供每分钟动量，我们需要基于比分和时间生成"隐含动量"或置为中性)
    # 这里我们使用简单的随机游走+事件冲击来模拟，以免回测引擎因为缺数据报错
    sim_momentum_h = 1.0
    sim_momentum_a = 1.0
    
    for minute in range(96):
        # A. 检查本分钟发生的事件
        minute_events = [e for e in events if e['minute'] == minute]
        
        goal_scored_now = False
        penalty_awarded = 0 # 0=No, 1=Yes (implied by PENALTY goal)
        
        for e in minute_events:
            if e['type'] == 'GOAL':
                goal_scored_now = True
                if e.get('subtype') == 'PENALTY':
                    penalty_awarded = 1
                    
                if e['team_id'] == home_id:
                    current_state['home_score'] += 1
                else:
                    current_state['away_score'] += 1
            elif e['type'] == 'RED_CARD':
                if e['team_id'] == home_id:
                    current_state['home_red'] += 1
                else:
                    current_state['away_red'] += 1

        # B. 动量模拟逻辑 (仅用于填充特征列)
        # 1. 如果进球，进球方动量大增
        if goal_scored_now:
            if current_state['home_score'] > current_state['away_score']: # Home leads
                sim_momentum_h += 0.3
                sim_momentum_a -= 0.2
            else:
                sim_momentum_a += 0.3
                sim_momentum_h -= 0.2
        else:
            # 均值回归
            sim_momentum_h += (1.0 - sim_momentum_h) * 0.1 + np.random.normal(0, 0.02)
            sim_momentum_a += (1.0 - sim_momentum_a) * 0.1 + np.random.normal(0, 0.02)
        
        # C. 赔率模拟 (Odds Decay)
        # 真实情况需要 Historic Odds API (通常很贵)。这里用简单的 Time Decay 模拟大小球赔率
        # 假设 Over 2.5 初始赔率 1.90
        # 随着时间推移，如果没有进球，Over赔率会上升。如果有进球，Over赔率会下降。
        total_goals = current_state['home_score'] + current_state['away_score']
        
        # 简易模型: Base Odds * TimeFactor / GoalsFactor
        # 这只是为了让策略能跑起来，不是真实赔率！
        time_elapsed = minute / 90.0
        base_prob = 0.5 # 假设50%概率
        # 剩余时间越少，不再进球概率越大 -> Over 概率越小 -> Over 赔率越高
        # 除非已经进了很多球
        
        # 只要数据里有这一列，策略引擎就能跑。
        # 实际上你应该导入真实的 odds 如果有的话。
        sim_odds_over_2_5 = 2.0 + (minute * 0.05) - (total_goals * 0.8)
        sim_odds_over_2_5 = max(1.01, sim_odds_over_2_5) 

        # D. 构建 Row
        # 注意: 
        # 1. VAR 和 Dangerous Attacks 通常不包含在免费的标准 API 中 (属于高级 In-Play 数据)
        # 2. 此处保留模拟逻辑用于回测代码兼容，如果您的数据源包含真实 columns，请直接赋值
        
        sim_da_h = int(np.random.poisson(0.5) + (sim_momentum_h - 1.0) * 2) if goal_scored_now == False else 5
        sim_da_a = int(np.random.poisson(0.5) + (sim_momentum_a - 1.0) * 2) if goal_scored_now == False else 5
        sim_var = 1 if penalty_awarded else 0 # 如果有得点球，假设有 VAR 确认
        
        row = {
            'match_id': match_id,
            'minute': minute,
            'home_score': current_state['home_score'],
            'away_score': current_state['away_score'],
            'red_cards_home': current_state['home_red'],
            'red_cards_away': current_state['away_red'],
            'feature_momentum_home': round(sim_momentum_h, 3), # 模拟
            'feature_momentum_away': round(sim_momentum_a, 3), # 模拟
            'pressure_index_h': round(50 + (sim_momentum_h-1)*50 + np.random.normal(0,2), 1),
            'pressure_index_a': round(50 + (sim_momentum_a-1)*50 + np.random.normal(0,2), 1),
            'dangerous_attacks_home': max(0, sim_da_h), # 仿真填充
            'dangerous_attacks_away': max(0, sim_da_a), # 仿真填充
            'var_event': sim_var,
            'odds_over_2.5': round(sim_odds_over_2_5, 2)
        }
        timeline_rows.append(row)
        
    return pd.DataFrame(timeline_rows)


def main():
    # 1. 准备目录
    if not os.path.exists(OUTPUT_DIR):
        os.makedirs(OUTPUT_DIR)

    # 2. 获取比赛列表
    print("Step 1: 获取比赛列表...")
    matches = fetch_premier_league_matches()
    print(f"共获取到 {len(matches)} 场比赛元数据。")
    
    all_timelines = []
    
    # 3. 逐场转换
    print("Step 2: 转换为分钟级数据...")
    for match in matches:
        try:
            df_match = convert_match_to_timeseries(match)
            all_timelines.append(df_match)
            print(f"  - Processed Match {match['id']} ({match.get('homeTeam',{}).get('name')} vs {match.get('awayTeam',{}).get('name')})")
        except Exception as e:
            print(f"  - Failed Match {match.get('id')}: {e}")
            
    # 4. 合并保存
    if all_timelines:
        final_df = pd.concat(all_timelines, ignore_index=True)
        final_df.to_csv(OUTPUT_FILE, index=False)
        print(f"\n成功! 数据已保存至: {OUTPUT_FILE}")
        print(f"总行数: {len(final_df)}")
        print("您现在可以修改 main_backtest.py 将 data_path 指向此文件来使用真实(模拟)数据进行回测。")
    else:
        print("未生成任何数据。")

if __name__ == "__main__":
    main()
