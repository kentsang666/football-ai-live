from fastapi.responses import JSONResponse
from fastapi import FastAPI, Request
from fastapi.templating import Jinja2Templates
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import List
import uvicorn
import requests
import sqlite3
import logging
import asyncio
import json
import os
import math
import numpy as np
from contextlib import asynccontextmanager
from datetime import datetime
from model_utils import predict_match
from prediction_engine import FootballPredictionSystem
from translation_utils import trans_team, trans_league, trans_status, LEAGUE_WHITELIST
from live_engine import PressureModel, LivePricing, AsianHandicapPricer, SignalGenerator
import random

# 配置日志
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# --- Engines ---
momentum_engine = PressureModel()
pred_engine = FootballPredictionSystem()
ah_pricer = AsianHandicapPricer()
signal_gen = SignalGenerator()

# --- Global State for Live Data ---
LIVE_INPLAY_CACHE = []
TODAY_SCHEDULE_CACHE = {"date": None, "data": [], "last_update": 0}
# --- 全局算法日志缓存 ---
ALGO_LOGS = []  # 每条为字符串，最大长度1000条，超出自动丢弃最早

# --- 联赛过滤状态 & 持久化 ---
BLOCKLIST_FILE = "league_blocklist.json"

def load_blocklist():
    if os.path.exists(BLOCKLIST_FILE):
        try:
            with open(BLOCKLIST_FILE, 'r', encoding='utf-8') as f:
                return set(json.load(f))
        except:
            return set()
    return set()

def save_blocklist(blocked_set):
    try:
        with open(BLOCKLIST_FILE, 'w', encoding='utf-8') as f:
            json.dump(list(blocked_set), f, ensure_ascii=False, indent=2)
    except Exception as e:
        logger.error(f"Failed to save blocklist: {e}")

LEAGUE_BLOCKLIST = load_blocklist() # 存储被用户屏蔽的联赛名称
ALL_ACTIVE_LEAGUES = []  # 当前API返回的所有联赛列表

# --- 推荐历史持久化 ---
HISTORY_FILE = "recommendation_history.json"
RECOMMENDATION_HISTORY = []

def load_history():
    if os.path.exists(HISTORY_FILE):
        try:
            with open(HISTORY_FILE, 'r', encoding='utf-8') as f:
                data = json.load(f)
                return data if isinstance(data, list) else []
        except:
            return []
    return []

def save_history_to_disk():
    try:
        with open(HISTORY_FILE, 'w', encoding='utf-8') as f:
            json.dump(RECOMMENDATION_HISTORY, f, ensure_ascii=False, indent=2)
    except Exception as e:
        logger.error(f"Failed to save history: {e}")

def add_recommendation_record(record):
    global RECOMMENDATION_HISTORY
    # Prevent duplicate keys
    existing = next((r for r in RECOMMENDATION_HISTORY if r.get('key') == record.get('key')), None)
    if existing:
        return
    RECOMMENDATION_HISTORY.append(record)
    save_history_to_disk()

# Check & Load history on startup
RECOMMENDATION_HISTORY = load_history()

# --- 自动结算逻辑 ---
async def settle_pending_records():
    """
    定期检查 Pending 状态的推荐记录，查询比赛结果并结算
    """
    global RECOMMENDATION_HISTORY
    
    pending = [r for r in RECOMMENDATION_HISTORY if r.get('result') == 'Pending']
    if not pending:
        return

    # 提取比赛ID去重
    pending_ids = list(set([str(r['match_id']) for r in pending]))
    
    # 每次最多查询 10 场，避免 URL 过长或超限
    chunk_size = 10
    chunks = [pending_ids[i:i + chunk_size] for i in range(0, len(pending_ids), chunk_size)]
    
    headers = {
        'x-apisports-key': API_KEY,
        'x-rapidapi-host': "v3.football.api-sports.io"
    }

    dirty = False
    
    for chunk in chunks:
        ids_str = '-'.join(chunk)
        url = f"{API_URL}?ids={ids_str}"
        try:
            # 使用同步 requests 但在异步函数中，注意性能影响 (通常结算不频繁没关系)
            # 更好的做法是用 aiohttp，但为了保持一致性暂用 requests
            resp = requests.get(url, headers=headers, timeout=10)
            if resp.status_code == 200:
                data = resp.json().get('response', [])
                
                # 构建完场比分映射
                finished_map = {}
                for m in data:
                    status = m['fixture']['status']['short']
                    # FT: Full Time, AET: After Extra Time, PEN: Penalties
                    if status in ['FT', 'AET', 'PEN']:
                        finished_map[m['fixture']['id']] = {
                            'home': m['goals']['home'],
                            'away': m['goals']['away']
                        }
                
                # 结算逻辑
                for rec in RECOMMENDATION_HISTORY:
                    if rec['result'] == 'Pending' and rec['match_id'] in finished_map:
                        score = finished_map[rec['match_id']]
                        
                        try:
                            # 解析盘口 "HDP -0.5"
                            if 'HDP' in rec['bet_type']:
                                line_str = rec['bet_type'].replace('HDP ', '')
                                line = float(line_str)
                                
                                # 计算过程
                                # Outcome = (Home - Away) + Line
                                diff = score['home'] - score['away']
                                val = diff + line
                                
                                res = "Error"
                                if val == 0: res = "Push"
                                elif val == 0.25: res = "Half Win"
                                elif val == -0.25: res = "Half Loss"
                                elif val > 0: res = "Win"
                                else: res = "Loss"
                                
                                rec['result'] = res
                                rec['final_score'] = f"{score['home']}-{score['away']}"
                                rec['settled_at'] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                                dirty = True
                                logger.info(f"Settled bet {rec['key']} ({rec['bet_type']}) with Score {score['home']}-{score['away']} -> {res}")
                        except Exception as e:
                            logger.error(f"Settlement calc error for {rec['key']}: {e}")
                            
        except Exception as e:
            logger.error(f"Settlement request failed: {e}")
            
    if dirty:
        save_history_to_disk()

