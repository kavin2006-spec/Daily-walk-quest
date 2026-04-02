require("dotenv").config();
const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;
const ORS_API_KEY = process.env.ORS_API_KEY;

// OpenRouteService base URL
const ORS_BASE = "https://api.openrouteservice.org";

// Step conversion: 1 step ≈ 0.75 meters
const METERS_PER_STEP = 0.75;
const MAX_RETRIES = 8;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function stepsToMeters(steps) {
  return steps * METERS_PER_STEP;
}

/**
 * Generate a lat/lng point at a given distance (meters) and bearing from origin.
 * Standard haversine destination point formula.
 */
function destinationPoint(lat, lng, distanceMeters, bearingDeg) {
  const R = 6371000;
  const δ = distanceMeters / R;
  const θ = (bearingDeg * Math.PI) / 180;
  const φ1 = (lat * Math.PI) / 180;
  const λ1 = (lng * Math.PI) / 180;

  const φ2 = Math.asin(
    Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ)
  );
  const λ2 =
    λ1 +
    Math.atan2(
      Math.sin(θ) * Math.sin(δ) * Math.cos(φ1),
      Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2)
    );

  return {
    lat: (φ2 * 180) / Math.PI,
    lng: ((λ2 * 180) / Math.PI + 540) % 360 - 180,
  };
}

/**
 * Call OpenRouteService Directions API (foot-walking).
 *
 * ORS expects coordinates as [lng, lat] pairs (GeoJSON order).
 *
 * API reference: https://openrouteservice.org/dev/#/api-docs/v2/directions/{profile}/post
 *
 * How the API key is used:
 *   - Passed as the "Authorization" header
 *   - Value is just the key string (no "Bearer" prefix needed)
 *
 * Returns:
 *   - distanceMeters: total route distance
 *   - geometry: GeoJSON LineString coordinates [[lng,lat], ...]
 */
async function getWalkingRoute(fromLat, fromLng, toLat, toLng) {
  const url = `${ORS_BASE}/v2/directions/foot-walking`;

  const response = await axios.post(
    url,
    {
      // ORS uses [longitude, latitude] order — opposite of what you might expect
      coordinates: [
        [fromLng, fromLat],
        [toLng, toLat],
      ],
    },
    {
      headers: {
        // API key goes in the Authorization header — no "Bearer" prefix
        Authorization: ORS_API_KEY,
        "Content-Type": "application/json",
      },
    }
  );

  const route = response.data.routes[0];
  const distanceMeters = route.summary.distance;

  // Decode the geometry — ORS returns encoded polyline by default
  // Request GeoJSON format by adding "geometry_simplify: false" and checking format
  // The default response includes an encoded polyline in route.geometry
  // We decode it here for Leaflet
  const geometry = decodeORSPolyline(route.geometry);

  return { distanceMeters, geometry };
}

/**
 * Decode ORS encoded polyline (same format as Google's polyline encoding).
 * Returns array of [lat, lng] pairs ready for Leaflet.
 */
function decodeORSPolyline(encoded) {
  let index = 0,
    lat = 0,
    lng = 0;
  const coordinates = [];

  while (index < encoded.length) {
    let b,
      shift = 0,
      result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    // Return as [lat, lng] for Leaflet
    coordinates.push([lat / 1e5, lng / 1e5]);
  }

  return coordinates;
}

// ─── Routes ──────────────────────────────────────────────────────────────────

/**
 * POST /api/generate-destination
 *
 * Algorithm:
 * 1. Convert step goal → total distance in meters
 * 2. Target one-way distance = total / 2
 * 3. Generate a point at that distance in a random direction
 * 4. Request walking route there and back via ORS
 * 5. Check if round-trip distance >= step goal distance
 * 6. If yes → return destination + route geometry
 * 7. If no → retry with a different angle
 */
