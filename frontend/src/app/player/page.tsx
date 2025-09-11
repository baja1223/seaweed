"use client";

import { useMemo, useRef, useState } from "react";
import HlsPlayer from "@/components/HlsPlayer";

type LevelOption = { index: number; height?: number; width?: number; bitrate?: number; name?: string };

function parseBoolEnv(v: any, fallback = false) {
  const s = (v ?? "").toString().trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(s)) return true;
  if (["0", "false", "no", "off"].includes(s)) return false;
  return fallback;
}

export default function PlayerPage() {
  const defaultUrl = useMemo(() => process.env.NEXT_PUBLIC_CDN_URL || "", []);
  const defaultLL = useMemo(() => parseBoolEnv(process.env.NEXT_PUBLIC_LOW_LATENCY, true), []);
  const [url, setUrl] = useState<string>(defaultUrl);
  const [lowLatency, setLowLatency] = useState<boolean>(defaultLL);
  const [levels, setLevels] = useState<LevelOption[]>([]);
  const [level, setLevel] = useState<number>(-1); // -1 = auto
  const [stats, setStats] = useState<{ latencySec?: number; bufferSec?: number; bitrateKbps?: number; currentLevel?: number; autoLevel?: boolean; droppedFrames?: number; decodedFrames?: number }>({});
  const [health, setHealth] = useState<"healthy" | "buffering" | "stalled" | "recovering" | "error" | "idle">("idle");
  const actionsRef = useRef<null | { goLive: () => void; reload: () => void; setAutoLevel: () => void }>(null);

  const formatLevelLabel = (l: LevelOption) => {
    const res = l.height ? `${l.height}p` : l.name || `L${l.index}`;
    const br = l.bitrate ? `${Math.round(l.bitrate / 1000)} kbps` : "";
    return br ? `${res} @ ${br}` : res;
  };

  return (
    <div className="max-w-4xl mx-auto py-8">
      <h1 className="text-2xl font-semibold mb-4">Video Player</h1>
      <div className="flex flex-wrap gap-2 mb-4 items-center">
        <input
          className="border rounded p-2 flex-1 min-w-[280px]"
          placeholder="Enter video URL (mp4 or HLS .m3u8)"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <button className="border rounded px-4 h-10" onClick={() => setUrl(url)}>
          Load
        </button>
        <label className="flex items-center gap-2 px-2 py-1 border rounded">
          <input
            type="checkbox"
            checked={lowLatency}
            onChange={(e) => setLowLatency(e.target.checked)}
          />
          <span>Low Latency</span>
        </label>
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-600">Quality</span>
          <select
            className="border rounded p-2 h-10"
            value={level}
            onChange={(e) => setLevel(parseInt(e.target.value, 10))}
          >
            <option value={-1}>Auto</option>
            {levels.map((l) => (
              <option key={l.index} value={l.index}>
                {formatLevelLabel(l)}
              </option>
            ))}
          </select>
          <button className="border rounded px-2 h-10" onClick={() => actionsRef.current?.setAutoLevel()}>Set Auto</button>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-sm text-gray-600">Health</span>
          <span className="text-sm font-medium px-2 py-1 border rounded">
            {health}
          </span>
          <button className="border rounded px-2 h-10" onClick={() => actionsRef.current?.goLive()}>Go Live</button>
          <button className="border rounded px-2 h-10" onClick={() => actionsRef.current?.reload()}>Reconnect</button>
        </div>
      </div>
      <div className="aspect-video bg-black/5">
        {url ? (
          <HlsPlayer
            key={`${url}_${lowLatency ? "ll" : "std"}`}
            src={url}
            controls
            className="w-full h-full"
            lowLatency={lowLatency}
            level={level}
            onLevels={(lvls) => setLevels(lvls)}
            onStats={(s) => setStats(s)}
            onHealth={(h) => setHealth(h)}
            actionsRef={actionsRef}
            maxLatencySec={lowLatency ? 3 : 6}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-gray-500">
            Enter a video URL to play
          </div>
        )}
      </div>

      <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2 text-sm">
        <div className="border rounded p-2">
          <div className="text-gray-500">Latency</div>
          <div className="font-medium">{stats.latencySec != null ? `${stats.latencySec.toFixed(1)} s` : "—"}</div>
        </div>
        <div className="border rounded p-2">
          <div className="text-gray-500">Buffer</div>
          <div className="font-medium">{stats.bufferSec != null ? `${stats.bufferSec.toFixed(1)} s` : "—"}</div>
        </div>
        <div className="border rounded p-2">
          <div className="text-gray-500">Bitrate</div>
          <div className="font-medium">{stats.bitrateKbps != null ? `${stats.bitrateKbps} kbps` : "—"}</div>
        </div>
        <div className="border rounded p-2">
          <div className="text-gray-500">Level</div>
          <div className="font-medium">{stats.autoLevel ? "Auto" : (stats.currentLevel != null ? `L${stats.currentLevel}` : "—")}</div>
        </div>
        <div className="border rounded p-2">
          <div className="text-gray-500">Dropped Frames</div>
          <div className="font-medium">{stats.droppedFrames != null ? stats.droppedFrames : "—"}</div>
        </div>
        <div className="border rounded p-2">
          <div className="text-gray-500">Decoded Frames</div>
          <div className="font-medium">{stats.decodedFrames != null ? stats.decodedFrames : "—"}</div>
        </div>
      </div>

      <p className="text-sm text-gray-500 mt-3">
        Tip: Toggle Low Latency for LL-HLS streams; use Auto quality or select a specific rendition.
      </p>
    </div>
  );
}
