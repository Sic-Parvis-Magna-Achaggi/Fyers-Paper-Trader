"""Make a TEST data folder that looks like v0.12 (single page password "OldPass12345"), for the upgrade test.
Usage: python3 tests/make_old_data.py /tmp/fyers_test"""
import hashlib, json, os, secrets, shutil, sys
D = sys.argv[1]
shutil.rmtree(D, ignore_errors=True); os.makedirs(D)
HERE = os.path.dirname(os.path.abspath(__file__))
for f in os.listdir(HERE + "/fixtures"):
    shutil.copy(HERE + "/fixtures/" + f, D)
salt = secrets.token_bytes(16)
json.dump({"pw_hash": hashlib.scrypt(b"OldPass12345", salt=salt, n=2**14, r=8, p=1, dklen=32).hex(), "salt": salt.hex(), "sessions": {}},
          open(D + "/auth.json", "w"))
print("old-style test data in", D)
