import requests
import json

API_KEY = "8b86ae86981996818bbdcafafa10717f"
API_URL = "https://v3.football.api-sports.io/odds/live"

headers = {
    'x-apisports-key': API_KEY,
    'x-rapidapi-host': "v3.football.api-sports.io"
}

# Fetch live odds for all matches
try:
    print("Fetching live odds...")
    response = requests.get(API_URL, headers=headers, timeout=10)
    data = response.json()
    
    if 'response' in data and len(data['response']) > 0:
        print(f"Got live odds for {len(data['response'])} matches.")
        # Print the first one to see structure
        print(json.dumps(data['response'][0], indent=2))
    else:
        print("No live odds available or empty response.")
        print(data)

except Exception as e:
    print(f"Error: {e}")
