# translation_utils.py
import json
import os
import requests
import queue
import threading
import time

# --- DeepSeek 配置 ---
# 请在此填入您的 API Key, 格式如 sk-xxxxxxxx
DEEPSEEK_API_KEY = "sk-3f8b098a030a486aad4f6e8c87cecc46" 
DEEPSEEK_BASE_URL = "https://api.deepseek.com"

# --- 自动汉化缓存逻辑 ---
AUTO_TRANS_FILE = "auto_translations.json"
AUTO_TRANS_CACHE = {}

# 背景翻译队列
TRANS_QUEUE = queue.Queue()
PENDING_KEYS = set() # 防止重复添加到队列

def load_auto_translations():
    global AUTO_TRANS_CACHE
    if os.path.exists(AUTO_TRANS_FILE):
        try:
            with open(AUTO_TRANS_FILE, 'r', encoding='utf-8') as f:
                AUTO_TRANS_CACHE = json.load(f)
        except:
            AUTO_TRANS_CACHE = {}

def save_auto_translation(key, value):
    global AUTO_TRANS_CACHE
    AUTO_TRANS_CACHE[key] = value
    # 异步写入文件，这里简单处理，实际生产中可优化为定时写入
    try:
        with open(AUTO_TRANS_FILE, 'w', encoding='utf-8') as f:
            json.dump(AUTO_TRANS_CACHE, f, ensure_ascii=False, indent=2)
    except:
        pass

def google_translate_worker():
    """
    后台翻译工作线程：从队列消费待翻译文本，请求 API，存入缓存
    """
    # Use a session to reuse TCP connections and avoid port exhaustion (TIME_WAIT)
    session = requests.Session()
    
    while True:
        try:
            item = TRANS_QUEUE.get()
            if item is None: break # 退出信号
            
            raw_text, clean_text = item
            
            # 双重检查缓存（可能在排队时已被处理）
            if raw_text in AUTO_TRANS_CACHE:
                TRANS_QUEUE.task_done()
                if raw_text in PENDING_KEYS: PENDING_KEYS.remove(raw_text)
                continue

            success = False
            
            # 0. 尝试 DeepSeek API (优先)
            # 使用 DeepSeek-V3.2 (deepseek-chat)
            if not success and DEEPSEEK_API_KEY:
                try:
                    ds_url = f"{DEEPSEEK_BASE_URL}/chat/completions"
                    headers = {
                        "Authorization": f"Bearer {DEEPSEEK_API_KEY}",
                        "Content-Type": "application/json"
                    }
                    payload = {
                        "model": "deepseek-chat", # DeepSeek-V3.2
                        "messages": [
                            {"role": "system", "content": "You are a professional football translator. Translate the following team or league name to Simplified Chinese. Output ONLY the translated name, no explanation."},
                            {"role": "user", "content": clean_text}
                        ],
                        "temperature": 0.1,
                        "stream": False
                    }
                    resp = session.post(ds_url, json=payload, headers=headers, timeout=5)
                    if resp.status_code == 200:
                        data = resp.json()
                        if data.get('choices') and len(data['choices']) > 0:
                            res = data['choices'][0]['message']['content'].strip()
                            # 简单的结果清理 (防止模型偶尔话多)
                            if len(res) < len(clean_text) * 3: 
                                save_auto_translation(raw_text, res)
                                success = True
                except Exception as e:
                    # DeepSeek 失败，继续尝试其他
                    pass

            # 1. 尝试 Google Translate API
            if not success:
                try:
                    base_url = "https://translate.googleapis.com/translate_a/single"
                    params = {
                        "client": "gtx",
                        "sl": "auto",
                        "tl": "zh-CN",
                        "dt": "t",
                        "q": clean_text
                    }
                    # 设置超时
                    resp = session.get(base_url, params=params, timeout=3)
                    if resp.status_code == 200:
                        data = resp.json()
                        if data and data[0] and data[0][0] and data[0][0][0]:
                            res = data[0][0][0]
                            save_auto_translation(raw_text, res)
                            success = True
                except Exception as e:
                    # 忽略 Google 错误，尝试 fallback
                    pass
            
            # 2. 如果 Google 失败，尝试 MyMemory API (Backup)
            if not success:
                try:
                    mm_url = "https://api.mymemory.translated.net/get"
                    params = {
                        "q": clean_text,
                        "langpair": "en|zh-CN"
                    }
                    resp = session.get(mm_url, params=params, timeout=5)
                    if resp.status_code == 200:
                        data = resp.json()
                        if data.get("responseData"):
                            res = data["responseData"]["translatedText"]
                            # MyMemory 有时会返回错误信息作为文本，简单过滤
                            if "MYMEMORY" not in res and "QUERY LENGTH LIMIT EXCEEDED" not in res:
                                save_auto_translation(raw_text, res)
                                success = True
                except Exception:
                    pass

            # 清理 Pending
            if raw_text in PENDING_KEYS: PENDING_KEYS.remove(raw_text)
            TRANS_QUEUE.task_done()
            
            # 缩短间隔加快速度，但在失败时适当延时
            if success:
                time.sleep(0.2) 
            else:
                time.sleep(1.0) # 失败后多休息一下
            
        except Exception:
            pass

