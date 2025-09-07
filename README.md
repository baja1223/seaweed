# seaweed (buttblastr core)
**Author:** taha z  
**Repo:** https://github.com/baja1223/seaweed

Seaweed is the core of **buttblastr**, a Kick/Twitch-style livestreaming platform.  
It’s built from the ground up to be modular: **Auth**, **Real-time Chat**, **Stream Management**, and a minimal **Frontend**.  
Phase 2 adds **RTMP ingest**, **transcoding to HLS**, and **CDN delivery**.

> **Note on names:**  
> Project metadata credits the project to **taha z**.  
> User records in the database default `author` to **"john seaweed"** when no author is supplied.

---

## ✨ What the app does (high level)
- **Register & sign in** users (JWT access/refresh tokens, protected `/profile`)
- **Create/join chat rooms** (one room per live stream) with **WebSocket** broadcast + **Redis** history
- **Start/end streams** and list **currently active streams** (with basic viewer counts placeholder)
- **Generate stream keys** per broadcast (used later with OBS → RTMP ingest)
- **Frontend** page to demo auth, chat, and streams in one place

---

## 🧱 Architecture Overview


```text
            Browser (Frontend)
     ┌─────────────┬─────────────┐
     │    REST     │   WebSocket │
     v             v
[Auth API]     [Chat WS]
  Node/Exp       ws + Redis
    │  \          │
    │   \         │
  MongoDB   Redis (history)
    │
    │     REST
    └──▶ [Streams API] ───▶ Postgres

Phase 2 (video path)
- OBS → RTMP → NGINX-RTMP → FFmpeg → HLS files → CDN (CloudFront/Cloudflare)
- Frontend plays HLS via hls.js (or video.js)

Also note:
- /stream/start returns a unique stream key (used as rtmp path)
- Chat rooms map to stream IDs; Redis keeps short history
