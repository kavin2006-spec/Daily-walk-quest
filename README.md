# Daily Walk Quest 🌿

A minimal web app that generates one walkable destination per day based on your step goal — validated with real walking routes. No Google account or credit card required.

---

## What It Does

Every day the app picks one destination for you to walk to and back. The destination is chosen so that the total round-trip walking distance meets your daily step goal. Once generated, it stays the same for the rest of the day — one quest per day, no more, no less.

---

## Stack

| Layer | Tech | Notes |
|---|---|---|
| Map display | Leaflet + OpenStreetMap | Free, no API key needed |
| Walking routes | OpenRouteService | Free tier, no credit card |
| Geocoding | OpenRouteService | Same key |
| Frontend | React | |
| Backend | Node.js + Express | Handles route logic |

---

## Getting a Free API Key

1. Go to **openrouteservice.org** and sign up — email and password only, no credit card
2. After login go to your **Dashboard**
3. Click **Request a token** → give it a name → **Create**
4. Copy the key — it looks like `5b3ce3597851110001cf6248...`

Free tier gives you **2,000 requests/day** and **40 requests/minute** — more than enough for personal use.

---

## Project Structure

```
daily-walk-quest/
├── backend/
│   ├── server.js          ← Express server, route logic, ORS calls
│   ├── .env               ← your API key (never committed)
│   ├── .env.example       ← safe template to show what .env should look like
│   └── package.json
└── frontend/
    ├── public/
    │   └── index.html
    └── src/
        ├── App.js         ← React app + Leaflet map
        ├── App.css        ← styles
        └── index.js       ← entry point
```

---

## Local Setup

### 1. Clone the repo

```bash
git clone https://github.com/YOUR_USERNAME/daily-walk-quest.git
cd daily-walk-quest
```

### 2. Set up the backend

```bash
cd backend
npm install
```

Create a `.env` file (copy from the template):
```bash
cp .env.example .env
```

Open `.env` and paste your ORS key:
```
ORS_API_KEY=your_key_here
PORT=3001
```

Start the backend:
```bash
node server.js
# → Daily Walk Quest backend running on http://localhost:3001
# → ORS API key: ✓ configured
```

### 3. Set up the frontend

Open a new terminal:
```bash
cd frontend
npm install
npm start
# → opens http://localhost:3000
```

You need both terminals running at the same time — backend on 3001, frontend on 3000.

---

## How the Algorithm Works

```
1. Convert step goal to meters (1 step = 0.75m)
   e.g. 4000 steps → 3000m total round-trip

2. Divide by 2 to get one-way target distance
   e.g. 3000m / 2 = 1500m one-way

3. Generate a point at that distance in a direction seeded by today's date
   (same date = same starting direction = consistent across devices)

4. Request a walking route to that point via OpenRouteService

5. Request a walking route back home

6. Check if total round-trip distance >= step goal distance
   → Yes: return the destination
   → No: rotate bearing 45° and retry (up to 8 attempts)
```

Straight-line distance is never used for validation — only actual walking route distance from OpenRouteService counts.

---

## How Daily Data Is Stored

The app uses **localStorage** — your browser's built-in key-value storage. No account, no server-side database.

Each day gets its own key based on the date:
```
dwq_quest_2025-01-15  →  { destination, route, stepGoal, ... }
dwq_quest_2025-01-16  →  { destination, route, stepGoal, ... }
```

**What this means:**
- Open the app again the same day → loads instantly from cache, no API call
- Open the next day → fresh key, generates a new destination
- Different browser or device → generates independently (but same date = same starting direction, so you'll likely land at the same destination)
- Clear browser data → cache is wiped, regenerates on next open

### Cleaning up old cache entries

Old daily entries accumulate in localStorage but are never automatically removed. Each entry is tiny (~5kb) so it's harmless, but **after about a month it's worth clearing them out**. Add this snippet inside the first `useEffect` in `App.js`:

```javascript
// Clean up entries from previous days
Object.keys(localStorage)
  .filter(key => key.startsWith("dwq_quest_") && key !== CACHE_KEY)
  .forEach(key => localStorage.removeItem(key));
```

This runs every time the app opens and removes any key that isn't today's.

---

## Live Navigation

The app displays your destination's coordinates and the walking route on the map, but does not include live GPS tracking.

**To get turn-by-turn navigation to your destination:**

1. After generating your walk, note the coordinates shown in the panel (e.g. `51.93412, 4.48201`)
2. Open **Google Maps** on your phone
3. Tap the search bar and paste the coordinates directly
4. Tap **Directions → Walking**

Google Maps will give you full live navigation from your current location to the destination.

---

## Deployment

The app is split into two deployments — backend on Render, frontend on Vercel.

### Backend → Render (free)

1. Go to **render.com** → New → Web Service → connect your GitHub repo
2. Set **Root Directory** to `backend`
3. Build command: `npm install`
4. Start command: `node server.js`
5. Under **Environment**, add:
   - `ORS_API_KEY` = your key
6. Deploy — you'll get a URL like `https://daily-walk-quest-backend.onrender.com`

### Frontend → Vercel (free)

1. Go to **vercel.com** → New Project → import your repo
2. Set **Root Directory** to `frontend`
3. Under **Environment Variables**, add:
   - `REACT_APP_BACKEND_URL` = your Render backend URL
4. Deploy — you'll get a URL like `https://daily-walk-quest.vercel.app`

---

## Environment Variables

| Variable | Where | Description |
|---|---|---|
| `ORS_API_KEY` | `backend/.env` and Render | Your OpenRouteService API key |
| `PORT` | `backend/.env` | Backend port (default 3001) |
| `REACT_APP_BACKEND_URL` | Vercel environment | Full URL of your deployed backend |

**Never commit your `.env` file.** It is listed in `.gitignore`. Use `.env.example` as the committed template.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `ORS API key: ✗ MISSING` | Check `backend/.env` — no quotes around the key |
| `401 Unauthorized` from ORS | Key is wrong or not activated — check ORS dashboard |
| Map is blank or grey | Make sure `import "leaflet/dist/leaflet.css"` is in `App.js` |
| Frontend can't reach backend | Make sure backend is running on 3001 and `"proxy"` is set in `frontend/package.json` |
| Port already in use | Run `netstat -ano | findstr :3000` on Windows, find the PID, kill with `taskkill /PID xxxx /F` |
| Works locally but not on Vercel | Check that `REACT_APP_BACKEND_URL` is set in Vercel environment variables |
| Render backend is slow to respond | Render free tier spins down after inactivity — first request of the day takes ~30 seconds to wake up |
