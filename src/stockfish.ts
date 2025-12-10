// src/analyze.ts
import { spawn, ChildProcessWithoutNullStreams } from "child_process";
import fs from "fs";
import path from "path";
import { Chess } from "chess.js";
import { generateReport } from "./report.js";

/**
 * Config
 */
const STOCKFISH_CMD = "C:\\stockfish\\stockfish.exe"; // or full path e.g. "/usr/local/bin/stockfish" or "stockfish.exe"

/**
 * Utility: run UCI command and capture info
 */
class UciEngine {
  proc: ChildProcessWithoutNullStreams;
  buffer: string = "";
  onLine: ((line: string) => void) | null = null;

  constructor(cmd = STOCKFISH_CMD) {
    this.proc = spawn(STOCKFISH_CMD, [], { stdio: "pipe" });
    this.proc.stdout.setEncoding("utf8");
    this.proc.stderr.setEncoding("utf8");

    this.proc.stdout.on("data", (chunk: string) => {
      this.buffer += chunk;
      const lines = this.buffer.split("\n");
      this.buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (this.onLine) this.onLine(line.trim());
      }
    });

    this.proc.stderr.on("data", (c) => {
      // Some stockfish builds don't use stderr; we ignore but you can log if needed
      // console.error("engine stderr:", c);
    });

    // UCI init
    this.send("uci");
  }

  send(cmd: string) {
    // console.log(">>", cmd);
    this.proc.stdin.write(cmd + "\n");
  }

  async waitForLineMatching(predicate: (line: string) => boolean, timeout = 15000) {
    return new Promise<string>((resolve, reject) => {
      const t = setTimeout(() => {
        this.onLine = null;
        reject(new Error("Timeout waiting for engine line"));
      }, timeout);

      const handler = (line: string) => {
        if (predicate(line)) {
          clearTimeout(t);
          this.onLine = null;
          resolve(line);
        }
      };

      this.onLine = handler;
    });
  }

  async quit() {
    this.send("quit");
    // allow process to exit
    await new Promise((r) => setTimeout(r, 50));
  }
}

/**
 * Parse a UCI "score" from an engine info line.
 * Returns centipawns from White's perspective. For mate scores, we convert to large centipawn values.
 */
function parseScoreFromInfoLine(line: string): number | null {
  // example lines: "info depth 12 score cp 34 ...", "info depth 20 score mate 3 ...", or "info score cp -14"
  const cpMatch = line.match(/score cp (-?\d+)/);
  if (cpMatch) return parseInt(cpMatch[1], 10);

  const mateMatch = line.match(/score mate (-?\d+)/);
  if (mateMatch) {
    const mateDistance = parseInt(mateMatch[1], 10);
    // Convert a mate to a large centipawn number
    // positive mate => White mating, negative => Black mating
    const sign = mateDistance >= 0 ? 1 : -1;
    const mag = 100000 - Math.abs(mateDistance);
    return sign * mag;
  }

  return null;
}

/**
 * Evaluate a FEN position at given depth. Returns centipawn eval from White's perspective.
 * This positions the engine and runs `go depth`.
 */
async function evalPosition(engine: UciEngine, fen: string, depth: number): Promise<number> {
  // Position
  engine.send(`position fen ${fen}`);
  // Clear previous search state; ask for search to depth
  engine.send(`go depth ${depth}`);

  let lastScore: number | null = null;

  // Listen to lines until "bestmove" appears; capture the last "info ... score ..." encountered
  return new Promise<number>((resolve, reject) => {
    const timeout = setTimeout(() => {
      engine.onLine = null;
      reject(new Error("Engine timed out during evalPosition"));
    }, 60000); // 60s per search guard; adjust if you raise depth

    engine.onLine = (line: string) => {
      // capture score lines
      const possible = parseScoreFromInfoLine(line);
      if (possible !== null) lastScore = possible;

      if (line.startsWith("bestmove")) {
        clearTimeout(timeout);
        engine.onLine = null;
        if (lastScore === null) {
          // if engine didn't output a score, treat as 0
          resolve(0);
        } else {
          resolve(lastScore);
        }
      }
    };
  });
}

/**
 * Compute accuracy from PGN using per-move centipawn loss mapping.
 */
