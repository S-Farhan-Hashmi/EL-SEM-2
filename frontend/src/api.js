// ========= API CONFIG =========
export const OCM_API_KEY = '485c6801-fc29-4323-b54f-7b979346cfa6';
export const GRAPHHOPPER_API_KEY = 'd0b14953-96df-4e6d-ae75-e6e4fc511a59';

// Backend URL: set window.CHARGEFLOW_BACKEND in index.html to your Render URL.
// Falls back to localhost:5000 for local development (start.bat).
const BACKEND_URL = (window.CHARGEFLOW_BACKEND || 'http://localhost:5000').replace(/\/$/, '');


const CORS_PROXIES = [
    'https://api.allorigins.win/raw?url=',
    'https://api.allorigins.win/get?url=',
    'https://corsproxy.io/?'
];

const GRAPHHOPPER_BASE_URL = 'https://graphhopper.com/api/1/route';

// ========= OPEN CHARGE MAP =========
export async function fetchChargingStations(lat, lng, radiusMiles) {
    const params = new URLSearchParams({
        output: 'json',
        latitude: lat,
        longitude: lng,
        distance: radiusMiles.toString(),
        distanceunit: 'Miles',
        maxresults: '50'
    });

    if (OCM_API_KEY) {
        params.append('key', OCM_API_KEY);
    }

    const url = `https://api.openchargemap.io/v3/poi/?${params.toString()}`;
    const isLocalFile = window.location.protocol === 'file:';

    console.log('Fetching charging stations from:', url);

    if (!isLocalFile) {
        try {
            const response = await fetch(url, {
                method: 'GET',
                headers: { 'Accept': 'application/json' }
            });

            if (response.ok) {
                const data = await response.json();
                if (Array.isArray(data)) return data;
                if (data && Array.isArray(data.data)) return data.data;
                throw new Error('Response is not an array');
            }
        } catch (err) {
            console.warn('Direct fetch failed:', err.message);
        }
    }

    let lastError = null;
    console.log('Trying CORS proxies as fallback...');

    for (let i = 0; i < CORS_PROXIES.length; i++) {
        const proxy = CORS_PROXIES[i];
        try {
            const requestUrl = `${proxy}${encodeURIComponent(url)}`;
            const response = await fetch(requestUrl);

            if (!response.ok) {
                throw new Error(`Proxy ${i + 1} returned status ${response.status}`);
            }

            let data = await response.json();

            if (data && data.contents) {
                data = JSON.parse(data.contents);
            } else if (typeof data === 'string') {
                data = JSON.parse(data);
            }

            if (Array.isArray(data)) return data;
            if (data && Array.isArray(data.data)) return data.data;
            throw new Error('Unexpected response format - expected array');
        } catch (err) {
            console.warn(`Proxy ${i + 1} failed:`, err.message);
            lastError = err;
        }
    }

    throw new Error(`Failed to fetch charging stations. Last error: ${lastError ? lastError.message : 'Unknown error'}`);
}

// ========= GRAPHHOPPER ROUTING =========
export async function fetchRouteFromGraphHopper(startLat, startLng, endLat, endLng) {
    const params = new URLSearchParams({
        vehicle: 'car',
        type: 'json',
        instructions: 'false',
        calc_points: 'true',
        points_encoded: 'false'
    });

    const pointParams = `point=${startLat},${startLng}&point=${endLat},${endLng}`;

    if (GRAPHHOPPER_API_KEY) {
        params.append('key', GRAPHHOPPER_API_KEY);
    }

    const url = `${GRAPHHOPPER_BASE_URL}?${pointParams}&${params.toString()}`;
    const needsProxy = window.location.protocol === 'file:';

    if (!needsProxy) {
        try {
            const response = await fetch(url, {
                headers: { 'Content-Type': 'application/json' }
            });
            if (response.ok) {
                return response.json();
            }
        } catch (err) {
            console.warn('Direct fetch failed, trying proxy:', err);
        }
    }

    let lastError = null;

    for (let i = 0; i < CORS_PROXIES.length; i++) {
        const proxy = CORS_PROXIES[i];
        try {
            const requestUrl = `${proxy}${encodeURIComponent(url)}`;
            const response = await fetch(requestUrl);

            if (!response.ok) {
                throw new Error(`Proxy ${i + 1} returned status ${response.status}`);
            }

            let data = await response.json();

            if (data && data.contents) {
                data = JSON.parse(data.contents);
            } else if (typeof data === 'string') {
                data = JSON.parse(data);
            }

            return data;
        } catch (err) {
            console.warn(`GraphHopper proxy ${i + 1} failed:`, err.message);
            lastError = err;
        }
    }

    throw new Error(`All CORS proxies failed for routing. Last error: ${lastError ? lastError.message : 'Unknown error'}`);
}

// ========= ML RECOMMENDATIONS =========
let _cachedRestaurants = null;

