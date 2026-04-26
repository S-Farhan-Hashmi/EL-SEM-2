from flask import Flask, request, jsonify
from flask_cors import CORS
from inference import get_recommendations
from collections import Counter
from datetime import datetime
import mysql.connector

# MySQL configuration
# UPDATE THESE TO MATCH YOUR LOCAL MYSQL CREDENTIALS
DB_CONFIG = {
    'host': 'localhost',
    'user': 'root',
    'password': 'Gourd@13',
    'database': 'chargeflow'
}

def get_db_connection():
    try:
        return mysql.connector.connect(**DB_CONFIG)
    except mysql.connector.Error as err:
        print(f"Error connecting to MySQL: {err}")
        return None

app = Flask(__name__)
CORS(app) # Enable CORS for frontend

@app.route('/register_timestamp', methods=['POST'])
def register_timestamp():
    try:
        data = request.get_json()
        station_id = data.get('station_id')
        timestamp_str = data.get('timestamp')
        
        if not station_id or not timestamp_str:
            return jsonify({"error": "Missing station_id or timestamp"}), 400
            
        # Parse ISO string and convert UTC to local time
        if timestamp_str.endswith('Z'):
            timestamp_str = timestamp_str.replace('Z', '+00:00')
        dt = datetime.fromisoformat(timestamp_str)
        
        # If the datetime has timezone info (like UTC), convert it to local system time
        if dt.tzinfo is not None:
            dt = dt.astimezone()
            
        mysql_datetime = dt.strftime('%Y-%m-%d %H:%M:%S')

        conn = get_db_connection()
        if not conn:
            return jsonify({"error": "Database connection failed"}), 500
            
        cursor = conn.cursor()
        query = "INSERT INTO station_timestamps (station_id, entry_time) VALUES (%s, %s)"
        cursor.execute(query, (str(station_id), mysql_datetime))
        conn.commit()
        cursor.close()
        conn.close()
        
        return jsonify({"success": True, "message": "Timestamp registered successfully"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

MIN_DATA_POINTS = 5  # Minimum timestamp entries required for peak hour prediction

@app.route('/peak_hours', methods=['GET'])
def peak_hours():
    try:
        station_id = request.args.get('station_id')
        if not station_id:
            return jsonify({"error": "Missing station_id"}), 400
            
        conn = get_db_connection()
        if not conn:
            return jsonify({"error": "Database connection failed"}), 500
            
        cursor = conn.cursor(dictionary=True)

        # First check total number of entries for this station
        count_query = "SELECT COUNT(*) as total FROM station_timestamps WHERE station_id = %s"
        cursor.execute(count_query, (str(station_id),))
        total_row = cursor.fetchone()
        total_entries = total_row['total'] if total_row else 0

        if total_entries < MIN_DATA_POINTS:
            cursor.close()
            conn.close()
            return jsonify({
                "peak_hours": [],
                "distribution": {},
                "total_entries": total_entries,
                "min_required": MIN_DATA_POINTS,
                "message": f"Need at least {MIN_DATA_POINTS} entries to predict peak hours. Currently have {total_entries}."
            })

        # Query to count entries per hour for this station
        query = """
            SELECT HOUR(entry_time) as hour, COUNT(*) as count 
            FROM station_timestamps 
            WHERE station_id = %s 
            GROUP BY hour 
            ORDER BY count DESC
        """
        cursor.execute(query, (str(station_id),))
        results = cursor.fetchall()
        cursor.close()
        conn.close()
        
        if not results:
            return jsonify({"peak_hours": [], "distribution": {}, "total_entries": total_entries, "min_required": MIN_DATA_POINTS})
            
        max_count = results[0]['count']
        peak_hours_list = [row['hour'] for row in results if row['count'] == max_count]
        
        distribution = {row['hour']: row['count'] for row in results}
        
        return jsonify({
            "peak_hours": peak_hours_list,
            "distribution": distribution,
            "total_entries": total_entries,
            "min_required": MIN_DATA_POINTS
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/all_peak_hours', methods=['GET'])
def all_peak_hours():
    """Returns peak hour data for ALL stations (used by the map bubble overlay)."""
    try:
        conn = get_db_connection()
        if not conn:
            return jsonify({"error": "Database connection failed"}), 500

        cursor = conn.cursor(dictionary=True)

        # Get entry counts per station
        count_query = """
            SELECT station_id, COUNT(*) as total
            FROM station_timestamps
            GROUP BY station_id
        """
        cursor.execute(count_query)
        station_counts = {row['station_id']: row['total'] for row in cursor.fetchall()}

        # Get hourly distribution per station
        dist_query = """
            SELECT station_id, HOUR(entry_time) as hour, COUNT(*) as count
            FROM station_timestamps
            GROUP BY station_id, hour
            ORDER BY station_id, count DESC
        """
        cursor.execute(dist_query)
        rows = cursor.fetchall()
        cursor.close()
        conn.close()

        # Build per-station result
        station_data = {}
        for row in rows:
            sid = row['station_id']
            if sid not in station_data:
                station_data[sid] = []
            station_data[sid].append({'hour': row['hour'], 'count': row['count']})

        result = {}
        for sid, entries in station_data.items():
            total = station_counts.get(sid, 0)
            if total < MIN_DATA_POINTS:
                result[sid] = {
                    'peak_hours': [],
                    'distribution': {},
                    'total_entries': total,
                    'min_required': MIN_DATA_POINTS,
                    'message': f'Need at least {MIN_DATA_POINTS} entries. Currently have {total}.'
                }
            else:
                max_count = entries[0]['count']
                peak_list = [e['hour'] for e in entries if e['count'] == max_count]
                dist = {e['hour']: e['count'] for e in entries}
                result[sid] = {
                    'peak_hours': peak_list,
                    'distribution': dist,
                    'total_entries': total,
                    'min_required': MIN_DATA_POINTS
                }

        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/recommend', methods=['GET'])
def recommend():
    try:
        lat = float(request.args.get('lat'))
        lng = float(request.args.get('lng'))
    except (TypeError, ValueError):
        return jsonify({"error": "Invalid or missing lat/lng parameters"}), 400

    recs = get_recommendations(lat, lng)
    return jsonify(recs)

if __name__ == '__main__':
    # Run the server on port 5000
    app.run(host='0.0.0.0', port=5000, debug=True)