def sanitize_data(data):
    """
    Recursively sanitize data to remove NaN/Inf and convert numpy types to native types.
    """
    if isinstance(data, dict):
        return {k: sanitize_data(v) for k, v in data.items()}
    elif isinstance(data, list):
        return [sanitize_data(v) for v in data]
    elif isinstance(data, (float, np.floating)):
        if np.isnan(data) or np.isinf(data):
            return None
        return float(data)
    elif isinstance(data, (int, np.integer)):
        return int(data)
    elif hasattr(data, 'item'): # Handle other numpy scalars
        val = data.item()
        if isinstance(val, (float, int)):
             return sanitize_data(val) # Recurse to handle float NaN check
        return val
    return data

# --- Background Task: 16s Polling ---
async def poll_live_data_task():
    """
    后台任务：每16秒轮询一次 API获取滚球数据 (In-Play)
    每天早上6点30分停止抓取数据，中午12点开始抓取数据
    """
    global LIVE_INPLAY_CACHE, ALL_ACTIVE_LEAGUES
    
    # Initialize a persistent session for polling
    # This keeps TCP connections alive and prevents port exhaustion (WinError 10048)
    session = requests.Session()
    session.headers.update({
        'x-apisports-key': API_KEY,
        'x-rapidapi-host': "v3.football.api-sports.io"
    })
    
    while True:
        # --- Time Window Check ---
        now = datetime.now()
        current_time = now.time()
        
        # Define objects for comparison
        stop_time = datetime.strptime("06:30", "%H:%M").time()
        start_time = datetime.strptime("12:00", "%H:%M").time()
        
        # If current time is between 06:30 and 12:00, sleep
        if stop_time <= current_time < start_time:
            logger.info(f">>> 休眠模式 (06:30-12:00). 当前: {current_time.strftime('%H:%M')}. 停止数据抓取.")
            LIVE_INPLAY_CACHE.clear() # Optional: Clear cache to avoid stale data display
            await asyncio.sleep(60) # Check every 60 seconds
            continue
            
        try:
            logger.info(">>> 正在轮询滚球数据 (16s interval)...")
            # Reuse session for requests
            
            # live=all 获取所有正在进行的比赛
            response = session.get(f"{API_URL}?live=all", timeout=10)
            
            # 同时并行获取赔率数据 (Use separated try/except to not block main flow)
            odds_map = {}
            try:
                odds_response = session.get("https://v3.football.api-sports.io/odds/live", timeout=10)
                if odds_response.status_code == 200:
                    odds_data = odds_response.json().get('response', [])
                    for o in odds_data:
                        odds_map[o['fixture']['id']] = o['odds']
            except Exception as oe:
                logger.warning(f"赔率获取失败: {oe}")

            if response.status_code == 200:
                data = response.json()
                
                # Check for API-level errors (e.g. Rate Limit)
                if data.get('errors'):
                     logger.error(f"API Error Response: {data.get('errors')}")
                
                raw_matches = data.get('response', [])
                
                parsed_list = []
                current_cycle_leagues = set() # 收集本轮所有联赛
                
                for item in raw_matches:
                    # 日志收集
                    def log_algo(msg):
                        ts = datetime.now().strftime('%H:%M:%S')
                        ALGO_LOGS.append(f"[{ts}] {msg}")
                        if len(ALGO_LOGS) > 1000:
                            ALGO_LOGS.pop(0)
                        # 同时打印到控制台，方便调试观察算法运行
                        logger.info(f"[ALGO] {msg}")
                    fixture = item['fixture']
                    teams = item['teams']
                    league = item['league']

                    # Sanitize Goals (Prevent NoneType arithmetic errors)
                    raw_goals = item.get('goals', {})
                    goals = {
                        'home': raw_goals.get('home') if raw_goals.get('home') is not None else 0,
                        'away': raw_goals.get('away') if raw_goals.get('away') is not None else 0
                    }

                    # 0. 联赛白名单过滤 (已废弃，改为黑名单逻辑)
                    league_cn = trans_league(league['name'], country=league.get('country'))
                    current_cycle_leagues.add(league_cn)
                    
                    if league_cn in LEAGUE_BLOCKLIST:
                         # 如果在黑名单中，直接跳过处理
                         continue
                        
                    home_cn = trans_team(teams['home']['name'])
                    away_cn = trans_team(teams['away']['name'])
                    log_algo(f"处理比赛: {league_cn} {home_cn} vs {away_cn}")
                    # 检查联赛为英超但队名不是英超球队，输出警告日志
                    ENGLISH_PREMIER_TEAMS = {
                        "曼城", "阿森纳", "利物浦", "阿斯顿维拉", "热刺", "切尔西", "曼联", "纽卡斯尔", "西汉姆联", "布莱顿", "布伦特福德", "水晶宫", "狼队", "富勒姆", "伯恩茅斯", "埃弗顿", "诺丁汉森林", "卢顿", "伯恩利", "谢菲联", "莱斯特城", "利兹联", "南安普顿"
                    }
                    if league_cn == "英超" and (home_cn not in ENGLISH_PREMIER_TEAMS or away_cn not in ENGLISH_PREMIER_TEAMS):
                        warn_msg = f"[警告] 联赛被识别为英超，但队伍为：{teams['home']['name']} vs {teams['away']['name']}，请检查联赛映射或数据源！(league_en={league['name']})"
                        log_algo(warn_msg)
                        # 自动收集到本地文件，便于后续批量修正
                        try:
                            # 1. 记录详细日志
                            with open('wrong_premier_league_mapping.log', 'a', encoding='utf-8') as f:
                                f.write(f"{datetime.now().strftime('%Y-%m-%d %H:%M:%S')} | league_en={league['name']} | home_en={teams['home']['name']} | away_en={teams['away']['name']}\n")
                            # 2. 自动收集所有被误判为英超的联赛英文名
                            with open('wrong_premier_league_mapping_leagues.txt', 'a+', encoding='utf-8') as f2:
                                f2.seek(0)
                                all_lines = set(l.strip() for l in f2.readlines())
                                if league['name'] not in all_lines:
                                    f2.write(league['name'] + '\n')
                            # 3. 自动生成建议的 LEAGUE_MAP 修正代码片段
                            with open('wrong_premier_league_mapping_leagues.txt', 'r', encoding='utf-8') as f3:
                                league_names = set(l.strip() for l in f3.readlines() if l.strip())
                            suggest_lines = [f'    "{ln}": "请填写正确中文",' for ln in sorted(league_names)]
                            with open('wrong_premier_league_mapping_suggest.py', 'w', encoding='utf-8') as f4:
                                f4.write('# 建议补充到 translation_utils.py 的 LEAGUE_MAP：\n')
                                f4.write('LEAGUE_MAP.update({\n')
                                for line in suggest_lines:
                                    f4.write(line + '\n')
                                f4.write('})\n')
                        except Exception as e:
                            log_algo(f"[文件写入异常] {e}")
                    
                    # 赔率处理
                    match_odds = odds_map.get(fixture['id'], [])
                    
                    if not match_odds:
                         # 仅在比赛进行中且无赔率时记录
                         if fixture['status']['short'] in ['1H', '2H', 'HT']:
                             log_algo(f"[无赔率源] {league_cn} | {home_cn} vs {away_cn} (API未返回Odds). 跳过此赛事.")
                         # 用户要求：如果没有赔率数据，则不显示该赛事
                         continue

                    # 通用自动收集和建议补全机制，支持任意自定义字段
                    try:
                        # 配置需要自动收集的自定义字段，格式：[(文件名, 字段值, 建议py变量名)]
                        custom_fields = [
                            ('untranslated_referee.txt', fixture.get('referee', ''), 'REFEREE_MAP'),
                            ('untranslated_stadium.txt', fixture.get('venue', {}).get('name', ''), 'STADIUM_MAP'),
                            ('untranslated_country.txt', league.get('country', ''), 'COUNTRY_MAP'),
                            ('untranslated_city.txt', fixture.get('venue', {}).get('city', ''), 'CITY_MAP'),
                        ]
                        for fname, value, pyname in custom_fields:
                            if value and value != pyname and value != '':
                                with open(fname, 'a+', encoding='utf-8') as f:
                                    f.seek(0)
                                    all_vals = set(l.strip() for l in f.readlines())
                                    if value not in all_vals:
                                        f.write(value + '\n')
                                # 生成建议补全代码
                                with open(fname, 'r', encoding='utf-8') as f2:
                                    vals = set(l.strip() for l in f2.readlines() if l.strip())
                                suggest_lines = [f'    "{v}": "请填写中文",' for v in sorted(vals)]
                                with open(f'{fname[:-4]}_suggest.py', 'w', encoding='utf-8') as f3:
                                    f3.write(f'# 建议补充到 translation_utils.py 的 {pyname}：\n')
                                    f3.write(f'{pyname}.update({{\n')
                                    for line in suggest_lines:
                                        f3.write(line + '\n')
                                    f3.write('})\n')
                    except Exception as e:
                        log_algo(f"[自定义字段收集写入异常] {e}")
                    # 自动收集未被汉化的比赛状态、事件类型、盘口类型等字段
                    try:
                        # 比赛状态
                        s_short = fixture['status']['short']
                        if trans_status(s_short) == s_short:
                            with open('untranslated_status.txt', 'a+', encoding='utf-8') as f:
                                f.seek(0)
                                all_status = set(l.strip() for l in f.readlines())
                                if s_short not in all_status:
                                    f.write(s_short + '\n')
                        # 盘口类型
                        for book in match_odds:
                            odds_type = book.get('name', str(book.get('id')))
                            # 可自定义 odds_type 翻译函数，这里直接收集
                            with open('untranslated_odds_type.txt', 'a+', encoding='utf-8') as f:
                                f.seek(0)
                                all_types = set(l.strip() for l in f.readlines())
                                if odds_type not in all_types:
                                    f.write(odds_type + '\n')
                        # 事件类型
                        raw_events = item.get('events', [])
                        for e in raw_events:
                            t_type = e.get('type')
                            detail = e.get('detail', '')
                            with open('untranslated_event_type.txt', 'a+', encoding='utf-8') as f:
                                f.seek(0)
                                all_types = set(l.strip() for l in f.readlines())
                                if t_type and t_type not in all_types:
                                    f.write(t_type + '\n')
                            if detail:
                                with open('untranslated_event_detail.txt', 'a+', encoding='utf-8') as f:
                                    f.seek(0)
                                    all_details = set(l.strip() for l in f.readlines())
                                    if detail not in all_details:
                                        f.write(detail + '\n')
                        # 生成建议的补全代码
                        def gen_suggest(src, pyname):
                            with open(src, 'r', encoding='utf-8') as f:
                                names = set(l.strip() for l in f.readlines() if l.strip())
                            suggest_lines = [f'    "{n}": "请填写中文",' for n in sorted(names)]
                            with open(f'{src[:-4]}_suggest.py', 'w', encoding='utf-8') as f2:
                                f2.write(f'# 建议补充到 translation_utils.py 的 {pyname}：\n')
                                f2.write(f'{pyname}.update({{\n')
                                for line in suggest_lines:
                                    f2.write(line + '\n')
                                f2.write('})\n')
                        gen_suggest('untranslated_status.txt', 'STATUS_MAP')
                        gen_suggest('untranslated_odds_type.txt', 'ODDS_TYPE_MAP')
                        gen_suggest('untranslated_event_type.txt', 'EVENT_TYPE_MAP')
                        gen_suggest('untranslated_event_detail.txt', 'EVENT_DETAIL_MAP')
                    except Exception as e:
                        log_algo(f"[其它字段收集写入异常] {e}")
                    # 自动收集未被汉化的联赛名，便于批量补全 LEAGUE_MAP
                    try:
                        with open('untranslated_leagues.txt', 'a+', encoding='utf-8') as f:
                            f.seek(0)
                            all_leagues = set(l.strip() for l in f.readlines())
                            if trans_league(league['name']) == league['name'] and league['name'] not in all_leagues:
                                f.write(league['name'] + '\n')
                        # 生成建议的 LEAGUE_MAP 批量补全代码
                        with open('untranslated_leagues.txt', 'r', encoding='utf-8') as f2:
                            league_names = set(l.strip() for l in f2.readlines() if l.strip())
                        suggest_lines = [f'    "{ln}": "请填写中文",' for ln in sorted(league_names)]
                        with open('untranslated_leagues_suggest.py', 'w', encoding='utf-8') as f3:
                            f3.write('# 建议补充到 translation_utils.py 的 LEAGUE_MAP：\n')
                            f3.write('LEAGUE_MAP.update({\n')
                            for line in suggest_lines:
                                f3.write(line + '\n')
                            f3.write('})\n')
                    except Exception as e:
                        log_algo(f"[联赛名收集写入异常] {e}")
                    # 自动收集未被汉化的队名，便于批量补全 TEAM_MAP
                    try:
                        with open('untranslated_teams.txt', 'a+', encoding='utf-8') as f:
                            f.seek(0)
                            all_teams = set(l.strip() for l in f.readlines())
                            for t in [teams['home']['name'], teams['away']['name']]:
                                if trans_team(t) == t and t not in all_teams:
                                    f.write(t + '\n')
                        # 生成建议的 TEAM_MAP 批量补全代码
                        with open('untranslated_teams.txt', 'r', encoding='utf-8') as f2:
                            team_names = set(l.strip() for l in f2.readlines() if l.strip())
                        suggest_lines = [f'    "{tn}": "请填写中文",' for tn in sorted(team_names)]
                        with open('untranslated_teams_suggest.py', 'w', encoding='utf-8') as f3:
                            f3.write('# 建议补充到 translation_utils.py 的 TEAM_MAP：\n')
                            f3.write('TEAM_MAP.update({\n')
                            for line in suggest_lines:
                                f3.write(line + '\n')
                            f3.write('})\n')
                    except Exception as e:
                        log_algo(f"[队名收集写入异常] {e}")
                    
                    # 提取亚盘 (ID 2)
                    ah_data = {"val": "-", "h": "-", "a": "-"}
                    ou_data = {"line": "-", "o": "-", "u": "-"}
                    
                    for book in match_odds:
                        log_algo(f"  盘口类型: {book.get('name', book.get('id'))}")  # 盘口类型一般为英文名，若需翻译可补充映射
                        # 亚盘 Asian Handicap (ID: 4 通常Pre-match, 33 Live)
                        # 我们把所有可能的ID都包进去
                        if book['id'] in [2, 4, 33]:
                            # 寻找最均衡的盘口 (Main=true 优先, 其次找 odds 离 2.0 最近的)
                            # 1. 尝试找 main
                            main_lines = [v for v in book['values'] if v.get('main')]
                            
                            # 2. 智能重构：分离主客队数据进行精准匹配
                            # (API 返回数据中 handicap 字符串可能不一致，如 "3.75" 和 "-3.75"，导致不能简单分组)
                            
                            all_bets = book['values']
                            home_bets = [b for b in all_bets if b['value'] == 'Home']
                            away_bets = [b for b in all_bets if b['value'] == 'Away']
                            
                            if home_bets:
                                # A. 寻找最佳主队盘口 (标记Main > 赔率接近1.95)
                                best_home = next((b for b in home_bets if b.get('main')), None)
                                
                                if not best_home:
                                    def dist_to_2(b):
                                        try: return abs(float(b['odd']) - 1.95)
                                        except: return 999
                                    best_home = min(home_bets, key=dist_to_2)
                                
                                # B. 提取数据
                                raw_line = best_home['handicap']
                                home_odd = best_home['odd']
                                away_odd = "-" # 默认空
                                
                                # C. 寻找匹配的客队赔率
                                # 逻辑：客队 handicap 应该等于 -1 * 主队 handicap (数值上)
                                try:
                                    target_h = -1 * float(raw_line)
                                    for ab in away_bets:
                                        try:
                                            # 允许 0.05 的浮点误差
                                            if abs(float(ab['handicap']) - target_h) < 0.05:
                                                away_odd = ab['odd']
                                                break
                                        except: pass
                                except: pass
                                
                                # D. 格式化盘口显示 (全场让球 = 实时让球 - 当前比分差)
                                try:
                                    # 1. 获取基础数值 (Home Handicap)
                                    base_hdp = float(raw_line)
                                    
                                    # 2. 计算比分差 (主 - 客)
                                    current_score_diff = goals['home'] - goals['away']
                                    
                                    # 3. 核心算法: 实时盘口 = 全场盘口 + 比分差
                                    # (即把 API 包含比分的全场盘，还原为 0-0 起步的滚球盘)
                                    # 验证: 全场让 -3.75, 领先 3 球. 滚球盘 = -3.75 + 3 = -0.75 (还需要进0.75)
                                    adj_hdp = base_hdp + current_score_diff
                                    
                                    # 4. 格式化
                                    # 保持 .25, .5, .75 这种亚盘习惯，如果整除则转int
                                    if adj_hdp.is_integer():
                                        display_hdp = int(adj_hdp)
                                    else:
                                        display_hdp = adj_hdp
                                        
                                    if display_hdp > 0: display_line = f"+{display_hdp}"
                                    else: display_line = f"{display_hdp}"
                                    
                                except Exception as e:
                                    logger.error(f"Handicap calc error: {e}")
                                    display_line = raw_line
                                
                                # 赔率减1显示 (net odds)
                                try:
                                    h_val = round(float(home_odd) - 1, 2)
                                except (ValueError, TypeError):
                                    h_val = "-"
                                
                                try:
                                    a_val = round(float(away_odd) - 1, 2)
                                except (ValueError, TypeError):
                                    a_val = "-"

                                ah_data = {"val": display_line, "h": h_val, "a": a_val}
                        
                        # 大小球 Match Goals (ID: 5 or 25) - 通常 Live 用 5 或 25
                        if book['id'] in [5, 25, 36]:
                            # 找最均衡的赔率 (和为4.0左右) 或者 Main
                            # 这里简单算 abs(over_odd - 2.0) 最小的
                            best_line = None
                            min_diff = 999
                            
                            # Group by handicap
                            lines = {}
                            for v in book['values']:
                                h = v['handicap']
                                if h not in lines: lines[h] = {}
                                lines[h][v['value']] = v['odd']
                                
                            for h, odds in lines.items():
                                if 'Over' in odds and 'Under' in odds:
                                    try:
                                        diff = abs(float(odds['Over']) - 2.0)
                                        if diff < min_diff:
                                            min_diff = diff
                                            # 赔率减1显示
                                            o_display = round(float(odds['Over']) - 1, 2)
                                            u_display = round(float(odds['Under']) - 1, 2)
                                            best_line = {"line": h, "o": o_display, "u": u_display}
                                    except: pass
                            
                            if best_line:
                                ou_data = best_line

                    # 处理时间显示
                    log_algo(f"  当前比分: {goals['home']}:{goals['away']}")
                    s_short = fixture['status']['short']
                    elapsed = fixture['status']['elapsed']
                    if elapsed is None: elapsed = 0 # Sanitize elapsed time
                    
                    if s_short == 'HT':
                        display_time = "中场"
                    elif s_short == 'FT':
                        display_time = "完场"
                    elif elapsed is not None:
                        # 格式化伤停补时显示
                        if s_short == '2H' and elapsed > 90:
                            display_time = f"90+{elapsed-90}'"
                        elif s_short == '1H' and elapsed > 45:
                            display_time = f"45+{elapsed-45}'"
                        # 加时赛处理 (ET)
                        elif s_short in ['ET', 'AET']:
                            if elapsed > 120:
                                display_time = f"120+{elapsed-120}'"
                            else:
                                display_time = f"ET {elapsed}'"
                        else:
                            display_time = f"{elapsed}'"
                    else:
                        display_time = trans_status(s_short)

                    # --- Events Processing (Moved Up for Red Card Logic) ---
                    match_events = []
                    home_red_cards = 0
                    away_red_cards = 0
                    
                    raw_events = item.get('events', [])
                    if raw_events:
                        for e in raw_events:
                            t_type = e.get('type')
                            detail = e.get('detail', '')
                            if t_type == 'Goal' or (t_type == 'Card' and 'Red' in detail) or t_type == 'VAR':
                                time_min = e.get('time', {}).get('elapsed', 0)
                                player_name = e.get('player', {}).get('name', 'Unknown')
                                team_id = e.get('team', {}).get('id')
                                is_home = (team_id == teams['home']['id'])
                                
                                if t_type == 'Card' and 'Red' in detail:
                                    if is_home: home_red_cards += 1
                                    else: away_red_cards += 1
                                
                                event_type_str = "goal"
                                if t_type == 'Card': event_type_str = "red_card"
                                elif t_type == 'VAR': event_type_str = "var"

                                match_events.append({
                                    "time": time_min,
                                    "type": event_type_str,
                                    "player": player_name,
                                    "is_home": is_home,
                                    "detail": detail
                                })
                        match_events.sort(key=lambda x: x['time'], reverse=True)

                    # 解析关键字段
                    parsed_match = {
                        "id": fixture['id'],
                        "timestamp": fixture['timestamp'], # 用于排序
                        "status_short": trans_status(s_short), # 翻译状态
                        "display_time": display_time,
                        "elapsed": elapsed,    # 比赛进行分钟数
                        "home_team": trans_team(teams['home']['name']), # 翻译队名
                        "away_team": trans_team(teams['away']['name']),
                        "home_score": goals['home'],
                        "away_score": goals['away'],
                        "league": trans_league(league['name'], country=league.get('country')), # 翻译联赛
                        "country": league.get('country'),
                        "home_red_cards": home_red_cards,
                        "away_red_cards": away_red_cards,
                        "events": match_events[:5],
                        # 赔率字段
                        "odds_ah": ah_data,
                        "odds_ou": ou_data,
                    }
                    
                    # --- AI Analysis (Pre-Match + Live) ---
                    # 1. Get Pre-Match Expectations (xG)
                    ai_pre = predict_match(teams['home']['name'], teams['away']['name'])
                    
                    # 2. Advanced Live Calculation (using elapsed time & current score)
                    live_probs = pred_engine.calculate_live_odds(
                        home_prematch_exp=ai_pre['home_xg'], 
                        away_prematch_exp=ai_pre['away_xg'],
                        current_minute=elapsed if isinstance(elapsed, int) else 0,
                        current_score_home=goals['home'],
                        current_score_away=goals['away'],
                        red_cards_home=home_red_cards,
                        red_cards_away=away_red_cards
                    )
                    
                    # 3. Merge Probabilities
                    ai_pre.update(live_probs)
                    
                    # 4. Generate AI Text based on Live Probs
                    hp = live_probs['home_prob']
                    ap = live_probs['away_prob']
                    dp = live_probs['draw_prob']
                    
                    ai_text = "观察走势"
                    highlight_color = "text-gray-400"
                
                    if hp >= 60: 
                        ai_text = "主胜率高"
                        highlight_color = "text-cyber-cyan"
                    elif ap >= 60: 
                        ai_text = "客队强势"
                        highlight_color = "text-neon-purple"
                    elif hp + ap > 85: 
                        ai_text = "建议分胜负"
                        highlight_color = "text-gray-200"
                    elif dp >= 40: 
                        ai_text = "防守胶着"
                        highlight_color = "text-yellow-400"
                        
                    ai_pre['ai_prediction'] = ai_text
                    ai_pre['highlight_color'] = highlight_color
                    
                    parsed_match["ai_analysis"] = ai_pre

                    # --- 2.5 高级算法处理 ---
                    
                    # 真实数据解析 (Real Stats)
                    # 从 item['statistics'] 中提取真实比赛数据
                    # API 结构: [{team: {id: X}, statistics: [{type: 'Shots on Goal', value: 5}, ...]}, ...]
                    
                    home_stats_map = {}
                    away_stats_map = {}
                    
                    raw_stats_list = item.get('statistics', []) 
                    # 注意: 有些小比赛可能没有 statistics 数组，或者为空
                    
                    home_id = teams['home']['id']
                    away_id = teams['away']['id']
                    
                    if raw_stats_list:
                        for team_s in raw_stats_list:
                            t_id = team_s['team']['id']
                            stats_arr = team_s.get('statistics', [])
                            
                            # 转字典以便快速查找
                            # 注意 value 可能是 None 或 int 或 str (e.g. "50%")
                            s_dict = {}
                            for s in stats_arr:
                                if s['value'] is not None:
                                    s_dict[s['type']] = s['value']
                            
                            if t_id == home_id:
                                home_stats_map = s_dict
                            elif t_id == away_id:
                                away_stats_map = s_dict

                    # 辅助函数: 安全获取数值
                    def get_stat_val(s_map, key):
                        v = s_map.get(key)
                        if v is None: return 0
                        if isinstance(v, str):
                            # 处理百分比或特殊符号
                            v = v.replace('%', '')
                            try: return int(v)
                            except: return 0
                        return int(v)

                    # 构建真实统计对象
                    real_stats = {
                        "home": {
                            "dangerous_attacks": get_stat_val(home_stats_map, "Dangerous Attacks"),
                            "shots_on_target": get_stat_val(home_stats_map, "Shots on Goal"),
                            "shots_off_target": get_stat_val(home_stats_map, "Shots off Goal"),
                            "corners": get_stat_val(home_stats_map, "Corner Kicks"),
                            "possession": get_stat_val(home_stats_map, "Ball Possession"),
                            # 备用字段：如果没有 Dangerous Attacks，可以用 Total Attacks 代替吗？暂不
                        },
                        "away": {
                           "dangerous_attacks": get_stat_val(away_stats_map, "Dangerous Attacks"),
                           "shots_on_target": get_stat_val(away_stats_map, "Shots on Goal"),
                           "shots_off_target": get_stat_val(away_stats_map, "Shots off Goal"),
                           "corners": get_stat_val(away_stats_map, "Corner Kicks"),
                           "possession": get_stat_val(away_stats_map, "Ball Possession")
                        }
                    }

                    # A. 动量引擎 (喂入真实数据)
                    flat_stats = {
                        'home_da': real_stats['home']['dangerous_attacks'],
                        'home_sot': real_stats['home']['shots_on_target'],
                        'home_corners': real_stats['home']['corners'],
                        'away_da': real_stats['away']['dangerous_attacks'],
                        'away_sot': real_stats['away']['shots_on_target'],
                        'away_corners': real_stats['away']['corners']
                    }
                    log_algo(f"  动量输入: {flat_stats}")
                    h_mom, a_mom, h_press, a_press = momentum_engine.calculate_momentum(flat_stats)
                    log_algo(f"  动量输出: 主队 {h_press:.1f} 客队 {a_press:.1f}")
                    
                    # B. 动态泊松概率 (Live Pricing)
                    # 基础xG: 使用赛前 AI 预测的期望进球值 (xG)
                    # 如果没有预测成功，默认使用 1.35 (联盟平均)
                    pm_pred = parsed_match.get('ai_analysis', {})
                    base_h_xg = pm_pred.get('home_xg', 1.35)
                    base_a_xg = pm_pred.get('away_xg', 1.05) # 客队通常稍低
                    
                    pricing_model = LivePricing(base_h_xg, base_a_xg)
                    log_algo(f"  赛前xG: 主队 {base_h_xg} 客队 {base_a_xg}")
                    
                    rem_min = 90
                    if elapsed: rem_min = max(90 - elapsed, 0)
                    
                    # 1. Calculate Live Lambdas
                    lambda_h, lambda_a = pricing_model.get_remaining_xg(
                        elapsed if elapsed else 0, # minute passed
                        h_mom, a_mom
                    )
                    log_algo(f"  剩余xG: 主队 {lambda_h:.2f} 客队 {lambda_a:.2f}")
                    
                    # 2. Calculate 1x2 Probs for UI
                    prob_h, prob_d, prob_a = pricing_model.calculate_1x2_probs(
                        lambda_h, lambda_a, 
                        (goals['home'], goals['away'])
                    )
                    log_algo(f"  1X2概率: 主胜 {prob_h:.1f}% 平局 {prob_d:.1f}% 客胜 {prob_a:.1f}%")
                    
                    live_probs = {
                        "prob_home_win": prob_h,
                        "prob_draw": prob_d,
                        "prob_away_win": prob_a,
                        "lambda_home": lambda_h,
                        "lambda_away": lambda_a
                    }
                    
                    # C. 亚盘公平赔率 & 信号
                    # 获取当前盘口 (从 odds_ah.val, e.g. "-0.5")
                    try:
                        current_line_str = ah_data.get('val', '0')
                        if current_line_str != '-':
                            # 清洗数据: "+0.5" -> 0.5, "0" -> 0, "-0.5" -> -0.5
                            current_line = float(current_line_str)
                            
                            # 注意: 我们的 Pricer 接受的是 "Line for Home"，即主队让球
                            # 如果显示是 +0.5，意味着主队受让，Line = 0.5 (取决于定义)
                            # 通常显示格式："-0.5" 意味着主队让半球
                            
                            fair_odd = ah_pricer.calculate_fair_odds(
                                live_probs['lambda_home'], 
                                live_probs['lambda_away'], 
                                goals['home'] - goals['away'],
                                current_line
                            )
                            
                            # CRITICAL FIX: Use the RAW decimal odd for mathematical comparison
                            # ah_data['h'] is the display value (e.g. 0.95), we need the full odd (e.g. 1.95)
                            market_odd_raw = home_odd 
                            
                            # Lower threshold to 1% for testing visibility
                            signal = signal_gen.analyze(fair_odd, market_odd_raw, threshold=0.01)
                            
                            if signal:
                                log_algo(f"*** 发现价值注单 *** {league_cn} {home_cn} vs {away_cn} | EV: {signal['ev']}% | Fair: {fair_odd} | Mkt: {market_odd_raw}")
                                
                                # --- Auto-Save Recommendation to History ---
                                # Key: MatchID + Line (To allow multiple bets per match if line triggers differently, but avoid spamming same line)
                                # Actually, match_id + signal_type is better if we only support 'VALUE BET' type.
                                # Let's assume one recommendation per match per session for now to keep it clean.
                                rec_key = f"{fixture['id']}_{current_line}" 
                                
                                rec_record = {
                                    "key": rec_key,
                                    "match_id": fixture['id'],
                                    "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                                    "league": league_cn,
                                    "home_team": home_cn,
                                    "away_team": away_cn,
                                    "score_at_rec": f"{goals['home']}-{goals['away']}",
                                    "time_at_rec": display_time,
                                    "bet_type": f"HDP {current_line}", # e.g. "HDP -0.5"
                                    "odds": market_odd_raw,
                                    "fair_odds": fair_odd,
                                    "ev": signal['ev'],
                                    "result": "Pending" 
                                }
                                add_recommendation_record(rec_record)
                                # --------------------------------------------
                            
                            parsed_match['advanced_analytics'] = {
                                "momentum": {"home": round(h_press, 1), "away": round(a_press, 1)},
                                "fair_odds_home": fair_odd,
                                "signal": signal
                            }
                        else:
                             parsed_match['advanced_analytics'] = None
                    except Exception as e:
                        logger.warning(f"Engine calc error: {e}")
                        parsed_match['advanced_analytics'] = None


                    # Sanitize data to ensure JSON compliance (Handle NaN/Inf)
                    sanitized_match = sanitize_data(parsed_match)
                    parsed_list.append(sanitized_match)
                
                # Sort by timestamp ascending (Earliest match first - e.g. 80' shows before 10')
                parsed_list.sort(key=lambda x: x.get('timestamp', 0))

                # 更新全局缓存
                LIVE_INPLAY_CACHE = parsed_list
                ALL_ACTIVE_LEAGUES = sorted(list(current_cycle_leagues))
                logger.info(f"滚球数据更新成功: 抓取到 {len(parsed_list)} 场正在进行的比赛 (总联赛: {len(current_cycle_leagues)}, 屏蔽: {len(LEAGUE_BLOCKLIST)})")
                
            else:
                logger.error(f"滚球数据轮询失败: {response.status_code}")
                
        except Exception as e:
            logger.error(f"轮询异常: {e}")
            
        # 等待 16 秒
        await asyncio.sleep(16)

