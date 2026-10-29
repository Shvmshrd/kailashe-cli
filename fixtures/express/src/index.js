const express = require("express");
const app = express();
const url = process.env.DATABASE_URL;
app.get("/", (req, res) => res.send("ok"));
app.listen(3000);