# 启动后台线程
t = threading.Thread(target=google_translate_worker, daemon=True)
t.start()

def auto_translate_text(text, is_team=False):
    """
    非阻塞自动翻译：
    1. 查缓存 -> 有则返回
    2. 无缓存 -> 加入后台队列，返回原文
    """
    if not text: return text
    if text in AUTO_TRANS_CACHE:
        return AUTO_TRANS_CACHE[text]
    
    # 避免重复提交
    if text not in PENDING_KEYS:
        # 简单清洗用于翻译，但Key保持原文
        query = text
        if is_team:
            query = text.replace(" FC", "").replace("CF ", "").strip()
            
        PENDING_KEYS.add(text)
        TRANS_QUEUE.put((text, query))
        
    return text  # 立即返回原文，不阻塞

# 初始化加载
load_auto_translations()

# 初始化加载
load_auto_translations()

# 0. 联赛白名单 (只抓取这些联赛)
LEAGUE_WHITELIST = {
    # 五大联赛
    "Premier League",
    "La Liga", 
    "Bundesliga",
    "Serie A",
    "Ligue 1",
    
    # 欧战
    "UEFA Champions League",
    "UEFA Europa League",
    "UEFA Europa Conference League",
    
    # 国际/其他
    "World Cup",
    "Euro Championship",
    "Copa America",
    
    # 友谊赛 (可选，目前开启)
    "Friendly Match",
    "Club Friendlies",

    # 次级联赛 (临时添加测试用)
    "Championship", # 英冠
    "Segunda División", # 西乙
    "Serie B", # 意乙
    
    # 用户新增 - 2026/01/13
    "Saudi Pro League",       # 沙特联
    "Türkiye Kupası", "Turkish Cup", # 土杯
    "Belgian Cup", "Croky Cup", "Coupe de Belgique", # 比利时杯
    "NIFL Premiership",       # 北爱超
    "Cymru Premier",          # 威超
    "EFL Cup", "League Cup",  # 英联杯
    "Coppa Italia",           # 意杯
    "KNVB Beker",             # 荷兰杯
    "Club Friendlies", "Club Friendlies 1", "Club Friendlies 2", "Club Friendlies 3", "Friendly Match", # 球会友谊
    # 用户补充 2026/01/13
    "Turkiye Kupasi", "Turkish Cup", # 土杯
    "Egypt Cup", # 埃及杯
    "Second Division A", # 埃及甲
    "Division 1", # 沙地甲
    "Copa de la Liga Profesional", # 超联杯
    "Tipsport Malta Cup", "Tipsport League", # TIP杯
    "State Cup", # 以杯
    "Coupe d'Algérie", # 阿尔杯
    "EFL Trophy", # 英锦赛
    "Belgian Cup", "Croky Cup", # 比利时杯
    "FA Trophy", # 英挑杯
    "Premiership", # 北爱超
    "Cymru Premier", # 威超
    "Challenge Cup", # 苏挑杯
    "Copa del Rey", # 西杯
    "KNVB Beker", # 荷兰杯
}

