# Test helper: print the admin's 2FA secret from a TEST data folder (never run against the real server data).
import os, sys, json
os.environ["FYERS_HELPER_DATA"] = sys.argv[1]
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from helper import users
d = users._load(); u = next(x for x in d["users"].values() if x["username"] == "admin")
print(users.unseal(u["totp"]))
