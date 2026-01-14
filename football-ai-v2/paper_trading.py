import json
import os
import time
import math

STATS_FILE = "simulated_ledger.json"

class PaperTrader:
    """
    模拟交易与账单系统 (Paper Trading & Ledger System)
    功能：
    1. 维护虚拟资金 (Bankroll)。
    2. 接收交易信号进行"虚拟下单"。
    3. 比赛结束后结算损益 (PnL)，并记录流水。
    """
    def __init__(self, initial_bankroll=10000.0):
        self.initial_bankroll = initial_bankroll
        # Data structure:
        # bankroll: float
        # active_orders: list [ {id, match_id, selection, odds, stake, ...} ]
        # ledger: list [ {id, type='BET'/'SETTLE', amount, balance_after, desc, ...} ]
        self.load_state()

    def load_state(self):
        if os.path.exists(STATS_FILE):
            try:
                with open(STATS_FILE, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    self.bankroll = data.get('bankroll', self.initial_bankroll)
                    self.active_orders = data.get('active_orders', [])
                    self.ledger = data.get('ledger', [])
            except:
                self.reset()
        else:
            self.reset()

    def reset(self):
        self.bankroll = self.initial_bankroll
        self.active_orders = []
        self.ledger = [{
            "time": time.strftime("%Y-%m-%d %H:%M:%S"),
            "type": "INIT",
            "amount": self.initial_bankroll,
            "balance": self.initial_bankroll,
            "desc": "账户初始化"
        }]
        self.save_state()

    def save_state(self):
        try:
            with open(STATS_FILE, 'w', encoding='utf-8') as f:
                json.dump({
                    "bankroll": self.bankroll,
                    "active_orders": self.active_orders,
                    "ledger": self.ledger
                }, f, indent=2, ensure_ascii=False)
        except:
            pass

    def place_order(self, match_id, event_str, selection, odds, stake_pct, reason):
        """
        下单接口
        selection: e.g. "Home -0.5" or {"type": "AH", "line": -0.5, "team": "home"}
        """
        # 1. Deduplication check
        for order in self.active_orders:
            if order['match_id'] == match_id:
                return False, "订单已存在"

        # 2. Calculate Stake
        stake_amount = self.bankroll * (stake_pct / 100.0)
        if stake_amount < 10.0: # Minimum bet
            return False, "金额过小"
            
        if stake_amount > self.bankroll:
            return False, "余额不足"

        # 3. Create Order
        order = {
            "order_id": f"ORD_{match_id}_{int(time.time())}",
            "match_id": match_id,
            "event": event_str,
            "selection": selection, # dict
            "odds": odds,
            "stake": round(stake_amount, 2),
            "reason": reason,
            "timestamp": time.time(),
            "status": "OPEN"
        }
        
        # 4. Update Bankroll & Ledger
        self.bankroll -= stake_amount
        self.active_orders.append(order)
        
        self._add_ledger_entry(
            "BET", 
            -stake_amount, 
            f"下单: {event_str} [{selection.get('desc')}] @ {odds}"
        )
        
        self.save_state()
        return True, f"成功下单 {stake_amount:.2f}元"

    def settle_match(self, match_id, score_home, score_away):
        """
        结算比赛
        """
        settled_count = 0
        to_remove_indices = []
        
        for idx, order in enumerate(self.active_orders):
            if order['match_id'] == match_id:
                pnl, result_type = self._calculate_pnl(order, score_home, score_away)
                
                # Update Bankroll (Return Stake + Profit)
                # If Loss, return is 0.
                # If Win, return Stake + Stake*(Odds-1) = Stake*Odds
                
                # Logic: PnL is pure profit/loss.
                # Return Amount = Stake + PnL (If PnL is negative stake, return 0)
                
                return_amount = order['stake'] + pnl
                if return_amount > 0:
                    self.bankroll += return_amount
                    
                self._add_ledger_entry(
                    result_type,
                    return_amount,
                    f"结算 ({result_type}): {order['event']} PnL: {pnl:+.2f}"
                )
                
                to_remove_indices.append(idx)
                settled_count += 1
                
        # Remove settled from active
        for i in sorted(to_remove_indices, reverse=True):
            del self.active_orders[i]
            
        if settled_count > 0:
            self.save_state()
            
    def _add_ledger_entry(self, l_type, amount, desc):
        entry = {
            "time": time.strftime("%Y-%m-%d %H:%M:%S"),
            "type": l_type,
            "amount": round(amount, 2),
            "balance": round(self.bankroll, 2),
            "desc": desc
        }
        self.ledger.insert(0, entry) # Newest first
        # Limit ledger size
        if len(self.ledger) > 1000:
            self.ledger.pop()

    def _calculate_pnl(self, order, h, a):
        """
        计算单注盈亏
        Return: (PnL_Amount, Result_String)
        """
        sel = order['selection']
        stk = order['stake']
        odds = order['odds']
        
        # Asian Handicap Logic
        if sel.get('type') == 'AH':
            line = sel.get('line') # e.g. -0.5
            diff = h - a
            # If bet on Home, val = diff + line
            # Checking logic... our system usually bets on Home for now in the demo
            # Assuming selection is always HOME relative
            
            val = diff + line
            
            # Full Win
            if val >= 0.5:
                return stk * (odds - 1), "WIN"
            # Full Loss
            elif val <= -0.5:
                return -stk, "LOSS"
            # Push
            elif abs(val) < 0.01:
                return 0.0, "PUSH"
            # Half Win (+0.25 net)
            elif abs(val - 0.25) < 0.01:
                return (stk / 2) * (odds - 1), "HALF_WIN"
            # Half Loss (-0.25 net)
            elif abs(val + 0.25) < 0.01:
                return -stk / 2, "HALF_LOSS"
                
        return 0.0, "VOID"

    def get_summary(self):
        return {
            "balance": round(self.bankroll, 2),
            "open_orders": len(self.active_orders),
            "today_pnl": 0 # TODO: Calculate from ledger
        }
