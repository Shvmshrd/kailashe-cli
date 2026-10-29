package main

import (
  "net/http"
  "os"
)

func main() {
  _ = os.Getenv("DATABASE_URL")
  _ = http.ListenAndServe(":8080", nil)
}
