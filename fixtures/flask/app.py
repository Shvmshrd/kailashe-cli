import os
from flask import Flask
app = Flask(__name__)
redis_url = os.getenv("REDIS_URL")
if __name__ == "__main__":
    app.run(port=5000)
