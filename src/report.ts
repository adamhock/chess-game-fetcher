// src/evaluateGame.ts
import fs from "fs";
import path from "path";

const HISTORY_FILE = path.join(process.cwd(), "history.json");
const MAX_HISTORY = 100; // number of games to keep

type GameRecord = {
  date: string;      // ISO string
  accuracy: number;  // 0-100
  rating: number;    // Elo at time of game
};

/**
 * Load historical games from JSON
 */
function loadHistory(): GameRecord[] {
  if (!fs.existsSync(HISTORY_FILE)) return [];
  try {
    const data = fs.readFileSync(HISTORY_FILE, "utf8");
    const arr: GameRecord[] = JSON.parse(data);
    return arr.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  } catch (err) {
    console.error("Failed to read history file:", err);
    return [];
  }
}

/**
 * Save historical games to JSON
 */
function saveHistory(history: GameRecord[]) {
  try {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
  } catch (err) {
    console.error("Failed to save history file:", err);
  }
}

/**
 * Compute mean accuracy from an array of games
 */
function computeMeanAccuracy(games: GameRecord[]): number {
  if (!games.length) return 0;
  const sum = games.reduce((acc, g) => acc + g.accuracy, 0);
  return sum / games.length;
}

/**
 * Determine performance label based on difference from mean
 */
function performanceLabel(diff: number): string {
  if (diff >= 10) return "Excellent";
  if (diff >= 5) return "Great";
  if (diff >= 2) return "Good";
  if (diff > -2) return "Fair";
  if (diff > -5) return "Bad";
  if (diff > -10) return "Awful";
  return "Terrible";
}

function verbalSummaryForHome(label: string, diff: number, accuracy: number): string {
  const absDiff = Math.abs(diff).toFixed(1);
  let diffText: string;

  if (diff >= 10) diffText = `over 10% above your recent average`;
  else if (diff <= -10) diffText = `over 10% below your recent average`;
  else if (diff > 0) diffText = `${absDiff}% above your recent average`;
  else if (diff < 0) diffText = `${absDiff}% below your recent average`;
  else diffText = `exactly at your recent average`;

  // Conversational phrasing for Google Home Mini
  switch (label) {
    case "Excellent":
      return `Amazing! You played an excellent game. Your accuracy was ${accuracy}, which is ${diffText}.`;
    case "Great":
      return `Great job! You played a great game. Your accuracy was ${accuracy}, which is ${diffText}.`;
    case "Good":
      return `Nice work! You played a good game. Your accuracy was ${accuracy}, which is ${diffText}.`;
    case "Fair":
      return `You played a fair game. Your accuracy was ${accuracy}, which is ${diffText}.`;
    case "Bad":
      return `Hmm, you played a bad game. Your accuracy was ${accuracy}, which is ${diffText}.`;
    case "Awful":
      return `Ouch, that was an awful game. Your accuracy was ${accuracy}, which is ${diffText}.`;
    case "Terrible":
      return `Yikes! You played a terrible game. Your accuracy was ${accuracy}, which is ${diffText}.`;
    default:
      return `Your game performance was ${label}. Your accuracy was ${accuracy}, which is ${diffText}.`;
  }
}


/**
 * Evaluate game relative to personal history
 */
export function generateReport(
  accuracy: number,
  rating: number
): string {
  console.log("Generating report...");
  const history = loadHistory();

  // Append new game
  const newGame: GameRecord = {
    date: new Date().toISOString(),
    accuracy,
    rating,
  };
  history.unshift(newGame); // add to front

  // Keep only last MAX_HISTORY games
  const trimmedHistory = history.slice(0, MAX_HISTORY);
  saveHistory(trimmedHistory);

  // Compute mean accuracy
  const meanAccuracy = computeMeanAccuracy(trimmedHistory);

  // Compare new game to mean
  const diff = accuracy - meanAccuracy;
  const label = performanceLabel(diff);

  return verbalSummaryForHome(label, diff, accuracy)
}