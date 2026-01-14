
import requests
import datetime
import sys

API_KEY_1 = "8b86ae86981996818bbdcafafa10717f" 
API_KEY_2 = "8056557685c490a60424687d4a529367"
API_URL = "https://v3.football.api-sports.io/fixtures?live=all"

def check_key(key, name):
    print(f"--- Checking {name} ---")
    headers = {
        'x-apisports-key': key,
        'x-rapidapi-host': "v3.football.api-sports.io"
    }
    try:
        start = datetime.datetime.now()
        r = requests.get("https://v3.football.api-sports.io/status", headers=headers, timeout=10)
        print(f"Status Code: {r.status_code}")
        if r.status_code == 200:
            data = r.json()
            print(f"Account: {data['response']['account']}")
            print(f"Subscription: {data['response']['subscription']}")
            print(f"Requests: {data['response']['requests']}")
        else:
            print(f"Error: {r.text}")
    except Exception as e:
        print(f"Exception: {e}")

    # Check Live
    try:
        r = requests.get(API_URL, headers=headers, timeout=10)
        print(f"Live Matches Status: {r.status_code}")
        if r.status_code == 200:
            data = r.json()
            count = data.get('results', 0)
            print(f"Live Matches Count: {count}")
            if count == 0:
                print("Response payload:", str(data)[:200])
        else:
            print(f"Live Matches Error: {r.text}")
    except Exception as e:
        print(f"Live Exception: {e}")

print(f"Current System Time: {datetime.datetime.now()}")
print(f"Current System Time (Time only): {datetime.datetime.now().time()}")

check_key(API_KEY_1, "Key 1 (Original)")
check_key(API_KEY_2, "Key 2 (Backup)")
