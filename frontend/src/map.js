import { fetchChargingStations, fetchRouteFromGraphHopper, fetchRestaurantRecommendations, analyzePeakHours, registerTimestampInMySQL } from './api.js';
import { getDatabase } from './auth.js';

// ========= MAP STATE =========
export let map = null;
export let mapInitialized = false;
export let userMarker = null;
export let firebaseLocationMarker = null;
export let rangeCircle = null;
export let stationMarkers = [];
export let currentRoute = null;
export let userLocationWatchId = null;
let isFirstLocationFind = true;
export let recommendedStations = new Set(); // Tracks stations we already requested KNN for

// ========= UTILITY =========
export function calculateDistanceMiles(lat1, lon1, lat2, lon2) {
    const R = 3958.8; // Earth radius in miles
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
        Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
        Math.sin(dLon/2) * Math.sin(dLon/2); 
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); 
    return R * c; 
}

export function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

export function statusMessage(msg, type = 'neutral') {
    const statusEl = document.getElementById('status');
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.classList.remove('error', 'success');
    if (type === 'error') statusEl.classList.add('error');
    if (type === 'success') statusEl.classList.add('success');
}

// ========= MAP INIT =========
export function loadOpenStreetMapView() {
    if (mapInitialized) {
        statusMessage('OpenStreetMap view is already loaded.', 'success');
        return;
    }
    statusMessage('Loading OpenStreetMap view…', 'neutral');
    initLeafletMap();
}

export function initLeafletMap() {
    const defaultLocation = { lat: 37.7749, lng: -122.4194 };

    map = L.map('map', {
        zoomControl: false,
        attributionControl: false
    }).setView([defaultLocation.lat, defaultLocation.lng], 11);

    L.control.zoom({ position: 'bottomright' }).addTo(map);

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);

    L.control.attribution({ position: 'bottomright' })
        .addAttribution('Map data © OpenStreetMap contributors');

    // Force size recalculation to prevent "black map" (0 height/width) issues
    setTimeout(() => {
        if (map) {
            map.invalidateSize();
        }
    }, 250);

    window.addEventListener('resize', () => {
        if (map) {
            map.invalidateSize();
        }
    });

    mapInitialized = true;
    statusMessage('Map view ready. Trying to locate you…', 'success');
    locateUser(defaultLocation);
}

// ========= GEOLOCATION =========
export function locateUser(fallbackLocation) {
    if (!navigator.geolocation) {
        statusMessage('Geolocation is not supported by this browser. Using default location.', 'error');
        setUserLocation(fallbackLocation);
        return;
    }

    // Clear any existing watch before starting a new one
    if (userLocationWatchId !== null) {
        navigator.geolocation.clearWatch(userLocationWatchId);
    }

    userLocationWatchId = navigator.geolocation.watchPosition(
        (position) => {
            const coords = {
                lat: position.coords.latitude,
                lng: position.coords.longitude
            };
            statusMessage('Live location tracking active.', 'success');
            setUserLocation(coords);
        },
        (error) => {
            console.warn('Geolocation error:', error);
            statusMessage('Unable to access live location. Using default city.', 'error');
            setUserLocation(fallbackLocation);
        },
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
    );
}

export function setUserLocation(coords) {
    if (!mapInitialized) return;
    const latLng = [coords.lat, coords.lng];
    
    // Only recenter the map on the very first location fix,
    // BUT only if Firebase hasn't already zoomed to our own stations.
    if (isFirstLocationFind) {
        isFirstLocationFind = false;
        if (!window.firebaseZoomedToStations) {
            map.setView(latLng, 14);
        }
    }

    // Update existing marker instead of deleting/recreating to avoid flickering
    if (userMarker) {
        userMarker.setLatLng(latLng);
    } else {
        userMarker = L.circleMarker(latLng, {
            radius: 8,
            fillColor: '#3b82f6',
            fillOpacity: 1,
            color: '#ffffff',
            weight: 3
        }).addTo(map).bindTooltip('Your Location', { direction: 'top' });
    }

    // Trigger KNN check when location updates
    checkProximityForRecommendations(coords.lat, coords.lng);
}