async def poll_settlement_task():
    """后台任务：定期结算未完成的记录"""
    logger.info("Starting auto-settlement background task...")
    while True:
        try:
            await settle_pending_records()
        except Exception as e:
            logger.error(f"Auto-settlement task error: {e}")
        
        # 每 2 分钟 (120 秒) 检查一次，不需要太频繁
        await asyncio.sleep(120) 

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: 启动后台任务
    task_live = asyncio.create_task(poll_live_data_task())
    task_settle = asyncio.create_task(poll_settlement_task())
    yield
    # Shutdown
    task_live.cancel()
    task_settle.cancel()


app = FastAPI(title="NeuroBall AI Backend", lifespan=lifespan)
templates = Jinja2Templates(directory="templates")

# --- DB Configuration (Switch to SQLite for portability) ---
DB_FILE = "football_data.db"

def get_db_connection():
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    return conn

# --- 新增：实时胜率展示接口 ---
@app.get("/api/live-predictions")
async def get_live_predictions():
    """
    从数据库查询正在进行的比赛即时预测结果
    前端每隔 10 秒调用一次
    """
    try:
        connection = get_db_connection()
        cursor = connection.cursor()
        
        # SQLite Query
        sql = """
        SELECT 
            match_id, league_id, start_time, 
            home_team, away_team, 
            current_home_score, current_away_score, current_minute,
            live_home_win_prob, status
        FROM matches
        WHERE status IN ('1H', '2H', 'HT', 'ET', 'BT', 'P', 'INT', 'LIVE')
        ORDER BY start_time DESC
        """
        cursor.execute(sql)
        rows = cursor.fetchall()
        
        # 为前端格式化数据
        results = []
        for r in rows:
            results.append({
                "id": r['match_id'],
                "league_id": r['league_id'],
                "time": r['current_minute'],
                "status": r['status'],
                "home_team": trans_team(r['home_team']), # 稍微尝试翻译一下队名
                "away_team": trans_team(r['away_team']),
                "home_score": r['current_home_score'],
                "away_score": r['current_away_score'],
                "live_home_win_prob": r['live_home_win_prob']
            })
                
        connection.close()
        return JSONResponse(content={"matches": results})
    except Exception as e:
        logger.error(f"Error fetching live predictions: {e}")
        return JSONResponse(content={"matches": [], "error": str(e)})

