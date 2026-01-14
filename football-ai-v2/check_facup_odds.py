import requests
import json
from datetime import datetime

API_KEY = "8b86ae86981996818bbdcafafa10717f"
API_URL = "https://v3.football.api-sports.io"
HEADERS = {
    'x-apisports-key': API_KEY,
    'x-rapidapi-host': "v3.football.api-sports.io"
}

def check_facup_odds():
    print("Checking FA Cup (League ID 45) status...")
    
    # 1. Check League Coverage
    url = f"{API_URL}/leagues"
    params = {"id": 45, "current": "true"}
    resp = requests.get(url, headers=HEADERS, params=params)
    if resp.status_code == 200:
        data = resp.json().get('response', [])
        if data:
            coverage = data[0]['seasons'][0]['coverage']
            print(f"League Coverage (Odds): {coverage.get('odds')}")
        else:
            print("No active season found for FA Cup.")
    else:
        print(f"Error fetching league info: {resp.status_code}")

    # 2. Check Today's Fixtures
    today = datetime.now().strftime("%Y-%m-%d")
    print(f"\nChecking fixtures for today ({today})...")
    url = f"{API_URL}/fixtures"
    params = {"league": 45, "season": 2024, "date": today} # Trying 2024 season (adjust if needed, usually 2024 for 24/25)
    # The current date is Jan 2026 in the user prompt context, so season might be 2025.
    # Let's try to get the current season from step 1 if possible, or just guess 2025.
    
    # Actually, let's just use 'live=all' and filter for league 45 to see if any are playing NOW.
    print(f"Checking LIVE fixtures...")
    url = f"{API_URL}/fixtures"
    params = {"live": "all"}
    resp = requests.get(url, headers=HEADERS, params=params)
    
    facup_matches = []
    if resp.status_code == 200:
        matches = resp.json().get('response', [])
        for m in matches:
            if m['league']['id'] == 45:
                facup_matches.append(m)
        
        print(f"Found {len(facup_matches)} LIVE FA Cup matches.")
    
    if not facup_matches:
        # Fallback: Check scheduled for today (User context is 2026-01-14)
        # Note: In 2026, Jan 14 is a Wednesday. FA Cup 3rd/4th rounds are usually Jan.
        params = {"league": 45, "date": today, "season": 2025} # Assuming 2025-2026 season
        resp = requests.get(url, headers=HEADERS, params=params)
        if resp.status_code == 200:
            facup_matches = resp.json().get('response', [])
            print(f"Found {len(facup_matches)} scheduled FA Cup matches for today.")

    if not facup_matches:
        print("No matches found for verification.")
        return

    # 3. Check Odds for the first found match
    fixture_id = facup_matches[0]['fixture']['id']
    print(f"\nChecking Odds for Fixture ID: {fixture_id} ({facup_matches[0]['teams']['home']['name']} vs {facup_matches[0]['teams']['away']['name']})")
    
    # Check Pre-match odds
    url = f"{API_URL}/odds"
    params = {"fixture": fixture_id}
    resp = requests.get(url, headers=HEADERS, params=params)
    odds_data = resp.json().get('response', [])
    print(f"Pre-match available bookmakers: {len(odds_data)}")
    
    # Check Live odds
    url = f"{API_URL}/odds/live"
    params = {"fixture": fixture_id}
    resp = requests.get(url, headers=HEADERS, params=params)
    live_odds_data = resp.json().get('response', [])
    print(f"Live available bookmakers: {len(live_odds_data)}")
    
    if live_odds_data:
        print("Sample Live Odds:", json.dumps(live_odds_data[0]['odds'][0], indent=2))

if __name__ == "__main__":
    check_facup_odds()
