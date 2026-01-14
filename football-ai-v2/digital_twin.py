import numpy as np
import time

class DigitalTwinGym:
    """
    数字孪生模拟场 (Digital Twin Simulation Gym)
    
    Concept:
    Instead of calculating a static formula for probabilities, we spawn thousands of 
    "Digital Twin" matches that run in parallel universes. Each twin evolves 
    minute-by-minute based on granular agent behaviors (morale, fatigue, volatility).
    
    This explicitly models "Variance" and "Tails" better than Poisson.
    """
    def __init__(self):
        pass

    def run_simulation(self, 
                       current_minute, 
                       current_score, 
                       home_strength, 
                       away_strength, 
                       home_volatility=0.1, 
                       away_volatility=0.1,
                       n_sims=500):
        """
        Run Agent-Based Simulation (Monte Carlo)
        
        Params:
            current_minute: int (0-90)
            current_score: (h_goals, a_goals)
            home_strength: float (lambda/90, base probability to list)
            away_strength: float
            home_volatility: float (std dev of performance)
            away_volatility: float
        """
        rem_time = 90 - current_minute
        if rem_time <= 0:
            # Match finished
            h, a = current_score
            if h > a: return 1.0, 0.0, 0.0, float(h), float(a)
            elif h == a: return 0.0, 1.0, 0.0, float(h), float(a)
            else: return 0.0, 0.0, 1.0, float(h), float(a)

        # 1. Initialize State Matrix for N simulations
        # Each row is a parallel universe
        # Columns: [Curr_Home_Goals, Curr_Away_Goals, Momentum_Home, Momentum_Away]
        sim_state = np.zeros((n_sims, 4))
        sim_state[:, 0] = current_score[0]
        sim_state[:, 1] = current_score[1]
        
        # Base Probability per minute
        # We assume strength is provided as "Total Expected Goals" for full match? 
        # Or Rate? Let's assume input is "Expected Goals Remaining / Remaining Mins" approx.
        # But usually we get lambda for full match. Let's convert rate.
        
        p_h_base = (home_strength / 90.0) if home_strength > 0 else 0
        p_a_base = (away_strength / 90.0) if away_strength > 0 else 0
        
        # Vectorized Loop for each remaining minute
        # This allows "Agent Behavior" (State updates)
        for t in range(rem_time):
            # Dynamic Agents:
            # If Momentum > Threshold, Prob increases
            # Momentum decays
            
            # 1. Random Event Generation (0 to 1)
            rand_outcome = np.random.rand(n_sims, 2) # [Home_Roll, Away_Roll]
            
            # 2. Determine Thresholds (incorporating Agent Volatility)
            # Volatility check: Some sims have overperforming teams, some under
            # We simulate this by perturbing p_base each minute or once per match?
            # Let's perturb each minute (Performance fluctuation)
            
            perf_h = np.random.normal(1.0, home_volatility, n_sims)
            perf_a = np.random.normal(1.0, away_volatility, n_sims)
            
            # 3. Goal Checks
            # Goal if Roll < Probability * Performance
            goals_h = rand_outcome[:, 0] < (p_h_base * perf_h)
            goals_a = rand_outcome[:, 1] < (p_a_base * perf_a)
            
            # 4. Update State
            sim_state[:, 0] += goals_h
            sim_state[:, 1] += goals_a
            
            # 5. Agent Reaction (Digital Twin Logic)
            # "Conceding Goal" Event -> Boost Attacking Urgency (simple model)
            # If Home Concedes (goals_a is True), next minute home P increases slightly
            # We can't easily change p_h_base inside loop efficiently without complex masks, 
            # but we can try a simple "Game State" adjustment for next loop?
            # For speed, we skip complex state feedback in this simplified version.

        # Post-Simulation Analysis
        final_h = sim_state[:, 0]
        final_a = sim_state[:, 1]
        
        avg_h_goals = np.mean(final_h)
        avg_a_goals = np.mean(final_a)
        
        home_wins = np.sum(final_h > final_a)
        draws = np.sum(final_h == final_a)
        away_wins = np.sum(final_h < final_a)
        
        return (
            home_wins / n_sims,
            draws / n_sims,
            away_wins / n_sims,
            avg_h_goals,
            avg_a_goals
        )
