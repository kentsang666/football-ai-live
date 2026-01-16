import requests

try:
    resp = requests.post("http://localhost:8000/api/history/clear")
    print(f"Status: {resp.status_code}")
    print(f"Body: {resp.text}")
except Exception as e:
    print(f"Error: {e}")