# --- 新增：算法日志接口 ---
@app.get("/api/logs")
async def get_algo_logs():
    """
    返回算法运行详细日志（最新1000条）
    """
    return JSONResponse(content={"logs": ALGO_LOGS[-1000:]})

# ================= Configuration =================
# 您的 API 配置 (API-Football.com / API-SPORTS)
API_KEY = "8b86ae86981996818bbdcafafa10717f" 
# API_KEY = "8056557685c490a60424687d4a529367" # Backup Key
API_URL = "https://v3.football.api-sports.io/fixtures"

def get_fallback_mock_data():
    # 这里我们也可以用 predict_match 来生成假数据的概率，让假数据看起来也像真的
    # 为了演示，我们生成几场假比赛
    mock_teams = [("Man City", "Arsenal"), ("Real Madrid", "Barcelona"), ("Liverpool", "Chelsea")]
    matches = []
    
    for idx, (home, away) in enumerate(mock_teams):
        m = predict_match(home, away)
        
        # 解包预测结果
        h_prob = m["home_prob"]
        d_prob = m["draw_prob"]
        a_prob = m["away_prob"]
        
        # 简单逻辑生成文案
        if h_prob >= 60:
            ai_text = "主胜稳胆"
            color = "text-cyber-cyan" 
        elif a_prob >= 50:
            ai_text = "客队突袭"
            color = "text-neon-purple"
        elif d_prob >= 30 and abs(h_prob - a_prob) < 10:
            ai_text = "防守胶着"
            color = "text-gray-400"
        else:
            ai_text = "大球机会"
            color = "text-matrix-green"

        matches.append({
            "id": idx,
            "time": "20:00", 
            "day": "Today",
            "league": "英超" if idx != 1 else "西甲", 
            "home_team": trans_team(home), 
            "away_team": trans_team(away),
            "home_prob": h_prob, 
            "draw_prob": d_prob, 
            "away_prob": a_prob,
            "ai_prediction": ai_text, 
            "highlight_color": color,
            "confidence": 9.2
        })
    return matches

