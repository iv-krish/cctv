# Unified Monitoring Platform (CCTV, Drones, IoT) — Architecture Audit & Enterprise Roadmap

## 1. Codebase Architecture Audit

### 1.1 Current Architecture & Existing Features
- **Runtime & Backend:** Single-file Node.js server (`server.js`, ~950 lines) using Express 4.x and express-session (in-memory MemoryStore).
- **Media Engine:** go2rtc v1.9.14 binary running as an external localhost sub-process on ports 1984 (API/WS), 8554 (RTSP), 8555 (WebRTC TCP/UDP).
- **Proxy Layer:** `/go2rtc/*` reverse proxy in Express with custom raw TCP socket forwarding on HTTP `upgrade` for WebRTC/MSE signalling.
- **Frontend:** Single-page application (`public/index.html`) using Vanilla HTML5/CSS/JavaScript with responsive grid, camera card embeds (iframes pointing to `/go2rtc/stream.html`), SSE client for live detection stream, and Cloudflare Tunnel UI.
- **AI Analytics Module:** Python 3.11 (`detector/detector.py`) running YOLOv8 Nano (`yolov8n.pt`) on CPU at fixed intervals (default 2s), pulling frames via HTTP from go2rtc (`/api/frame.jpeg`) and posting detections with base64 images back to Express `/api/events`.
- **Remote Access:** Cloudflare Quick Tunnel integration via spawned `cloudflared.exe`.
- **Data Persistence:** Synchronous flat JSON files (`data/cameras.json`, `data/events.json`) and disk directory for snapshots (`data/events/*.jpg`).

### 1.2 Security Weaknesses & Vulnerabilities
| Category | Current State | Risk Level | Remediation |
|---|---|---|---|
| **Session & Auth** | Single hardcoded `ADMIN_USER` and `ADMIN_PASS` in `.env`; session in memory (MemoryStore) leaks and resets on process restart. | High | Replace with salted bcrypt/Argon2 user database, persistent session store (Redis/SQLite), and JWT/cookie RBAC. |
| **API Token Storage** | Static `DETECTOR_TOKEN` checked via plain string equality without constant-time comparison. | Medium | Use `crypto.timingSafeEqual` and per-agent rotating API tokens. |
| **Tunnel Public Exposure** | Cloudflare Quick Tunnel generates unauthenticated temporary URLs on `trycloudflare.com`. | High | Switch to authenticated Cloudflare Access with zero-trust identity verification or Tailscale peer mesh. |
| **Input Validation** | Basic URL sanitization without strict URL schema validation or SSRF protection on internal IP probes. | Medium | Strict IPv4/IPv6 CIDR validation; block private loopback ranges in user-defined URLs. |
| **File Permissions** | Synchronous file reads and writes (`fs.writeFileSync`) directly on the event loop. | Medium | Asynchronous non-blocking I/O with atomic file swaps or ACID SQLite engine. |

### 1.3 Scalability Limits & System Bottlenecks
- **JSON File Concurrency:** `data/cameras.json` and `data/events.json` are read and written synchronously (`JSON.parse` / `JSON.stringify`) on every event. Above 15–20 cameras or high detection rates, disk I/O blocking stalls the Node.js event loop.
- **AI Inference Bottleneck:** YOLOv8 Nano CPU mode inference takes ~120–250ms per frame. Sequentially polling 10+ cameras on a single Python thread creates frame lag and drops real-time throughput.
- **Browser Media Limit:** Browsers cap simultaneous WebRTC peer connections and hardware decoding pipelines. 8+ simultaneous 1080p WebRTC MSE streams in a single tab exceed standard browser GPU limits without sub-streaming or canvas virtualization.
- **go2rtc In-Memory State:** All stream registrations currently happen via runtime in-memory PATCH requests without a persisted database of active stream health.

### 1.4 Technical Debt & Structural Recommendations
- **Monolithic `server.js`:** Needs immediate modularization into `src/server.ts`, `src/routes/`, `src/services/streaming.ts`, `src/services/diagnostics.ts`, and `src/services/tunnel.ts`.
- **Python Virtualenv Portability:** The bundled Python environment contained hardcoded paths in `pyvenv.cfg`. Moving to containerized Docker services (`docker-compose.yml`) eliminates OS-specific path corruption.

