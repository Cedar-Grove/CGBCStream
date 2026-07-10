import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { getInputStatus } from "../input/inputMonitor.js";

export type RelayStatus = "stopped" | "waiting" | "starting" | "running" | "error";

export interface RelayState {
  status: RelayStatus;
  startedAt: string | null;
  restarts: number;
  lastError: string | null;
  bitrateKbps: number | null;
}

// Backoff for auto-restart after an unexpected ffmpeg exit while the input
// genuinely was live (a real failure) — caps out so a persistent problem
// doesn't spin-loop ffmpeg.
const RESTART_BACKOFF_MS = [1000, 2000, 5000, 10000, 30000];

// How often to re-check for input while armed but nothing's live yet.
const WAITING_POLL_MS = 5000;

const BITRATE_PATTERN = /bitrate=\s*([\d.]+)\s*kbits\/s/;

export class FfmpegRelay {
  private process: ChildProcessWithoutNullStreams | null = null;
  private state: RelayState = {
    status: "stopped",
    startedAt: null,
    restarts: 0,
    lastError: null,
    bitrateKbps: null,
  };
  private stopRequested = false;
  private restartTimer: NodeJS.Timeout | null = null;
  private waitingTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly sourceUrl: string,
    private readonly destUrl: string,
  ) {}

  getStatus(): RelayState {
    return { ...this.state };
  }

  start(): void {
    if (this.process || this.waitingTimer) return;
    this.stopRequested = false;
    this.state.restarts = 0;
    this.attemptStart();
  }

  stop(): void {
    this.stopRequested = true;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    if (this.waitingTimer) {
      clearTimeout(this.waitingTimer);
      this.waitingTimer = null;
    }
    this.process?.kill("SIGTERM");
    this.process = null;
    this.state.status = "stopped";
    this.state.startedAt = null;
    this.state.bitrateKbps = null;
  }

  /** Only spawns ffmpeg once there's an actual signal to relay — being "enabled" with nothing to stream yet is normal, not an error. */
  private async attemptStart(): Promise<void> {
    if (this.stopRequested) return;
    const input = await getInputStatus();
    if (this.stopRequested) return;
    if (!input.live) {
      this.state.status = "waiting";
      this.state.lastError = null;
      this.waitingTimer = setTimeout(() => {
        this.waitingTimer = null;
        this.attemptStart();
      }, WAITING_POLL_MS);
      return;
    }
    this.spawnProcess();
  }

  private spawnProcess(): void {
    this.state.status = "starting";
    this.state.bitrateKbps = null;

    const child = spawn("ffmpeg", [
      "-nostdin",
      "-loglevel", "warning",
      "-stats",
      "-i", this.sourceUrl,
      "-c", "copy",
      "-f", "flv",
      this.destUrl,
    ]);
    this.process = child;

    child.stderr.on("data", (chunk: Buffer) => {
      const line = chunk.toString().trim();
      if (!line) return;
      console.log(`[ffmpeg] ${line}`);
      const match = line.match(BITRATE_PATTERN);
      if (match) this.state.bitrateKbps = Number(match[1]);
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
      this.state.bitrateKbps = null;
      this.handleUnexpectedExit(code, signal);
    });
  }

  /** Distinguishes "the source disappeared" (expected, go back to waiting) from a genuine failure while input was actually live (real error, retry with backoff). */
  private async handleUnexpectedExit(code: number | null, signal: NodeJS.Signals | null): Promise<void> {
    if (this.stopRequested) return;
    const input = await getInputStatus();
    if (this.stopRequested) return;
    if (!input.live) {
      this.state.restarts = 0;
      this.attemptStart();
      return;
    }
    this.state.status = "error";
    this.state.lastError = `ffmpeg exited (code=${code}, signal=${signal})`;
    this.scheduleRestart();
  }

  private scheduleRestart(): void {
    const delay =
      RESTART_BACKOFF_MS[Math.min(this.state.restarts, RESTART_BACKOFF_MS.length - 1)];
    this.state.restarts += 1;
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      if (!this.stopRequested) this.spawnProcess();
    }, delay);
  }
}
