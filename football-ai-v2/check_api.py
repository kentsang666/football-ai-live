import urllib.request
import json
import traceback

try:
    print("Attempting to connect to http://127.0.0.1:8000/api/live...")
    with urllib.request.urlopen('http://127.0.0.1:8000/api/live') as response:
        data = response.read()
        print(f"Response received. Size: {len(data)} bytes")
        
        try:
            json_data = json.loads(data)
            print("JSON parsing successful.")
            print(f"Match count: {json_data.get('count')}")
            
            # Check for NaN validation manually just in case
            if b'NaN' in data:
                print("WARNING: 'NaN' found in raw response text! This breaks JS.")
            else:
                print("No 'NaN' text found.")
                
        except json.JSONDecodeError as e:
            print(f"JSON Decode Error: {e}")
            print(f"Partial response: {data[:200]}")
            
except Exception as e:
    print(f"Connection/Request failed: {e}")
    traceback.print_exc()
