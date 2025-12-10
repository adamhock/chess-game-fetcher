// src/latestGame.ts
import fetch from "node-fetch";

type LatestDetails = {
  rating: number;
}

type ProfileDetails = {
  last: LatestDetails;
}

type ChessComProfile = {
  chess_blitz: ProfileDetails;
};

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

const username = "ahock1620";

async function getRating() {
  console.log("Getting Rating...");
  const url = `https://api.chess.com/pub/player/${username}/stats`;

  const res = await fetch(url);

  const profile = await res.json() as ChessComProfile;

  console.log("Your blitz rating is " + profile.chess_blitz.last.rating)
  return profile.chess_blitz.last.rating;
}

async function getLatestGame() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const url = `https://api.chess.com/pub/player/${username}/games/${year}/${month}`;

  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`Chess.com API returned ${res.status} ${res.statusText}`);
  }

  const raw = await res.json();

  if (!isGamesResponse(raw)) {
    throw new Error("Unexpected response shape from Chess.com API");
  }

  const games = raw.games;
  if (!games.length) {
    console.log("No games found for this month.");
    return "";
  }

  const latest = games[games.length - 1];
  console.log("Latest game:");
  console.log({
    url: latest.url,
    white: latest.white,
    black: latest.black,
    pgn: latest.pgn?.slice(0, 500) ?? "(no pgn)"
  });

  if (!latest.pgn) {
    throw new Error("Unexpected response shape from Chess.com API");
  }

  return latest.pgn;
}

export async function getLatestDetails() {
  const latestPgn = await getLatestGame();
  const rating = await getRating();
  console.log('test');
  return {latestPgn, rating};
}

// Run and catch errors so the program doesn't crash silently
getLatestDetails().catch(err => {
  console.error("Error fetching latest game:", err);
  process.exitCode = 1;
});