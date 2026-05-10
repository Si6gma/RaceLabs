# Telemetry Suite

A production-grade, real-time sim racing telemetry platform inspired by professional motorsport engineering tools like MoTeC i2, AIM RaceStudio, and F1 pit wall software.

## Architecture

```
F1 Game UDP Telemetry
        ↓
Python UDP Receiver (port 20777)
        ↓
Telemetry Decoder (F1 23/24 binary protocol)
        ↓
Realtime Telemetry Bus
        ↓
WebSocket Broadcaster ──→ Frontend Dashboard
        ↓
Telemetry Recorder ──→ InfluxDB (time-series)
        ↓
PostgreSQL (metadata/sessions)
```

## Tech Stack

**Frontend**
- React 18 + TypeScript
- Vite (build tool)
- TailwindCSS (styling)
- Zustand (state management)
- HTML5 Canvas (high-frequency telemetry rendering)
- WebSocket client (real-time streaming)

**Backend**
- Python 3.11 + FastAPI
- Async UDP listener
- WebSocket broadcaster
- SQLAlchemy Async + PostgreSQL
- InfluxDB client

**Infrastructure**
- Docker + Docker Compose
- NGINX reverse proxy
- Redis (caching/pub-sub)

## Features

### Live Dashboard
- Real-time speed, gear, RPM display
- Throttle/brake gauges
- Steering wheel visualization
- DRS/ERS indicators
- Tyre temperature and wear
- Live track map
- G-force readouts
- Fuel monitoring

### Telemetry Charts
- Canvas-rendered high-frequency traces
- Multi-graph overlay (speed, throttle, brake, RPM, steering, G-force, gear, DRS)
- Synchronized hover cursor
- Pause/play controls
- Graph toggles

### Track Map
- GPS position rendering
- Speed heatmap overlay
- Throttle/brake overlays
- Zoom and pan
- Live car marker with heading

### Lap Comparison
- Multi-lap selection
- Delta calculations
- Sector time comparison
- Best lap detection
- Visual delta bars

### Session Management
- Session history table
- Export capabilities
- Best lap tracking
- Live/offline status

### Analytics
- Speed statistics
- Engine telemetry
- Input analysis
- G-force peaks
- Tyre degradation
- Session summaries

## Quick Start

### Prerequisites
- Docker + Docker Compose
- F1 23 or F1 24 (for live telemetry)

### Run with Docker

```bash
docker-compose up -d
```

Services:
- Frontend: http://localhost:3000
- Backend API: http://localhost:8000
- InfluxDB: http://localhost:8086

### Configure F1 Game

In F1 23/24:
1. Go to Settings → Telemetry Settings
2. Enable UDP Telemetry Output
3. Set IP to your machine's IP
4. Set Port to `20777`
5. Format: 2023 or 2024

### Development

**Backend**
```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

**Frontend**
```bash
cd frontend
npm install
npm run dev
```

## UDP Protocol

The decoder supports the Codemasters F1 23/24 telemetry protocol:

| Packet Type | ID | Data |
|------------|-----|------|
| Motion | 0 | Position, G-forces, suspension |
| Session | 1 | Weather, track temp, session info |
| Lap Data | 2 | Lap times, sectors, position |
| Car Telemetry | 6 | Speed, throttle, brake, RPM, temps |
| Car Status | 7 | Fuel, tyres, ERS, damage |
| Car Damage | 10 | Detailed damage |

## Performance

- **Target latency**: <100ms end-to-end
- **UI updates**: 60 FPS via requestAnimationFrame
- **Canvas rendering**: GPU-accelerated
- **WebSocket**: No polling, pure push architecture
- **Frame buffering**: Configurable ring buffers

## Project Structure

```
.
├── backend/
│   ├── app/
│   │   ├── main.py           # FastAPI app
│   │   ├── decoder.py        # F1 UDP decoder
│   │   ├── telemetry.py      # Processing pipeline
│   │   ├── websocket.py      # WS manager
│   │   ├── udp_receiver.py   # UDP listener
│   │   ├── models.py         # SQLAlchemy models
│   │   ├── database.py       # DB connection
│   │   └── config.py         # Settings
│   ├── Dockerfile
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── pages/            # All views
│   │   ├── components/       # Reusable UI
│   │   ├── stores/           # Zustand state
│   │   ├── hooks/            # WebSocket hook
│   │   ├── types/            # TypeScript types
│   │   └── utils/            # Formatters/colors
│   ├── Dockerfile
│   └── package.json
├── nginx/
│   └── nginx.conf
├── postgres/
│   └── init/
├── docker-compose.yml
└── .env
```

## License

MIT
