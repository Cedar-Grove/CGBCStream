import Hls from "hls.js";
import { useEffect, useRef } from "react";

// MediaMTX serves HLS directly (not proxied through the backend API) —
// same host, fixed port from docker-compose.
const HLS_URL = `${window.location.protocol}//${window.location.hostname}:8888/live/index.m3u8`;

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
