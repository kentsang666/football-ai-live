import math

# --- 1. 球队能力值数据库 (静态模拟) ---
# 1.0 代表联盟平均水平。
# >1.0 代表强，<1.0 代表弱。
TEAM_STATS = {
    # 英超强队
    "Man City": {"att": 1.45, "def": 0.60}, # 攻击极强，防守好(失球少所以数值低)
    "Arsenal": {"att": 1.35, "def": 0.70},
    "Liverpool": {"att": 1.40, "def": 0.75},
    "Chelsea": {"att": 1.15, "def": 1.10},
    "Man United": {"att": 1.10, "def": 1.20},
    "Tottenham": {"att": 1.20, "def": 1.15},
    
    # 西甲强队
    "Real Madrid": {"att": 1.42, "def": 0.65},
    "Barcelona": {"att": 1.38, "def": 0.70},
    "Atletico Madrid": {"att": 1.10, "def": 0.60},
    
    # 德甲/其他 (作为示例)
    "Bayern Munich": {"att": 1.50, "def": 0.80},
    "PSG": {"att": 1.45, "def": 0.85},
}

LEAGUE_AVG_GOALS = 1.35  # 假设每支球队场均进球 1.35 个

def get_team_rating(team_name):
    """
    模糊匹配球队名字。如果找不到，默认给一个平均水平 (1.0)。
    这样防止遇到小球队时程序报错。
    """
    # 简单的名字清洗，去掉了 'FC' 等后缀以增加匹配率
    clean_name = team_name.replace(" FC", "").replace("CF ", "").strip()
    
    # 在字典里找，找不到就返回默认值
    # default: att=1.0 (平均), def=1.0 (平均)
    return TEAM_STATS.get(clean_name, {"att": 1.0, "def": 1.0})

# --- 2. 泊松公式 ---
def poisson_probability(k, lamb):
    """
    计算进 k 个球的概率
    公式: P(k) = (lambda^k * e^-lambda) / k!
    """
    return (lamb ** k * math.exp(-lamb)) / math.factorial(k)

# --- 3. 核心预测逻辑 ---
def predict_match(home_team, away_team):
    """
    输入：两队名字
    输出：胜平负概率 (百分比)
    """
    # 1. 获取攻防数据
    home_stats = get_team_rating(home_team)
    away_stats = get_team_rating(away_team)
    
    # 2. 计算预期进球 (Lambda)
    # 主队进球 = 主队攻击 x 客队防守 x 联盟平均 x 主场优势(1.1)
    home_expect = home_stats["att"] * away_stats["def"] * LEAGUE_AVG_GOALS * 1.1
    
    # 客队进球 = 客队攻击 x 主队防守 x 联盟平均
    away_expect = away_stats["att"] * home_stats["def"] * LEAGUE_AVG_GOALS
    
    # 3. 计算胜平负概率矩阵 (遍历 0-5 球的所有组合)
    max_goals = 6
    prob_home_win = 0.0
    prob_draw = 0.0
    prob_away_win = 0.0
    
    for h_goals in range(max_goals):     # 主队进 0~5 球
        for a_goals in range(max_goals): # 客队进 0~5 球
            # 该比分发生的概率 = 主队进h球概率 * 客队进a球概率
            prob = poisson_probability(h_goals, home_expect) * poisson_probability(a_goals, away_expect)
            
            if h_goals > a_goals:
                prob_home_win += prob
            elif h_goals == a_goals:
                prob_draw += prob
            else:
                prob_away_win += prob
                
    # 4. 归一化 (确保加起来是 100%)
    total_prob = prob_home_win + prob_draw + prob_away_win
    
    hp = int((prob_home_win / total_prob) * 100)
    dp = int((prob_draw / total_prob) * 100)
    ap = int((prob_away_win / total_prob) * 100)

    # 简易 AI 评价生成
    ai_text = "观察走势"
    highlight_color = "text-gray-400"

    if hp >= 60: 
        ai_text = "主胜率高"
        highlight_color = "text-cyber-cyan"
    elif ap >= 60: 
        ai_text = "客队强势"
        highlight_color = "text-neon-purple"
    elif hp + ap > 80: 
        ai_text = "建议分胜负"
        highlight_color = "text-gray-200"
    elif dp >= 35: 
        ai_text = "防守胶着"
        highlight_color = "text-yellow-400"
    
    return {
        "home_prob": hp,
        "draw_prob": dp,
        "away_prob": ap,
        "home_xg": round(home_expect, 2), # 预期进球 xG
        "away_xg": round(away_expect, 2),
        "ai_prediction": ai_text,
        "highlight_color": highlight_color
    }