# 1. 联赛名称映射
LEAGUE_MAP = {
    "Premier League": "英超",
    "La Liga": "西甲",
    "Bundesliga": "德甲",
    "Serie A": "意甲",
    "Ligue 1": "法甲",
    "UEFA Champions League": "欧冠",
    "UEFA Europa League": "欧联",
    "UEFA Europa Conference League": "欧协联",
    
    "Championship": "英冠",
    "Segunda División": "西乙",
    "Serie B": "意乙",

    # --- 欧洲主流联赛 ---
    "Eredivisie": "荷甲",
    "Primeira Liga": "葡超",
    "Liga Portugal": "葡超",
    "Süper Lig": "土超",
    "Super Lig": "土超",
    # "Super League": "瑞士超", # 已移动到 trans_league 动态判断
    "Swiss Super League": "瑞士超",
    "Greek Super League": "希腊超",
    "Super League 1": "希腊超",
    "Scottish Premiership": "苏超",
    "Premiership": "苏超", # 苏格兰/北爱尔兰容易混淆，但苏超更常见，或需特判
    "Championship": "英冠", # 覆盖通用
    "League One": "英甲",
    "League Two": "英乙",
    "National League": "英非联",
    
    # --- 北欧 ---
    "Eliteserien": "挪超",
    "Allsvenskan": "瑞典超",
    # "Superliga": "丹麦超", # 丹麦 (Specific check moved to trans_league for context) 
    "Veikkausliiga": "芬兰超",
    "Besta deild karla": "冰岛超",

    # --- 东欧/其他欧洲 ---
    "Russian Premier League": "俄超",
    "Premier Liga": "俄超",
    "Ukrainian Premier League": "乌超",
    "Premier League": "英超", # 兜底，虽有特判
    "HNL": "克甲",
    "1. HNL": "克甲",
    "Ekstraklasa": "波兰超",
    "Fortuna Liga": "捷克/斯洛伐克超",
    "NB I": "匈牙利甲",
    "First League": "保加利亚甲", # 通用名，风险
    "Liga I": "罗甲",

    # --- 亚洲 ---
    "J1 League": "日职联",
    "J2 League": "日职乙",
    "K League 1": "韩职联",
    "K League 2": "韩职乙",
    "Chinese Super League": "中超",
    "CSL": "中超",
    "A-League": "澳超",
    "Saudi Pro League": "沙特联",
    "Pro League": "沙特联", # 常见简写
    "Persian Gulf Pro League": "伊朗超",
    "Stars League": "卡塔尔超",
    "UAE Pro League": "阿联酋超",
    
    # --- 美洲 ---
    "Major League Soccer": "美职联",
    "MLS": "美职联",
    "Liga MX": "墨超",
    "Brasileirão": "巴甲",
    "Serie A": "意甲", # 巴西如果也是Serie A需特判
    "Primera División": "阿甲", # 阿根廷/智利/乌拉圭等多用此名，需注意
    "Liga Profesional": "阿甲",
    "Primera A": "哥伦比亚甲",
    
    # --- 杯赛补全 ---
    "Copa Sudamericana": "南球杯",
    "Copa Libertadores": "解放者杯",
    "CAF Champions League": "非冠",
    "AFC Champions League": "亚冠",
    "AFC Cup": "亚协杯",
    
    # 新增映射
    "Saudi Pro League": "沙特联",
    "Türkiye Kupası": "土杯",
    "Turkish Cup": "土杯",
    "Belgian Cup": "比利时杯", 
    "Croky Cup": "比利时杯", 
    "Coupe de Belgique": "比利时杯",
    "NIFL Premiership": "北爱超",
    "Cymru Premier": "威超",
    "EFL Cup": "英联杯", 
    "League Cup": "英联杯",
    "FA Cup": "英足总杯",
    "Coppa Italia": "意杯",
    "KNVB Beker": "荷兰杯",
    "Club Friendlies": "球会友谊",
    "Club Friendlies 1": "球会友谊",
    "Club Friendlies 2": "球会友谊",
    "Club Friendlies 3": "球会友谊",
    
    "World Cup": "世界杯",
    "Euro Championship": "欧洲杯",
    "Copa America": "美洲杯",
    "Friendly Match": "友谊赛",
    "Club Friendlies": "俱乐部友谊赛",
    # 用户补充 2026/01/13
    "Turkiye Kupasi": "土杯",
    "Turkish Cup": "土杯",
    "Egypt Cup": "埃及杯",
    "Second Division A": "埃及甲",
    "Division 1": "沙地甲",
    "Copa de la Liga Profesional": "超联杯",
    "Tipsport Malta Cup": "TIP杯",
    "Tipsport League": "TIP杯",
    "State Cup": "以杯",
    "Coupe d'Algérie": "阿尔杯",
    "EFL Trophy": "英锦赛",
    "Belgian Cup": "比利时杯",
    "Croky Cup": "比利时杯",
    "FA Trophy": "英挑杯",
    "Premiership": "北爱超",
    "Cymru Premier": "威超",
    "Challenge Cup": "苏挑杯",
    "Copa del Rey": "西杯",
    "KNVB Beker": "荷兰杯",
    
    # 2026/01/14 补充
    "FKF Premier League": "肯尼亚超",
    "Thailand FA Cup": "泰国足总杯",
    "Tipsport Liga": "TIP杯", 
    "U18 Premier League - South": "英超U18(南区)",
    "U18 Premier League - North": "英超U18(北区)",
    "U18 Premier League": "英超U18",
}