# ================= Core Logic =================

def fetch_live_matches():
    """
    尝试从 API-Football (v3) 获取真实数据。
    如果失败，返回模拟数据。
    带简单缓存：60秒过期，防止频繁请求
    """
    global TODAY_SCHEDULE_CACHE
    import time
    
    current_ts = time.time()
    today_str = datetime.now().strftime("%Y-%m-%d")
    
    # Cache Check: 必须是同一天 且 缓存未过期 (60s)
    if (TODAY_SCHEDULE_CACHE["date"] == today_str and 
        TODAY_SCHEDULE_CACHE["data"] and 
        (current_ts - TODAY_SCHEDULE_CACHE["last_update"] < 60)):
        return TODAY_SCHEDULE_CACHE["data"]

    headers = {
        'x-apisports-key': API_KEY,
        'x-rapidapi-host': "v3.football.api-sports.io"
    }
    params = {'date': today_str}
    try:
        print(">>> AI 正在连接数据源 (API-Football) 并进行计算...")
        # 清除缓存强制刷新
        TODAY_SCHEDULE_CACHE["data"] = [] 
        response = requests.get(API_URL, headers=headers, params=params, timeout=5)
        if response.status_code == 200:
            data = response.json()
            matches_data = []
            match_list = data.get('response', [])
            if not match_list:
                logger.warning("API返回成功但今日无比赛。")
        else:
            logger.error(f"API请求失败: {response.status_code} - {response.text}")
            # 如果API失败，尝试返回旧缓存（如果有）
            if TODAY_SCHEDULE_CACHE["data"]:
                return TODAY_SCHEDULE_CACHE["data"]
            return []
    except Exception as e:
        logger.error(f"连接错误: {str(e)}")
        return []
            
    except Exception as e:
        logger.error(f"连接错误: {str(e)}")
        return []