export async function analyze(pgn: string, depth: number) {
  console.log("starting analysis");
  const chess = new Chess();
  chess.loadPgn(pgn, { strict: false });

  // Build move list with FENs before and after each move
  const history = chess.history({ verbose: true });
  // We'll re-play from start to capture fen before each move
  const game = new Chess();
  const moveRecords: { moveSan: string; fromFen: string; toFen: string; turnBefore: "w" | "b" }[] = [];

  for (const mv of history) {
    const fenBefore = game.fen();
    const turnBefore = game.turn() as "w" | "b";
    // apply move
    game.move(mv.san, { strict: false });
    const fenAfter = game.fen();
    moveRecords.push({ moveSan: mv.san, fromFen: fenBefore, toFen: fenAfter, turnBefore });
  }

  // Start engine
  const engine = new UciEngine(STOCKFISH_CMD);

  // give engine a short moment to be ready
  await new Promise((r) => setTimeout(r, 200));
  // Tell engine to use UCI (already sent in constructor) and isready
  engine.send("isready");
  await engine.waitForLineMatching((l) => l === "readyok", 5000);

  const moveScores: { idx: number; move: string; cpl: number; score: number }[] = [];

  for (let i = 0; i < moveRecords.length; i++) {
    const rec = moveRecords[i];
    // 1) Ask the engine for its suggested best move from the fenBefore
    engine.send(`position fen ${rec.fromFen}`);
    engine.send(`go depth ${depth}`);
    // capture bestmove and the last score for the root
    const bestMoveLine = await engine.waitForLineMatching((l) => l.startsWith("bestmove"), 60000);
    // From the time we asked "go", the engine also produced info lines containing score.
    // But we want to evaluate the position after the best move *explicitly* and after the played move,
    // to get comparable evals (this is more robust).
    // Extract the engine's bestmove from the bestMoveLine:
    const bmMatch = bestMoveLine.match(/^bestmove\s+([a-h][1-8][a-h][1-8qrbn]?)\b/);
    const bestMoveUci = bmMatch ? bmMatch[1] : null;

    // Apply bestMoveUci to fenBefore to make fenAfterBest
    // Use chess.js for move application:
    const temp = new Chess(rec.fromFen);
    if (!bestMoveUci) {
      // if engine failed to provide a bestmove, skip scoring for this move
      continue;
    }
    try {
      // convert UCI to SAN? chess.js supports move by {from,to,promotion}
      const from = bestMoveUci.slice(0, 2);
      const to = bestMoveUci.slice(2, 4);
      const promotion = bestMoveUci.length > 4 ? bestMoveUci[4] : undefined;
      temp.move({ from, to, promotion } as any);
    } catch (e) {
      // if bestmove can't be applied, skip
      continue;
    }
    const fenAfterBest = temp.fen();

    // Evaluate fenAfterBest and fenAfterPlayed
    const evalBest = await evalPosition(engine, fenAfterBest, depth);
    const evalPlayed = await evalPosition(engine, rec.toFen, depth);

    // Convert evals (which are from White's perspective) to the perspective of the player who moved.
    const playerMultiplier = rec.turnBefore === "w" ? 1 : -1;
    const evalBestPersp = evalBest * playerMultiplier;
    const evalPlayedPersp = evalPlayed * playerMultiplier;

    // centipawn loss: how much worse the played move is compared to best
    let cpl = evalBestPersp - evalPlayedPersp;
    if (cpl < 0) cpl = 0; // negative loss means played better than engine best at this depth: clamp to 0

    // Map CPL to move score [0..1]
    const moveScore = cplToMoveScore(cpl);

    moveScores.push({ idx: i + 1, move: rec.moveSan, cpl: Math.round(cpl), score: moveScore });
    // (Optional) print progress
    console.log(`move ${i + 1} ${rec.moveSan}: cpl=${Math.round(cpl)} score=${(moveScore * 100).toFixed(1)}%`);
  }

  // Clean up engine
  await engine.quit();

  if (!moveScores.length) {
    return 0;
  }

  const avg = moveScores.reduce((s, m) => s + m.score, 0) / moveScores.length;
  const accuracyPct = avg * 100;

  return accuracyPct;
}

/**
 * A simple CPL -> move score mapping. Tunable.
 * You can tweak breakpoints as you like.
 */
function cplToMoveScore(cpl: number): number {
  if (cpl <= 10) return 1.0;
  if (cpl <= 30) return 0.95;
  if (cpl <= 60) return 0.80;
  if (cpl <= 100) return 0.60;
  if (cpl <= 200) return 0.30;
  return 0.10;
}