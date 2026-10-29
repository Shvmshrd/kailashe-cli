import os
from fastapi import FastAPI
app = FastAPI()
db = os.getenv("DATABASE_URL")
cache = os.environ.get("REDIS_URL")
@app.get("/")
def root():
    return {"ok": True}
