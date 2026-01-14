import requests
import json
from datetime import datetime

API_KEY = "8b86ae86981996818bbdcafafa10717f"
API_URL = "https://v3.football.api-sports.io"
HEADERS = {
    'x-apisports-key': API_KEY,
    'x-rapidapi-host': "v3.football.api-sports.io"
}

def check_friendlies_odds():
    print("Searching for Friendly Leagues...")
    
    # 1. Identify IDs for Friendlies
    # We look for "Club Friendlies" and "Friendlies"
    friendlies_ids = []
    
    # Search via API to be sure or just use known IDs if search fails/takes too long. 
    # Known: 667 (Club Friendlies), 10 (Friendlies - National)
    target_ids = [667, 10] 
    
    # Let's verify their names and coverage
    for lid in target_ids:
        url = f"{API_URL}/leagues"
        params = {"id": lid, "current": "true"}
        resp = requests.get(url, headers=HEADERS, params=params)
        if resp.status_code == 200:
            data = resp.json().get('response', [])
            if data:
                league_name = data[0]['league']['name']
                country = data[0]['country']['name']
                coverage = data[0]['seasons'][0]['coverage']
                season_year = data[0]['seasons'][0]['year']
                print(f"League: {league_name} ({country}) [ID: {lid}] Season: {season_year}")
                print(f"  Coverage - Odds: {coverage.get('odds')}, Fixtures: {coverage.get('fixtures')}")
                friendlies_ids.append({'id': lid, 'name': league_name, 'season': season_year})
            else:
                print(f"League ID {lid}: No current season found.")
        else:
            print(f"Error fetching league {lid}: {resp.status_code}")

    if not friendlies_ids:
        print("No friendly leagues found.")
        return

    # 2. Check Fixtures
    today = datetime.now().strftime("%Y-%m-%d") # Context: 2026-01-14
    # Note: user might be in a different timezone, but we use system time or the one provided in context.
    # The prompt says 2026年1月14日.
    print(f"\nChecking fixtures for today ({today})...")
    
    total_fixtures = []
    
    for league in friendlies_ids:
        print(f"\nChecking {league['name']} (ID: {league['id']})...")
        
        # Check LIVE first
        # We can't filter live by league in one call effectively if we want to be sure, 
        # but 'live=all' is global. Let's try fetching by date and league.
        url = f"{API_URL}/fixtures"
        params = {"league": league['id'], "season": league['season'], "date": today}
        resp = requests.get(url, headers=HEADERS, params=params)
        
        matches = []
        if resp.status_code == 200:
            matches = resp.json().get('response', [])
            print(f"  Found {len(matches)} matches scheduled/live for today.")
            total_fixtures.extend(matches)
        else:
            print(f"  Error fetching fixtures: {resp.status_code}")

    if not total_fixtures:
        print("No friendly matches found today to check odds for.")
        return

    # 3. Check Odds for found fixtures
    print(f"\nVerifying Odds for non-cancelled matches (checking up to 20)...")
    count_checked = 0
    odds_found_count = 0
    
    for m in total_fixtures:
        if count_checked >= 20: break
        
        status = m['fixture']['status']['short']
        if status in ['CANC', 'PST', 'ABD', 'WO']:
            continue # Skip cancelled/postponed
            
        fid = m['fixture']['id']
        home = m['teams']['home']['name']
        away = m['teams']['away']['name']
        
        print(f"  Checking: {home} vs {away} [{status}] (ID: {fid})")
        
        # Fetch Odds
        url = f"{API_URL}/odds"
        params = {"fixture": fid}
        resp = requests.get(url, headers=HEADERS, params=params)
        
        count_checked += 1
        
        if resp.status_code == 200:
            odds_data = resp.json().get('response', [])
            if odds_data:
                bookmakers = odds_data[0]['bookmakers']
                if bookmakers:
                    print(f"    -> [ODDS FOUND] {len(bookmakers)} bookmakers. Example: {bookmakers[0]['name']}")
                    odds_found_count += 1
                    # If we find one, we can define that coverage exists but is spotty.
                else:
                    print(f"    -> [NO BOOKMAKERS]")
            else:
                print(f"    -> [NO ODDS OBJECT]")
        else:
            print(f"    -> Error fetching odds: {resp.status_code}")

    print(f"\nSummary: Found odds for {odds_found_count} out of {count_checked} valid matches checked.")

if __name__ == "__main__":
    check_friendlies_odds()
