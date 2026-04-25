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
            return jsonify({"peak_hours": [], "distribution": {}})
            
        max_count = results[0]['count']
        peak_hours_list = [row['hour'] for row in results if row['count'] == max_count]
        
        distribution = {row['hour']: row['count'] for row in results}
        
        return jsonify({
            "peak_hours": peak_hours_list,
            "distribution": distribution
        })
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