# 2. 球队名称映射 (持续补充)
TEAM_MAP = {
    # 英超
    "Manchester City": "曼城",
    "Arsenal": "阿森纳",
    "Liverpool": "利物浦",
    "Aston Villa": "阿斯顿维拉",
    "Tottenham": "热刺",
    "Chelsea": "切尔西",
    "Manchester United": "曼联",
    "Newcastle": "纽卡斯尔",
    "West Ham": "西汉姆联",
    "Brighton": "布莱顿",
    "Brentford": "布伦特福德",
    "Crystal Palace": "水晶宫",
    "Wolves": "狼队",
    "Fulham": "富勒姆",
    "Bournemouth": "伯恩茅斯",
    "Everton": "埃弗顿",
    "Nottingham Forest": "诺丁汉森林",
    "Luton Town": "卢顿",
    "Burnley": "伯恩利",
    "Sheffield Utd": "谢菲联",
    "Leicester City": "莱斯特城",
    "Leeds United": "利兹联",
    "Southampton": "南安普顿",
    
    # 西甲
    "Real Madrid": "皇马",
    "Barcelona": "巴萨",
    "Girona": "赫罗纳",
    "Atletico Madrid": "马竞",
    "Athletic Club": "毕尔巴鄂",
    "Real Sociedad": "皇家社会",
    "Betis": "贝蒂斯",
    "Sevilla": "塞维利亚",
    "Villarreal": "比利亚雷亚尔",
    "Valencia": "瓦伦西亚",
    
    # 德甲
    "Bayer 04 Leverkusen": "勒沃库森",
    "Bayern Munich": "拜仁慕尼黑",
    "Stuttgart": "斯图加特",
    "Dortmund": "多特蒙德",
    "RB Leipzig": "莱比锡红牛",
    "Eintracht Frankfurt": "法兰克福",
    
    # 意甲
    "Inter": "国际米兰",
    "Milan": "AC米兰",
    "Juventus": "尤文图斯",
    "Bologna": "博洛尼亚",
    "Roma": "罗马",
    "Atalanta": "亚特兰大",
    "Napoli": "那不勒斯",
    "Lazio": "拉齐奥",
    "Fiorentina": "佛罗伦萨",
    
    # 法甲
    "Paris Saint Germain": "巴黎圣日耳曼",
    "Monaco": "摩纳哥",
    "Brest": "布雷斯特",
    "Lille": "里尔",
    "Nice": "尼斯",
    "Lyon": "里昂",
    "Marseille": "马赛",
    
    # 葡超
    "Benfica": "本菲卡",
    "Sporting CP": "葡萄牙体育",
    "Porto": "波尔图",
    "Braga": "布拉加",

    # 荷甲
    "Ajax": "阿贾克斯",
    "PSV Eindhoven": "PSV埃因霍温",
    "Feyenoord": "费耶诺德",

    # 其他豪门 / 常见队
    "Celtic": "凯尔特人",
    "Rangers": "流浪者",
    "Galatasaray": "加拉塔萨雷",
    "Fenerbahce": "费内巴切",
    "Besiktas": "贝西克塔斯",
    "Al Nassr": "利雅得胜利",
    "Al Hilal": "利雅得新月",
    "Inter Miami": "迈阿密国际",
    "Boca Juniors": "博卡青年",
    "River Plate": "河床",
    "Flamengo": "弗拉门戈",
    "Palmeiras": "帕尔梅拉斯",

    # 常见前缀/地名 (用于组合翻译)
    "Manchester": "曼彻斯特",
    "Leeds": "利兹",
    "Leicester": "莱斯特",
    "Norwich": "诺维奇",
    "Sheffield": "谢菲尔德",
    "Cardiff": "加的夫",
    "Swansea": "斯旺西",
    "Birmingham": "伯明翰",
    "Stoke": "斯托克",
    "Hull": "赫尔",
    "Coventry": "考文垂",
    "Preston": "普雷斯顿",
    "Derby": "德比",
    "Blackburn Rovers": "布莱克本",
    "Ipswich Town": "伊普斯维奇",
    "Middlesbrough": "米德尔斯堡",
    "Sunderland": "桑德兰",
    "Watford": "沃特福德",
    "West Bromwich Albion": "西布朗",
    "QPR": "女王公园巡游者",
    "Millwall": "米尔沃尔",
    "Swansea City": "斯旺西",
    "Cardiff City": "加的夫城",
    "Bristol City": "布里斯托尔城",
    "Plymouth Argyle": "普利茅斯",
    "Sheffield Wednesday": "谢周三",
    "Rotherham United": "罗瑟汉姆",
    "Huddersfield Town": "哈德斯菲尔德",
    
    # 意甲/乙补全
    "Cremonese": "克雷莫内塞",
    "Cosenza": "科森扎",
    "Salernitana": "萨勒尼塔纳",
    "Giugliano": "朱利亚诺",
    "AZ Picerno": "皮切尔诺",
    
    # 西甲/乙补全
    "Celta Vigo": "塞尔塔",
    "Huesca": "韦斯卡",
    "Cordoba": "科尔多瓦",
    
    # 低级别/杯赛补全
    "Barnsley": "巴恩斯利",
    "Paris FC": "巴黎FC",
    "AFC Wimbledon": "温布尔登",
    "Jong AZ": "阿尔克马尔青年队",
    "Jong Ajax": "阿贾克斯青年队",
    
    # 临时补充 (Log Observed)
    "Melaka": "马六甲", 
    "Pdrm": "马来西亚皇家警察",
    "Power Dynamos": "动力发电机",
    "Green Eagles": "绿鹰",
    "Police": "警察",
}

