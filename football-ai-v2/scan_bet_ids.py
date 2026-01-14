import requests
import json
from datetime import datetime

API_KEY = "8b86ae86981996818bbdcafafa10717f"
headers = {
    'x-apisports-key': API_KEY,
    'x-rapidapi-host': "v3.football.api-sports.io"
}

def scan_all_bets():
    today = datetime.now().strftime("%Y-%m-%d")
    league_id = 78 # Bundesliga
    season = 2025
    
    url = "https://v3.football.api-sports.io/odds"
    params = {
        "league": league_id,
        "season": season,
        "date": today,
        "bookmaker": 1 # Bet365
    }
    
    print("Fetching full odds details...")
    resp = requests.get(url, headers=headers, params=params)
    
    if resp.status_code == 200:
        data = resp.json()
        matches = data.get('response', [])
        if matches:
            m = matches[0]
            print(f"Match: {m['fixture']['id']}")
            for book in m['bookmakers']:
                print(f"Bookmaker: {book['name']} (ID: {book['id']})")
                for bet in book['bets']:
                    print(f"  ID: {bet['id']} | Name: {bet['name']}")
                    # Print first value to see structure
                    if bet['values']:
                        print(f"    Sample: {bet['values'][0]}")
        else:
            print("No matches found.")

if __name__ == "__main__":
    scan_all_bets()