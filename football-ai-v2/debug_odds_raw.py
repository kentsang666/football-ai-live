import requests
import json
from datetime import datetime

# API Key from context
API_KEY = "8b86ae86981996818bbdcafafa10717f"
headers = {
    'x-apisports-key': API_KEY,
    'x-rapidapi-host': "v3.football.api-sports.io"
}

def debug_odds():
    today = datetime.now().strftime("%Y-%m-%d")
    # Premier League ID: 39 (England) - checking a major league ensures odds usually exist
    # But today's list had ID 762 (Jamaica), 78 (Bundesliga), etc.
    # Let's check Bundesliga (ID 78) for valid odds structure
    
    league_id = 78 
    season = 2025 # Assuming current season
    
    print(f"Fetching odds for League {league_id}, Date {today}...")
    
    url = "https://v3.football.api-sports.io/odds"
    params = {
        "league": league_id,
        "season": season,
        "date": today,
        "bookmaker": 1 # Bet365
    }
    
    resp = requests.get(url, headers=headers, params=params)
    print(f"Status: {resp.status_code}")
    
    if resp.status_code == 200:
        data = resp.json()
        matches = data.get('response', [])
        print(f"Matches with odds found: {len(matches)}")
        
        if matches:
            first_match = matches[0]
            print(f"Match ID: {first_match['fixture']['id']}")
            bookmakers = first_match['bookmakers']
            if bookmakers:
                bets = bookmakers[0]['bets']
                print(f"Bookmaker: {bookmakers[0]['name']}")
                
                # Check AH (ID 5)
                ah_bet = next((b for b in bets if b['id'] == 5), None)
                if ah_bet:
                    print("\n--- Asian Handicap (ID 5) Raw Values ---")
                    print(json.dumps(ah_bet['values'][:5], indent=2)) # Show first 5
                else:
                    print("No AH (ID 5) found.")

                # Check OU (ID 6)
                ou_bet = next((b for b in bets if b['id'] == 6), None)
                if ou_bet:
                    print("\n--- Over/Under (ID 6) Raw Values ---")
                    print(json.dumps(ou_bet['values'][:5], indent=2))
                else:
                    print("No O/U (ID 6) found.")
    else:
        print(resp.text)

if __name__ == "__main__":
    debug_odds()