---

## 2. Feature Evaluation Matrix

| Category | Feature | What It Needs | Effort | Architectural Placement |
|---|---|---|---|---|
| **Core Platform** | ONVIF Discovery & PTZ | WS-Discovery UDP broadcast, SOAP ONVIF client for profile extraction & PTZ control | Medium | `src/services/onvif.ts` + go2rtc ONVIF source provider |
| **Core Platform** | Camera Groups, Sites & Floor Plans | Multi-tier relational schema (Org > Site > Building > Floor > Camera); Leaflet/MapLibre UI | Medium | PostgreSQL / SQLite + GeoJSON GIS layer + SPA Map view |
| **Core Platform** | Health Monitoring & Auto-Reconnect | Background health worker with exponential backoff, circuit breakers, and latency tracking | Small | `src/workers/healthCheck.ts` + WebSocket broadcast |
| **Core Platform** | Continuous & Event Recording | go2rtc built-in DVR / FFmpeg segmented MP4 writing to tiered storage; retention lifecycle cleaner | Large | `src/services/recorder.ts` + S3 / MinIO / Local storage |
| **AI & Alerts** | Multi-class Detection & ALPR | Ultralytics YOLOv10/YOLOv11 or ONNX Runtime + TensorRT GPU acceleration + FastALPR | Medium | `services/ai-detector/` (Dedicated Python/C++ gRPC microservice) |
| **AI & Alerts** | Polygonal Zones & Line Crossing | Vector geometry math (Ray casting algorithm) over normalized bounding-box coordinates | Medium | Frontend Zone Editor (HTML5 Canvas) + AI inference post-processor |
| **AI & Alerts** | Multi-channel Alerting | Webhook engine, Telegram Bot API, Twilio SMS, SMTP, WhatsApp Cloud API | Small | `src/services/notifications/` with queue worker |
| **Drones & Sensors** | Drone Video Ingest | RTMP/SRT ingestion endpoints (via go2rtc / MediaMTX) for DJI, Autel, and custom telemetry rigs | Medium | Media Ingest Gateway (`rtmp://:1935/live/{stream_key}`) |
| **Drones & Sensors** | MAVLink Telemetry & Live Map | MAVLink v2 parser over UDP/Serial (port 14550), GPS path rendering, altitude/attitude HUD | Medium | `src/services/mavlink.ts` + MapLibre Drone Layer |
| **Drones & Sensors** | Body Cams & IoT Sensors | RTSP/WebRTC ingest for body cams; MQTT broker for PIR sensors, door contacts, panic buttons | Medium | `src/services/mqtt.ts` + Event correlation engine |
| **Gov & Enterprise** | Granular RBAC & Permissions | Role hierarchy (Admin, Operator, Viewer, Auditor) with ABAC (Attribute-Based Access Control) | Medium | Middleware authorization guards + JWT claims |
| **Gov & Enterprise** | Enterprise SSO & 2FA | SAML 2.0, OIDC (Keycloak, Okta, Azure AD), TOTP (Google Authenticator) | Medium | Passport.js / OpenID Client + `src/auth/sso.ts` |
| **Gov & Enterprise** | Immutable Audit Logs | Cryptographically signed append-only audit trail (User, Action, Stream, IP, Timestamp) | Medium | Dedicated table with HMAC chaining or write-once ledger |
| **Gov & Enterprise** | Multi-Tenancy | Tenant isolation (Logical database partitioning via `tenant_id` + Row Level Security) | Large | Database schema architecture & API tenant resolution |
| **Gov & Enterprise** | Air-Gapped Packaging | Offline Docker images, embedded YOLO model weights, zero WAN dependency | Medium | Helm charts / Single-node Docker Compose bundle |
| **Gov & Enterprise** | Privacy & Dynamic Redaction | Real-time face/license plate blurring, configurable privacy masking polygons | Large | GStreamer / OpenCV filter pipeline before go2rtc distribution |
| **Operations** | Zero-Trust Remote Access | Tailscale embedded DERP/Subnet router or Cloudflare Access Service Tokens | Small | `tools/tailscale` / Cloudflare Tunnel configuration |
| **Operations** | Progressive Web App (PWA) | Web Manifest, Service Worker, Web Push API for background push notifications | Small | `public/manifest.json` + `public/sw.js` |
| **Operations** | Admin Telemetry & Metrics | Prometheus `/metrics` exporter, Node exporter, GPU utilization stats via NVML | Small | `src/routes/metrics.ts` + Grafana dashboard |

