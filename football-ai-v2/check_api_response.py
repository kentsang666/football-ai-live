import requests
import json

try:
    print("Testing /api/live-matches...")
    response = requests.get('http://localhost:5000/api/live-matches', timeout=5)
    print(f"Status Code: {response.status_code}")
    if response.status_code == 200:
        data = response.json()
        print(f"Count: {data.get('count')}")
        matches = data.get('matches', [])
        if matches:
            print("First match sample:")
            print(json.dumps(matches[0], indent=2))
        else:
            print("Matches list is empty.")
    else:
        print("Error content:")
        print(response.text)
except Exception as e:
    print(f"Request failed: {e}")
