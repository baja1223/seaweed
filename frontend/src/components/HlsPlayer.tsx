"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

type HlsCtor = any; // Keep loose typing to avoid local type dependency

export type HlsPlayerProps = {
  src: string;
  autoPlay?: boolean;
  muted?: boolean;
  controls?: boolean;
  className?: string;
  poster?: string;
  // If true, prefer lower latency over stability
  lowLatency?: boolean;
  // Set desired level (-1 for auto)
  level?: number;
  // Called once levels are known (after manifest parsed)
  onLevels?: (levels: Array<{ index: number; bitrate?: number; width?: number; height?: number; name?: string }>) => void;
  // Emits stats periodically (approx 1s)
  onStats?: (stats: {
    latencySec?: number;
    bufferSec?: number;
    droppedFrames?: number;
    decodedFrames?: number;
    currentLevel?: number;
    autoLevel?: boolean;
    bitrateKbps?: number;
  }) => void;
  // Emits health state changes
  onHealth?: (health: "healthy" | "buffering" | "stalled" | "recovering" | "error" | "idle") => void;
  // Expose player actions
  actionsRef?: React.MutableRefObject<
    | null
    | {
        goLive: () => void;
        reload: () => void;
        setAutoLevel: () => void;
      }
  >;
  // When latency exceeds this, snap to live edge
  maxLatencySec?: number;
};

function isHlsUrl(url: string) {
  try {
    const u = new URL(url, typeof window !== "undefined" ? window.location.href : undefined);
    return u.pathname.toLowerCase().endsWith(".m3u8");
  } catch {
    return url.toLowerCase().includes(".m3u8");
  }
}

