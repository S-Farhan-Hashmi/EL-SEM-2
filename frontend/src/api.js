// ========= API CONFIG =========
export const OCM_API_KEY = '485c6801-fc29-4323-b54f-7b979346cfa6';
export const GRAPHHOPPER_API_KEY = 'd0b14953-96df-4e6d-ae75-e6e4fc511a59';

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
export async function fetchRestaurantRecommendations(lat, lng) {
    try {
        const response = await fetch(`http://localhost:5000/recommend?lat=${lat}&lng=${lng}`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        return data;
    } catch (err) {
        console.error('Failed to fetch restaurant recommendations:', err);
        return null;
    }
}