# ================= Routes =================

@app.get("/")
async def read_root(request: Request):
    # matches = fetch_live_matches() # Shielded: Disable Schedule Fetching
    matches = []
    hero = {}
    return templates.TemplateResponse("index.html", {"request": request, "matches": matches, "hero": hero})

@app.get("/admin")
async def read_admin(request: Request):
    return templates.TemplateResponse("admin.html", {"request": request})

# --- 新增：API 接口查看实时数据 ---
@app.get("/api/live")
async def get_live_data():
    """
    返回最新的滚球数据缓存，以及当前所有活动联赛（含被屏蔽的）和当前屏蔽列表
    """
    # 临时修复：如果全局列表为空但有比赛数据，则从比赛数据中提取
    # 注意：这只能提取未屏蔽的联赛，但总比没有好。
    # 理想情况下 ALL_ACTIVE_LEAGUES 应该包含所有（含屏蔽的）。
    current_leagues = ALL_ACTIVE_LEAGUES
    if not current_leagues and LIVE_INPLAY_CACHE:
        current_leagues = sorted(list(set([m['league'] for m in LIVE_INPLAY_CACHE])))
        
    logger.info(f"API Request - Matches: {len(LIVE_INPLAY_CACHE)}, Leagues: {len(current_leagues)}")
    
    return {
        "count": len(LIVE_INPLAY_CACHE),
        "matches": LIVE_INPLAY_CACHE,
        "leagues": current_leagues,
        "blocked_leagues": list(LEAGUE_BLOCKLIST),
        "updated_at": datetime.now().strftime("%H:%M:%S")
    }


