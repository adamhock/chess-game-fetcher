import { getLatestDetails } from "./latest.js";
import { generateReport } from "./report.js";
import { analyze } from "./stockfish.js";

const DEFAULT_DEPTH = 18; // increase for better quality (but slower)

export async function main(): Promise<string> {
  console.log("Fetching latest game...");

  const {latestPgn, rating} = await getLatestDetails();

  console.log("Running Stockfish analysis...");
  const accuracy = await analyze(latestPgn, DEFAULT_DEPTH);

  console.log("Evaluating compared to history...");
  const summary = generateReport(accuracy, rating);

  return summary;
}
