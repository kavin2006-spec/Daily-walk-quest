import React, { useState, useEffect, useRef, useCallback } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./App.css";

// ─── Constants ───────────────────────────────────────────────────────────────

const TODAY = new Date().toISOString().split("T")[0];
const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || "";
const CACHE_KEY = `dwq_quest_${TODAY}`;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDistance(meters) {
  if (meters >= 1000) return `${(meters / 1000).toFixed(2)} km`;
  return `${Math.round(meters)} m`;
}

function formatSteps(steps) {
  return steps.toLocaleString();
}

// ─── Map Component ────────────────────────────────────────────────────────────
//
// Uses Leaflet + OpenStreetMap tiles.
// No API key needed for the map itself — OSM tiles are free and open.
//
// Leaflet is imported as an npm package (already in package.json).
// The CSS import above ("leaflet/dist/leaflet.css") is required for the map
// to render correctly — without it, tiles overlap and controls break.

function WalkMap({ home, destination, outboundGeometry, inboundGeometry }) {
  const mapRef = useRef(null);       // DOM element ref
  const leafletMap = useRef(null);   // Leaflet map instance
  const layersRef = useRef([]);      // Track markers/polylines so we can remove them

  // Initialise the Leaflet map once on mount
  useEffect(() => {
    if (leafletMap.current) return; // already initialised

    leafletMap.current = L.map(mapRef.current, {
      center: home || [51.9225, 4.47917], // fallback: Rotterdam
      zoom: 14,
      zoomControl: true,
    });

    // OpenStreetMap tile layer — completely free, no API key
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution:
        '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(leafletMap.current);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-draw markers and routes whenever data changes
  useEffect(() => {
    const map = leafletMap.current;
    if (!map) return;

    // Remove all previous layers
    layersRef.current.forEach((layer) => map.removeLayer(layer));
    layersRef.current = [];

    if (!home) return;

    const bounds = [];

    // ── Home marker (green circle) ──────────────────────────────────────────
    const homeIcon = L.divIcon({
      className: "",
      html: `<div style="
        width:16px; height:16px;
        background:#c8f09a;
        border:2.5px solid #1a2a0a;
        border-radius:50%;
        box-shadow:0 0 0 3px rgba(200,240,154,0.25);
      "></div>`,
      iconSize: [16, 16],
      iconAnchor: [8, 8],
    });

    const homeMarker = L.marker([home.lat, home.lng], { icon: homeIcon })
      .addTo(map)
      .bindPopup("🏠 Home");

    layersRef.current.push(homeMarker);
    bounds.push([home.lat, home.lng]);

    if (destination) {
      // ── Destination marker (tan/gold circle) ─────────────────────────────
      const destIcon = L.divIcon({
        className: "",
        html: `<div style="
          width:20px; height:20px;
          background:#e8d5a3;
          border:2.5px solid #1a2a0a;
          border-radius:50%;
          box-shadow:0 0 0 4px rgba(232,213,163,0.25);
        "></div>`,
        iconSize: [20, 20],
        iconAnchor: [10, 10],
      });

      const destMarker = L.marker([destination.lat, destination.lng], {
        icon: destIcon,
      })
        .addTo(map)
        .bindPopup("📍 Today's Destination");

      layersRef.current.push(destMarker);
      bounds.push([destination.lat, destination.lng]);

      // ── Outbound route (solid green line) ─────────────────────────────────
      if (outboundGeometry && outboundGeometry.length > 0) {
        const outLine = L.polyline(outboundGeometry, {
          color: "#1a1a1a",
          weight: 5,
          opacity: 0.85,
        }).addTo(map);
        layersRef.current.push(outLine);
        outboundGeometry.forEach((p) => bounds.push(p));
      }

      // ── Inbound route (dashed tan line) ───────────────────────────────────
      if (inboundGeometry && inboundGeometry.length > 0) {
        const inLine = L.polyline(inboundGeometry, {
          color: "#444444",
          weight: 4,
          opacity: 0.6,
          dashArray: "8, 8",
        }).addTo(map);
        layersRef.current.push(inLine);
      }

      // Fit map to show the full route
      if (bounds.length > 1) {
        map.fitBounds(bounds, { padding: [60, 60] });
      }
    } else {
      // Just centre on home if no destination yet
      map.setView([home.lat, home.lng], 14);
    }
  }, [home, destination, outboundGeometry, inboundGeometry]);

  return <div ref={mapRef} className="map-container" />;
}

// ─── App ─────────────────────────────────────────────────────────────────────

export default function App() {
  const [phase, setPhase] = useState("setup"); // setup | loading | quest
  const [address, setAddress] = useState("");
  const [home, setHome] = useState(null);
  const [formattedAddress, setFormattedAddress] = useState("");
  const [stepGoal, setStepGoal] = useState(4000);
  const [quest, setQuest] = useState(null);
  const [error, setError] = useState("");
  const [geoLoading, setGeoLoading] = useState(false);
  const [attempts, setAttempts] = useState(0);

  // Load cached quest on startup
  useEffect(() => {
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        setHome({ lat: parsed.homeLat, lng: parsed.homeLng });
        setFormattedAddress(parsed.formattedAddress || "");
        setStepGoal(parsed.stepGoal);
        setQuest(parsed);
        setPhase("quest");
      } catch {
        localStorage.removeItem(CACHE_KEY);
      }
    }
  }, []);

  // Use browser GPS — no API key needed
  const useMyLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setError("Geolocation not supported by your browser.");
      return;
    }
    setGeoLoading(true);
    setError("");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setHome({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setFormattedAddress("Current Location");
        setGeoLoading(false);
      },
      () => {
        setError("Could not get your location. Try typing an address.");
        setGeoLoading(false);
      }
    );
  }, []);

  // Geocode a typed address using ORS (via our backend)
  const geocodeAddress = useCallback(async () => {
    if (!address.trim()) return;
    setGeoLoading(true);
    setError("");
    try {
      const res = await fetch(
        `${BACKEND_URL}/api/geocode?address=${encodeURIComponent(address)}`
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Geocoding failed");
      setHome({ lat: data.lat, lng: data.lng });
      setFormattedAddress(data.formattedAddress);
    } catch (e) {
      setError(e.message);
    } finally {
      setGeoLoading(false);
    }
  }, [address]);

  // Generate today's destination
  const generateQuest = useCallback(async () => {
    if (!home) {
      setError("Please set your home location first.");
      return;
    }
    setPhase("loading");
    setError("");
    setAttempts(0);

    // Animate the attempt counter while we wait
    const ticker = setInterval(
      () => setAttempts((a) => a + 1),
      900
    );

    try {
      const res = await fetch(`${BACKEND_URL}/api/generate-destination`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          homeLat: home.lat,
          homeLng: home.lng,
          stepGoal,
          date: TODAY,
        }),
      });
      const data = await res.json();
      clearInterval(ticker);

      if (!res.ok) throw new Error(data.error || "Failed to generate destination");

      const questData = {
        ...data,
        homeLat: home.lat,
        homeLng: home.lng,
        formattedAddress,
        stepGoal,
      };
      setQuest(questData);
      localStorage.setItem(CACHE_KEY, JSON.stringify(questData));
      setPhase("quest");
    } catch (e) {
      clearInterval(ticker);
      setError(e.message);
      setPhase("setup");
    }
  }, [home, stepGoal, formattedAddress]);

  const resetQuest = () => {
    localStorage.removeItem(CACHE_KEY);
    setQuest(null);
    setPhase("setup");
    setError("");
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="app">
      {/* Map lives in the background at all times */}
      <WalkMap
        home={home}
        destination={quest?.destination}
        outboundGeometry={quest?.outboundGeometry}
        inboundGeometry={quest?.inboundGeometry}
      />

      {/* Loading overlay */}
      {phase === "loading" && (
        <div className="overlay">
          <div className="loading-card">
            <div className="loading-icon">⟳</div>
            <p className="loading-title">Scouting your route…</p>
            <p className="loading-sub">
              Validating walking routes · attempt {attempts + 1}
            </p>
            <div className="loading-bar">
              <div className="loading-fill" />
            </div>
          </div>
        </div>
      )}

      {/* Setup panel */}
      {phase === "setup" && (
        <div className="panel">
          <div className="panel-header">
            <span className="logo-mark">◉</span>
            <h1 className="app-title">Daily Walk Quest</h1>
            <p className="app-sub">One destination. One walk. Every day.</p>
          </div>

          <div className="panel-body">
            {/* Location input */}
            <div className="field-group">
              <label className="field-label">Home Location</label>
              <div className="address-row">
                <input
                  className="text-input"
                  placeholder="Enter your address…"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && geocodeAddress()}
                />
                <button
                  className="btn-secondary"
                  onClick={geocodeAddress}
                  disabled={geoLoading || !address.trim()}
                >
                  {geoLoading ? "…" : "Set"}
                </button>
              </div>
              <button
                className="geo-btn"
                onClick={useMyLocation}
                disabled={geoLoading}
              >
                {geoLoading ? "Locating…" : "↯ Use my current location"}
              </button>
              {formattedAddress && (
                <p className="location-confirmed">✓ {formattedAddress}</p>
              )}
            </div>

            {/* Step goal */}
            <div className="field-group">
              <label className="field-label">
                Daily Step Goal
                <span className="field-hint">
                  ≈ {formatDistance(stepGoal * 0.75)} round-trip
                </span>
              </label>
              <div className="step-presets">
                {[3000, 4000, 6000, 8000, 10000].map((s) => (
                  <button
                    key={s}
                    className={`preset-btn ${stepGoal === s ? "active" : ""}`}
                    onClick={() => setStepGoal(s)}
                  >
                    {s.toLocaleString()}
                  </button>
                ))}
              </div>
              <div className="custom-step-row">
                <input
                  type="number"
                  className="text-input number-input"
                  value={stepGoal}
                  min={1000}
                  max={30000}
                  step={500}
                  onChange={(e) => setStepGoal(Number(e.target.value))}
                />
                <span className="input-unit">steps</span>
              </div>
            </div>

            {error && <p className="error-msg">{error}</p>}

            <button
              className="btn-primary"
              onClick={generateQuest}
              disabled={!home}
            >
              Generate Today's Walk →
            </button>
          </div>
        </div>
      )}

      {/* Quest result panel */}
      {phase === "quest" && quest && (
        <div className="panel quest-panel">
          <div className="quest-header">
            <span className="quest-date">{TODAY}</span>
            <h2 className="quest-title">Today's Quest</h2>
          </div>

          <div className="stats-row">
            <div className="stat">
              <span className="stat-value">{formatSteps(quest.stepGoal)}</span>
              <span className="stat-label">steps</span>
            </div>
            <div className="stat-divider" />
            <div className="stat">
              <span className="stat-value">
                {formatDistance(quest.roundTripDistanceMeters)}
              </span>
              <span className="stat-label">round-trip</span>
            </div>
            <div className="stat-divider" />
            <div className="stat">
              <span className="stat-value">
                {formatDistance(quest.outboundDistanceMeters)}
              </span>
              <span className="stat-label">one way</span>
            </div>
          </div>

          <div className="dest-coords">
            <span className="coord-label">Destination</span>
            <span className="coord-val">
              {quest.destination.lat.toFixed(5)},{" "}
              {quest.destination.lng.toFixed(5)}
            </span>
          </div>

          <div className="route-legend">
            <span className="legend-item">
              <span className="dot green" /> Outbound
            </span>
            <span className="legend-item">
              <span className="dot tan" /> Return
            </span>
          </div>

          <button className="btn-ghost" onClick={resetQuest}>
            ← Change settings
          </button>
        </div>
      )}
    </div>
  );
}