// ========= RECOMMENDATIONS LOGIC =========
function showRecommendations(recs, stationName) {
    const area = document.getElementById('recommendationsArea');
    const list = document.getElementById('recommendationsList');
    if (!area || !list) return;

    list.innerHTML = '';
    
    const info = document.createElement('div');
    info.style.fontSize = '0.75rem';
    info.style.color = '#94a3b8';
    info.style.marginBottom = '0.5rem';
    info.innerHTML = `Near <strong>${escapeHtml(stationName)}</strong>`;
    list.appendChild(info);

    if (recs.length === 0) {
        list.innerHTML += '<div style="color: #94a3b8; font-size: 0.8rem; padding: 0.5rem 0;">No AI recommendations found.</div>';
    } else {
        recs.forEach(rec => {
            const item = document.createElement('div');
            item.style.background = 'rgba(255, 255, 255, 0.08)';
            item.style.border = '1px solid rgba(255, 255, 255, 0.15)';
            item.style.borderRadius = '10px';
            item.style.padding = '12px 14px';
            item.style.display = 'flex';
            item.style.flexDirection = 'column';
            item.style.gap = '8px';
            item.style.transition = 'transform 0.2s ease, background 0.2s ease';
            item.onmouseover = () => { item.style.background = 'rgba(255, 255, 255, 0.12)'; item.style.transform = 'translateY(-2px)'; };
            item.onmouseout = () => { item.style.background = 'rgba(255, 255, 255, 0.08)'; item.style.transform = 'translateY(0)'; };
            
            const nameDiv = document.createElement('div');
            nameDiv.style.fontWeight = '600';
            nameDiv.style.fontSize = '0.95rem';
            nameDiv.style.color = '#ffffff';
            nameDiv.style.lineHeight = '1.3';
            nameDiv.style.wordBreak = 'break-word';
            nameDiv.textContent = rec.name;
            
            const metaDiv = document.createElement('div');
            metaDiv.style.display = 'flex';
            metaDiv.style.justifyContent = 'space-between';
            metaDiv.style.alignItems = 'center';
            metaDiv.style.fontSize = '0.8rem';
            
            const ratingSpan = document.createElement('span');
            ratingSpan.innerHTML = `⭐ <strong style="color: #fcd34d;">${rec.rating.toFixed(1)}</strong>`;
            ratingSpan.style.background = 'rgba(0,0,0,0.3)';
            ratingSpan.style.padding = '2px 6px';
            ratingSpan.style.borderRadius = '4px';
            
            const distSpan = document.createElement('span');
            const distDisp = (rec.distance * 69).toFixed(2);
            distSpan.innerHTML = `<span style="opacity:0.7;">📍</span> ~${distDisp} mi`; 
            distSpan.style.color = '#cbd5e1';

            metaDiv.appendChild(ratingSpan);
            metaDiv.appendChild(distSpan);
            
            item.appendChild(nameDiv);
            item.appendChild(metaDiv);
            list.appendChild(item);
        });
    }

    area.classList.add('active');
}

async function checkProximityForRecommendations(userLat, userLng) {
    const thresholdMiles = 5;

    // Collect all candidates: [dist, lat, lng, title]
    const candidates = [];

    // OCM stations
    for (const marker of stationMarkers) {
        const pos = marker.getLatLng();
        const dist = calculateDistanceMiles(userLat, userLng, pos.lat, pos.lng);
        const title = marker.options.title || 'Unknown Station';
        if (dist <= thresholdMiles) {
            candidates.push({ dist, lat: pos.lat, lng: pos.lng, title });
        }
    }

    // Firebase stations
    if (window.firebaseStationMarkerMap) {
        for (const [id, marker] of Object.entries(window.firebaseStationMarkerMap)) {
            const pos = marker.getLatLng();
            const dist = calculateDistanceMiles(userLat, userLng, pos.lat, pos.lng);
            const title = marker.options.title || `Station ${id}`;
            if (dist <= thresholdMiles) {
                candidates.push({ dist, lat: pos.lat, lng: pos.lng, title });
            }
        }
    }

    if (candidates.length === 0) return;

    // Sort by distance — closest first
    candidates.sort((a, b) => a.dist - b.dist);

    // Pick the closest one that hasn't been recommended yet
    for (const candidate of candidates) {
        if (!recommendedStations.has(candidate.title)) {
            recommendedStations.add(candidate.title);
            const recs = await fetchRestaurantRecommendations(candidate.lat, candidate.lng);
            if (recs && recs.length > 0) {
                showRecommendations(recs, candidate.title);
                return;
            }
        }
    }

    // If all nearby stations were already in the set but we still have candidates,
    // force-show recommendations for the closest one (ensures at least 1 recommendation)
    if (candidates.length > 0) {
        const closest = candidates[0];
        const recs = await fetchRestaurantRecommendations(closest.lat, closest.lng);
        if (recs && recs.length > 0) {
            showRecommendations(recs, closest.title);
        }
    }
}

// ========= RANGE CIRCLE =========
export function drawRangeCircle(center, radiusMiles) {
    const radiusMeters = radiusMiles * 1609.34;
    if (rangeCircle) rangeCircle.remove();

    rangeCircle = L.circle(center, {
        radius: radiusMeters,
        color: '#3b82f6',
        weight: 1.5,
        opacity: 0.6,
        fillColor: '#3b82f6',
        fillOpacity: 0.1
    }).addTo(map);

    map.fitBounds(rangeCircle.getBounds());
}