# 3. 比赛状态映射 (In-Play 用)
STATUS_MAP = {
    "TBD": "未定",
    "NS": "未开赛",
    "1H": "上半场",
    "HT": "中场",
    "2H": "下半场",
    "ET": "加时",
    "P": "点球",
    "FT": "完场",
    "AET": "完场(加时)",
    "PEN": "完场(点球)",
    "BT": "加赛",
    "SUSP": "暂停",
    "INT": "中断",
    "PST": "推迟",
    "CANC": "取消",
    "ABD": "腰斩",
    "AWD": "判决",
    "WO": "弃权",
    "LIVE": "进行中"
}

def trans_league(english_name, country=None):
    """翻译联赛名，找不到则返回原名"""
    if not english_name: return ""
    
    # 特殊处理 Premier League 避免其他国家联赛误判为英超
    if english_name == "Premier League" and country and country != "England":
        # 如果是其他国家的 Premier League，尝试构建全名查找
        full_name = f"{country} Premier League"
        if full_name in LEAGUE_MAP: return LEAGUE_MAP[full_name]
        # 如果没有映射，暂不翻译，直接返回全名，避免显示为“英超”
        return full_name 

    # 特殊处理 FA Cup 避免其他国家杯赛误判为英足总杯
    if english_name == "FA Cup" and country and country != "England":
        # 如果是 "Thailand" + "FA Cup" -> "Thailand FA Cup" -> 递归调用看是否在 Map 中
        full_name = f"{country} FA Cup"
        if full_name in LEAGUE_MAP: return LEAGUE_MAP[full_name]
        return full_name 

    # 特殊处理 Serie A (巴西)
    if english_name == "Serie A" and country and country == "Brazil":
        return "巴甲"
    
    # 特殊处理 Primera Division (多国通用)
    if english_name == "Primera División" or english_name == "Primera Division":
        if country == "Argentina": return "阿甲"
        if country == "Chile": return "智利甲"
        if country == "Uruguay": return "乌拉圭甲"
        if country == "Columbia": return "哥伦比亚甲"
        if country == "Paraguay": return "巴拉圭甲"
        if country == "Spain": return "西甲"

    # 特殊处理 Super League (多国通用)
    if english_name == "Super League":
        if country == "China": return "中超"
        if country == "Switzerland": return "瑞士超"
        if country == "Greece": return "希腊超"
        if country == "Turkey": return "土超"
        if country == "India": return "印超"
        if country == "Malaysia": return "马超"
        if country == "Uzbekistan": return "乌兹超"
        if country == "Zambia": return "赞比亚超"
        if country == "Malawi": return "马拉维超"
        if country == "Kenya": return "肯尼亚超"
        if country == "Belgium": return "比女超" # 通常比利时男子叫 Pro League

        # 通用兜底：如果没有匹配到特定国家，尝试构造 "国家名 + 超"
        # 需确保 country 已经是中文，或者我们能接受 "Zambia超" 这种形式等待后续优化
        # 这里暂时让其进入自动翻译流程，或者返回 "超级联赛"
        pass

    # 特殊处理 Superliga (多国通用)
    if english_name == "Superliga" or "superliga" in english_name.lower():
        if country == "Denmark": return "丹麦超"
        if country == "Argentina": return "阿甲" # Older name, but possible
        if country == "Slovakia": return "斯洛伐克超"
        if country == "Serbia": return "塞尔维亚超"
        if country == "Romania": return "罗甲"
        if country == "Albania": return "阿尔巴尼亚超"
        if country == "Kosovo": return "科索沃超"
        # 移除 return english_name，允许后续逻辑处理 (自动翻译或模糊匹配)

    # 1. 字典精确匹配
    if english_name in LEAGUE_MAP: return LEAGUE_MAP[english_name]

    # 2. 模糊匹配
    lower_name = english_name.lower()
    
    if "club friendlies" in lower_name: return "球会友谊"
    if "saudi" in lower_name and "pro" in lower_name: return "沙特联"
    if "turk" in lower_name and "cup" in lower_name: return "土杯"
    if "belgian" in lower_name and "cup" in lower_name: return "比利时杯"
    if "nifl" in lower_name: return "北爱超"
    if "cymru" in lower_name: return "威超"
    if "efl cup" in lower_name or "league cup" in lower_name: return "英联杯"
    if "coppa italia" in lower_name: return "意杯"
    if "knvb" in lower_name: return "荷兰杯"
    
    # 尝试自动翻译
    return auto_translate_text(english_name)

