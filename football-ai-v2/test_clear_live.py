import requests
import json
import time

BASE_URL = "http://localhost:8000"

def test_clear_history():
    print(f"Testing Clear History API on {BASE_URL}...")
    
    # 1. Get current history count
    try:
        r = requests.get(f"{BASE_URL}/api/history")
        r.raise_for_status()
        initial_history = r.json()
        print(f"Initial history count: {len(initial_history)}")
    except Exception as e:
        print(f"Failed to get initial history: {e}")
        return

    # 2. Call Clear API
    print("Calling /api/history/clear...")
    try:
        r = requests.post(f"{BASE_URL}/api/history/clear")
        print(f"Clear response status: {r.status_code}")
        print(f"Clear response body: {r.text}")
        r.raise_for_status()
    except Exception as e:
        print(f"Failed to call clear API: {e}")
        return

    # 3. Verify history is empty
    print("Verifying history is empty...")
    try:
        r = requests.get(f"{BASE_URL}/api/history")
        r.raise_for_status()
        final_history = r.json()
        print(f"Final history count: {len(final_history)}")
        
        if len(final_history) == 0:
            print("SUCCESS: History cleared.")
        else:
            print(f"FAILURE: History not cleared. Remaining: {len(final_history)}")
            
    except Exception as e:
        print(f"Failed to verify history: {e}")

if __name__ == "__main__":
    test_clear_history()
