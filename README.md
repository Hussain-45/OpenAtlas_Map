# OpenAtlas

OpenAtlas is a free, open-source mapping and navigation Progressive Web Application (PWA) built with React, TypeScript, Vite, MapLibre GL JS, and OpenStreetMap data. It provides global online mapping, multi-modal routing, and live turn-by-turn navigation, alongside a completely network-independent **Offline Delhi Mode** featuring vector basemaps (PMTiles), fast local place search (13,594 places), and a client-side road network routing engine (33,001 km of roads).

---

## Key Capabilities

### 1. Interactive Vector Map
- **WebGL Vector Map**: Smooth client-side vector rendering powered by MapLibre GL JS.
- **Map Controls**: Pan, zoom, pitch, bearing rotation, compass reset, and fullscreen view.
- **Multiple Visual Styles**: One-click switching between OpenFreeMap *Liberty*, *Positron*, *Bright*, and *Dark* styles, as well as offline vector styling.
- **Saved Places & Custom Lists**: Bookmark locations, organize them into custom lists (Favorites, Want to Go, Starred), and filter or export them.
- **Trip & Search History**: Automatic, privacy-respecting local storage of recent searches and calculated routes.
- **Shareable Links & Data Portability**: Share place markers or multi-stop routes via URL query parameters; export/import data in open JSON format.

### 2. Search & Place Discovery
- **Online Global Search**: Fast search-as-you-type and reverse geocoding via Photon (Komoot) with Nominatim fallback.
- **Nearby Amenities**: One-click discovery of nearby hospitals, restaurants, cafes, pharmacies, ATMs, petrol pumps, banks, and supermarkets.
- **Offline Delhi Place Search**: 100% offline search indexing 13,594 landmarks, points of interest, and neighbourhoods across Delhi NCT using an in-memory token and prefix index.

### 3. Multi-Modal Route Planning
- **Online Routing**: Driving, walking, and cycling route calculation powered by OSRM and Valhalla demonstration endpoints.
- **Offline Delhi Road Routing**: High-performance client-side graph pathfinding executing within the browser with zero network requests:
  - **944,338 nodes** and **1,080,347 unique edges** across Delhi National Capital Territory (NCT).
  - **33,001 km** of indexed roads (residential, service, arterial highways, footpaths, cycle tracks).
  - Mode-specific access restrictions: motorways (driving only), footways/steps (pedestrians only), cycle tracks (bicycles and pedestrians).
  - Strict one-way street compliance for vehicles and cyclists, with reverse traversal permitted for pedestrians.
  - Turn-by-turn maneuver extraction with calculated bearing changes ($\ge 35^\circ$), street name transitions, and realistic speed models.
- **Multi-Stop Itineraries**: Add, reorder, and remove up to 5 intermediate stops with sequential waypoint navigation.
- **Alternative Routes**: Compares route alternatives by distance and duration.

### 4. Turn-by-Turn GPS Navigation
- **Live GPS Tracking**: Real-time position tracking via `navigator.geolocation.watchPosition` with high accuracy and sensor heading support.
- **Directional Navigation Puck**: Visual heading pointer, speed display, and animated GPS accuracy radius.
- **Heads-Up Display (HUD)**: Prominent top maneuver banner (next turn icon, distance to turn, street name) and bottom trip summary (ETA, remaining distance, duration, GPS accuracy).
- **Voice Guidance**: Natural spoken turn instructions via browser `SpeechSynthesis`, with automatic deduplication and 20-second cooldown throttling to prevent repetitive audio.
- **Off-Route Detection & Rerouting**: Real-time perpendicular distance calculation against the active route polyline with GPS accuracy buffering. If off-route, offers 1-click route recalculation from the live position (supported offline in Delhi mode).
- **Coverage Boundary Safeguards**: Immediate visual warnings if the user moves outside the offline coverage area.

