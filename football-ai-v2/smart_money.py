import numpy as np
import time

class SmartMoneyDetector:
    def __init__(self):
        # Cache structure: 
        # { 
        #   fixture_id: {
        #      'start_odds': {'home': 2.0, 'away': 3.5}, 
        #      'last_odds': {'home': 2.0, 'away': 3.5},
        #      'start_time': timestamp,
        #      'score': "0-0",
        #      'history': [ (ts, home_odd, away_odd), ... ]
        #   } 
        # }
        self.tracker = {}
        # Threshold: Drop > 10% indicates smart money
        self.DROP_THRESHOLD = 0.10 
        self.SHARP_DROP_THRESHOLD = 0.15

    def track(self, fixture_id, current_odds, current_score, elapsed, shadow_odds=None):
        """
        Track odds movement and return signal if Smart Money is detected.
        current_odds: dict {'home': float, 'away': float} (e.g. Bet365)
        shadow_odds: dict {'home': float, 'away': float} (e.g. Pinnacle) - Optional
        """
        now = time.time()
        
        # Initialize if new
        if fixture_id not in self.tracker:
            self.tracker[fixture_id] = {
                'start_odds': current_odds,
                'last_odds': current_odds,
                'start_time': now,
                'start_elapsed': elapsed,
                'score': current_score,
                'history': []
            }
            return None

        # If score changed, reset baseline because odds change naturally
        prev_data = self.tracker[fixture_id]
        if prev_data['score'] != current_score:
            # Score changed! Reset tracker for this match to avoid false positives
            self.tracker[fixture_id] = {
                'start_odds': current_odds,
                'last_odds': current_odds,
                'start_time': now,
                'start_elapsed': elapsed,
                'score': current_score,
                'history': []
            }
            return None

        # Record history (max last 10 points)
        self.tracker[fixture_id]['history'].append((now, current_odds.get('home'), current_odds.get('away')))
        if len(self.tracker[fixture_id]['history']) > 20:
            self.tracker[fixture_id]['history'].pop(0)

        # Analysis
        signal = None
        
        start_home = prev_data['start_odds'].get('home')
        curr_home = current_odds.get('home')
        
        start_away = prev_data['start_odds'].get('away')
        curr_away = current_odds.get('away')

        # --- 1. Basic Drop Detection (Self-Comparison) ---
        # Check HOME Drop
        if start_home and curr_home and start_home > 1.0:
            drop_pct = (start_home - curr_home) / start_home
            if drop_pct >= self.DROP_THRESHOLD:
                level = 'MEDIUM' if drop_pct < self.SHARP_DROP_THRESHOLD else 'HIGH'
                signal = {
                    'detected': True,
                    'type': 'ODDS_DROP',
                    'team': 'HOME',
                    'drop_pct': round(drop_pct * 100, 1),
                    'from_odds': start_home,
                    'to_odds': curr_home,
                    'level': level
                }

        # Check AWAY Drop (only if Home didn't trigger, or prioritize largest drop)
        if not signal and start_away and curr_away and start_away > 1.0:
            drop_pct = (start_away - curr_away) / start_away
            if drop_pct >= self.DROP_THRESHOLD:
                level = 'MEDIUM' if drop_pct < self.SHARP_DROP_THRESHOLD else 'HIGH'
                signal = {
                    'detected': True,
                    'type': 'ODDS_DROP',
                    'team': 'AWAY',
                    'drop_pct': round(drop_pct * 100, 1),
                    'from_odds': start_away,
                    'to_odds': curr_away,
                    'level': level
                }
        
        # --- 2. Shadow Line Divergence (Arbitrage/Value Detection) ---
        # If Pinnacle (Shadow) is significantly lower than Bet365 (Current),
        # it means Sharp money has already hammered Pinnacle, but 365 is slow.
        if not signal and shadow_odds:
            # Threshold: 365 > Pin * 1.05 (5% Arb is massive in play)
            # Or simplified: if Pin implies 55% prob vs 365 implies 45%
            
            # Helper to safely get odds
            s_home = shadow_odds.get('home')
            s_away = shadow_odds.get('away')
            
            if curr_home and s_home and s_home > 1.0:
                # If 365 is offering 2.10 and Pin is offering 1.90
                # Divergence = (2.10 - 1.90) / 1.90 = 0.10 (10% Value)
                divergence = (curr_home - s_home) / s_home
                if divergence > 0.08: # 8% Value
                     signal = {
                        'detected': True,
                        'type': 'SHADOW_DIVERGENCE',
                        'team': 'HOME',
                        'drop_pct': round(divergence * 100, 1), # Reusing field for UI
                        'from_odds': curr_home, # 365
                        'to_odds': s_home,      # Pin
                        'level': 'HIGH_VALUE'
                    }
            
            if not signal and curr_away and s_away and s_away > 1.0:
                divergence = (curr_away - s_away) / s_away
                if divergence > 0.08:
                     signal = {
                        'detected': True,
                        'type': 'SHADOW_DIVERGENCE',
                        'team': 'AWAY',
                        'drop_pct': round(divergence * 100, 1),
                        'from_odds': curr_away,
                        'to_odds': s_away,
                        'level': 'HIGH_VALUE'
                    }

        # Update last odds
        self.tracker[fixture_id]['last_odds'] = current_odds
        
        return signal