// ========= ROUTE DRAWING =========
export function drawRoute(points) {
    if (currentRoute) currentRoute.remove();

    let routeCoordinates = [];

    if (points && points.coordinates) {
        routeCoordinates = points.coordinates.map(coord => {
            if (Array.isArray(coord) && coord.length >= 2) return [coord[1], coord[0]];
            return null;
        }).filter(Boolean);
    } else if (Array.isArray(points)) {
        if (points.length > 0 && Array.isArray(points[0]) && points[0].length === 2) {
            routeCoordinates = points.map(p => [p[1], p[0]]);
        } else if (points.length > 0 && typeof points[0] === 'object' && points[0].lat !== undefined) {
            routeCoordinates = points.map(p => [p.lat, p.lng]);
        }
    }

    if (routeCoordinates.length === 0) {
        console.warn('No valid route coordinates found');
        return;
    }

    currentRoute = L.polyline(routeCoordinates, {
        color: '#10b981',
        weight: 5,
        opacity: 0.9,
        smoothFactor: 1
    }).addTo(map);

    map.fitBounds(currentRoute.getBounds(), { padding: [50, 50] });
}

// ========= OCM STATION MARKERS =========
export function clearStationMarkers() {
    stationMarkers.forEach(marker => marker.remove());
    stationMarkers = [];
    // Reset the recommendation cache so new stations are checked fresh
    recommendedStations.clear();
}

export function addStationMarkers(stations) {
    stations.forEach(station => {
        if (!station.AddressInfo) return;
        const { Latitude, Longitude } = station.AddressInfo;
        if (Latitude == null || Longitude == null) return;

        const marker = L.marker([Latitude, Longitude], {
            title: station.AddressInfo.Title || 'Charging Station'
        }).addTo(map);

        const addressParts = [
            station.AddressInfo.AddressLine1,
            station.AddressInfo.Town,
            station.AddressInfo.StateOrProvince,
            station.AddressInfo.Postcode
        ].filter(Boolean);

        const usageCost = station.UsageCost || 'See provider for details';

        const infoHtml = `
      <div style="font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 260px;">
        <div style="font-size: 0.95rem; font-weight: 600; margin-bottom: 0.2rem; color: #111827;">
          ${escapeHtml(station.AddressInfo.Title || 'Charging Station')}
        </div>
        <div style="font-size: 0.82rem; color: #4b5563; margin-bottom: 0.35rem;">
          ${escapeHtml(addressParts.join(', ') || 'Address not available')}
        </div>
        <div style="font-size: 0.82rem; color: #111827; margin-bottom: 0.35rem;">
          <strong>Usage cost:</strong> ${escapeHtml(usageCost)}
        </div>
        <div style="margin-top: 0.5rem;">
          <button id="routeBtn-${station.ID}" style="
            background: linear-gradient(135deg, #3b82f6, #10b981);
            color: #ffffff; border: none; border-radius: 6px;
            padding: 0.4rem 0.8rem; font-size: 0.8rem; font-weight: 600;
            cursor: pointer; width: 100%; transition: filter 0.2s;
          " onmouseover="this.style.filter='brightness(1.1)'" onmouseout="this.style.filter='brightness(1)'">
            🧭 Get Route
          </button>
        </div>
        <div id="routeInfo-${station.ID}" style="margin-top: 0.5rem; font-size: 0.75rem; color: #4b5563; display: none;"></div>
        <div style="margin-top: 0.5rem; padding-top: 0.5rem; border-top: 1px solid #e5e7eb;">
          <div style="font-size: 0.8rem; font-weight: 600; color: #1f2937; margin-bottom: 0.3rem;">MySQL Peak Hours Test</div>
          <button id="simEntryBtn-ocm-${station.ID}" style="
            background: #4f46e5; color: white; border: none; border-radius: 4px;
            padding: 0.3rem 0.6rem; font-size: 0.75rem; cursor: pointer; width: 100%; margin-bottom: 0.3rem; transition: background 0.2s;
          " onmouseover="this.style.background='#4338ca'" onmouseout="this.style.background='#4f46e5'">
            🚗 Simulate Entry (Now)
          </button>
          <div id="peakInfo-ocm-${station.ID}" style="font-size: 0.75rem; color: #4b5563; min-height: 1.2rem;">Click to register timestamp.</div>
        </div>
      </div>
    `;

        marker.bindPopup(infoHtml);

        marker.on('popupopen', async () => {
            const routeBtn = document.getElementById(`routeBtn-${station.ID}`);
            if (routeBtn) {
                routeBtn.addEventListener('click', () => calculateRouteToStation(station, marker));
            }
            
            const simBtn = document.getElementById(`simEntryBtn-ocm-${station.ID}`);
            const peakInfo = document.getElementById(`peakInfo-ocm-${station.ID}`);
            if (simBtn && peakInfo) {
                peakInfo.innerHTML = "Loading...";
                const stationStrId = `ocm-${station.ID}`;
                const initialData = await analyzePeakHours(stationStrId);
                if (initialData && initialData.peak_hours && initialData.peak_hours.length > 0) {
                    peakInfo.innerHTML = `Peak hours: <strong>${initialData.peak_hours.join(', ')}</strong>`;
                } else {
                    peakInfo.innerHTML = "No entries yet.";
                }

                simBtn.addEventListener('click', async () => {
                    const nowISO = new Date().toISOString();
                    simBtn.disabled = true;
                    simBtn.innerText = "Registering...";
                    
                    const res = await registerTimestampInMySQL(stationStrId, nowISO);
                    if (res && res.success) {
                        const updatedData = await analyzePeakHours(stationStrId);
                        if (updatedData && updatedData.peak_hours && updatedData.peak_hours.length > 0) {
                            peakInfo.innerHTML = `Peak hours: <strong>${updatedData.peak_hours.join(', ')}</strong>`;
                        } else {
                            peakInfo.innerHTML = "Error fetching updated data.";
                        }
                    } else {
                        peakInfo.innerHTML = "<span style='color:red;'>Failed to register</span>";
                    }
                    
                    simBtn.disabled = false;
                    simBtn.innerText = "🚗 Simulate Entry (Now)";
                });
            }
        });

        stationMarkers.push(marker);
    });
}

