from translation_utils import trans_team

teams = ["Manchester City", "Unknown Team FC", "Arsenal", None]
for t in teams:
    res = trans_team(t)
    print(f"'{t}' -> '{res}' (Type: {type(res)})")
