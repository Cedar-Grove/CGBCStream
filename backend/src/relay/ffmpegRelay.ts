import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { getInputStatus } from "../input/inputMonitor.js";
import { assertPrimaryIngest } from "./ingestUrl.js";

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

// How long a SIGTERM'd ffmpeg gets to close its RTMP connection before it is
// killed outright. Until it exits the platform still counts it as a live
// encoder on that stream key.
const KILL_GRACE_MS = 5000;

const BITRATE_PATTERN = /bitrate=\s*([\d.]+)\s*kbits\/s/;

/**
 * Pushes the local source to exactly one destination URL.
 *
 * The invariant that matters to the platforms on the other end: this class
 * never has more than one ffmpeg process alive at a time. Two overlapping
 * processes push the same stream key from two connections, which YouTube
 * reports as the key arriving twice and refuses.
 */
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
  private killTimer: NodeJS.Timeout | null = null;
  // Set while a process is shutting down and a fresh start has been asked
  // for, so the restart happens on that process's exit rather than alongside it.
  private startOnExit = false;

  constructor(
    private readonly sourceUrl: string,
    readonly destUrl: string,
  ) {
    assertPrimaryIngest(destUrl, "the relay destination");
  }

  getStatus(): RelayState {
    return { ...this.state };
  }

  start(): void {
    this.stopRequested = false;
    this.clearRestartTimer();

    // Already armed and waiting for input, or already pushing — either way
    // there is nothing to add, and spawning again would double up.
    if (this.waitingTimer) return;
    if (this.process) {
      // A process that is on its way out (stop() then start()) must finish
      // exiting before the next one may connect.
      if (this.killTimer) this.startOnExit = true;
      return;
    }

    this.state.restarts = 0;
    this.attemptStart();
  }

  stop(): void {
    this.stopRequested = true;
    this.startOnExit = false;
    this.clearRestartTimer();
    if (this.waitingTimer) {
      clearTimeout(this.waitingTimer);
      this.waitingTimer = null;
    }
    if (this.process && !this.killTimer) {
      const child = this.process;
      child.kill("SIGTERM");
      // The process reference is deliberately kept until the exit event, so
      // nothing new can be spawned while this one still holds the connection.
      this.killTimer = setTimeout(() => child.kill("SIGKILL"), KILL_GRACE_MS);
    }
    this.state.status = "stopped";
    this.state.startedAt = null;
    this.state.bitrateKbps = null;
  }

  private clearRestartTimer(): void {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
  }

  /** Only spawns ffmpeg once there's an actual signal to relay — being "enabled" with nothing to stream yet is normal, not an error. */
  private async attemptStart(): Promise<void> {
    if (this.stopRequested || this.process) return;
    const input = await getInputStatus();
    if (this.stopRequested || this.process) return;
    if (!input.live) {
      this.state.status = "waiting";
      this.state.lastError = null;
      if (this.waitingTimer) return;
      this.waitingTimer = setTimeout(() => {
        this.waitingTimer = null;
        this.attemptStart();
      }, WAITING_POLL_MS);
      return;
    }
    this.spawnProcess();
  }

  private spawnProcess(): void {
    // Last line of defence against a second connection on the same key.
    if (this.process) return;

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
      if (this.process !== child) return;
      this.process = null;
      if (this.killTimer) {
        clearTimeout(this.killTimer);
        this.killTimer = null;
      }
      if (this.startOnExit) {
        this.startOnExit = false;
        this.stopRequested = false;
        this.state.restarts = 0;
        this.attemptStart();
        return;
      }
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
    this.clearRestartTimer();
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      if (!this.stopRequested) this.attemptStart();
    }, delay);
  }
}