### 5. PWA & Offline Package Lifecycle
- **Installable PWA**: Standalone application experience installable on Android, iOS, macOS, Windows, and Linux.
- **App Shell Caching**: VitePWA and Workbox precache HTML, CSS, JavaScript, icons, font glyphs, and sprites.
- **Origin Private File System (OPFS)**: Large vector tile archives (`NewDelhi.osm.pmtiles`, ~15.4 MB) stream directly into browser OPFS storage, completely bypassing HTTP cache eviction limits.
- **CacheStorage Architecture**: The binary road network routing graph (`delhi-routing-graph.bin`, ~22.8 MB) is preserved in dedicated CacheStorage (`openatlas-offline-routing-v1`), surviving hard browser reloads even when completely disconnected.
- **Safe Package Management**: Download progress tracking, cancellation via `AbortController`, SHA-256 header verification, and complete cleanup on package deletion.

---

## Technical Architecture

```
                                  +-------------------------------------------+
                                  |         OpenAtlas React Application       |
                                  +-------------------------------------------+
                                                        |
                     +----------------------------------+----------------------------------+
                     |                                                                     |
         [Online Map Mode]                                                     [Offline Delhi Mode]
                     |                                                                     |
       +-------------+-------------+                                         +-------------+-------------+
       |                           |                                         |                           |
MapLibre GL JS            Routing / Geocoding                           MapLibre GL JS           Offline Router / Search
(OpenFreeMap CDN)         (OSRM / Valhalla / Photon)                    (PMTiles in OPFS)        (Graph in CacheStorage)
       |                           |                                         |                           |
Remote Vector Tiles       Remote REST APIs                            Local Byte Ranges         Local Graph Pathfinding
       |                           |                                  via FileSource            (A* Search on TypedArrays)
       v                           v                                         v                           v
  Web Network                 Web Network                             Browser Sandbox             Browser Sandbox
```

### Technology Stack
- **Frontend Framework**: React 19, TypeScript ~6.0, Vite 8
- **Map Engine**: MapLibre GL JS 6.14, PMTiles 4.5
- **PWA / Service Worker**: `vite-plugin-pwa` 2.0, Workbox
- **Icons**: Lucide React
- **Testing & Quality**: Vitest 5.0, Oxlint, TypeScript strict type checking
- **Offline Data Format**: PMTiles v3 (vector tiles), Custom Binary Graph (`ODRG` format), JSON POI catalog

---

## Installation and Quick Start

### Prerequisites
- Node.js LTS (version 20 or higher recommended).
- A modern web browser supporting WebGL and OPFS (Chrome 102+, Edge 102+, Safari 16.4+, Firefox 111+).

### Setup Commands (PowerShell / Bash)

1. Clone or navigate to the OpenAtlas directory:
   ```bash
   cd c:\Users\samee\Desktop\OpenAtlas
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Configure environment variables (optional; defaults work out of the box):
   ```bash
   # Windows PowerShell:
   Copy-Item .env.example .env
   # Linux / macOS:
   cp .env.example .env
   ```

4. Start development server:
   ```bash
   npm run dev
   ```
   Open `http://localhost:5173/` in your browser.

---

## Verification and Testing

OpenAtlas enforces strict quality gates across automated unit, integration, and offline integrity tests:

```bash
# 1. Run full test suite (143+ unit and integration tests)
npm test

# 2. Run high-performance linter
npm run lint

# 3. Verify TypeScript type safety
npx tsc -b

# 4. Verify offline data integrity and road network graph
npm run verify:offline

# 5. Build production bundle and service worker
npm run build

# 6. Preview production build locally
npm run preview
```

### Verifying Offline PWA Behavior
To test genuine offline functionality:
1. Run `npm run build && npm run preview`.
2. Open `http://localhost:4173/` in Chrome or Edge.
3. Open the sidebar and click **Offline maps (Delhi)**.
4. Click **Download package** (~15.4 MB basemap; routing graph pre-warms automatically).
5. Switch to **Offline Delhi** mode.
6. Open Chrome DevTools -> **Network** tab -> Check **Offline** (or disconnect Wi-Fi).
7. Press `Ctrl + Shift + R` (Hard Reload).
8. The app reloads from the Service Worker cache, renders vector tiles from OPFS, searches 13,594 local places, and calculates genuine turn-by-turn road routes across Driving, Walking, and Cycling with 0 network calls.

