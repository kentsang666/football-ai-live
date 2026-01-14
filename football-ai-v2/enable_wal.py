import sqlite3

def enable_wal_mode():
    try:
        conn = sqlite3.connect('football_prediction_v2.db')
        cursor = conn.cursor()
        cursor.execute('PRAGMA journal_mode=WAL;')
        result = cursor.fetchone()
        print(f"WAL mode set. Result: {result}")
        conn.close()
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    enable_wal_mode()
