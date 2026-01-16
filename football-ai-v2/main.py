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
from datetime import datetime, timedelta
from model_utils import predict_match
from prediction_engine import FootballPredictionSystem
from translation_utils import trans_team, trans_league, trans_status, LEAGUE_WHITELIST
from live_engine import PressureModel, LivePricing, AsianHandicapPricer, OverUnderPricer, SignalGenerator, TacticalInertia, TransformerMomentum, ExpectedThreatModel, LatencyGuard, KellyStaking, ConsensusOracle, TEAM_CONTEXT_DB, TEAM_STYLE_DB
from gnn_engine import GNNEngine, load_demo_graph_data
from digital_twin import DigitalTwinGym
from paper_trading import PaperTrader
from smart_money import SmartMoneyDetector
import random
import copy
import hashlib # Moved from inner loop
import time

# ================= Configuration =================
# 您的 API 配置 (API-Football.com / API-SPORTS)
API_KEY = "8b86ae86981996818bbdcafafa10717f" 
# API_KEY = "8056557685c490a60424687d4a529367" # Backup Key (Switched due to possible live odds limit)
API_URL = "https://v3.football.api-sports.io/fixtures"

# OpenWeatherMap Key (Please set via env var or replace here)
OWM_API_KEY = os.getenv("OWM_API_KEY", "a6967e0888abfd4d1cf9a629657617b5") # 填入您的 OpenWeatherMap Key


# 配置日志
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# --- Engines ---
momentum_engine = PressureModel()
inertia_engine = TacticalInertia() # New V3.0 Engine
transformer_engine = TransformerMomentum() # New Transformer Engine
gnn_engine = GNNEngine() # New Graphical Neural Network
xt_engine = ExpectedThreatModel() # New xT Spatial Engine
twin_engine = DigitalTwinGym() # New Digital Twin Simulation
latency_guard = LatencyGuard() # New Latency Protection
kelly_engine = KellyStaking(fraction=0.25) # Quarter Kelly
oracle_engine = ConsensusOracle() # New Multi-Source Consensus
paper_engine = PaperTrader(initial_bankroll=100000.0) # New Simulated Trading
pred_engine = FootballPredictionSystem()

# --- Initialize GNN with Historical Context ---
try:
    logger.info("Initializing GNN with historical match graph...")
    history_matches = load_demo_graph_data()
    gnn_engine.learn(history_matches)
    logger.info(f"GNN Learned from {len(history_matches)} matches. Teams mapped: {gnn_engine.num_teams}")
except Exception as e:
    logger.error(f"GNN Init Failed: {e}")
ah_pricer = AsianHandicapPricer()
ou_pricer = OverUnderPricer()
signal_gen = SignalGenerator()
smart_money_engine = SmartMoneyDetector()

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
ALL_ACTIVE_LEAGUES = []  # 当前API返回的所有联赛列表 (已翻译)
ALL_ACTIVE_LEAGUES_RAW = [] # 当前API返回的所有联赛列表 (Raw Dict: {name, country})
TEAM_LAST_MATCH_MAP = {} # 全局球队赛程表 (用于计算疲劳度)
NO_ODDS_TRACKER = {} # 记录无赔率比赛的持续时间 {fixture_id: start_timestamp}

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

def is_handicap_is_double(hdp_abs):
    # 3.14159 -> 0.1419
    tail = hdp_abs - int(hdp_abs)
    fraction_str = f"{tail:.2f}"
    # 0.14
    first_char = fraction_str[2]
    # 取第二个字符，得到1 
    if first_char in ['2','7']:
        first = hdp_abs - 0.25
        second = hdp_abs + 0.25
        return True,first,second
    else:
        return False,hdp_abs,0
    
def settle_one_handicap(hdp_abs,hand,final_home_score,final_away_score,bet_home_score,
                        bet_away_score,selection,score_value):
    if hand == 1:
        # 上盘 
        compare_value = hdp_abs
    elif hand == 2:
        # 下盘
        compare_value = -hdp_abs
    else:
        compare_value = 0.0

    one_detla = 0
    two_delta = 0
    if selection == "Home":
        one_detla = final_home_score - bet_home_score
        two_delta = final_away_score - bet_away_score
    else:
        one_detla = final_away_score - bet_away_score
        two_delta = final_home_score - bet_home_score
    
    delta = one_detla - two_delta

    if delta > compare_value + 0.00001:
        return score_value # win
    elif delta < compare_value - 0.00001:
        return -score_value # loss
    else:
        return 0.0 # push


def settle_one_hdp_record(rec,final_home_sore,final_away_score):
    selection = rec.get('selection', 'Home')
    hdp =  float(rec['handicap'])
    hdp_abs = round(abs(hdp), 2)
    # 这里first，second也都是正数
    is_double,first,second = is_handicap_is_double(hdp_abs)
    # hand = 0 平手盘，1上盘，2下盘
    hand = 0
    if hdp < -0.00001:
        # 主队让球
        if selection == "Home":
            # 选择主，那么就是上盘
            hand = 1
        else:
            # 选择客，那么就是下盘
            hand = 2
    elif hdp > 0.00001:
        # 客队让球
        if selection == "Home":
            # 选择主，那么就是下盘
            hand = 2
        else:
            # 选择客，那么就是上盘
            hand = 1
    else:
        # 平手盘
        hand = 0
    bet_home_score, bet_away_score = 0, 0
    if 'score_at_rec' in rec and rec['score_at_rec']:
        try:
            parts = rec['score_at_rec'].split('-')
            bet_home_score = int(parts[0])
            bet_away_score = int(parts[1])
        except: pass
    total_score = 0.0
    if is_double:
        res1 = settle_one_handicap(first,hand,final_home_sore,final_away_score,bet_home_score,bet_away_score,selection,0.5)
        res2 = settle_one_handicap(second,hand,final_home_sore,final_away_score,bet_home_score,bet_away_score,selection,0.5)
        total_score = res1 + res2
    else:
        total_score = settle_one_handicap(hdp,hand,final_home_sore,final_away_score,bet_home_score,bet_away_score,selection,1.0)   
    # total_score范围: 1.0,0.5,0.0,-0.5,-1.0
    if abs(total_score - 1.0) < 0.00001:
        rec['result'] = "Win"
    elif abs(total_score - 0.5) < 0.00001:
        rec['result'] = "Half Win"
    elif abs(total_score - 0.0) < 0.00001:
        rec['result'] = "Push"
    elif abs(total_score + 0.5) < 0.00001:
        rec['result'] = "Half Loss"
    elif abs(total_score + 1.0) < 0.00001:
        rec['result'] = "Loss"

def settle_one_ou(hdp,total_goals,selection,score_value):
    if selection == "Over":
        if total_goals > hdp + 0.00001:
            return score_value # win
        elif total_goals < hdp - 0.00001:
            return -score_value # loss
        else:
            return 0.0 # push
    else:
        if total_goals < hdp - 0.00001:
            return score_value # win
        elif total_goals > hdp + 0.00001:
            return -score_value # loss
        else:
            return 0.0 # push

def settle_one_ou_record(rec,final_home_sore,final_away_score):
    selection = rec.get('selection', 'Under')
    # 大小盘的handicap是正数
    hdp =  float(rec['handicap'])
    is_double,first,second = is_handicap_is_double(hdp)
    total_goals = final_home_sore + final_away_score
    if is_double:
        res1 = settle_one_ou(first,total_goals,selection,0.5)
        res2 = settle_one_ou(second,total_goals,selection,0.5)
        total_score = res1 + res2
    else:
        total_score = settle_one_ou(hdp,total_goals,selection,1.0)
    if abs(total_score - 1.0) < 0.00001:
        rec['result'] = "Win"
    elif abs(total_score - 0.5) < 0.00001:
        rec['result'] = "Half Win"
    elif abs(total_score - 0.0) < 0.00001:
        rec['result'] = "Push"
    elif abs(total_score + 0.5) < 0.00001:
        rec['result'] = "Half Loss"
    elif abs(total_score + 1.0) < 0.00001:
        rec['result'] = "Loss"

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
            # Optimize: Run blocking IO in executor
            loop = asyncio.get_event_loop()
            resp = await loop.run_in_executor(None, lambda: requests.get(url, headers=headers, timeout=10))
            
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
                        
                        # 1. 优先记录比分 (无论结算是否成功)
                        h_s = score['home']
                        a_s = score['away']
                        if h_s is None or a_s is None:
                            continue # 数据不完整，跳过

                        rec['final_score'] = f"{h_s}-{a_s}"
                        rec['settled_at'] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                        dirty = True

                        try:
                            if '主' in rec['bet_type'] or '客' in rec['bet_type'] or '平' in rec['bet_type']:
                                settle_one_hdp_record(rec,h_s,a_s)
                                selection = rec.get('selection', 'Home')
                                res = rec['result']
                                line = float(rec['handicap'])
                                start_h, start_a = 0, 0
                                if 'score_at_rec' in rec and rec['score_at_rec']:
                                    try:
                                        parts = rec['score_at_rec'].split('-')
                                        start_h = int(parts[0])
                                        start_a = int(parts[1])
                                    except: pass
                                logger.info(f"Settled {rec.get('key')} [{selection} {line}]: BetScore {start_h}-{start_a}. FinScore={h_s}-{a_s} => {res}")
                                
                                # --- Online Learning (RL) ---
                                if 'snapshot' in rec:
                                    learn_val = 0
                                    if res == 'Win': learn_val = 1
                                    elif res == 'Half Win': learn_val = 0.5
                                    elif res == 'Loss': learn_val = -1
                                    elif res == 'Half Loss': learn_val = -0.5
                                    
                                    if learn_val != 0:
                                        if selection == 'Home':
                                            algo_log = momentum_engine.learn(learn_val, rec['snapshot'], is_home_bet=True)
                                        else:
                                            algo_log = momentum_engine.learn(learn_val, rec['snapshot'], is_home_bet=False)
                                        # logger.info(f"Updated Model Weights: {algo_log}")
                            
                            # 简单的 O/U 扩展 (以备后续使用)
                            elif 'Over' in rec['bet_type'] or 'Under' in rec['bet_type'] or 'O/U' in rec['bet_type']:
                                # 假设格式: "Over 2.5" / "Under 2.5"
                                settle_one_ou_record(rec,h_s,a_s)
                                res = rec['result'] 
                                logger.info(f"Settled bet {rec['key']} ({rec['bet_type']}) with Score {h_s}-{a_s} -> {res}")

                        except Exception as e:
                            logger.error(f"Settlement calc error for {rec['key']}: {e}")
                
                # --- Paper Trading Settlement ---
                # Also settle anything in paper trader for these matches
                for m in data:
                    fid = m['fixture']['id']
                    if fid in finished_map:
                         # Settle simulating orders
                         paper_engine.settle_match(
                             fid, 
                             finished_map[fid]['home'],
                             finished_map[fid]['away']
                         )
            
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

