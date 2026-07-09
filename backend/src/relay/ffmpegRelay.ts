import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

export type RelayStatus = "stopped" | "starting" | "running" | "error";

export interface RelayState {
  status: RelayStatus;
  startedAt: string | null;
  restarts: number;
  lastError: string | null;
}

// Backoff for auto-restart after an unexpected ffmpeg exit (e.g. source
// dropped mid-service) — caps out so a persistently down source doesn't
// spin-loop ffmpeg.
const RESTART_BACKOFF_MS = [1000, 2000, 5000, 10000, 30000];

export class FfmpegRelay {
  private process: ChildProcessWithoutNullStreams | null = null;
  private state: RelayState = {
    status: "stopped",
    startedAt: null,
    restarts: 0,
    lastError: null,
  };
  private stopRequested = false;
  private restartTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly sourceUrl: string,
    private readonly destUrl: string,
  ) {}

  getStatus(): RelayState {
    return { ...this.state };
  }

  start(): void {
    if (this.process) return;
    this.stopRequested = false;
    this.state.restarts = 0;
    this.spawnProcess();
  }

  stop(): void {
    this.stopRequested = true;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    this.process?.kill("SIGTERM");
    this.process = null;
    this.state.status = "stopped";
    this.state.startedAt = null;
  }

  private spawnProcess(): void {
    this.state.status = "starting";

    const child = spawn("ffmpeg", [
      "-loglevel", "warning",
      "-i", this.sourceUrl,
      "-c", "copy",
      "-f", "flv",
      this.destUrl,
    ]);
    this.process = child;

    child.stderr.on("data", (chunk: Buffer) => {
      const line = chunk.toString().trim();
      if (line) console.log(`[ffmpeg] ${line}`);
    });

    child.on("spawn", () => {
      this.state.status = "running";
      this.state.startedAt = new Date().toISOString();
      this.state.lastError = null;
    });

    child.on("error", (err) => {
      this.state.status = "error";
      this.state.lastError = err.message;
    });

    child.on("exit", (code, signal) => {
      this.process = null;
      if (this.stopRequested) {
        this.state.status = "stopped";
        return;
      }
      this.state.status = "error";
      this.state.lastError = `ffmpeg exited (code=${code}, signal=${signal})`;
      this.scheduleRestart();
    });
  }

  private scheduleRestart(): void {
    const delay =
      RESTART_BACKOFF_MS[Math.min(this.state.restarts, RESTART_BACKOFF_MS.length - 1)];
    this.state.restarts += 1;
    this.restartTimer = setTimeout(() => {
      if (!this.stopRequested) this.spawnProcess();
    }, delay);
  }
}