---

## Data Pipeline & Road Network Generation

The offline dataset covers Central Delhi and the National Capital Territory (bounds: `76.978°E–77.497°E`, `28.440°N–28.738°N`).

- **Vector Tiles (`public/offline/delhi/NewDelhi.osm.pmtiles`)**: Extracted from OpenStreetMap data via BBBike and packaged into PMTiles v3 format.
- **Places Index (`public/offline/delhi/places.json`)**: 13,594 OpenStreetMap amenities, transport stops, landmarks, and shops stored as compact tuples: `[name, lon, lat, category, type]`.
- **Road Network Graph (`public/offline/delhi/delhi-routing-graph.bin`)**: Built using `scripts/buildDelhiRoutingGraph.mjs` directly from the zoom-14 street vectors in `NewDelhi.osm.pmtiles`:
  - Scans 446 zoom-14 vector tiles across the Delhi bounding box.
  - Stitches polyline segments across tile boundaries via $10^{-5}$ degree coordinate quantization (~1.1m precision).
  - Filters non-routable geometries (rail, runway, subway).
  - Computes connected components using Union-Find to exclude unreachable fragments.
  - Serializes vertices, component bitmasks, directed edges, and null-terminated street names into an optimized 64-byte aligned binary layout.

To regenerate the road network graph from updated PMTiles:
```bash
npm run build:routing
```

---

## Data Licenses and Attributions

OpenAtlas is built on open standards and open data:

| Asset / Service | Provider / Project | License | Attribution Requirement |
| :--- | :--- | :--- | :--- |
| **Map Vectors & Routing** | OpenStreetMap Contributors | ODbL 1.0 | © OpenStreetMap contributors |
| **Online Basemap Styles** | OpenFreeMap | CC0 / OpenFreeMap TOS | © OpenFreeMap |
| **Online Geocoding** | Komoot (Photon) / OSMF (Nominatim) | Apache 2.0 / ODbL | © OpenStreetMap contributors via Photon |
| **Online Routing** | Project OSRM / Valhalla | BSD-2-Clause / MIT | © OpenStreetMap contributors via OSRM & Valhalla |
| **Offline Basemap Extract** | BBBike / OpenStreetMap | ODbL 1.0 | Map data © OpenStreetMap contributors |
| **Application Source Code** | OpenAtlas Project | MIT | (See LICENSE file) |

---

## Limitations and Boundaries

1. **Offline Geographic Coverage**: Offline basemap rendering, place search, and road routing are strictly limited to the **Delhi National Capital Territory (NCT)** extract (`76.98°E–77.50°E`, `28.44°N–28.74°N`). OpenAtlas does not claim global offline map coverage. For areas outside Delhi, switch to Online mode.
2. **Traffic Awareness**: Route durations and ETAs are static estimates calculated from highway classification speed profiles. OpenAtlas does not provide live traffic, congestion overlays, or dynamic incident rerouting.
3. **Turn Restrictions & Road Legality**: The offline road graph extracts topology from vector tile line features. While one-way directionality and mode access (motorways, cycleways, footways, steps) are enforced, complex time-of-day turn restrictions or localized temporary closures may not be represented.
4. **Demonstration Endpoints**: Default online geocoding (Photon) and routing (OSRM/Valhalla) use public demonstration servers with fair-use rate limits. High-volume or production deployments should configure self-hosted endpoints via `.env`.
5. **GPS Precision**: Navigation accuracy depends on device hardware sensors and browser geolocation permissions. High buildings or poor satellite visibility may reduce GPS accuracy.

---

## Privacy and Permissions

- **Geolocation**: Device location is requested only when the user explicitly clicks "Find my location", "My Location", or "Start Navigation". Location coordinates are processed exclusively in-memory on the device and are never sent to external analytics or advertising servers.
- **Local Persistence**: Saved places, lists, route history, and offline packages are stored locally on the user's device via `localStorage`, `CacheStorage`, and the Origin Private File System (`OPFS`).
- **No Tracking / Telemetry**: OpenAtlas contains zero analytics scripts, advertising trackers, or fingerprinting libraries.
