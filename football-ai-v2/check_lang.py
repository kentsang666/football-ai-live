import requests
import json

headers = {
    'x-apisports-key': '8b86ae86981996818bbdcafafa10717f', 
    'x-rapidapi-host': "v3.football.api-sports.io"
}

# 1. Check Countries
print("--- Countries ---")
try:
    resp = requests.get('https://v3.football.api-sports.io/countries', headers=headers)
    data = resp.json()['response']
    # Print only China to see if it has localization fields
    for c in data:
        if c['name'] == 'China' or c['code'] == 'CN':
            print(c)
    # Print first few to see language
    print(data[:3])
except Exception as e:
    print(e)
    
# 2. Check Team info for a major team (e.g. Man City id 50)
print("\n--- Team (Man City) with lang=zh ---")
try:
    # Try search param
    resp = requests.get('https://v3.football.api-sports.io/teams?id=50&lang=zh', headers=headers)
    print(resp.json()) # Print full check
except:
    pass
