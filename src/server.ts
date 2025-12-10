// src/server.ts
import express, { Request, Response } from "express";
import { main } from "./main.js";

const app = express();
const PORT = process.env.PORT || 3000;

// Explicit types added here for TS safety:
app.get("/summary", async (_req: Request, res: Response) => {
  try {
    const message = await main();

    await fetch(`https://maker.ifttt.com/trigger/chess_result/with/key/${process.env.IFTTT_KEY}`, {
      method: "POST",
      headers: { "Content-Type":"application/json" },
      body: JSON.stringify({ value1: message })
    });

    return res.json({ fulfillmentText: message });
  } catch (err) {
    console.error("Error executing analysis:", err);
    return res.status(500).json({ error: "Failed to analyze the game" });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