---

## 3. Recommended Target Architecture

```
                       ┌──────────────────────────────────────────────┐
                       │           Clients & Interfaces               │
                       │   SPA (Web), Mobile PWA, Video Wall, API    │
                       └──────────────────────┬───────────────────────┘
                                              │ HTTPS / WSS
                       ┌──────────────────────▼───────────────────────┐
                       │          API & Security Gateway              │
                       │    Reverse Proxy, RBAC, SSO, Rate Limiting   │
                       └───────┬──────────────────────────────┬───────┘
                               │                              │
                ┌──────────────▼─────────────┐ ┌──────────────▼─────────────┐
                │   Core Application API     │ │     High-Performance       │
                │  (Node.js / Go Service)    │ │   Media Gateway (go2rtc)   │
                │  - Camera Metadata & CRUD  │ │  - RTSP, WebRTC, ONVIF     │
                │  - Event Audit & Logs      │ │  - RTMP, SRT, WebTorrent   │
                │  - Notification Engine     │ │  - MSE & HLS Transmuxing   │
                └───────┬─────────────┬──────┘ └──────────────┬─────────────┘
                        │             │                       │
      ┌─────────────────▼──┐   ┌──────▼────────────┐   ┌──────▼─────────────┐
      │   Storage Layer    │   │ Message Bus/Queue │   │  AI Worker Cluster │
      │ - PostgreSQL (ACID)│   │  (Redis Streams)  │   │ - YOLOv10/11 GPU   │
      │ - S3/MinIO Clips   │   │ - Event pub/sub   │   │ - Zone Evaluation  │
      │ - Timescale Telemetry│ │ - Sensor Telemetry│   │ - License Plate ALPR│
      └────────────────────┘   └───────────────────┘   └────────────────────┘
```

### Components to Keep vs. Replace
1. **Media Server:** **Keep go2rtc**. It is lightweight, compiled in Go, supports RTSP, WebRTC, MSE, MP4, and low-latency two-way audio.
2. **Database:** **Replace flat JSON files with SQLite (for single-node on-prem) or PostgreSQL (for multi-tenant enterprise)** with Prisma/Drizzle ORM.
3. **Queue & Caching:** **Add Redis / Valkey** for distributed pub/sub, detection message queues, and active session caching.
4. **AI Inference:** **Replace polling script with a dedicated streaming inference pipeline** using NVIDIA DeepStream, TensorRT, or ONNX Runtime reading direct RTSP sub-streams without intermediate JPEG decoding.
5. **Video Storage:** **Integrate MinIO / Local S3 storage** with retention lifecycle policies (e.g. prune after 30/90 days automatically).

---

## 4. Phased Product Roadmap

### Phase 1: Stabilization & Hardening (Month 1)
- Migrate from single-file `server.js` to structured TypeScript modules.
- Replace `data/*.json` with SQLite + WAL mode for reliable atomic transactions.
- Implement strict session management, bcrypt password hashing, and CSRF protection.
- Containerize the entire stack into a single `docker-compose.yml` for reproducible deployment.
- Formalize ONVIF port probing and fallback logic in the camera connection wizard.

### Phase 2: Core Platform & NVR Features (Months 2–3)
- **Multi-Camera Video Wall:** Configurable layouts (1x1, 2x2, 3x3, 4x4, 1+5) with dynamic quality switching (Main stream on focus, Light stream on grid).
- **Segmented Recording:** Continuous and event-driven H.264/H.265 clip recording to local/network disks with timeline playback.
- **Hierarchical Grouping:** Site > Building > Zone organization for enterprise deployments.
- **Granular Health Monitoring:** Instant telemetry on bitrate, packet loss, FPS, and automated reconnect alerts.
- **PWA Client:** Mobile-friendly dashboard with Web Push notification triggers for perimeter breaches.