class FilterRequest(BaseModel):
    blocked: List[str]

@app.post("/api/set-league-filter")
async def set_league_filter(req: FilterRequest):
    """
    接收前端发送的被屏蔽联赛列表
    """
    global LEAGUE_BLOCKLIST
    LEAGUE_BLOCKLIST = set(req.blocked)
    
    # Persist change
    save_blocklist(LEAGUE_BLOCKLIST)
    
    logger.info(f"Updated League Blocklist: {len(LEAGUE_BLOCKLIST)} leagues blocked.")
    return {"status": "ok", "blocked_count": len(LEAGUE_BLOCKLIST)}



@app.post("/api/translate-cache")
async def translate_live_cache():
    """对当前 LIVE_INPLAY_CACHE 的队名和联赛进行再次汉化并返回汉化结果的副本。"""
    translated = []
    for m in LIVE_INPLAY_CACHE:
        copy = dict(m)
        try:
            copy['home_team'] = trans_team(m.get('home_team') if isinstance(m.get('home_team'), str) else m.get('home_team', ''))
            copy['away_team'] = trans_team(m.get('away_team') if isinstance(m.get('away_team'), str) else m.get('away_team', ''))
            # league may already be translated, ensure use trans_league on original if available
            copy['league'] = trans_league(m.get('league') if isinstance(m.get('league'), str) else m.get('league', ''), country=m.get('country'))
        except Exception:
            pass
        translated.append(copy)
    return {"count": len(translated), "matches": translated}