// ========= ROUTE CALCULATION (OCM) =========
export async function calculateRouteToStation(station, stationMarker) {
    if (!userMarker) {
        statusMessage('User location is not set. Cannot calculate route.', 'error');
        return;
    }

    const startPoint = userMarker.getLatLng();
    const endPoint = stationMarker.getLatLng();
    statusMessage('Calculating route...', 'neutral');

    try {
        const routeData = await fetchRouteFromGraphHopper(startPoint.lat, startPoint.lng, endPoint.lat, endPoint.lng);

        if (routeData && routeData.paths && routeData.paths.length > 0) {
            const path = routeData.paths[0];
            const distanceKm = (path.distance / 1000).toFixed(2);
            const distanceMiles = (distanceKm * 0.621371).toFixed(2);
            const timeMinutes = Math.round(path.time / 60000);
            const timeHours = Math.floor(timeMinutes / 60);
            const timeMins = timeMinutes % 60;
            const timeString = timeHours > 0 ? `${timeHours}h ${timeMins}m` : `${timeMins}m`;

            drawRoute(path.points);

            const routeInfoEl = document.getElementById(`routeInfo-${station.ID}`);
            if (routeInfoEl) {
                routeInfoEl.style.display = 'block';
                routeInfoEl.innerHTML = `
          <div style="padding: 0.6rem; background: rgba(255,255,255,0.05); border-radius: 8px; border: 1px solid rgba(255,255,255,0.1);">
            <div style="font-weight: 600; margin-bottom: 0.3rem; color: #fff;">Route Information:</div>
            <div style="color: #cbd5e1;">Distance: <strong style="color:#fff;">${distanceMiles} mi</strong> (${distanceKm} km)</div>
            <div style="color: #cbd5e1;">Estimated Time: <strong style="color:#fff;">${timeString}</strong></div>
          </div>
        `;
            }

            statusMessage(`Route calculated: ${distanceMiles} mi, ${timeString}`, 'success');
        } else {
            throw new Error('No route found');
        }
    } catch (err) {
        console.error('Route calculation error:', err);
        statusMessage('Failed to calculate route. Please try again.', 'error');
    }
}

// ========= HANDLE RANGE + STATIONS =========
export async function handleCalculate() {
    if (!mapInitialized || !map) {
        statusMessage('Map is not ready yet. Please load the map first.', 'error');
        return;
    }

    const carModelSelect = document.getElementById('carModel');
    const batteryInput = document.getElementById('batteryLevel');
    const rangeInfoEl = document.getElementById('rangeInfo');
    const stationInfoEl = document.getElementById('stationInfo');

    const maxRangeMiles = parseFloat(carModelSelect.value);
    const batteryPercent = parseFloat(batteryInput.value);

    if (isNaN(batteryPercent) || batteryPercent < 0 || batteryPercent > 100) {
        statusMessage('Please enter a valid battery percentage between 0 and 100.', 'error');
        return;
    }

    const distanceMiles = (maxRangeMiles * batteryPercent) / 100;
    const distanceMilesRounded = Math.round(distanceMiles * 10) / 10;
    rangeInfoEl.textContent = `~${distanceMilesRounded} mi`;

    if (!userMarker) {
        statusMessage('User location is not set yet.', 'error');
        return;
    }

    const center = userMarker.getLatLng();
    drawRangeCircle(center, distanceMiles);

    statusMessage('Searching for charging stations within your reachable range...', 'neutral');
    stationInfoEl.textContent = '…';

    try {
        const stations = await fetchChargingStations(center.lat, center.lng, distanceMiles);

        if (!stations || !Array.isArray(stations)) throw new Error('Invalid response format - expected array');

        clearStationMarkers();
        addStationMarkers(stations);
        stationInfoEl.textContent = `${stations.length}`;
        statusMessage(`Found ${stations.length} charging station${stations.length === 1 ? '' : 's'} in range.`, 'success');

        // ===== TERMINAL / CONSOLE LOG =====
        console.log(`[Initiate Flow] Search coords: lat=${center.lat.toFixed(6)}, lng=${center.lng.toFixed(6)}`);
        console.log(`[Initiate Flow] OCM stations found: ${stations.length}`);
        if (window.firebaseStationMarkerMap) {
            const ownCount = Object.keys(window.firebaseStationMarkerMap).length;
            console.log(`[Initiate Flow] Own Firebase stations on map: ${ownCount}`);
            Object.entries(window.firebaseStationMarkerMap).forEach(([id, m]) => {
                const ll = m.getLatLng();
                console.log(`  → Station ${id}: lat=${ll.lat.toFixed(6)}, lng=${ll.lng.toFixed(6)}`);
            });
        }

        // Immediately check proximity for recommendations now that stations are loaded
        if (userMarker) {
            const pos = userMarker.getLatLng();
            checkProximityForRecommendations(pos.lat, pos.lng);
        }

        if (stations.length > 0) {
            const bounds = L.latLngBounds([center]);
            stations.slice(0, 20).forEach(s => {
                if (s.AddressInfo && s.AddressInfo.Latitude && s.AddressInfo.Longitude) {
                    bounds.extend([s.AddressInfo.Latitude, s.AddressInfo.Longitude]);
                }
            });
            map.fitBounds(bounds);
        } else {
            statusMessage('No charging stations found in your range. Try increasing battery level or range.', 'error');
        }
    } catch (err) {
        console.error('Error fetching charging stations:', err);
        statusMessage(`Failed to fetch charging stations: ${err.message || 'Unknown error'}`, 'error');
        document.getElementById('stationInfo').textContent = '–';
    }
}