### Phase 3: AI Analytics & Drone Operations (Months 4–6)
- **GPU-Accelerated Inference Service:** Offload detection to GPU via TensorRT/CUDA.
- **Perimeter & Vector Rules:** Interactive zone drawing for intrusion detection, tripwires, loitering, and after-hours alerts.
- **Drone Telemetry Gateway:** Ingestion of RTMP/SRT video feeds alongside MAVLink telemetry for real-time UAV map tracking.
- **ALPR / ANPR & Face Recognition:** Automated vehicle logging and whitelist/blacklist alert dispatching.
- **Multi-Channel Alert Hub:** Telegram, WhatsApp, Email, and generic JSON Webhook dispatching with annotated event snapshots.

### Phase 4: Government & Enterprise Grade (Months 7–9)
- **Enterprise SSO & Directory Sync:** SAML 2.0 and OpenID Connect (OIDC) integration with Active Directory/Okta.
- **Role-Based Access Control (RBAC):** Admin, Supervisor, Operator, Auditor roles with camera-level permissions.
- **Cryptographic Audit Trail:** Append-only log recording all user logins, stream views, PTZ commands, and clip exports.
- **Dynamic Privacy Masking:** On-the-fly face and license plate anonymization for public disclosures (DPDP / GDPR compliance).
- **Multi-Tenant Partitioning:** Logical data isolation for multiple agencies sharing single server infrastructure.
- **Air-Gapped Installation Kit:** Offline Helm charts and deployment bundles for restricted networks.

---

## 5. Top 10 High-Value Features to Build First

1. **SQLite Database Migration (Prisma/Drizzle):** Eliminates JSON race conditions, unlocks high camera counts, and provides robust transaction integrity.
2. **ONVIF Auto-Discovery:** Automatically scans LAN for cameras, retrieves RTSP profiles, and configures channels without manual URL construction.
3. **Continuous / Event Video Recording:** Transforms the dashboard from a live viewer into a true security record system (NVR).
4. **Multi-Camera Flexible Wall View:** Essential for control rooms and security guards monitoring 4–32 channels simultaneously.
5. **GPU Acceleration for AI Detector:** Increases inference capacity from 1–2 fps on 1 camera to 30+ fps across 16+ channels.
6. **Polygonal Zone & Line-Crossing Rules:** Reduces false positive alerts from trees and shadows by 90%+.
7. **Role-Based Access Control (RBAC):** Prevents viewers from altering camera configurations or accessing restricted locations.
8. **Automated Offline / Reconnect Alerts:** Instantly notifies operators when a camera cable is cut or network hardware fails.
9. **Zero-Trust Private Networking (Tailscale / Cloudflare Access):** Replaces insecure temporary tunnels with authenticated, permanent remote access.
10. **Interactive Timeline & Export Utility:** Allows security personnel to quickly search recorded incidents and export digitally signed MP4 evidence.

---

## 6. Technical, Legal, and Privacy Risks

- **Regulatory & Privacy Compliance (DPDP Act 2023 / GDPR):** Storing video footage of public areas requires explicit data retention policies, access audit logs, and clear signage. Unrestricted storage without legal-hold lifecycles creates severe compliance liabilities.
- **Network Bandwidth Saturation:** Streaming 16 unmanaged 1080p Main streams saturates a 100 Mbps LAN switch (~60–80 Mbps). The platform must enforce adaptive bitrate (ABR) switching and utilize sub-streams by default.
- **Video Storage Exhaustion:** Unchecked video recording can exhaust local storage within days, crashing the host OS. Storage drivers must enforce strict quotas, circular FIFO pruning, and low-disk warnings.
- **Drone Telemetry Airspace Constraints:** Ingesting drone streams and flight coordinates requires compliance with local aviation authorities (e.g., DGCA DigitalSky in India / FAA in the US) regarding geofencing and flight log preservation.
- **Security Vulnerabilities in Legacy Cameras:** Many low-cost IP cameras run outdated Linux kernels with known vulnerabilities. The platform must isolate camera traffic on a dedicated CCTV VLAN without direct WAN gateway access.
