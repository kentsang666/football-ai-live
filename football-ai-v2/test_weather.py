import requests
import os

# 配置
API_KEY = os.getenv("OWM_API_KEY", "a6967e0888abfd4d1cf9a629657617b5")
CITY = "London"

def test_weather():
    if not API_KEY:
        print("❌ API Key Not Found!")
        return

    url = f"http://api.openweathermap.org/data/2.5/weather?q={CITY}&appid={API_KEY}&units=metric"
    print(f">>> Testing OpenWeatherMap API for [{CITY}]...")
    
    try:
        resp = requests.get(url, timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            temp = data['main']['temp']
            weather = data['weather'][0]['main']
            desc = data['weather'][0]['description']
            print(f"✅ Success! Status: {resp.status_code}")
            print(f"   Temp: {temp}°C")
            print(f"   Weather: {weather} ({desc})")
        else:
            print(f"❌ Failed! Status: {resp.status_code}")
            print(f"   Response: {resp.text}")
            
    except Exception as e:
        print(f"❌ Exception: {e}")

if __name__ == "__main__":
    test_weather()