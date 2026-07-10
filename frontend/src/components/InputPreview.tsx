import Hls from "hls.js";
import { useEffect, useRef } from "react";

// Proxied through the backend at /hls (see backend/src/index.ts) rather
// than hitting MediaMTX's :8888 directly — a direct port doesn't work when
// the app is reached through something that only tunnels one port
// (Cloudflare Tunnel, a reverse proxy) or over HTTPS (mixed-content
// blocked). Same origin as the page always works regardless of how it's
// reached.
const HLS_URL = `${window.location.protocol}//${window.location.host}/hls/live/index.m3u8`;

export default function InputPreview({ live }: { live: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !live) return;

    if (Hls.isSupported()) {
      const hls = new Hls({ liveSyncDurationCount: 2 });
      hls.loadSource(HLS_URL);
      hls.attachMedia(video);
      return () => hls.destroy();
    }

    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = HLS_URL;
    }
  }, [live]);

  if (!live) {
    return <div className="preview-placeholder">No input signal</div>;
  }

  return <video ref={videoRef} className="preview-video" autoPlay muted playsInline controls />;
}