// ========= FIREBASE MARKER HELPERS =========
function getMarkerColor(status) {
    return status === 'Available' ? '#22c55e' : '#ef4444';
}

function createStationIcon(status) {
    const color = getMarkerColor(status);
    return L.divIcon({
        className: 'firebase-station-marker',
        html: `<div style="background-color: ${color}; width: 24px; height: 24px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 6px rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 10px;">⚡</div>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12]
    });
}

function createStationPopup(station, stationId) {
    const info = station.Info || {};
    const live = station.Live || {};
    const title = info.Title || info.title || `Station ${stationId}`;
    const uuid = info.UUID || info.uuid;
    const status = live.Status || 'Unknown';
    const statusColor = status === 'Available' ? '#22c55e' : '#ef4444';
    // New Arduino (Document.txt) marks nodes with Type: 'module' — no relay/solar fields
    const isModule = station.Type === 'module';

    return `
    <div style="font-family: system-ui, -apple-system, sans-serif; max-width: 260px;">
      <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 0.3rem;">
        <div style="font-size: 0.95rem; font-weight: 600; color: #1f2937; flex: 1;">
          ${escapeHtml(title)}
        </div>
        ${isModule ? `<span style="font-size: 0.65rem; font-weight: 700; background: #dbeafe; color: #1d4ed8; border-radius: 4px; padding: 2px 6px; white-space: nowrap;">📡 MONITOR</span>` : ''}
      </div>
      <div style="font-size: 0.8rem; color: #6b7280; margin-bottom: 0.2rem;">
        <strong>Station ID:</strong> ${stationId}
      </div>
      ${uuid ? `<div style="font-size: 0.75rem; color: #9ca3af; margin-bottom: 0.2rem;"><strong>UUID:</strong> ${escapeHtml(uuid)}</div>` : ''}
      <div style="font-size: 0.8rem; color: #6b7280; margin-top: 0.5rem; padding-top: 0.5rem; border-top: 1px solid #e5e7eb;">
        <div style="margin-bottom: 0.3rem;">
          <strong>Status:</strong>
          <span style="color: ${statusColor}; font-weight: 600;">${escapeHtml(status)}</span>
        </div>
        ${live.Distance != null ? `<div><strong>Sensor Distance:</strong> ${live.Distance} cm</div>` : ''}
      </div>
      <div style="margin-top: 0.5rem;">
        <button id="routeBtn-firebase-${stationId}" style="
          background: linear-gradient(135deg, #38bdf8, #22c55e);
          color: #0b1120; border: none; border-radius: 6px;
          padding: 0.4rem 0.8rem; font-size: 0.8rem; font-weight: 600;
          cursor: pointer; width: 100%; transition: filter 0.2s;
        " onmouseover="this.style.filter='brightness(1.1)'" onmouseout="this.style.filter='brightness(1)'">
          🧭 Get Route
        </button>
      </div>
      <div id="routeInfo-firebase-${stationId}" style="margin-top: 0.5rem; font-size: 0.75rem; color: #4b5563; display: none;"></div>
      <div style="margin-top: 0.5rem; padding-top: 0.5rem; border-top: 1px solid #e5e7eb;">
        <div style="font-size: 0.8rem; font-weight: 600; color: #1f2937; margin-bottom: 0.3rem;">Peak Hours</div>
        <button id="simEntryBtn-${stationId}" style="
          background: #4f46e5; color: white; border: none; border-radius: 4px;
          padding: 0.3rem 0.6rem; font-size: 0.75rem; cursor: pointer; width: 100%; margin-bottom: 0.3rem; transition: background 0.2s;
        " onmouseover="this.style.background='#4338ca'" onmouseout="this.style.background='#4f46e5'">
          🚗 Simulate Entry (Now)
        </button>
        <div id="peakInfo-${stationId}" style="font-size: 0.75rem; color: #4b5563; min-height: 1.2rem;">Click to register timestamp.</div>
      </div>
    </div>
  `;
}

export function createOrUpdateStationMarker(station, stationId, markerMap) {
    if (!station || !station.Info) {
        console.warn(`Station ${stationId} missing Info node`);
        return null;
    }

    const info = station.Info;
    const lat = info.Latitude || info.latitude;
    const lng = info.Longitude || info.longitude;
    const live = station.Live || {};
    const status = live.Status || 'Unknown';

    if (!window.stationPreviousStatus) {
        window.stationPreviousStatus = {};
    }

    const previousStatus = window.stationPreviousStatus[stationId];

    // New Arduino (Document.txt): no relay. Auto-register timestamp when a car
    // arrives (Available → Occupied) — the sensor loop still writes Status to Firebase.
    if (previousStatus === 'Available' && status === 'Occupied') {
        console.log(`Station ${stationId}: car detected (Available → Occupied). Auto-registering timestamp...`);
        const nowISO = new Date().toISOString();
        registerTimestampInMySQL(stationId, nowISO).then(res => {
            if (res && res.success) {
                console.log(`✓ Auto-registered timestamp for ${stationId}`);
                const peakInfo = document.getElementById(`peakInfo-${stationId}`);
                if (peakInfo) {
                    analyzePeakHours(stationId).then(updatedData => {
                        if (updatedData && updatedData.peak_hours && updatedData.peak_hours.length > 0) {
                            peakInfo.innerHTML = `Peak hours: <strong>${updatedData.peak_hours.join(', ')}</strong>`;
                        }
                    });
                }
            } else {
                console.error(`Failed to auto-register timestamp for ${stationId}`);
            }
        });
    }

    window.stationPreviousStatus[stationId] = status;

    if (lat == null || lng == null || isNaN(lat) || isNaN(lng)) {
        console.warn(`Station ${stationId} missing or invalid coordinates`);
        return null;
    }

    const latNum = typeof lat === 'string' ? parseFloat(lat) : lat;
    const lngNum = typeof lng === 'string' ? parseFloat(lng) : lng;

    if (isNaN(latNum) || isNaN(lngNum)) {
        console.warn(`Station ${stationId} has invalid coordinates: ${lat}, ${lng}`);
        return null;
    }

    let marker = markerMap[stationId];

    const attachListeners = (m) => {
        m.off('popupopen');
        m.on('popupopen', async () => {
            const routeBtn = document.getElementById(`routeBtn-firebase-${stationId}`);
            if (routeBtn) {
                routeBtn.addEventListener('click', () => calculateRouteToFirebaseStation(stationId, m));
            }
            
            const simBtn = document.getElementById(`simEntryBtn-${stationId}`);
            const peakInfo = document.getElementById(`peakInfo-${stationId}`);
            if (simBtn && peakInfo) {
                // Fetch initial peak hours
                peakInfo.innerHTML = "Loading...";
                const initialData = await analyzePeakHours(stationId);
                if (initialData && initialData.peak_hours.length > 0) {
                    peakInfo.innerHTML = `Peak hours: <strong>${initialData.peak_hours.join(', ')}</strong>`;
                } else {
                    peakInfo.innerHTML = "No entries yet.";
                }

                simBtn.addEventListener('click', async () => {
                    const nowISO = new Date().toISOString();
                    simBtn.disabled = true;
                    simBtn.innerText = "Registering...";
                    
                    const res = await registerTimestampInMySQL(stationId, nowISO);
                    if (res && res.success) {
                        const updatedData = await analyzePeakHours(stationId);
                        if (updatedData && updatedData.peak_hours.length > 0) {
                            peakInfo.innerHTML = `Peak hours: <strong>${updatedData.peak_hours.join(', ')}</strong>`;
                        } else {
                            peakInfo.innerHTML = "Error fetching updated data.";
                        }
                    } else {
                        peakInfo.innerHTML = "<span style='color:red;'>Failed to register</span>";
                    }
                    
                    simBtn.disabled = false;
                    simBtn.innerText = "🚗 Simulate Entry (Now)";
                });
            }
        });
    };

    if (marker) {
        marker.setIcon(createStationIcon(status));
        marker.setPopupContent(createStationPopup(station, stationId));
        attachListeners(marker);
        console.log(`✓ Updated marker for station ${stationId} - Status: ${status}`);
    } else {
        marker = L.marker([latNum, lngNum], {
            title: info.Title || info.title || `Station ${stationId}`,
            icon: createStationIcon(status)
        }).addTo(map);

        marker.bindPopup(createStationPopup(station, stationId));
        attachListeners(marker);

        markerMap[stationId] = marker;
        console.log(`✓ Created marker for station ${stationId} - Status: ${status}`);
    }

    if (!window.siteStationStatuses) window.siteStationStatuses = {};
    window.siteStationStatuses[stationId] = {
        title: info.Title || `Station ${stationId}`,
        status: status,
        color: status === 'Available' ? 'Green' : 'Red'
    };

    return marker;
}

// ========= FIREBASE STATION ROUTE =========
async function calculateRouteToFirebaseStation(stationId, stationMarker) {
    if (!userMarker) {
        statusMessage('User location is not set. Cannot calculate route.', 'error');
        return;
    }

    const startPoint = userMarker.getLatLng();
    const endPoint = stationMarker.getLatLng();
    statusMessage('Calculating route...', 'neutral');

    try {
        const routeData = await fetchRouteFromGraphHopper(startPoint.lat, startPoint.lng, endPoint.lat, endPoint.lng);

        if (routeData && routeData.paths && routeData.paths.length > 0) {
            const path = routeData.paths[0];
            const distanceKm = (path.distance / 1000).toFixed(2);
            const distanceMiles = (distanceKm * 0.621371).toFixed(2);
            const timeMinutes = Math.round(path.time / 60000);
            const timeHours = Math.floor(timeMinutes / 60);
            const timeMins = timeMinutes % 60;
            const timeString = timeHours > 0 ? `${timeHours}h ${timeMins}m` : `${timeMins}m`;

            drawRoute(path.points);

            const routeInfoEl = document.getElementById(`routeInfo-firebase-${stationId}`);
            if (routeInfoEl) {
                routeInfoEl.style.display = 'block';
                routeInfoEl.innerHTML = `
          <div style="padding: 0.6rem; background: rgba(255,255,255,0.05); border-radius: 8px; border: 1px solid rgba(255,255,255,0.1);">
            <div style="font-weight: 600; margin-bottom: 0.3rem; color: #fff;">Route Information:</div>
            <div style="color: #cbd5e1;">Distance: <strong style="color:#fff;">${distanceMiles} mi</strong> (${distanceKm} km)</div>
            <div style="color: #cbd5e1;">Estimated Time: <strong style="color:#fff;">${timeString}</strong></div>
          </div>
        `;
            }

            statusMessage(`Route calculated: ${distanceMiles} mi, ${timeString}`, 'success');
        } else {
            throw new Error('No route found');
        }
    } catch (err) {
        console.error('Route calculation error:', err);
        statusMessage('Failed to calculate route. Please try again.', 'error');

        const routeInfoEl = document.getElementById(`routeInfo-firebase-${stationId}`);
        if (routeInfoEl) {
            routeInfoEl.style.display = 'block';
            routeInfoEl.innerHTML = `
        <div style="padding: 0.5rem; background: #fee2e2; border-radius: 6px; color: #991b1b;">
          <div style="font-weight: 600;">Route calculation failed</div>
          <div style="font-size: 0.75rem;">Please try again later</div>
        </div>
      `;
        }
    }
}

// ========= FIREBASE LOCATION MARKER =========
export function updateFirebaseLocationMarker(lat, lng, title) {
    if (!mapInitialized || !map) {
        setTimeout(() => updateFirebaseLocationMarker(lat, lng, title), 500);
        return;
    }

    const latLng = [lat, lng];
    if (firebaseLocationMarker) firebaseLocationMarker.remove();

    try {
        const orangeIcon = L.divIcon({
            className: 'firebase-location-marker',
            html: '<div style="background-color: #f59e0b; width: 20px; height: 20px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.3);"></div>',
            iconSize: [20, 20],
            iconAnchor: [10, 10]
        });

        firebaseLocationMarker = L.marker(latLng, {
            title: title || 'EV Station Location',
            icon: orangeIcon
        }).addTo(map);
    } catch (error) {
        console.error('Error creating custom icon, using default:', error);
        firebaseLocationMarker = L.marker(latLng, { title: title || 'EV Station Location' }).addTo(map);
    }

    firebaseLocationMarker.bindTooltip(title || 'EV Station Location', { direction: 'top' });
    console.log(`✓ Firebase location marker updated: ${lat}, ${lng}`);

    if (userMarker) {
        const bounds = L.latLngBounds([userMarker.getLatLng(), latLng]);
        map.fitBounds(bounds, { padding: [50, 50] });
    } else {
        map.setView(latLng, 12);
    }
}

// ========= FIREBASE STATIONS LOADING =========
export function loadStationsFromFirebase() {
    const firebaseDatabase = getDatabase();

    if (!firebaseDatabase) {
        console.warn('Firebase DB not ready, retrying...');
        setTimeout(() => loadStationsFromFirebase(), 500);
        return;
    }
    if (!mapInitialized || !map) {
        console.warn('Map not ready, retrying...');
        setTimeout(() => loadStationsFromFirebase(), 500);
        return;
    }

    console.log('✅ Connecting to Firebase Realtime DB...');
    const stationsRef = firebaseDatabase.ref('stations');

    if (!window.firebaseStationMarkerMap) {
        window.firebaseStationMarkerMap = {};
    }

    // Use a single .on('value') listener — fires immediately with current data
    // and again on every update. No need for .once() first.
    stationsRef.on('value', snapshot => {
            if (!snapshot.exists()) {
                console.warn('⚠️ Firebase snapshot empty — no stations found at /stations/');
                return;
            }

            const stationsData = snapshot.val();
            const stationIds = Object.keys(stationsData);
            console.log(`📡 Firebase: found ${stationIds.length} station(s):`, stationIds);

            // Remove markers for stations that no longer exist
            const currentIds = Object.keys(window.firebaseStationMarkerMap);
            currentIds.forEach(id => {
                if (!stationIds.includes(id)) {
                    const m = window.firebaseStationMarkerMap[id];
                    if (m) { m.remove(); delete window.firebaseStationMarkerMap[id]; }
                }
            });

            // Create or update a marker for each station
            const validMarkerLatLngs = [];
            stationIds.forEach(stationId => {
                const m = createOrUpdateStationMarker(stationsData[stationId], stationId, window.firebaseStationMarkerMap);
                if (m) validMarkerLatLngs.push(m.getLatLng());
            });

            console.log(`✓ ${Object.keys(window.firebaseStationMarkerMap).length} marker(s) on map`);

            // *** KEY FIX: zoom map to show the Firebase stations ***
            // Only do this on first load (when the map is still at the default view)
            if (validMarkerLatLngs.length > 0 && !window.firebaseZoomedToStations) {
                window.firebaseZoomedToStations = true;
                if (validMarkerLatLngs.length === 1) {
                    map.setView(validMarkerLatLngs[0], 15);
                } else {
                    map.fitBounds(L.latLngBounds(validMarkerLatLngs), { padding: [60, 60] });
                }
                map.invalidateSize();
                statusMessage(`📡 ${validMarkerLatLngs.length} own station(s) loaded from Firebase.`, 'success');
            }
        },
        error => {
            console.error('❌ Firebase read error:', error.message || error);
            statusMessage('Failed to load own stations from Firebase.', 'error');
        }
    );
}

// ========= FIREBASE LOCATION LISTENER =========
export function setupLocationListener() {
    const firebaseDatabase = getDatabase();
    if (!firebaseDatabase) {
        setTimeout(() => setupLocationListener(), 500);
        return;
    }

    firebaseDatabase.ref().once('value')
        .then(snapshot => {
            const rootData = snapshot.val();
            if (!rootData) return;

            const locationPaths = ['info', '/info', 'data/info', 'sensor/info'];
            const rootKeys = Object.keys(rootData);
            rootKeys.forEach(key => {
                locationPaths.push(`${key}/info`);
                locationPaths.push(`${key}/Info`);
            });

            locationPaths.forEach((path, index) => {
                setTimeout(() => {
                    const locationRef = firebaseDatabase.ref(path);
                    locationRef.once('value')
                        .then(locationSnapshot => {
                            if (!locationSnapshot.exists()) return;
                            const locationData = locationSnapshot.val();
                            if (!locationData || typeof locationData !== 'object') return;

                            let lat = locationData.Latitude || locationData.latitude || locationData.Lat || locationData.lat;
                            let lng = locationData.Longitude || locationData.longitude || locationData.Lng || locationData.lng;
                            let title = locationData.Title || locationData.title || 'EV Station Location';

                            if (typeof lat === 'string') lat = parseFloat(lat);
                            if (typeof lng === 'string') lng = parseFloat(lng);

                            if (lat !== null && lng !== null && !isNaN(lat) && !isNaN(lng)) {
                                updateFirebaseLocationMarker(lat, lng, title);

                                locationRef.on('value', updateSnapshot => {
                                    const updateData = updateSnapshot.val();
                                    if (updateData && typeof updateData === 'object') {
                                        let uLat = updateData.Latitude || updateData.latitude || updateData.Lat || updateData.lat;
                                        let uLng = updateData.Longitude || updateData.longitude || updateData.Lng || updateData.lng;
                                        let uTitle = updateData.Title || updateData.title || 'EV Station Location';
                                        if (typeof uLat === 'string') uLat = parseFloat(uLat);
                                        if (typeof uLng === 'string') uLng = parseFloat(uLng);
                                        if (uLat !== null && uLng !== null && !isNaN(uLat) && !isNaN(uLng)) {
                                            updateFirebaseLocationMarker(uLat, uLng, uTitle);
                                        }
                                    }
                                });
                            }
                        })
                        .catch(err => console.log(`Path "${path}" does not exist or error:`, err.message));
                }, index * 100);
            });
        })
        .catch(error => console.error('Error reading root for location:', error));
}
