import requests
import json
from datetime import datetime

match_id = 1434037 # Cardiff U21
url = f"https://v3.football.api-sports.io/fixtures?id={match_id}"
headers = {
    'x-rapidapi-host': "v3.football.api-sports.io",
    'x-rapidapi-key': "8b86ae86981996818bbdcafafa10717f"
}

resp = requests.get(url, headers=headers)
data = resp.json()['response'][0]
print(f"Match ID: {match_id}")
print(f"Date (UTC): {data['fixture']['date']}")
print(f"Timestamp: {data['fixture']['timestamp']}")
print(f"Status: {data['fixture']['status']}")

# Check system time
print(f"System Time: {datetime.now()}")