# --- Referee & Injury Helpers ---
def get_referee_stats_mock(referee_name):
    """
    Mock function to simulate referee strictness based on name hash.
    returns: strictness (0-10, high is strict), avg_cards
    """
    if not referee_name:
        return {"strictness": 5.0, "avg_cards": 3.5}
    
    # Deterministic hash to ensure same referee always gets same stats
    hash_val = int(hashlib.md5(referee_name.encode('utf-8')).hexdigest(), 16)
    
    # Simulate strictness between 3.0 and 9.0
    strictness = 3.0 + (hash_val % 60) / 10.0
    
    # Simulate avg cards (strictness correlated roughly)
    avg_cards = 2.0 + (hash_val % 40) / 10.0
    
    return {"strictness": round(strictness, 1), "avg_cards": round(avg_cards, 1)}

async def fetch_injuries(fixture_id, session):
    """
    Fetch confirmed injuries for a specific fixture from API-Sports.
    Rate Limit Aware: Should be cached.
    """
    # Base URL is usually /fixtures, need root
    base_url = "https://v3.football.api-sports.io"
    url = f"{base_url}/injuries?fixture={fixture_id}"
    
    try:
        loop = asyncio.get_event_loop()
        resp = await loop.run_in_executor(None, lambda: session.get(url, timeout=5))
        
        if resp.status_code == 200:
            data = resp.json().get('response', [])
            # Parse simple list: "Player Name (Team) - Reason"
            injuries = []
            for item in data:
                p_name = item['player']['name']
                t_id = item['team']['id']
                reason = item['player']['reason']
                injuries.append({'name': p_name, 'team_id': t_id, 'reason': reason})
            return injuries
    except Exception as e:
        logger.error(f"Injury fetch failed for {fixture_id}: {e}")
    return []

# --- Background Task: Historical Data Fetcher (GNN Init) ---
def fetch_and_train_gnn():
    """
    启动时运行：抓取过去 90 天的真实比赛数据来训练 GNN
    """
    logger.info(">>> 正在抓取历史数据构建 GNN 知识图谱 (Last 90 Days)...")
    
    # Calculate dates
    today = datetime.now()
    past_date = today - timedelta(days=90)
    
    date_from = past_date.strftime("%Y-%m-%d")
    date_to = today.strftime("%Y-%m-%d")
    
    # API Call: Fixtures from date_from to date_to
    # Note: API-Sports allows filtering by date range but usually separate endpoint per date or league.
    # For simplicity in this 'Live' system, accessing /fixtures?from=X&to=Y is standard but heavy.
    # We will fetch Top Leagues only to save requests if quota limited.
    # For now, let's try a wide fetch or just use the demo loader if API fails.
    
    headers = {
        'x-apisports-key': API_KEY,
        'x-rapidapi-host': "v3.football.api-sports.io"
    }
    
    # List of Major League IDs to train on (Premier League, La Liga, Bundesliga, Serie A, Ligue 1)
    # 2023/2024 season IDs (Approximate, need clear IDs in real usage)
    # Using 'status=FT' (Finished)
    
    # DEMO MODE SWITCH:
    # Real fetching might exhaust quota on startup. 
    # We will simulate the "Action" of fetching but stick to Demo Data + Extended Mock Data 
    # unless you explicitly want to burn 10-20 API calls here.
    
    # For safety, I will stick to an Extended Offline Dataset for now, 
    # but the structure is here to uncomment the requests.
    
    real_matches = []
    
    # --- ACTIVE REAL FETCH (Authorized) ---
    # Fetch last 3 days of results to update Team Strength dynamically
    # This ensures the GNN knows about very recent upsets
    
    logger.info("  (GNN) Connecting to API-Sports for recent results (Last 3 Days)...")
    try:
        dates_to_fetch = [today - timedelta(days=i) for i in range(1, 4)] # Last 3 days
        for d in dates_to_fetch:
           d_str = d.strftime("%Y-%m-%d")
           url = "https://v3.football.api-sports.io/fixtures"
           params = {"date": d_str, "status": "FT"}
           
           # Filter for Major Leagues to save bandwidth/processing if needed, or get all
           # For GNN global connectivity, getting all carries value.
           resp = requests.get(url, headers=headers, params=params, timeout=10)
           
           if resp.status_code == 200:
               data = resp.json().get('response', [])
               logger.info(f"    - Fetched {len(data)} matches for {d_str}")
               
               for f in data:
                   # Standardize result
                   h_g = f['goals']['home']
                   a_g = f['goals']['away']
                   if h_g is None or a_g is None: continue
                   
                   res = 'draw'
                   if h_g > a_g: res = 'home_win'
                   elif a_g > h_g: res = 'away_win'
                   
                   real_matches.append({
                       'home': f['teams']['home']['name'],
                       'away': f['teams']['away']['name'],
                       'result': res,
                       'date': d_str
                   })
           else:
               logger.warning(f"    - Failed to fetch {d_str}: {resp.status_code}")
               
    except Exception as e:
        logger.error(f"  (GNN) Real Data Fetch Failed: {e}")
    
    # Fallback/Base to extended demo data (Legacy Knowledge)
    logger.info("  (GNN) Loading Base Knowledge Graph (Historical)...")
    from gnn_engine import load_demo_graph_data
    base_matches = load_demo_graph_data() 
    
    # Merge: Real recent data overrides or augments base data
    # GNN handles duplicates naturally by reinforcing edges or creating multigraphs
    all_matches = base_matches + real_matches
    
    # 注入 GNN
    gnn_engine.learn(all_matches)
    logger.info(f">>> GNN 训练完成. Total Nodes: {gnn_engine.num_teams} (Base: {len(base_matches)} + Recent: {len(real_matches)})")
    
    # [NEW] Build Schedule Map for Fatigue Calculation
    # Map: TeamName -> LastMatchDate (datetime)
    # This allows O(1) lookup to see if a team played recently
    global TEAM_LAST_MATCH_MAP
    TEAM_LAST_MATCH_MAP = {}
    
    # Sort matches by date ascending so we end with the latest match
    # Note: base_matches might not have dates, so we rely on real_matches for the critical recent history
    for m in real_matches:
        d_str = m.get('date')
        if d_str:
            try:
                dt = datetime.strptime(d_str, "%Y-%m-%d")
                TEAM_LAST_MATCH_MAP[m['home']] = dt
                TEAM_LAST_MATCH_MAP[m['away']] = dt
            except: pass
            
    logger.info(f">>> Created Schedule Map for {len(TEAM_LAST_MATCH_MAP)} teams.")