def apply_translation_to_cache():
    """将翻译应用回 LIVE_INPLAY_CACHE（覆盖原始字段）。"""
    global LIVE_INPLAY_CACHE
    new_cache = []
    for m in LIVE_INPLAY_CACHE:
        nm = dict(m)
        nm['home_team'] = trans_team(m.get('home_team') if isinstance(m.get('home_team'), str) else m.get('home_team', ''))
        nm['away_team'] = trans_team(m.get('away_team') if isinstance(m.get('away_team'), str) else m.get('away_team', ''))
        nm['league'] = trans_league(m.get('league') if isinstance(m.get('league'), str) else m.get('league', ''), country=m.get('country'))
        new_cache.append(nm)
    LIVE_INPLAY_CACHE = new_cache

@app.get("/api/history")
async def get_history_api():
    """
    获取推荐历史记录
    """
    # Sort by timestamp desc
    sorted_hist = sorted(RECOMMENDATION_HISTORY, key=lambda x: x['timestamp'], reverse=True)
    return {"count": len(sorted_hist), "history": sorted_hist}

@app.get("/api/schedule")
async def get_schedule_data():
    """
    返回今日赛程数据 (屏蔽/Disabled)
    """
    # matches = fetch_live_matches() # Uses internal cache
    # logger.info(f"API Schedule requested. Returning {len(matches)} matches.")
    matches = []
    return {
        "count": 0,
        "matches": [],
        "updated_at": datetime.now().strftime("%H:%M:%S")
    }
    logger.info(f"API Schedule requested. Returning {len(matches)} matches.")
    return {
        "count": len(matches),
        "matches": matches,
        "updated_at": datetime.now().strftime("%H:%M:%S")
    }

# 启动入口 (开发环境)
if __name__ == "__main__":
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
