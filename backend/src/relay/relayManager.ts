import { FfmpegRelay, type RelayState } from "./ffmpegRelay.js";
import { listEnabledStaticDestinations, resetYoutubeEnabledState } from "../destinations/repository.js";

// One FfmpegRelay per enabled destination, keyed by destination id, so a
// crash/backoff on one destination's push never touches the others.
export class RelayManager {
  private relays = new Map<string, FfmpegRelay>();

  constructor(private readonly sourceUrl: string) {}

  start(destinationId: string, rtmpUrl: string): void {
    let relay = this.relays.get(destinationId);
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

  /**
   * Used on backend boot so a restart self-heals mid-service. Static
   * destinations (Subsplash/Facebook) restart on their fixed RTMP
   * target; YouTube destinations can't — their RTMP key was tied to a
   * broadcast that no longer exists, so their "enabled" flag is cleared
   * instead of silently relaying nowhere.
   */
  reconcile(): void {
    resetYoutubeEnabledState();
    for (const destination of listEnabledStaticDestinations()) {
      this.start(destination.id, destination.rtmpUrl);
    }
  }
}