export default function HlsPlayer({
  src,
  autoPlay = false,
  muted = false,
  controls = true,
  className,
  poster,
  lowLatency,
  level,
  onLevels,
  onStats,
  onHealth,
  actionsRef,
  maxLatencySec,
}: HlsPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<any | null>(null);
  const statsTimerRef = useRef<any | null>(null);
  const healthRef = useRef<
    | {
        lastTime: number;
        lastProgressAt: number;
        stalledSince?: number;
        recovering?: boolean;
        mediaRecoveries: number;
        netRecoveries: number;
      }
    | null
  >(null);
  const [nativeSupported, setNativeSupported] = useState(false);

  const useLowLatency = useMemo(() => {
    // allow override via env flag
    const envFlag = (process.env.NEXT_PUBLIC_LOW_LATENCY || "")
      .toString()
      .trim()
      .toLowerCase();
    const envLL = envFlag === "1" || envFlag === "true" || envFlag === "yes";
    return Boolean(typeof lowLatency === "boolean" ? lowLatency : envLL);
  }, [lowLatency]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;

    // If it's not an HLS URL, just set src on the video tag
    if (!isHlsUrl(src)) {
      setNativeSupported(true);
      video.src = src;
      return;
    }

    // Check native HLS support (Safari, iOS)
    const canPlayNative = video.canPlayType("application/vnd.apple.mpegurl");
    if (canPlayNative) {
      setNativeSupported(true);
      video.src = src;
      return;
    }

    let hls: any;
    let destroyed = false;

    (async () => {
      try {
        // Dynamic import so SSR never tries to bundle hls.js
        const mod = await import("hls.js");
        const Hls: HlsCtor = mod.default ?? mod;
        if (!Hls?.isSupported?.()) {
          // fallback to native element
          setNativeSupported(true);
          video.src = src;
          return;
        }

        // Tuned defaults for live HLS and LL-HLS
        const config = useLowLatency
          ? {
              // Low-latency tuned
              lowLatencyMode: true,
              backBufferLength: 15,
              maxBufferLength: 6,
              maxMaxBufferLength: 30,
              liveSyncDuration: 1.5, // seconds target latency from live edge
              liveMaxLatencyDuration: 3.0,
              maxLiveSyncPlaybackRate: 1.5,
              enableWorker: true,
              progressive: true,
              fragLoadingTimeOut: 20000,
              manifestLoadingTimeOut: 15000,
              startPosition: -1,
            }
          : {
              // Stability tuned (slightly higher latency)
              lowLatencyMode: false,
              backBufferLength: 30,
              maxBufferLength: 12,
              maxMaxBufferLength: 60,
              liveSyncDuration: 3.0,
              liveMaxLatencyDuration: 6.0,
              maxLiveSyncPlaybackRate: 1.0,
              enableWorker: true,
              progressive: true,
              fragLoadingTimeOut: 20000,
              manifestLoadingTimeOut: 15000,
              startPosition: -1,
            };

        hls = new Hls(config);
        hls.attachMedia(video);
        hls.on(Hls.Events.MEDIA_ATTACHED, () => {
          if (destroyed) return;
          hls.loadSource(src);
        });

        hls.on(Hls.Events.MANIFEST_PARSED, (_evt: any, data: any) => {
          try {
            const levels = (hls.levels || []).map((l: any, i: number) => ({
              index: i,
              bitrate: l.bitrate,
              width: l.width,
              height: l.height,
              name: l.name,
            }));
            onLevels?.(levels);
          } catch {}
        });

        hls.on(Hls.Events.ERROR, (_evt: any, data: any) => {
          if (!data?.fatal) return;
          onHealth?.("recovering");
          const state = (healthRef.current ||= {
            lastTime: 0,
            lastProgressAt: Date.now(),
            mediaRecoveries: 0,
            netRecoveries: 0,
          });
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              try { hls.startLoad(); state.netRecoveries++; } catch {}
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              try { hls.recoverMediaError(); state.mediaRecoveries++; } catch {}
              break;
            default:
              onHealth?.("error");
              try { hls.destroy(); } catch {}
          }
        });
        hlsRef.current = hls;
        // Start stats loop
        if (statsTimerRef.current) clearInterval(statsTimerRef.current);
        statsTimerRef.current = setInterval(() => {
          const v = videoRef.current as any;
          if (!v) return;
          const targetMaxLatency = Math.max(1, Number(maxLatencySec ?? (useLowLatency ? 3 : 6)));
          // buffer seconds
          let bufferSec: number | undefined;
          try {
            const { buffered, currentTime } = v as HTMLVideoElement;
            if (buffered && buffered.length) {
              let end = 0;
              for (let i = 0; i < buffered.length; i++) end = Math.max(end, buffered.end(i));
              bufferSec = Math.max(0, end - currentTime);
            }
          } catch {}
          // latency seconds
          let latencySec: number | undefined;
          try {
            if (hls?.latency != null && !Number.isNaN(hls.latency)) {
              latencySec = hls.latency;
            } else if (v.seekable && v.seekable.length) {
              const liveEdge = v.seekable.end(v.seekable.length - 1);
              latencySec = Math.max(0, liveEdge - v.currentTime);
            }
          } catch {}
          // frames
          let droppedFrames: number | undefined;
          let decodedFrames: number | undefined;
          try {
            if (typeof v.getVideoPlaybackQuality === 'function') {
              const q = v.getVideoPlaybackQuality();
              droppedFrames = q.droppedVideoFrames;
              decodedFrames = q.totalVideoFrames;
            } else {
              droppedFrames = (v as any).webkitDroppedFrameCount;
              decodedFrames = (v as any).webkitDecodedFrameCount;
            }
          } catch {}
          // level/bitrate
          let currentLevel: number | undefined;
          let autoLevel: boolean | undefined;
          let bitrateKbps: number | undefined;
          try {
            currentLevel = hls?.currentLevel;
            autoLevel = hls?.autoLevelEnabled;
            const l = hls?.levels?.[currentLevel ?? -1];
            if (l?.bitrate) bitrateKbps = Math.round(l.bitrate / 1000);
          } catch {}

          onStats?.({ latencySec, bufferSec, droppedFrames, decodedFrames, currentLevel, autoLevel, bitrateKbps });

          // Health & auto-recovery
          const now = Date.now();
          const state = (healthRef.current ||= {
            lastTime: v.currentTime || 0,
            lastProgressAt: now,
            mediaRecoveries: 0,
            netRecoveries: 0,
          });
          const isPlaying = !v.paused && !v.ended && v.readyState >= 2;
          const progressed = Math.abs((v.currentTime || 0) - (state.lastTime || 0)) > 0.05;
          if (progressed) {
            state.lastProgressAt = now;
            state.stalledSince = undefined;
          }
          state.lastTime = v.currentTime || 0;

          // Snap to live if we drifted too far
          try {
            if (isPlaying && latencySec != null && latencySec > targetMaxLatency && v.seekable && v.seekable.length) {
              const live = v.seekable.end(v.seekable.length - 1);
              v.currentTime = Math.max(0, live - Math.min(1, targetMaxLatency / 3));
              onHealth?.("recovering");
            }
          } catch {}

          // Detect buffering/stall and recover in stages
          const sinceProgress = (now - state.lastProgressAt) / 1000;
          if (isPlaying && (bufferSec ?? 0) < 0.15) {
            onHealth?.("buffering");
          } else if (isPlaying && sinceProgress > 3) {
            onHealth?.("stalled");
            try {
              if (!state.recovering) {
                state.recovering = true;
                if (sinceProgress > 3 && sinceProgress <= 8) {
                  hls?.recoverMediaError?.();
                } else if (sinceProgress > 8 && sinceProgress <= 15) {
                  hls?.startLoad?.();
                } else if (sinceProgress > 15) {
                  const srcUrl = src;
                  try { hls?.loadSource?.(srcUrl); } catch {}
                }
                setTimeout(() => { if (healthRef.current) healthRef.current.recovering = false; }, 1500);
              }
            } catch {}
          } else if (isPlaying) {
            onHealth?.("healthy");
          } else {
            onHealth?.("idle");
          }
        }, 1000);
      } catch (e) {
        // On any failure, fallback to native playback
        setNativeSupported(true);
        video.src = src;
      }
    })();

    return () => {
      destroyed = true;
      try { if (hls) hls.destroy(); } catch {}
      hlsRef.current = null;
      if (statsTimerRef.current) {
        clearInterval(statsTimerRef.current);
        statsTimerRef.current = null;
      }
      if (healthRef.current) healthRef.current = null;
    };
  }, [src, useLowLatency]);

  // Apply external level selection
  useEffect(() => {
    const hls = hlsRef.current;
    if (!hls) return;
    if (typeof level === 'number') {
      try {
        if (level < 0) {
          hls.currentLevel = -1;
          hls.autoLevelEnabled = true;
        } else {
          hls.autoLevelEnabled = false;
          hls.currentLevel = level;
        }
      } catch {}
    }
  }, [level]);

  // Expose actions
  useEffect(() => {
    if (!actionsRef) return;
    actionsRef.current = {
      goLive: () => {
        const v = videoRef.current as any;
        if (!v) return;
        try {
          if (v.seekable && v.seekable.length) {
            const live = v.seekable.end(v.seekable.length - 1);
            v.currentTime = Math.max(0, live - 0.5);
          }
        } catch {}
      },
      reload: () => {
        const hls = hlsRef.current as any;
        try {
          if (hls?.loadSource) hls.loadSource(src);
          else if (videoRef.current) (videoRef.current as any).load?.();
        } catch {}
      },
      setAutoLevel: () => {
        const hls = hlsRef.current as any;
        try { if (hls) { hls.currentLevel = -1; hls.autoLevelEnabled = true; } } catch {}
      }
    };
    return () => { if (actionsRef) actionsRef.current = null; };
  }, [actionsRef, src]);

  return (
    <video
      ref={videoRef}
      controls={controls}
      autoPlay={autoPlay}
      muted={muted}
      className={className}
      poster={poster}
      // Note: src set dynamically for HLS via hls.js or native fallback
    />
  );
}
