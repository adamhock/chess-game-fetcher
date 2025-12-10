// src/latestGame.ts
import fetch from "node-fetch";
import { analyze } from "./analyze.js";

type Archives = {
  archives: string[];
}
type ChessComGame = {
  url: string;
  white?: string;
  black?: string;
  pgn?: string;
  // chess.com returns other fields; we only care about these for now
};

type GamesResponse = {
  games: ChessComGame[];
};

// Type guard to narrow unknown -> GamesResponse
function isGamesResponse(obj: unknown): obj is GamesResponse {
  if (!obj || typeof obj !== "object") return false;
  const maybe = obj as { [k: string]: unknown };
  if (!("games" in maybe)) return false;
  return Array.isArray(maybe.games);
}

const username = "ahock1620"; // <-- change this

async function getLatestGame() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");



  // const archivesUrl = `https://api.chess.com/pub/player/${username}/games/archives`;

  // const archivesRes = await fetch(archivesUrl);

  // if (!archivesRes.ok) {
  //   throw new Error(`Chess.com API returned ${archivesRes.status} ${archivesRes.statusText}`);
  // }

  // const archives = (await archivesRes.json() as Archives).archives;

  // if (archives.length == 0) {
  //   throw new Error(`archives list returned empty`);
  // }

  // const url = archives[archives.length-1];

  const url = `https://api.chess.com/pub/player/${username}/games/${year}/${month}`
  console.log ("this is the url " +  url);

  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`Chess.com API returned ${res.status} ${res.statusText}`);
  }

  const raw = await res.json(); // raw is `unknown` type

  if (!isGamesResponse(raw)) {
    throw new Error("Unexpected response shape from Chess.com API");
  }

  const games = raw.games;
  if (!games.length) {
    console.log("No games found for this month.");
    return;
  }

  const latest = games[games.length - 1];
  console.log("Latest game:");
  console.log({
    url: latest.url,
    white: latest.white,
    black: latest.black,
    pgn: latest.pgn?.slice(0, 500) ?? "(no pgn)"
  });

  return analyze(latest.pgn!);
}

// Run and catch errors so the program doesn't crash silently
getLatestGame().catch(err => {
  console.error("Error fetching latest game:", err);
  process.exitCode = 1;
});