async function loadRestaurantCSV() {
    if (_cachedRestaurants) return _cachedRestaurants;
    try {
        // Try multiple possible paths for the CSV
        const paths = [
            'backend-ml/data/Bengaluru_Restaurants.csv',
            '../backend-ml/data/Bengaluru_Restaurants.csv',
            './backend-ml/data/Bengaluru_Restaurants.csv'
        ];
        let csvText = null;
        for (const path of paths) {
            try {
                const resp = await fetch(path);
                if (resp.ok) {
                    csvText = await resp.text();
                    console.log(`[KNN Fallback] Loaded CSV from: ${path}`);
                    break;
                }
            } catch (e) { /* try next path */ }
        }
        if (!csvText) {
            console.error('[KNN Fallback] Could not load restaurant CSV from any path');
            return null;
        }

        // Parse CSV
        const lines = csvText.split('\n');
        const restaurants = [];
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            // Handle CSV with quoted fields (commas inside quotes)
            const fields = [];
            let current = '';
            let inQuotes = false;
            for (let j = 0; j < line.length; j++) {
                const ch = line[j];
                if (ch === '"') {
                    inQuotes = !inQuotes;
                } else if (ch === ',' && !inQuotes) {
                    fields.push(current.trim());
                    current = '';
                } else {
                    current += ch;
                }
            }
            fields.push(current.trim());

            // CSV columns: name, cuisine, DietaryRestrictions, latitude, longitude, phone, rating
            if (fields.length >= 7) {
                const lat = parseFloat(fields[3]);
                const lng = parseFloat(fields[4]);
                const rating = parseFloat(fields[6]) || 3.0;
                const name = fields[0];
                if (!isNaN(lat) && !isNaN(lng) && name) {
                    restaurants.push({ name, lat, lng, rating });
                }
            }
        }

        console.log(`[KNN Fallback] Parsed ${restaurants.length} restaurants from CSV`);
        _cachedRestaurants = restaurants;
        return restaurants;
    } catch (err) {
        console.error('[KNN Fallback] Error loading CSV:', err);
        return null;
    }
}

function knnRecommend(restaurants, queryLat, queryLng, topN = 5) {
    // Calculate Euclidean distance (same as sklearn KNN with ball_tree on lat/lng)
    const withDist = restaurants.map(r => {
        const dLat = r.lat - queryLat;
        const dLng = r.lng - queryLng;
        const dist = Math.sqrt(dLat * dLat + dLng * dLng);
        return { name: r.name, rating: r.rating, distance: dist };
    });

    // Sort by distance ascending
    withDist.sort((a, b) => a.distance - b.distance);

    // Return top N
    return withDist.slice(0, topN);
}

export async function fetchRestaurantRecommendations(lat, lng) {
    // Try Flask backend first
    try {
        const response = await fetch(`${BACKEND_URL}/recommend?lat=${lat}&lng=${lng}`);
        if (response.ok) {
            const data = await response.json();
            if (data && data.length > 0) {
                console.log(`[Recommendations] Got ${data.length} results from Flask backend`);
                return data;
            }
        }
    } catch (err) {
        console.warn('[Recommendations] Flask backend unavailable, using browser-side KNN fallback');
    }

    // Fallback: browser-side KNN using CSV data
    try {
        const restaurants = await loadRestaurantCSV();
        if (!restaurants || restaurants.length === 0) {
            console.error('[Recommendations] No restaurant data available for fallback');
            return null;
        }
        const recs = knnRecommend(restaurants, lat, lng, 5);
        console.log(`[Recommendations] Browser KNN found ${recs.length} results`);
        return recs;
    } catch (err) {
        console.error('[Recommendations] Fallback KNN failed:', err);
        return null;
    }
}

// ========= PEAK HOURS ANALYSIS =========
export async function analyzePeakHours(stationId) {
    try {
        const response = await fetch(`${BACKEND_URL}/peak_hours?station_id=${encodeURIComponent(stationId)}`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        return data;
    } catch (err) {
        console.error('Failed to analyze peak hours:', err);
        return null;
    }
}

// ========= ALL PEAK HOURS (Bulk) =========
export async function fetchAllPeakHours() {
    try {
        const response = await fetch(`${BACKEND_URL}/all_peak_hours`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        return data;
    } catch (err) {
        console.error('Failed to fetch all peak hours:', err);
        return null;
    }
}

export async function registerTimestampInMySQL(stationId, timestamp) {
    try {
        const response = await fetch(`${BACKEND_URL}/register_timestamp`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ station_id: stationId, timestamp: timestamp })
        });
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        return data;
    } catch (err) {
        console.error('Failed to register timestamp:', err);
        return null;
    }
}

export async function clearStationTimestamps(stationId) {
    try {
        const response = await fetch(`${BACKEND_URL}/clear_timestamps?station_id=${encodeURIComponent(stationId)}`, {
            method: 'DELETE'
        });
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        return data;
    } catch (err) {
        console.error('Failed to clear timestamps:', err);
        return null;
    }
}