app.post("/api/generate-destination", async (req, res) => {
  const { homeLat, homeLng, stepGoal = 4000, date } = req.body;

  if (!homeLat || !homeLng) {
    return res.status(400).json({ error: "homeLat and homeLng are required" });
  }

  if (!ORS_API_KEY || ORS_API_KEY === "YOUR_ORS_API_KEY_HERE") {
    return res.status(500).json({
      error:
        "ORS API key not configured. Add ORS_API_KEY to backend/.env — get a free key at openrouteservice.org",
    });
  }

  const totalDistanceMeters = stepsToMeters(stepGoal);
  const oneWayTarget = totalDistanceMeters / 2;

  console.log(`\nGenerating destination for ${date || "today"}`);
  console.log(
    `Step goal: ${stepGoal} → ${totalDistanceMeters}m round-trip, ${oneWayTarget}m one-way`
  );

  // Use the date as a seed so the same day always starts from the same angle
  let seedAngle = 0;
  if (date) {
    const dateNum = parseInt(date.replace(/-/g, ""), 10);
    seedAngle = (dateNum * 137.508) % 360; // golden angle spread → good distribution
  } else {
    seedAngle = Math.random() * 360;
  }

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    // Spread angles evenly across retries so we explore different directions
    const bearing = (seedAngle + attempt * (360 / MAX_RETRIES)) % 360;

    // Slightly increase radius on each retry in case local routes are longer
    const radiusMultiplier = 1 + attempt * 0.08;
    const targetRadius = oneWayTarget * radiusMultiplier;

    console.log(
      `Attempt ${attempt + 1}: bearing=${bearing.toFixed(1)}°, radius=${targetRadius.toFixed(0)}m`
    );

    const candidate = destinationPoint(homeLat, homeLng, targetRadius, bearing);

    try {
      // Get outbound route: home → destination
      const outbound = await getWalkingRoute(
        homeLat,
        homeLng,
        candidate.lat,
        candidate.lng
      );

      // Get inbound route: destination → home
      const inbound = await getWalkingRoute(
        candidate.lat,
        candidate.lng,
        homeLat,
        homeLng
      );

      const roundTripDistance = outbound.distanceMeters + inbound.distanceMeters;

      console.log(
        `  Round-trip: ${roundTripDistance.toFixed(0)}m (need ${totalDistanceMeters}m) — ${
          roundTripDistance >= totalDistanceMeters ? "✓ VALID" : "✗ too short"
        }`
      );

      if (roundTripDistance >= totalDistanceMeters) {
        return res.json({
          success: true,
          destination: candidate,
          roundTripDistanceMeters: roundTripDistance,
          outboundDistanceMeters: outbound.distanceMeters,
          inboundDistanceMeters: inbound.distanceMeters,
          // Geometry arrays of [lat, lng] pairs — ready for Leaflet polylines
          outboundGeometry: outbound.geometry,
          inboundGeometry: inbound.geometry,
          stepGoal,
          totalDistanceTarget: totalDistanceMeters,
          attemptsUsed: attempt + 1,
          date: date || new Date().toISOString().split("T")[0],
        });
      }
    } catch (err) {
      // ORS may return 404 if no route exists (e.g. point is in water)
      console.warn(`  Route error: ${err.response?.data?.error?.message || err.message}`);
    }

    // Small delay between retries to be kind to the API
    await new Promise((r) => setTimeout(r, 300));
  }

  return res.status(422).json({
    error:
      "Could not find a valid walkable destination after multiple attempts. Try a lower step goal or check that your location has walkable roads nearby.",
  });
});

/**
 * GET /api/geocode?address=...
 *
 * Uses ORS Geocoding (Pelias) to convert an address to coordinates.
 * No separate API key needed — same ORS key works.
 */
app.get("/api/geocode", async (req, res) => {
  const { address } = req.query;
  if (!address) return res.status(400).json({ error: "address is required" });

  if (!ORS_API_KEY || ORS_API_KEY === "YOUR_ORS_API_KEY_HERE") {
    return res.status(500).json({ error: "ORS API key not configured." });
  }

  try {
    const url = `${ORS_BASE}/geocode/search`;
    const response = await axios.get(url, {
      params: { text: address, size: 1 },
      headers: { Authorization: ORS_API_KEY },
    });

    const features = response.data.features;
    if (!features || features.length === 0) {
      return res.status(404).json({ error: "Address not found" });
    }

    const [lng, lat] = features[0].geometry.coordinates;
    const label = features[0].properties.label;

    res.json({ lat, lng, formattedAddress: label });
  } catch (err) {
    res.status(500).json({ error: err.response?.data?.error || err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Daily Walk Quest backend running on http://localhost:${PORT}`);
  console.log(`ORS API key: ${ORS_API_KEY ? "✓ configured" : "✗ MISSING — add to .env"}`);
});