def trans_team(english_name):
    """翻译球队名，找不到则返回原名"""
    if not english_name:
        return ""
    
    # 0. 预处理后缀 (U21, W, II, B)
    suffix_map = {
        " U21": " U21",
        " U23": " U23",
        " U19": " U19",
        " W": "女足",
        " Women": "女足",
        " II": "二队",
        " B": " B队"
    }
    
    found_suffix = ""
    clean_name = english_name
    
    for en_suffix, cn_suffix in suffix_map.items():
        if english_name.endswith(en_suffix):
            clean_name = english_name[:-len(en_suffix)] # 移除后缀
            found_suffix = cn_suffix
            break
            
    # 1. 字典精确/清洗匹配
    # 去除常见的俱乐部后缀 Fc, SC 等
    core_name = clean_name.replace(" FC", "").replace("CF ", "").replace("SC ", "").strip()
    
    translated_base = core_name # 默认就是处理后的英文名
    
    if core_name in TEAM_MAP:
        translated_base = TEAM_MAP[core_name]
    else:
        # 2. 启发式翻译 (Heuristic)
        # 处理 "xxx City" -> "xxx城"
        if core_name.endswith(" City"):
            prefix = core_name.replace(" City", "")
            if prefix in TEAM_MAP: 
                translated_base = TEAM_MAP[prefix] + "城"
        
        # 处理 "xxx United" -> "xxx联"
        elif core_name.endswith(" United"):
            prefix = core_name.replace(" United", "")
            if prefix in TEAM_MAP:
                translated_base = TEAM_MAP[prefix] + "联"

        # 处理 "AFC xxx"
        elif core_name.startswith("AFC "):
            suffix = core_name.replace("AFC ", "")
            if suffix in TEAM_MAP:
                translated_base = TEAM_MAP[suffix]
        
        # 如果还是没找到，并且 clean_name != english_name (说明有后缀)，
        # 我们可以尝试只翻译 clean_name 部分如果能找到的话。
        # (上面逻辑其实已经覆盖了，如果 core_name 在 map 里就行)
        
        # 如果依然是英文，且有后缀，至少把后缀保留好
        if translated_base == core_name:
             # 尝试自动翻译
             translated_base = auto_translate_text(core_name, is_team=True)
             
    return translated_base + found_suffix


# (Deleted duplicate trans_league)

def trans_status(status_short):
    """翻译比赛状态缩写"""
    return STATUS_MAP.get(status_short, status_short)