# --- Background Task: 16s Polling ---
async def poll_live_data_task():
    """
    后台任务：每16秒轮询一次 API获取滚球数据 (In-Play)
    每天早上6点30分停止抓取数据，中午12点30分开始抓取数据
    """
    global LIVE_INPLAY_CACHE, ALL_ACTIVE_LEAGUES, ALL_ACTIVE_LEAGUES_RAW, TEAM_LAST_MATCH_MAP, NO_ODDS_TRACKER
    
    # Initialize a persistent session for polling
    # This keeps TCP connections alive and prevents port exhaustion
    session = requests.Session()
    session.headers.update({
        'x-apisports-key': API_KEY,
        'x-rapidapi-host': "v3.football.api-sports.io"
    })
    
    # Cache for static match data (Lineups, Managers, Venues) to avoid repeat fetching
    # Structure: { fixture_id: { 'data': ..., 'fetched_at': datetime } }
    STATIC_DATA_CACHE = {}
    
    while True:
        # --- Time Window Check ---
        now = datetime.now()
        current_time = now.time()
        
        # Define objects for comparison
        stop_time = datetime.strptime("06:30", "%H:%M").time()
        start_time = datetime.strptime("12:30", "%H:%M").time()
        
        # If current time is between 06:30 and 12:00, sleep
        if stop_time <= current_time < start_time:
            logger.info(f">>> 休眠模式 (06:30-12:30). 当前: {current_time.strftime('%H:%M')}. 停止数据抓取.")
            LIVE_INPLAY_CACHE.clear() # Optional: Clear cache to avoid stale data display
            await asyncio.sleep(60) # Check every 60 seconds
            continue
            
        try:
            logger.info(">>> 正在轮询滚球数据 (16s interval)...")
            # Reuse session for requests
            
            # live=all 获取所有正在进行的比赛
            loop = asyncio.get_event_loop()
            response = await loop.run_in_executor(None, lambda: session.get(f"{API_URL}?live=all", timeout=10))
            
            # 同时并行获取赔率数据 (Multi-Source Fetching)
            # 1. Bet365 (Market Maker)
            # 4. Pinnacle (Sharp Money / Shadow Oracle)
            odds_map = {} # Primary (Bet365)
            shadow_odds_map = {} # Secondary (Pinnacle)
            
            try:
                # Launch parallel requests for mult-bookmaker consensus
                # Increased timeout to 15s because odds payload can be large
                odds_tasks = [
                    loop.run_in_executor(None, lambda: session.get("https://v3.football.api-sports.io/odds/live", timeout=15)),
                    loop.run_in_executor(None, lambda: session.get("https://v3.football.api-sports.io/odds/live?bookmaker=4", timeout=15))
                ]
                
                # Wait for both (return_exceptions=True prevents one failure from crashing the other)
                odds_results = await asyncio.gather(*odds_tasks, return_exceptions=True)
                
                # Process Primary (Bet365)
                if isinstance(odds_results[0], requests.Response):
                     if odds_results[0].status_code == 200:
                        json_resp = odds_results[0].json()
                        data_365 = json_resp.get('response', [])
                        logger.info(f"DEBUG: Odds (Bet365) response items: {len(data_365)}")
                        if len(data_365) == 0:
                            logger.warning(f"DEBUG: Odds Response Body (Empty Results): {json_resp}")
                        for o in data_365:
                            odds_map[o['fixture']['id']] = o['odds']
                        # logger.info(f">>> Fetched {len(odds_map)} odds from Bet365")
                     else:
                        logger.warning(f"Bet365 Odds Fetch Failed: {odds_results[0].status_code} | Body: {odds_results[0].text[:200]}")
                elif isinstance(odds_results[0], Exception):
                     logger.warning(f"Bet365 Odds Fetch Exception: {odds_results[0]}")
                        
                # Process Secondary (Pinnacle)
                if isinstance(odds_results[1], requests.Response):
                     if odds_results[1].status_code == 200:
                        data_pin = odds_results[1].json().get('response', [])
                        for o in data_pin:
                            shadow_odds_map[o['fixture']['id']] = o['odds']
                        
                        if len(shadow_odds_map) > 0:
                            logger.info(f">>> Consensus Oracle Active: Captured {len(shadow_odds_map)} sharp lines from Pinnacle.")
                     else:
                        pass # Secondary failing is fine


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
                current_cycle_leagues_raw = [] # 收集本轮所有联赛(原始信息)
                
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
                    fixture_id = fixture['id']
                    teams = item['teams']
                    league = item['league']
                    
                    # [Pre-Calculate Translation] Fix NameError in Red Card / Momentum logs
                    home_cn = trans_team(teams['home']['name'])
                    away_cn = trans_team(teams['away']['name'])
                    league_cn = trans_league(league['name'], country=league.get('country'))

                    # Sanitize Goals (Prevent NoneType arithmetic errors)
                    raw_goals = item.get('goals', {})
                    goals = {
                        'home': raw_goals.get('home') if raw_goals.get('home') is not None else 0,
                        'away': raw_goals.get('away') if raw_goals.get('away') is not None else 0
                    }

                    # --- Odds Extraction & Smart Money Analysis & Consensus Check ---
                    live_odds = odds_map.get(fixture_id, [])
                    shadow_odds = shadow_odds_map.get(fixture_id, []) # Pinnacle Odds
                    
                    # Find main market (Full Time Result, ID=1 usually)
                    current_odds_dict = {}
                    winner_market = next((mk for mk in live_odds if mk['id'] == 1), None)
                    if winner_market:
                        for selection in winner_market['values']:
                             if selection['value'] == 'Home': current_odds_dict['home'] = float(selection['odd'])
                             elif selection['value'] == 'Away': current_odds_dict['away'] = float(selection['odd'])
                             elif selection['value'] == 'Draw': current_odds_dict['draw'] = float(selection['odd'])

                    # Shadow Odds Extraction for Consensus
                    shadow_odds_dict = {}
                    if shadow_odds:
                        sh_winner = next((mk for mk in shadow_odds if mk['id'] == 1), None)
                        if sh_winner:
                            for selection in sh_winner['values']:
                                if selection['value'] == 'Home': shadow_odds_dict['home'] = float(selection['odd'])
                                elif selection['value'] == 'Away': shadow_odds_dict['away'] = float(selection['odd'])
                    
                    # Run Consensus Check
                    if current_odds_dict and shadow_odds_dict:
                        # Construct packets for oracle
                        primary_pkt = {'goals': goals, 'odds': current_odds_dict}
                        secondary_pkt = {'goals': goals, 'odds': shadow_odds_dict}
                        
                        # Note: Oracle.validate currently checks Score consistency. 
                        # Ideally we extend it to check Price consistency (Arbitrage detection)
                        # For now, we just Log the Sharp Line comparison
                        
                        # arbitrage check: If Bet365 Home > Pinnacle Home * 1.05 -> Massive Value? 
                        # Or if Pinnacle implies Home Prob is 60% but 365 says 50% -> Value.
                        log_algo(f"  [Oracle] {home_cn} Odds: 365@{current_odds_dict.get('home')} vs Pin@{shadow_odds_dict.get('home')}")
                        
                        # Inject Shadow Odds into Cache for frontend to see "Sharp Money" sentiment
                        item['shadow_odds'] = shadow_odds_dict

                    smart_money_signal = None
                    if current_odds_dict:
                        score_str = f"{goals['home']}-{goals['away']}"
                        elapsed = fixture.get('status', {}).get('elapsed', 0)
                        
                        # Updated: Pass shadow_odds (Pinnacle) to SmartMoneyDetector
                        smart_money_signal = smart_money_engine.track(
                            fixture_id, 
                            current_odds_dict, 
                            score_str, 
                            elapsed,
                            shadow_odds=shadow_odds_dict # New Parameter
                        )
                        
                        if smart_money_signal:
                            logger.info(f"!!! SMART MONEY DETECTED [{fixture_id}]: {smart_money_signal}")
                            # Tag the match object for Frontend Alert
                            item['smart_money'] = smart_money_signal

                    # --- Tactical Inertia Update & Events Processing ---
                    # 解析红牌数据 (Red Cards Parsing)
                    # API-Sports 的 live=all 接口在某些套餐下包含 events 字段
                    # Fixed: Consolidate event parsing logic and fix Second Yellow Card bug
                    
                    red_home = 0
                    red_away = 0
                    match_events = [] # For Frontend Display
                    
                    # Store current match vars for Fatigue Calc later
                    # Fixed: Removed unused local variables h_name/a_name
                    
                    if 'events' in item and item['events']:
                        raw_events = item['events']
                        for ev in raw_events:
                            t_type = ev.get('type')
                            detail = ev.get('detail')
                            
                            # 1. Red Card Logic (Include Second Yellow)
                            is_red = False
                            if t_type == 'Card':
                                if detail == 'Red Card': is_red = True
                                elif detail == 'Second Yellow card': is_red = True
                            
                            if is_red:
                                if ev['team']['id'] == teams['home']['id']:
                                    red_home += 1
                                elif ev['team']['id'] == teams['away']['id']:
                                    red_away += 1
                                
                            # 2. Build Event List for Frontend
                            if t_type == 'Goal' or is_red or t_type == 'VAR':
                                time_min = ev.get('time', {}).get('elapsed', 0)
                                player_name = ev.get('player', {}).get('name', 'Unknown')
                                team_id = ev.get('team', {}).get('id')
                                is_h_ev = (team_id == teams['home']['id'])
                                
                                event_type_str = "goal"
                                if is_red: event_type_str = "red_card"
                                elif t_type == 'VAR': event_type_str = "var"

                                match_events.append({
                                    "time": time_min,
                                    "type": event_type_str,
                                    "player": player_name,
                                    "is_home": is_h_ev,
                                    "detail": detail
                                })
                        
                        # Sort by time desc
                        match_events.sort(key=lambda x: x['time'], reverse=True)
                    
                    if red_home > 0 or red_away > 0:
                        log_algo(f"Red Card Detected! Home: {red_home}, Away: {red_away} (Match: {home_cn} vs {away_cn})")
                    
                    
                    # --- LIVE STATS INJECTION & MOMENTUM ---
                    # Note: We perform detailed stats parsing and Momentum/Transformer calculation 
                    # further down in the "Advanced Algorithm" section (approx line 1100).
                    # This prevents duplicate state updates and redundant processing.
                    # Reference: See 'real_stats' parsing below.
                    
                    inertia_engine.update_state(fixture_id, goals['home'], goals['away'], red_home, red_away)

                    # 0. 联赛白名单过滤 (已废弃，改为黑名单逻辑)
                    # league_cn is already defined at top of loop
                    current_cycle_leagues.add(league_cn)
                    
                    # Store Raw info for real-time translation fallback
                    # Use a unique key to prevent duplicates
                    raw_key = f"{league['name']}_{league.get('country')}"
                    if not any(f"{x['name']}_{x.get('country')}" == raw_key for x in current_cycle_leagues_raw):
                        current_cycle_leagues_raw.append({'name': league['name'], 'country': league.get('country')})
                    
                    if league_cn in LEAGUE_BLOCKLIST:
                         continue

                    # --- LINEUPS & INJURIES (Once per match, cached) ---
                    # 关键球员对于 xG 的影响巨大。我们在首次遇到该比赛时抓取阵容和伤停。
                    # Limit to top leagues to save API calls
                    is_top_league = league_cn in ["英超", "西甲", "德甲", "意甲", "法甲", "欧冠"]
                    
                    home_missing_keys = False
                    away_missing_keys = False
                    
                    if is_top_league:
                        # Ensure sub-dict exists
                        if fixture_id not in STATIC_DATA_CACHE:
                             STATIC_DATA_CACHE[fixture_id] = {'fetched_at': datetime.now()}

                        # 1. Lineups
                        if 'lineups' not in STATIC_DATA_CACHE[fixture_id]:
                            logger.info(f"  [Lineups] Fetching lineups for {home_cn} vs {away_cn}...")
                            try:
                                # Run in executor to not block loop
                                l_url = f"{API_URL}/lineups?fixture={fixture_id}"
                                # Use new session or existing
                                l_resp = await loop.run_in_executor(None, lambda: requests.get(l_url, headers=session.headers, timeout=5))
                                
                                if l_resp.status_code == 200:
                                    l_data = l_resp.json().get('response', [])
                                    STATIC_DATA_CACHE[fixture_id]['lineups'] = l_data
                                else:
                                    STATIC_DATA_CACHE[fixture_id]['lineups'] = None # Mark tried
                            except Exception as le:
                                logger.error(f"  [Lineups] Failed: {le}")
                        
                        # 2. Injuries (New)
                        if 'injuries' not in STATIC_DATA_CACHE[fixture_id]:
                            logger.info(f"  [Injuries] Fetching injuries for {home_cn} vs {away_cn}...")
                            try:
                                # fetch_injuries is async
                                inj_data = await fetch_injuries(fixture_id, session)
                                STATIC_DATA_CACHE[fixture_id]['injuries'] = inj_data
                            except Exception as ie:
                                logger.error(f"  [Injuries] Failed: {ie}")
                                STATIC_DATA_CACHE[fixture_id]['injuries'] = []

                    # 检查 Cache for Key Player Absence (If fetched)
                    if fixture_id in STATIC_DATA_CACHE and STATIC_DATA_CACHE[fixture_id].get('lineups'):
                         # TODO: Implement granular checking. 
                         pass
                         
                    # home_cn/away_cn already defined at top of loop
                    log_algo(f"处理比赛: {league_cn} {home_cn} vs {away_cn}")
                    # 检查联赛为英超但队名不是英超球队，输出警告日志
                    ENGLISH_PREMIER_TEAMS = {
                        "曼城", "阿森纳", "利物浦", "阿斯顿维拉", "热刺", "切尔西", "曼联", "纽卡斯尔", "西汉姆联", "布莱顿", "布伦特福德", "水晶宫", "狼队", "富勒姆", "伯恩茅斯", "埃弗顿", "诺丁汉森林", "卢顿", "伯恩利", "谢菲联", "莱斯特城", "利兹联", "南安普顿"
                    }
                    if league_cn == "英超" and (home_cn not in ENGLISH_PREMIER_TEAMS or away_cn not in ENGLISH_PREMIER_TEAMS):
                        warn_msg = f"[警告] 联赛被识别为英超，但队伍为：{teams['home']['name']} vs {teams['away']['name']}，请检查联赛映射或数据源！(league_en={league['name']})"
                        log_algo(warn_msg)
                        # 自动收集到本地文件，便于后续批量修正
                        pass # Performance: Disabled file I/O
                    
                    # 赔率处理
                    match_odds = odds_map.get(fixture['id'], [])
                    
                    # [Modify] 不要因为没有赔率就跳过比赛，否则小联赛会消失
                    # if not match_odds:
                    #      # 仅在比赛进行中且无赔率时记录
                    #      if fixture['status']['short'] in ['1H', '2H', 'HT']:
                    #          log_algo(f"[无赔率源] {league_cn} | {home_cn} vs {away_cn} (API未返回Odds). 跳过此赛事.")
                    #      # 用户要求：如果没有赔率数据，则不显示该赛事
                    #      continue
                    
                    # 智能屏蔽逻辑: 如果连续5分钟(300s)没有赔率数据，则暂时屏蔽该比赛
                    if not match_odds:
                        now_ts = time.time()
                        if fixture_id not in NO_ODDS_TRACKER:
                            NO_ODDS_TRACKER[fixture_id] = now_ts
                        
                        duration_missing = now_ts - NO_ODDS_TRACKER[fixture_id]
                        if duration_missing > 300: # 5分钟
                            # 仅在刚超时的时候记录日志，避免刷屏
                            if duration_missing < 320:
                                log_algo(f"[无赔率超时] {league_cn} | {home_cn} vs {away_cn} 连续5分钟无数据，暂时隐藏。")
                            continue # 跳过，不添加到 parsed_list
                    else:
                        # 有数据了，重置计时器
                        if fixture_id in NO_ODDS_TRACKER:
                            # log_algo(f"[数据恢复] {home_cn} vs {away_cn} 赔率已恢复。")
                            del NO_ODDS_TRACKER[fixture_id]


                    # 通用自动收集和建议补全机制，支持任意自定义字段
                    pass # Performance: Disabled file I/O
                    # 自动收集未被汉化的比赛状态、事件类型、盘口类型等字段
                    pass # Performance: Disabled file I/O
                    # 自动收集未被汉化的联赛名，便于批量补全 LEAGUE_MAP
                    pass # Performance: Disabled file I/O
                    # 自动收集未被汉化的队名，便于批量补全 TEAM_MAP
                    pass # Performance: Disabled file I/O
                    
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
                                    display_line = str(raw_line) if raw_line is not None else "-"
                                
                                # 赔率减1显示 (net odds)
                                # Fixed: home_odd/away_odd might be unreferenced if exception occurs above
                                # Initialize them with defaults or move try block
                                try:
                                    if 'home_odd' in locals():
                                         h_val = round(float(home_odd) - 1, 2)
                                    else: h_val = "-"
                                except (ValueError, TypeError):
                                    h_val = "-"
                                
                                try:
                                    if 'away_odd' in locals():
                                        a_val = round(float(away_odd) - 1, 2)
                                    else: a_val = "-"
                                except (ValueError, TypeError):
                                    a_val = "-"

                                ah_data = {"val": display_line, "h": h_val, "a": a_val}
                        
                        # 大小球 Match Goals (ID: 5 or 25) - 通常 Live 用 5 或 25
                        if book['id'] in [5, 25, 36]:
                            # 找最均衡的赔率 (和为4.0左右) 或者 Main
                            # 这里简单算 abs(over_odd - 2.0) 最小的
                            best_line = None
                            min_diff = 999
                            
                            # Group by handicap (Robust)
                            lines = {}
                            for v in book['values']:
                                try:
                                    raw_val = str(v.get('value', ''))
                                    target_h = v.get('handicap')
                                    tag = None
                                    
                                    if "Over" in raw_val: tag = "Over"
                                    elif "Under" in raw_val: tag = "Under"
                                    
                                    if not target_h and tag:
                                        parts = raw_val.split(' ')
                                        for p in parts:
                                            try:
                                                float(p)
                                                target_h = p
                                            except: continue
                                    
                                    if tag and target_h:
                                        h_key = str(float(target_h))
                                        if h_key not in lines: lines[h_key] = {}
                                        lines[h_key][tag] = v['odd']
                                except: continue
                                
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
                                log_algo(f"  [OU DEBUG] Found Line {best_line['line']} | O:{best_line['o']} U:{best_line['u']}")

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

                    # --- Events Processing (Already done above) ---
                    # match_events, home_red_cards(red_home), away_red_cards(red_away) populated
                    home_red_cards = red_home
                    away_red_cards = red_away
                    
                    # --- Multi-Source Consensus Check (The Oracle Problem) ---
                    # 模拟一个 "影子数据源" (Secondary Feed)
                    # 实际场景：这里应该调用另一个 API (e.g. FlashScore Scraper)
                    shadow_source = copy.deepcopy(item) # Clone primary
                    
                    # [Removed] Chaos Monkey Simulation (Random Data Conflict) for Production Stability
                    # if random.random() < 0.005: ...

                    # 验证共识
                    validated_item, trust_status = oracle_engine.validate(fixture['id'], item, shadow_source)
                    
                    if trust_status == "CONFLICT_SCORE":
                        log_algo(f"💀 预言机严重警报: 多源比分不一致! 主源[{goals['home']}-{goals['away']}] 影子[{shadow_source['goals']['home']}-{shadow_source['goals']['away']}]")
                        # Fixed: parsed_match not defined yet. Construct minimal error object.
                        error_match = {
                            "id": fixture['id'],
                            "timestamp": fixture['timestamp'],
                            "home_team": trans_team(teams['home']['name']),
                            "away_team": trans_team(teams['away']['name']),
                            "league": league_cn,
                            "ai_analysis": {
                                "ai_prediction": "数据冲突",
                                "highlight_color": "text-red-600"
                            },
                             "oracle_alert": "DATA CONFLICT",
                             "status_short": "ERR",
                             "display_time": "Error"
                        }
                        parsed_list.append(error_match)
                        continue
                    
                    if trust_status == "SINGLE_SOURCE":
                        # Log warning but proceed
                         pass

                    # Ref Info w/ Mock Stats
                    ref_name = fixture.get('referee')
                    ref_data = get_referee_stats_mock(ref_name)
                    
                    # Injuries from Cache
                    inj_list = STATIC_DATA_CACHE.get(fixture_id, {}).get('injuries', [])

                    # 解析关键字段 (Proceed with Validated Item)
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
                        # Ref info
                        "referee": ref_name,
                        "referee_stats": ref_data,
                        "injuries": inj_list
                    }
                    
                    # --- AI Analysis (Pre-Match + Live) ---
                    # 1. Get Pre-Match Expectations (xG)
                    ai_pre = predict_match(teams['home']['name'], teams['away']['name'])
                    
                    # [NEW] Fatigue & Referee Logic (Unified)
                    # 1. Fatigue Logic (Shared Variables)
                    real_home_fatigue = 0.0 # 0.0 = Fresh, 0.1 = Tired, 0.3 = Exhausted
                    real_away_fatigue = 0.0
                    
                    if 'TEAM_LAST_MATCH_MAP' in globals():
                        try:
                             today_date = datetime.now()
                             # Home Check
                             # Fix: Use English name for Map lookup (Map keys are English)
                             t_h_name_en = teams['home']['name']
                             if t_h_name_en in TEAM_LAST_MATCH_MAP:
                                  delta_days = (today_date - TEAM_LAST_MATCH_MAP[t_h_name_en]).days
                                  if 0 < delta_days < 3: real_home_fatigue = 0.3
                                  elif 0 < delta_days < 5: real_home_fatigue = 0.1
                             
                             # Away Check
                             t_a_name_en = teams['away']['name']
                             if t_a_name_en in TEAM_LAST_MATCH_MAP:
                                  delta_days = (today_date - TEAM_LAST_MATCH_MAP[t_a_name_en]).days
                                  if 0 < delta_days < 3: real_away_fatigue = 0.3
                                  elif 0 < delta_days < 5: real_away_fatigue = 0.1
                        except Exception as fe:
                             logger.warning(f"Fatigue calc error: {fe}")

                    # Convert to Multiplier for Prediction Engine (1.0 = Fresh)
                    f_home = 1.0 - real_home_fatigue
                    f_away = 1.0 - real_away_fatigue

                    ref_factor = 0.0
                    # Use calculated mock stats
                    if ref_data:
                        # 0-10 Scale. >7.5 Strict (-Goals, More Cards), <3.5 Loose (+Goals, Less Cards)
                        s = ref_data['strictness']
                        if s > 7.5: ref_factor = -0.15 # Strict ref suppresses goals
                        elif s < 3.5: ref_factor = 0.15 # Loose ref allows more flow
                    
                    # 2. Advanced Live Calculation (using elapsed time & current score)
                    live_probs = pred_engine.calculate_live_odds(
                        home_prematch_exp=ai_pre['home_xg'], 
                        away_prematch_exp=ai_pre['away_xg'],
                        current_minute=elapsed if isinstance(elapsed, int) else 0,
                        current_score_home=goals['home'],
                        current_score_away=goals['away'],
                        red_cards_home=home_red_cards,
                        red_cards_away=away_red_cards,
                        ref_factor=ref_factor,
                        fatigue_home=f_home,
                        fatigue_away=f_away
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
                    
                    # Inject Smart Money Signal if any
                    if smart_money_signal:
                        parsed_match["smart_money"] = smart_money_signal
                        # Also upgrade priority if HIGH
                        if smart_money_signal['level'] == 'HIGH':
                            parsed_match['priority_score'] = 999 

                    # --- Latency & Freeze Check ---
                    # 检查是否因为进球或数据延迟需要暂停分析
                    # Use 'timestamp' from fixture which is updated time usually
                    # But API returns fixture.timestamp as Kickoff time usually. 
                    # We need "League Updated" or current fetch time. 
                    # Assuming data is reasonably fresh from poll loop roughly "now"
                    # We use system time as data_ts for freshness (since we just fetched it)
                    # But critical check is Score Change Freeze
                    
                    is_safe, safety_msg = latency_guard.check_safety(
                        fixture['id'], 
                        (goals['home'], goals['away']), 
                        time.time() # Assuming fetch is recent
                    )
                    
                    if not is_safe:
                        log_algo(f"🛑 延迟保护触发: 比赛[{fixture['id']}] {safety_msg}")
                        parsed_match["ai_analysis"]["ai_prediction"] = "数据冻结"
                        parsed_match["ai_analysis"]["highlight_color"] = "text-red-500"
                        # Create a dummy/empty analysis result to block trading signals
                        # We still want to see the match, just not the signals
                        parsed_match["latency_alert"] = safety_msg
                    
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

                    # [Simulation Fallback] If real stats empty (Common in lower leagues), generate mock stats
                    # based on score/time to drive the engines (Momentum/xT) instead of 0
                    if real_stats['home']['dangerous_attacks'] == 0 and real_stats['away']['dangerous_attacks'] == 0:
                        elapsed_sim = elapsed if elapsed else 0
                        # Base: 0.8 DA/min
                        base_da = int(elapsed_sim * 0.8)
                        base_sot = int(elapsed_sim * 0.1)
                        
                        # Add randomness & score bias
                        import random
                        real_stats['home']['dangerous_attacks'] = base_da + random.randint(0, 5) + (goals['home']*2)
                        real_stats['away']['dangerous_attacks'] = base_da + random.randint(0, 5) + (goals['away']*2)
                        
                        real_stats['home']['shots_on_target'] = base_sot + goals['home']
                        real_stats['away']['shots_on_target'] = base_sot + goals['away']
                        
                        real_stats['home']['corners'] = int(elapsed_sim * 0.1)
                        real_stats['away']['corners'] = int(elapsed_sim * 0.1)

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
                    
                    # Transformer Time-Series Analysis
                    h_tmom, a_tmom = transformer_engine.process_match(fixture['id'], flat_stats)
                    log_algo(f"  Transformer动量: 主队 {h_tmom:.1f} 客队 {a_tmom:.1f}")

                    # xT (Expected Threat) Spatial Analysis
                    h_xt_score, a_xt_score = xt_engine.calculate_xt(fixture['id'], flat_stats)
                    log_algo(f"  xT期望威胁: 主队 {h_xt_score:.3f} 客队 {a_xt_score:.3f}")
                    
                    # B. 动态泊松概率 (Live Pricing)
                    # 基础xG: 使用赛前 AI 预测的期望进球值 (xG)
                    # 如果没有预测成功，默认使用 1.35 (联盟平均)
                    pm_pred = parsed_match.get('ai_analysis', {})
                    base_h_xg = pm_pred.get('home_xg', 1.35)
                    base_a_xg = pm_pred.get('away_xg', 1.05) # 客队通常稍低
                    
                    pricing_model = LivePricing(base_h_xg, base_a_xg)
                    log_algo(f"  赛前xG: 主队 {base_h_xg} 客队 {base_a_xg}")
                    
                    # --- WEATHER INTEGRATION (Mixed Mode: Coordinates + Real Weather) ---
                    # Logic: 比赛开始前/开始即抓取天气。
                    # 为了优化性能，我们把天气请求加入到 static 缓存层，一场比赛只抓一次。
                    
                    real_weather = "PERFECT"
                    venue_info = fixture.get('venue', {})
                    venue_city = venue_info.get('city')
                    venue_id = venue_info.get('id')
                    
                    if (venue_city or venue_id) and fixture_id not in STATIC_DATA_CACHE.get('weather', {}):
                        # Init Cache Structure if missing
                        if 'weather' not in STATIC_DATA_CACHE: STATIC_DATA_CACHE['weather'] = {}
                        if 'venues' not in STATIC_DATA_CACHE: STATIC_DATA_CACHE['venues'] = {}
                        
                        try:
                            weather_type = "PERFECT"
                            lat, lon = None, None

                            # 1. 尝试获取坐标 (High Precision Mode)
                            if venue_id and OWM_API_KEY:
                                if venue_id in STATIC_DATA_CACHE['venues']:
                                    lat, lon = STATIC_DATA_CACHE['venues'][venue_id]
                                else:
                                    # Fetch from API-Sports
                                    try:
                                        v_url = f"https://v3.football.api-sports.io/venues?id={venue_id}"
                                        v_resp = requests.get(v_url, headers={'x-rapidapi-key': API_KEY}, timeout=5)
                                        if v_resp.status_code == 200:
                                            v_data = v_resp.json().get('response', [])
                                            if v_data:
                                                # 2010年酋长球场 {"latitude": "51.5549", "longitude": "-0.108436"}
                                                # 注意 API 返回可能是字符串
                                                raw_lat = v_data[0].get('latitude')
                                                raw_lon = v_data[0].get('longitude')
                                                if raw_lat and raw_lon:
                                                    lat, lon = raw_lat, raw_lon
                                                    STATIC_DATA_CACHE['venues'][venue_id] = (lat, lon)
                                                    logger.info(f"  [Venue] Cached Coords for ID {venue_id}: {lat},{lon}")
                                    except Exception as ve:
                                        logger.warning(f"  [Venue] Fetch Failed: {ve}")

                            # 2. 调用 OpenWeatherMap
                            if OWM_API_KEY:
                                # >>> Real API Mode <<<
                                if lat and lon:
                                    # Use Coordinates (Precise)
                                    w_url = f"http://api.openweathermap.org/data/2.5/weather?lat={lat}&lon={lon}&appid={OWM_API_KEY}&units=metric"
                                    loc_tag = f"Coords({lat},{lon})"
                                elif venue_city:
                                    # Fallback to City Name
                                    w_url = f"http://api.openweathermap.org/data/2.5/weather?q={venue_city}&appid={OWM_API_KEY}&units=metric"
                                    loc_tag = f"City({venue_city})"
                                else:
                                    raise Exception("No location info")

                                w_resp = requests.get(w_url, timeout=3)
                                if w_resp.status_code == 200:
                                    w_data = w_resp.json()
                                    main_condition = w_data['weather'][0]['main'].lower() # Rain, Snow, Clear, Drizzle
                                    temp_c = w_data['main']['temp']
                                    
                                    # Mapping
                                    if "rain" in main_condition or "drizzle" in main_condition or "thunder" in main_condition:
                                        weather_type = "RAIN"
                                    elif "snow" in main_condition:
                                        weather_type = "SNOW"
                                    elif temp_c > 32:
                                        weather_type = "HOT"
                                    elif temp_c < -5:
                                        weather_type = "SNOW" # Cold freeze
                                        
                                    logger.info(f"  [Weather API] {loc_tag}: {main_condition}, {temp_c}C -> {weather_type}")
                                else:
                                    logger.warning(f"  [Weather API] Failed {w_resp.status_code}: {w_resp.text}")
                                    # Fallback to simulation below if API fails
                                    raise Exception("API Error")
                            else:
                                raise Exception("No API Key")

                        except Exception as we:
                            # >>> Simulation / Fallback Mode <<<
                            # If no key or API fails, use city-based heuristics
                            sim_w_type = "PERFECT"
                            if venue_city:
                                city_lower = venue_city.lower()
                                if "rain" in city_lower or "manchester" in city_lower or "london" in city_lower:
                                    sim_w_type = "RAIN"
                                elif "munch" in city_lower or "moscow" in city_lower: # Munich
                                    sim_w_type = "SNOW"
                            
                            if item.get('league', {}).get('country') in ["Spain", "Italy", "Portugal", "Brazil", "Argentina"]:
                                sim_w_type = "HOT"
                                
                            weather_type = sim_w_type
                            if OWM_API_KEY: logger.warning(f"  [Weather] Fallback to simulation: {we}")

                        # Cache it
                        STATIC_DATA_CACHE['weather'][fixture_id] = weather_type
                    
                    # Retrieve from cache
                    if 'weather' in STATIC_DATA_CACHE and fixture_id in STATIC_DATA_CACHE['weather']:
                         real_weather = STATIC_DATA_CACHE['weather'][fixture_id]
                    
                    # Log if extreme
                    if real_weather != "PERFECT":
                         log_algo(f"  天气环境: {real_weather} (City: {venue_city})")

                    # Add weather to parsed_match for Frontend
                    parsed_match['weather'] = real_weather

                    # --- REFEREE STATS INTEGRATION (裁判数据接入) ---
                    # Logic: 检查裁判是否在 STATIC_DATA_CACHE 中。不在则抓取。
                    ref_name = parsed_match.get('referee')
                    ref_stats = None
                    
                    if ref_name:
                        # Normalize name
                        ref_key = ref_name.split(',')[0].strip() # "Taylor Anthony" -> "Taylor Anthony"
                        
                        # Init Cache
                        if 'referee_stats' not in STATIC_DATA_CACHE: STATIC_DATA_CACHE['referee_stats'] = {}
                        
                        if ref_key not in STATIC_DATA_CACHE['referee_stats']:
                             # Fetch or Mock
                             # Real API: /fixtures?referee={id}&last=10
                             # Mock Logic: Generate random strictness based on name hash to be consistent
                             
                             # Deterministic "Random" Stats
                             h_val = int(hashlib.md5(ref_key.encode()).hexdigest(), 16)
                             
                             # 30% Chance of Harsh Referee (Card Happy)
                             # 10% Chance of Penalty Happy
                             
                             sim_penalty = 1.0
                             if h_val % 10 == 0: sim_penalty = 1.25 # High Penalty Prob
                             
                             # Cache
                             STATIC_DATA_CACHE['referee_stats'][ref_key] = {'penalty': sim_penalty}
                             logger.info(f"  [Referee] Fetched stats for {ref_key}: {STATIC_DATA_CACHE['referee_stats'][ref_key]}")

                        ref_stats = STATIC_DATA_CACHE['referee_stats'].get(ref_key)

                    # --- GNN Integration (实力修正) ---
                    # 使用图嵌入向量计算两队在"关系网络"中的绝对统治力差距
                    # Fixed: Pass English names to GNN as the graph is built with English keys
                    gnn_gap, gnn_sim = gnn_engine.predict_match_strength(
                        teams['home']['name'], 
                        teams['away']['name']
                    )
                    
                    if gnn_gap != 0.0:
                        log_algo(f"  GNN图神经网络: 强度差 {gnn_gap:.3f} 相似度 {gnn_sim:.2f}")
                        # Apply correction: Positive Gap -> Home Stronger -> Boost Home xG
                        # Gap magnitude is usually small (<1.0) after normalization
                        # Demo scaling: Gap * 0.2
                        pricing_model.base_home_xg *= (1.0 + gnn_gap * 0.2)
                        pricing_model.base_away_xg *= (1.0 - gnn_gap * 0.2)
                    
                    rem_min = 90
                    if elapsed: rem_min = max(90 - elapsed, 0)
                    
                    # 1. Calculate Live Lambdas
                    # Updated V2.0: Pass current score for game state correction
                    
                    # --- FATIGUE CALCULATION (Real Schedule Based) ---
                    # Logic moved to top of loop (Unified Calculation)
                    # Using variables: real_home_fatigue, real_away_fatigue
                            
                    if real_home_fatigue > 0 or real_away_fatigue > 0:
                        log_algo(f"  疲劳修正: 主[{real_home_fatigue}] 客[{real_away_fatigue}] (基于赛程)")

                    # Detect Motivation Context (Heuristic + Demo DB)
                    # Use English names for lookup as TEAM_CONTEXT_DB keys are English
                    # Fixed: Imports moved to top-level
                    h_m_type = TEAM_CONTEXT_DB.get(teams['home']['name'], None)
                    a_m_type = TEAM_CONTEXT_DB.get(teams['away']['name'], None)
                    
                    if "Friendly" in parsed_match.get('league', ''):
                         h_m_type = "FRIENDLY"
                         a_m_type = "FRIENDLY"

                    if h_m_type or a_m_type:
                        log_algo(f"  战意背景: 主[{h_m_type}] 客[{a_m_type}]")

                    # Look up styles
                    # Use English names for lookup as TEAM_STYLE_DB keys are English
                    h_style = TEAM_STYLE_DB.get(teams['home']['name'])
                    a_style = TEAM_STYLE_DB.get(teams['away']['name'])
                    
                    if h_style and a_style:
                        log_algo(f"  战术博弈: {h_style} VS {a_style}")

                    # WEATHER LOGIC: Now using real_weather fetched above
                    # Keeping `venue_city` usage for logging
                        
                    lambda_h, lambda_a = pricing_model.get_remaining_xg(
                        elapsed if elapsed else 0, # minute passed
                        h_mom, a_mom,
                        current_score=(goals['home'], goals['away']),
                        league_name=parsed_match.get('league'), # Requires Chinese for Volatility Map
                        referee_name=parsed_match.get('referee'),
                        referee_stats=ref_stats, # [NEW] Pass dynamic referee stats
                        away_fatigue=real_away_fatigue, # Updated from sim to real
                        home_fatigue=real_home_fatigue, # Updated from sim to real
                        home_motivation_type=h_m_type,
                        away_motivation_type=a_m_type,
                        home_style=h_style,
                        away_style=a_style,
                        weather_type=real_weather, # Using the cached/mocked real weather
                        home_team_name=teams['home']['name'], # Fixed: Requires English for Fortress Map
                        home_transformer_mom=h_tmom,
                        away_transformer_mom=a_tmom,
                        home_xt=h_xt_score,
                        away_xt=a_xt_score
                    )
                    log_algo(f"  剩余xG: 主队 {lambda_h:.2f} 客队 {lambda_a:.2f}")
                    
                    # 2. Calculate 1x2 Probs for UI
                    prob_h, prob_d, prob_a = pricing_model.calculate_1x2_probs(
                        lambda_h, lambda_a, 
                        (goals['home'], goals['away'])
                    )
                    log_algo(f"  1X2概率(泊松): 主胜 {prob_h:.1f}% 平局 {prob_d:.1f}% 客胜 {prob_a:.1f}%")
                    
                    # --- Digital Twin Monte Carlo Simulation ---
                    # 运行 500 次并行宇宙模拟，对比泊松分布结果
                    # 泊松是理论值，蒙特卡洛能捕捉"长尾风险"(Fat Tails)和"波动率"(Volatility)
                    sim_h_win, sim_draw, sim_a_win, sim_h_g, sim_a_g = twin_engine.run_simulation(
                        current_minute=elapsed if elapsed else 0,
                        current_score=(goals['home'], goals['away']),
                        home_strength=lambda_h, # 使用已修正的 lambda
                        away_strength=lambda_a,
                        home_volatility=0.2, # 假设波动率
                        away_volatility=0.2,
                        n_sims=500
                    )
                    log_algo(f"  数字孪生(500次): 主胜 {sim_h_win*100:.1f}% 平局 {sim_draw*100:.1f}% 客胜 {sim_a_win*100:.1f}%")
                    
                    # 混合模型预测 (Ensemble)
                    # 70% 泊松 + 30% 孪生模拟
                    final_h_prob = prob_h * 0.7 + (sim_h_win * 100) * 0.3
                    final_d_prob = prob_d * 0.7 + (sim_draw * 100) * 0.3
                    final_a_prob = prob_a * 0.7 + (sim_a_win * 100) * 0.3

                    live_probs = {
                        "home_prob": round(final_h_prob, 2),
                        "draw_prob": round(final_d_prob, 2),
                        "away_prob": round(final_a_prob, 2),
                        "lambda_home": round(lambda_h, 2),
                        "lambda_away": round(lambda_a, 2)
                    }
                    parsed_match['ai_analysis'] = live_probs
                    
                    # --- Apply Tactical Inertia ---
                    inertia_factor = inertia_engine.get_correction_factor(fixture_id)
                    if inertia_factor != 1.0:
                         log_algo(f"战术惯性修正生效: 比赛[{fixture_id}] 修正系数 {inertia_factor:.2f}")
                         # 修正 lambda (xG产生率)
                         lambda_h *= inertia_factor
                         lambda_a *= inertia_factor
                         
                         # Re-calculate probabilities with corrected lambda
                         prob_h, prob_d, prob_a = pricing_model.calculate_1x2_probs(
                             lambda_h, lambda_a, 
                             (goals['home'], goals['away'])
                         )
                         # Update live_probs dict with new values
                         live_probs_update = {
                             "home_prob": prob_h,
                             "draw_prob": prob_d,
                             "away_prob": prob_a,
                             "lambda_home": lambda_h,
                             "lambda_away": lambda_a
                         }
                         parsed_match['ai_analysis'].update(live_probs_update)

                    # C. 亚盘公平赔率 & 信号
                    # 获取当前盘口 (从 odds_ah.val, e.g. "-0.5")
                    try:
                        current_line_str = ah_data.get('val', '0')
                        if current_line_str and current_line_str != '-':
                            # 清洗数据: "+0.5" -> 0.5, "0" -> 0, "-0.5" -> -0.5
                            current_line = float(current_line_str)
                            
                            # 注意: 我们的 Pricer 接受的是 "Line for Home"，即主队让球
                            # 如果显示是 +0.5，意味着主队受让，Line = 0.5 (取决于定义)
                            # 通常显示格式："-0.5" 意味着主队让半球
                            
                            # Soft Line Detection Logic
                            # 1. Calculate for Main Line
                            fair_odd = ah_pricer.calculate_fair_odds(
                                live_probs['lambda_home'], 
                                live_probs['lambda_away'], 
                                goals['home'] - goals['away'],
                                current_line
                            )
                            
                            # 信号分析 (Signal Analysis with Kelly)
                            # Get market odd for Home Win on AH
                            try:
                                m_odd_h = float(ah_data.get('h')) + 1.0 # net -> decimal
                            except: m_odd_h = 0.0
                            
                            ah_signal = signal_gen.analyze(fair_odd, m_odd_h)
                            if ah_signal:
                                # Apply Kelly Criterion
                                win_prob_ah = 1.0 / fair_odd
                                kelly_pct = kelly_engine.calculate_stake(win_prob_ah, m_odd_h)
                                
                                ah_signal['kelly_stake'] = f"{kelly_pct:.2f}%"
                                if kelly_pct > 0:
                                    parsed_match["ai_signal_ah"] = ah_signal
                                    # Boost priority heavily if Kelly suggests a bet
                                    parsed_match['priority_score'] = 999 
                                    
                                    # --- PAPER TRADING EXECUTION ---
                                    # Auto-place order if high confidence
                                    # Selection Info
                                    sel_info = {
                                        "type": "AH",
                                        "line": current_line,
                                        "start_score": (goals['home'], goals['away']),
                                        "desc": f"Home {current_line} @ {m_odd_h:.2f} (Score {goals['home']}-{goals['away']})"
                                    }
                                    
                                    success, msg = paper_engine.place_order(
                                        parsed_match['id'],
                                        f"{parsed_match['home_team']} vs {parsed_match['away_team']}",
                                        sel_info,
                                        m_odd_h,
                                        kelly_pct,
                                        "Kelly Signal > 0"
                                    )
                                    if success:
                                        log_algo(f"🤖 模拟交易触发: {msg}")

                            # 2. Check "Soft" Alternatives (Quarter Lines nearby)
                            # e.g. if Line is -0.5, we check -0.25 (Safer) or -0.75 (Riskier) to see if EV is better
                            alt_lines = [current_line - 0.25, current_line + 0.25]
                            best_soft_line = None
                            best_soft_ev = -999
                            
                            for alt in alt_lines:
                                alt_prob = pricing_model.calculate_asian_handicap_prob(
                                    live_probs['lambda_home'], 
                                    live_probs['lambda_away'],
                                    alt,
                                    (goals['home'], goals['away'])
                                )
                                # Mock Market Odd for Alt Line (In real app, fetch actual odds)
                                # Assumption: Market Odd adjust approx 0.3 per 0.25 line diff
                                # This is just for flagging potential
                                if alt_prob > 0.65: # High confidence threshold for Soft Line
                                    best_soft_line = alt

                            # Flag if Soft Line found
                            if best_soft_line:
                                parsed_match['soft_line_alert'] = f"软盘关注: {best_soft_line:+.2f}"

                            # CRITICAL FIX: Use the RAW decimal odd for mathematical comparison
                            # ah_data['h'] is the display value (e.g. 0.95), we need the full odd (e.g. 1.95)
                            try:
                                market_odd_raw = float(home_odd)
                            except:
                                market_odd_raw = 0.0

                            # --- Market Psychology & Overreaction Check ---
                            # Detect if market is Panic Selling or Hyping
                            from live_engine import MarketPsychology
                            psych_engine = MarketPsychology()
                            
                            # Convert Fair Odd back to Probability for comparison
                            fair_prob_ah = 1.0 / fair_odd if fair_odd > 0 else 0
                            
                            psy_type, psy_conf = psych_engine.detect_overreaction(fair_prob_ah, market_odd_raw)
                            if psy_type:
                                alert_msg = f"市场心理警报: {psy_type} (偏离度 {psy_conf:.1%})"
                                parsed_match['psych_alert'] = alert_msg
                                log_algo(f"*** {alert_msg} *** Match: {home_cn} vs {away_cn}")
                                
                                # If it's a Panic Overreaction, it is a high-quality Contrarian Bet
                                if psy_type == "PANIC_OVERREACTION":
                                    parsed_match['priority_score'] = 888

                            # Update threshold to 3% as requested
                            # --- 双向信号分析 (Dual-Side Analysis) ---
                            
                            # 定义下单处理函数
                            def process_bet_signal(signal, side, m_odd, f_odd):
                                # Kelly Calculation
                                k_win_prob = 1.0 / f_odd if f_odd > 0 else 0
                                k_pct = kelly_engine.calculate_stake(k_win_prob, m_odd)
                                k_amount = int(1000 * k_pct)
                                
                                # Skip invalid or small stakes
                                if k_pct <= 0: return None

                                signal['algo'] = "AI 综合模型 V3 (泊松+GNN)"
                                signal['stake_amt'] = k_amount

                                # Unique Key: MatchID + Line + Side
                                rec_key = f"{fixture['id']}_{current_line}_{side}"
                                
                                # 文案生成
                                display_bet = ""
                                eff_line = current_line if side == 'Home' else -current_line
                                side_cn = "主" if side == 'Home' else "客"
                                
                                if eff_line < 0: display_bet = f"{side_cn}让 {abs(eff_line)}"
                                elif eff_line > 0: display_bet = f"{side_cn}受 {abs(eff_line)}"
                                else: display_bet = "平手 0"

                                rec_record = {
                                    "key": rec_key,
                                    "match_id": fixture['id'],
                                    "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                                    "league": league_cn,
                                    "home_team": home_cn,
                                    "away_team": away_cn,
                                    "score_at_rec": f"{goals['home']}-{goals['away']}",
                                    "time_at_rec": display_time,
                                    "selection": side,            # Home / Away
                                    "handicap": current_line,     # 统一记录主让盘口
                                    "bet_type": display_bet,
                                    "odds": m_odd, 
                                    "fair_odds": f_odd,
                                    "ev": signal['ev'],
                                    "algo": "AI 综合模型 V3 (泊松+GNN)",
                                    "stake": f"¥{k_amount}",
                                    "result": "Pending",
                                    "snapshot": flat_stats
                                }
                                add_recommendation_record(rec_record)
                                
                                # Paper Trading
                                sel_info = {
                                    "type": "AH",
                                    "line": current_line, 
                                    "side": side,         
                                    "start_score": (goals['home'], goals['away']),
                                    "desc": f"{side} ({display_bet}) @ {m_odd:.2f}"
                                }
                                success, msg = paper_engine.place_order(
                                    fixture['id'],
                                    f"{home_cn} vs {away_cn}",
                                    sel_info,
                                    m_odd,
                                    k_pct,
                                    f"Kelly Signal > 0 ({side})"
                                )
                                if success:
                                    log_algo(f"🤖 模拟交易触发: {msg}")
                                return signal

                            # 1. 主队方向分析
                            try:
                                m_odd_h = float(ah_data.get('h')) + 1.0 
                            except: m_odd_h = 0.0
                            
                            ah_signal_h = signal_gen.analyze(fair_odd, m_odd_h, threshold=0.03)
                            
                            # 2. 客队方向分析
                            try:
                                m_odd_a = float(ah_data.get('a')) + 1.0
                            except: m_odd_a = 0.0

                            fair_odd_a = 0.0
                            if fair_odd > 0:
                                prob_h = 1.0 / fair_odd
                                prob_a = 1.0 - prob_h
                                if prob_a > 0.01: fair_odd_a = 1.0 / prob_a
                            
                            ah_signal_a = signal_gen.analyze(fair_odd_a, m_odd_a, threshold=0.03)

                            # 执行优选
                            best_signal = None
                            
                            # Process Home
                            if ah_signal_h:
                                log_algo(f"*** 发现价值注单(主) *** {league_cn} {home_cn} vs {away_cn} | EV: {ah_signal_h['ev']}%")
                                s = process_bet_signal(ah_signal_h, 'Home', m_odd_h, fair_odd)
                                if s: 
                                    parsed_match['priority_score'] = 999
                                    best_signal = s
                                    
                            # Process Away
                            if ah_signal_a:
                                log_algo(f"*** 发现价值注单(客) *** {league_cn} {home_cn} vs {away_cn} | EV: {ah_signal_a['ev']}%")
                                s = process_bet_signal(ah_signal_a, 'Away', m_odd_a, fair_odd_a)
                                if s:
                                    parsed_match['priority_score'] = 999
                                    # 如果之前没有信号，或者客队EV更高，则展示客队
                                    if not best_signal or float(s['ev']) > float(best_signal['ev'] or 0):
                                        best_signal = s

                            # 设置前端显示信号
                            if best_signal:
                                parsed_match['ai_signal_ah'] = best_signal

                            # --- Auto-Save Logic Replaced by process_bet_signal above ---
                            
                            parsed_match['advanced_analytics'] = {
                                "momentum": {"home": round(h_press, 1), "away": round(a_press, 1)},
                                "fair_odds_home": fair_odd,
                                "signal": signal
                            }
                        else:
                             parsed_match['advanced_analytics'] = None

                        # D. 大小球公平赔率 & 信号 (双向 v2)
                        # 获取当前大小盘 (从 odds_ou.line, e.g. "3.5")
                        ou_line_str = ou_data.get('line', '0')
                        if ou_line_str and ou_line_str != '-':
                            ou_line = float(ou_line_str)
                            
                            # 1. 计算公平赔率 (Fair Odds)
                            # Over Fair
                            fair_odd_over = ou_pricer.calculate_fair_odds(
                                live_probs['lambda_home'],
                                live_probs['lambda_away'],
                                goals['home'] + goals['away'],
                                ou_line
                            )
                            # Under Fair (1 / (1 - P_over))
                            fair_odd_under = 0.0
                            if fair_odd_over > 0:
                                p_over = 1.0 / fair_odd_over
                                p_under = 1.0 - p_over
                                if p_under > 0.01:
                                    fair_odd_under = 1.0 / p_under

                            # 2. 获取市场赔率 (Market Odds)
                            mkt_over = 0.0
                            mkt_under = 0.0
                            try:
                                # 假设 odds 原始数据是净赔率 (0.85)，需加1还原为欧赔 (1.85)
                                if ou_data.get('o') and ou_data['o'] != "-":
                                    mkt_over = float(ou_data['o']) + 1.0
                                if ou_data.get('u') and ou_data['u'] != "-":
                                    mkt_under = float(ou_data['u']) + 1.0
                                
                                # DEBUG OU CALC
                                if mkt_over > 0:
                                    diff_over = round(mkt_over - fair_odd_over, 2)
                                    diff_under = round(mkt_under - fair_odd_under, 2)
                                    # log_algo(f"  [OU CALC] Line:{ou_line} | Over: M{mkt_over}/F{fair_odd_over}({diff_over}) | Under: M{mkt_under}/F{fair_odd_under}({diff_under})")
                                    
                            except: pass

                            # 3. 信号处理函数
                            def process_ou_signal(sig, sel, line, m_odd, f_odd):
                                # Kelly Calculation
                                k_win = 1.0 / f_odd if f_odd > 0 else 0
                                k_pct = kelly_engine.calculate_stake(k_win, m_odd)
                                k_amt = int(1000 * k_pct)
                                
                                if k_pct <= 0: return None
                                
                                sig['algo'] = "AI 综合模型 V3 (泊松+GNN)"
                                sig['stake_amt'] = k_amt
                                
                                # 生成记录
                                rec_key = f"{fixture['id']}_OU_{line}_{sel}"
                                display_type = f"{sel} {line}" # Over 2.5
                                
                                rec = {
                                    "key": rec_key,
                                    "match_id": fixture['id'],
                                    "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                                    "league": league_cn,
                                    "home_team": home_cn,
                                    "away_team": away_cn,
                                    "score_at_rec": f"{goals['home']}-{goals['away']}",
                                    "time_at_rec": display_time,
                                    "selection": sel,            # "Over" / "Under"
                                    "handicap": line,            # 2.5
                                    "bet_type": display_type,    # "Over 2.5"
                                    "odds": m_odd, 
                                    "fair_odds": f_odd,
                                    "ev": sig['ev'],
                                    "algo": "AI 综合模型 V3 (泊松+GNN)",
                                    "stake": f"¥{k_amt}",
                                    "result": "Pending"
                                }
                                add_recommendation_record(rec)
                                
                                # Paper Trading
                                paper_sel = {
                                    "type": "OU",
                                    "line": line,
                                    "side": sel, # Over/Under
                                    "start_score": (goals['home'], goals['away']),
                                    "desc": f"{sel} {line} @ {m_odd:.2f}"
                                }
                                paper_engine.place_order(
                                    fixture['id'], 
                                    f"{home_cn} vs {away_cn}", 
                                    paper_sel, m_odd, k_pct, "OU Signal"
                                )
                                return sig

                            # 4. 执行双向扫描
                            best_ou_signal = None
                            
                            # Over Analysis
                            sig_over = signal_gen.analyze(fair_odd_over, mkt_over, threshold=0.05)
                            if sig_over:
                                sig_over['market_odds'] = mkt_over # Ensure frontend has odds
                                log_algo(f"*** 发现价值注单(大) *** {league_cn} | 大 {ou_line} | EV: {sig_over['ev']}%")
                                process_ou_signal(sig_over, "Over", ou_line, mkt_over, fair_odd_over)
                                best_ou_signal = sig_over
                                
                            # Under Analysis
                            sig_under = signal_gen.analyze(fair_odd_under, mkt_under, threshold=0.05)
                            if sig_under:
                                sig_under['market_odds'] = mkt_under # Ensure frontend has odds
                                log_algo(f"*** 发现价值注单(小) *** {league_cn} | 小 {ou_line} | EV: {sig_under['ev']}%")
                                process_ou_signal(sig_under, "Under", ou_line, mkt_under, fair_odd_under)
                                # Pick better EV if both exist (rare)
                                if not best_ou_signal or float(sig_under['ev']) > float(best_ou_signal['ev']):
                                    best_ou_signal = sig_under

                            # 5. 整合信号到 Live Feed
                            # 如果有大小球信号，且 (没有亚盘信号 OR 大小球EV更高)
                            if best_ou_signal:
                                current_signal = parsed_match['advanced_analytics'].get('signal')
                                if not current_signal or float(best_ou_signal['ev']) > float(current_signal.get('ev', 0)):
                                    # Update the display signal
                                    parsed_match['advanced_analytics']['signal'] = best_ou_signal
                                    # Add hint for frontend to display OU lines correctly
                                    parsed_match['odds_ah'] = {"val": f"OU {ou_line}"} # Hack to show line in card



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
                ALL_ACTIVE_LEAGUES_RAW = current_cycle_leagues_raw
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
    # Startup: 1. Initialize logic, 2. Start Background Tasks
    print("[LifeSpan] Starting Quantum Football System...")
    # Initial data fetch and GNN training (Simulated)
    fetch_and_train_gnn()

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

# ================= Configuration (Moved to Top) =================
# API_KEY and API_URL moved to top of file for global scope safety

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
    确保实时汉化：即使缓存中是旧的英文，这里也会尝试根据最新的 translation_utils 再次翻译
    """
    matches_to_send = []
    leagues_set = set()
    
    from translation_utils import trans_league, trans_team

    # 使用 LIVE_INPLAY_CACHE 的副本进行即时重新翻译
    # 这样修改翻译字典后，无需等待 16s 轮询即可在前台生效
    cache_copy = LIVE_INPLAY_CACHE.copy()
    
    for m in cache_copy:
        # Shallow copy match to allow display modification
        m_fresh = m.copy()
        
        # 1. Re-translate League (using stored country context)
        # 如果缓存里是 "Superliga"且未翻译，现在会重新尝试
        current_league_name = m_fresh.get('league', '')
        country = m_fresh.get('country', '')
        
        # 只有当包含 ASCII 字符（可能未汉化）时才尝试重翻，或者强制重翻
        # 这里为了稳妥，我们直接调用 trans_league，因为它内部会处理已翻译的情况(通常原样返回)
        new_league_name = trans_league(current_league_name, country=country)
        m_fresh['league'] = new_league_name
        leagues_set.add(new_league_name)
        
        # 2. Re-translate Teams (optional, but good for consistency)
        m_fresh['home_team'] = trans_team(m_fresh['home_team'])
        m_fresh['away_team'] = trans_team(m_fresh['away_team'])
        
        matches_to_send.append(m_fresh)
    
    # 3. Handle Blocked Leagues (which are missing from LIVE_INPLAY_CACHE)
    # Re-translate raw active leagues to ensure filter list is complete
    # Iterate over ALL_ACTIVE_LEAGUES_RAW (which contains everything, blocked or not)
    for raw_l in ALL_ACTIVE_LEAGUES_RAW:
        # Re-translate using current dictionary
        l_name_cn = trans_league(raw_l['name'], country=raw_l.get('country'))
        leagues_set.add(l_name_cn)

    # 4. Fallback: If RAW list is empty (e.g. just restarted), use blocked list directly
    # (Though we can't re-translate without raw info, blocked list is usually already CN)
    if not leagues_set and LEAGUE_BLOCKLIST:
         for bl in LEAGUE_BLOCKLIST:
             leagues_set.add(bl)

    current_leagues = sorted(list(leagues_set))
        
    logger.info(f"API Request - Matches: {len(matches_to_send)}, Leagues: {len(current_leagues)}")
    
    return {
        "count": len(matches_to_send),
        "matches": matches_to_send,
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
async def get_history_api(date: str = None):
    """
    获取推荐历史记录，可选日期过滤 (date: YYYY-MM-DD)
    """
    filtered = RECOMMENDATION_HISTORY
    
    # Date Filter
    if date:
        filtered = []
        for r in RECOMMENDATION_HISTORY:
            # Timestamp format usually "YYYY-MM-DD HH:MM:SS"
            ts = r.get('timestamp', '')
            if ts.startswith(date):
                filtered.append(r)
    
    # Sort by timestamp desc
    sorted_hist = sorted(filtered, key=lambda x: x['timestamp'], reverse=True)

    
    # 重新尝试翻译未汉化的球队名
    final_hist = []
    
    def has_chinese(text):
        for char in str(text):
            if '\u4e00' <= char <= '\u9fff':
                 return True
        return False

    for rec in sorted_hist:
        r = rec.copy()
        
        # 如果不包含中文，尝试再次翻译（可能因缓存未命中导致存了英文）
        if not has_chinese(r.get('home_team', '')):
             r['home_team'] = trans_team(r.get('home_team', ''))
             
        if not has_chinese(r.get('away_team', '')):
             r['away_team'] = trans_team(r.get('away_team', ''))
             
        if not has_chinese(r.get('league', '')):
             # League usually has country param, but we lost it in history rec
             # trans_league(name, country=None) is safer
             r['league'] = trans_league(r.get('league', ''))
             
        final_hist.append(r)

    return {"count": len(final_hist), "history": final_hist}

@app.post("/api/history/clear")
async def clear_history_api():
    """
    清除所有推荐历史记录
    """
    global RECOMMENDATION_HISTORY
    RECOMMENDATION_HISTORY = []
    save_history_to_disk()
    return {"status": "success", "message": "History cleared"}

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
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=False)
