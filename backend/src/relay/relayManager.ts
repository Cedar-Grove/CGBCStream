import { FfmpegRelay, type RelayState } from "./ffmpegRelay.js";
import { assertPrimaryIngest } from "./ingestUrl.js";

// One FfmpegRelay per enabled destination, keyed by destination id, so a
// crash/backoff on one destination's push never touches the others.
export class RelayManager {
  private relays = new Map<string, FfmpegRelay>();

  constructor(private readonly sourceUrl: string) {}

  /**
   * Arms the relay for a destination.
   *
   * The push URL is not fixed for the life of a destination: YouTube issues a
   * fresh stream key for every broadcast, so each service starts with a
   * different one. A cached relay still pointing at the previous key would
   * push this week's service to last week's (already finished) stream, so a
   * changed URL tears the old relay down and builds a new one — tears it
   * down first, deliberately, because two ffmpeg processes alive at once is
   * what makes a platform report the same key arriving twice.
   */
  start(destinationId: string, rtmpUrl: string): void {
    assertPrimaryIngest(rtmpUrl, `the push URL for destination ${destinationId}`);

    let relay = this.relays.get(destinationId);
    if (relay && relay.destUrl !== rtmpUrl) {
      relay.stop();
      this.relays.delete(destinationId);
      relay = undefined;
    }
    if (!relay) {
      relay = new FfmpegRelay(this.sourceUrl, rtmpUrl);
      this.relays.set(destinationId, relay);
    }
    relay.start();
  }

  stop(destinationId: string): void {
    this.relays.get(destinationId)?.stop();
  }

  getStatus(destinationId: string): RelayState | undefined {
    return this.relays.get(destinationId)?.getStatus();
  }

  getAllStatus(): Record<string, RelayState> {
    const result: Record<string, RelayState> = {};
    for (const [id, relay] of this.relays) {
      result[id] = relay.getStatus();
    }
    return result;
  }
}
