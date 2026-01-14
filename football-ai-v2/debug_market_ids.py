import requests
import json

API_KEY = "8b86ae86981996818bbdcafafa10717f"
API_URL = "https://v3.football.api-sports.io/odds/live"

headers = {
    'x-apisports-key': API_KEY,
    'x-rapidapi-host': "v3.football.api-sports.io"
}

try:
    print("Fetching live odds...")
    response = requests.get(API_URL, headers=headers, timeout=10)
    data = response.json()
    
    if 'response' in data and len(data['response']) > 0:
        print(f"Got live odds for {len(data['response'])} matches.")
        
        # Check markets for the first few matches
        for i in range(min(3, len(data['response']))):
            fixture = data['response'][i]
            print(f"\nMatch ID: {fixture['fixture']['id']}")
            print("Available Markets:")
            for market in fixture['odds']:
                print(f" - ID: {market['id']}, Name: {market['name']}")
                if "Asian Handicap" in market['name']:
                    print(f"   !!! FOUND ASIAN HANDICAP ID: {market['id']} !!!")
                    print(json.dumps(market['values'][:2], indent=2))
    else:
        print("No live odds available.")

except Exception as e:
    print(f"Error: {e}")