class FootballPredictionSystem:
    def __init__(self):
        self.league_avg_goals = 2.5 

    def calculate_prematch_lambda(self, home_stats, away_stats):
        # 简单算法：(主队进攻 + 客队防守) / 2
        # 注意：这里传入的 stats 可能是 get_team_rating 返回的 {att: ..., def: ...}
        # 为了兼容，如果传入的是字典，则尝试取值，否则假定是数值
        h_att = home_stats.get('att', 1.0) if isinstance(home_stats, dict) else home_stats
        a_def = away_stats.get('def', 1.0) if isinstance(away_stats, dict) else away_stats
        
        a_att = away_stats.get('att', 1.0) if isinstance(away_stats, dict) else away_stats
        h_def = home_stats.get('def', 1.0) if isinstance(home_stats, dict) else home_stats

        # 使用旧版逻辑计算 lambda，或者使用用户提供的新逻辑
        # 旧版: att * def * avg * 1.1 (home)
        home_exp_goals = h_att * a_def * LEAGUE_AVG_GOALS * 1.1
        away_exp_goals = a_att * h_def * LEAGUE_AVG_GOALS
        
        return home_exp_goals, away_exp_goals

    def calculate_live_odds(self, home_prematch_exp, away_prematch_exp, 
                            current_minute, current_score_home, current_score_away, 
                            red_cards_home=0, red_cards_away=0):
        # A. 计算剩余时间比例
        time_remaining = 90 - current_minute
        if time_remaining < 0: time_remaining = 0
        time_ratio = time_remaining / 90.0

        # B. 调整进攻能力 (红牌惩罚逻辑)
        home_factor = 0.6 if red_cards_home > 0 else 1.0
        away_factor = 0.6 if red_cards_away > 0 else 1.0

        # C. 计算“余下时间内”双方还能进几个球
        live_home_exp_remainder = home_prematch_exp * time_ratio * home_factor
        live_away_exp_remainder = away_prematch_exp * time_ratio * away_factor

        # D. 重新模拟最终比分
        live_home_win = 0.0
        live_draw = 0.0
        live_away_win = 0.0

        # 手动实现泊松 PMF 以避免引入 scipy
        def poisson_pmf(k, lam):
            return (lam ** k * math.exp(-lam)) / math.factorial(k)

        for h_new in range(7): # 稍微扩大范围
            for a_new in range(7):
                prob = poisson_pmf(h_new, live_home_exp_remainder) * poisson_pmf(a_new, live_away_exp_remainder)
                
                final_h = current_score_home + h_new
                final_a = current_score_away + a_new

                if final_h > final_a:
                    live_home_win += prob
                elif final_h == final_a:
                    live_draw += prob
                else:
                    live_away_win += prob

        total_prob = live_home_win + live_draw + live_away_win
        if total_prob == 0: total_prob = 1 # Avoid division by zero

        return {
            "home_prob": round(live_home_win / total_prob * 100, 1),
            "draw_prob": round(live_draw / total_prob * 100, 1),
            "away_prob": round(live_away_win / total_prob * 100, 1),
            "home_xg_remain": round(live_home_exp_remainder, 2),
            "away_xg_remain": round(live_away_exp_remainder, 2)
        }
# 初始化全局实例
start_predictor = FootballPredictionSystem()
