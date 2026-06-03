from flask import Flask, request, jsonify
from flask_cors import CORS
from inference import get_recommendations
from datetime import datetime
import os

# ── Database driver selection ─────────────────────────────────────────────────
# On Render the free tier provides PostgreSQL (DATABASE_URL env var).
# Locally we keep using MySQL via individual DB_* env vars / defaults.
DATABASE_URL = os.environ.get('DATABASE_URL')  # set automatically by Render

if DATABASE_URL:
    # ── PostgreSQL (Render) ──────────────────────────────────────────────────
    import psycopg2
    import psycopg2.extras

    def get_db_connection():
        try:
            # Render gives 'postgres://…'; psycopg2 needs 'postgresql://…'
            url = DATABASE_URL.replace('postgres://', 'postgresql://', 1)
            return psycopg2.connect(url, cursor_factory=psycopg2.extras.RealDictCursor)
        except Exception as err:
            print(f"Error connecting to PostgreSQL: {err}")
            return None

    def init_db():
        """Create table if it doesn't exist (runs once on startup)."""
        conn = get_db_connection()
        if not conn:
            return
        cur = conn.cursor()
        cur.execute("""
            CREATE TABLE IF NOT EXISTS station_timestamps (
                id         SERIAL PRIMARY KEY,
                station_id VARCHAR(255) NOT NULL,
                entry_time TIMESTAMP   NOT NULL
            );
        """)
        conn.commit()
        cur.close()
        conn.close()
        print("PostgreSQL: station_timestamps table ready.")

    DB_BACKEND = 'postgres'

else:
    # ── MySQL (local dev) ────────────────────────────────────────────────────
    import mysql.connector

    DB_CONFIG = {
        'host':     os.environ.get('DB_HOST',     'localhost'),
        'user':     os.environ.get('DB_USER',     'root'),
        'password': os.environ.get('DB_PASSWORD', 'Gourd@13'),
        'database': os.environ.get('DB_NAME',     'chargeflow'),
        'port':     int(os.environ.get('DB_PORT', 3306)),
    }

    def get_db_connection():
        try:
            return mysql.connector.connect(**DB_CONFIG)
        except mysql.connector.Error as err:
            print(f"Error connecting to MySQL: {err}")
            return None

    def init_db():
        pass  # Table already exists locally

    DB_BACKEND = 'mysql'

# ── Flask app ─────────────────────────────────────────────────────────────────
app = Flask(__name__)
CORS(app)

# Initialise DB table on startup (needed for fresh Render PostgreSQL)
init_db()

# ── Helper: run a query and return rows as list-of-dicts ─────────────────────
def db_fetchall(conn, query, params=()):
    cur = conn.cursor()
    cur.execute(query, params)
    rows = cur.fetchall()
    cur.close()
    if DB_BACKEND == 'postgres':
        return [dict(r) for r in rows]
    else:
        # mysql-connector with dictionary=True cursor already returns dicts,
        # but get_db_connection doesn't set that — recreate with dict cursor
        return rows

def db_fetchone(conn, query, params=()):
    cur = conn.cursor()
    cur.execute(query, params)
    row = cur.fetchone()
    cur.close()
    if DB_BACKEND == 'postgres':
        return dict(row) if row else None
    return row


# ── Route: register timestamp ─────────────────────────────────────────────────
@app.route('/register_timestamp', methods=['POST'])
def register_timestamp():
    try:
        data = request.get_json()
        station_id = data.get('station_id')
        timestamp_str = data.get('timestamp')

        if not station_id or not timestamp_str:
            return jsonify({"error": "Missing station_id or timestamp"}), 400

        if timestamp_str.endswith('Z'):
            timestamp_str = timestamp_str.replace('Z', '+00:00')
        dt = datetime.fromisoformat(timestamp_str)
        if dt.tzinfo is not None:
            dt = dt.astimezone()
        mysql_datetime = dt.strftime('%Y-%m-%d %H:%M:%S')

        conn = get_db_connection()
        if not conn:
            return jsonify({"error": "Database connection failed"}), 500

        cur = conn.cursor()
        cur.execute(
            "INSERT INTO station_timestamps (station_id, entry_time) VALUES (%s, %s)",
            (str(station_id), mysql_datetime)
        )
        conn.commit()
        cur.close()
        conn.close()

        return jsonify({"success": True, "message": "Timestamp registered successfully"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ── Route: clear timestamps for a station ────────────────────────────────────
@app.route('/clear_timestamps', methods=['DELETE'])
def clear_timestamps():
    try:
        station_id = request.args.get('station_id')
        if not station_id:
            return jsonify({"error": "Missing station_id"}), 400

        conn = get_db_connection()
        if not conn:
            return jsonify({"error": "Database connection failed"}), 500

        cur = conn.cursor()
        cur.execute("DELETE FROM station_timestamps WHERE station_id = %s", (str(station_id),))
        deleted = cur.rowcount
        conn.commit()
        cur.close()
        conn.close()

        return jsonify({"success": True, "deleted": deleted, "message": f"Cleared {deleted} entries for station {station_id}"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


MIN_DATA_POINTS = 5


# ── Route: peak hours for one station ────────────────────────────────────────
@app.route('/peak_hours', methods=['GET'])
def peak_hours():
    try:
        station_id = request.args.get('station_id')
        if not station_id:
            return jsonify({"error": "Missing station_id"}), 400

        conn = get_db_connection()
        if not conn:
            return jsonify({"error": "Database connection failed"}), 500

        cur = conn.cursor()

        # Total count
        cur.execute("SELECT COUNT(*) as total FROM station_timestamps WHERE station_id = %s", (str(station_id),))
        row = cur.fetchone()
        if DB_BACKEND == 'postgres':
            total_entries = dict(row)['total'] if row else 0
        else:
            total_entries = row[0] if row else 0

        if total_entries < MIN_DATA_POINTS:
            cur.close()
            conn.close()
            return jsonify({
                "peak_hours": [],
                "distribution": {},
                "total_entries": total_entries,
                "min_required": MIN_DATA_POINTS,
                "message": f"Need at least {MIN_DATA_POINTS} entries. Currently have {total_entries}."
            })

        # Hourly distribution
        if DB_BACKEND == 'postgres':
            hour_fn = "EXTRACT(HOUR FROM entry_time)::int"
        else:
            hour_fn = "HOUR(entry_time)"

        cur.execute(f"""
            SELECT {hour_fn} as hour, COUNT(*) as count
            FROM station_timestamps
            WHERE station_id = %s
            GROUP BY hour
            ORDER BY count DESC
        """, (str(station_id),))
        if DB_BACKEND == 'postgres':
            results = [dict(r) for r in cur.fetchall()]
        else:
            results = [{'hour': r[0], 'count': r[1]} for r in cur.fetchall()]
            
        cur.close()
        conn.close()

        if not results:
            return jsonify({"peak_hours": [], "distribution": {}, "total_entries": total_entries, "min_required": MIN_DATA_POINTS})

        max_count = results[0]['count']
        peak_hours_list = [r['hour'] for r in results if r['count'] == max_count]
        distribution = {r['hour']: r['count'] for r in results}

        return jsonify({
            "peak_hours": peak_hours_list,
            "distribution": distribution,
            "total_entries": total_entries,
            "min_required": MIN_DATA_POINTS
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ── Route: all peak hours (bubble overlay) ───────────────────────────────────
@app.route('/all_peak_hours', methods=['GET'])
def all_peak_hours():
    try:
        conn = get_db_connection()
        if not conn:
            return jsonify({"error": "Database connection failed"}), 500

        cur = conn.cursor()

        cur.execute("""
            SELECT station_id, COUNT(*) as total
            FROM station_timestamps
            GROUP BY station_id
        """)
        station_counts = {}
        for r in cur.fetchall():
            rd = dict(r) if DB_BACKEND == 'postgres' else {'station_id': r[0], 'total': r[1]}
            station_counts[rd['station_id']] = rd['total']

        if DB_BACKEND == 'postgres':
            hour_fn = "EXTRACT(HOUR FROM entry_time)::int"
        else:
            hour_fn = "HOUR(entry_time)"

        cur.execute(f"""
            SELECT station_id, {hour_fn} as hour, COUNT(*) as count
            FROM station_timestamps
            GROUP BY station_id, hour
            ORDER BY station_id, count DESC
        """)
        if DB_BACKEND == 'postgres':
            rows = [dict(r) for r in cur.fetchall()]
        else:
            rows = [{'station_id': r[0], 'hour': r[1], 'count': r[2]} for r in cur.fetchall()]
        cur.close()
        conn.close()

        station_data = {}
        for r in rows:
            sid = r['station_id']
            if sid not in station_data:
                station_data[sid] = []
            station_data[sid].append({'hour': r['hour'], 'count': r['count']})

        result = {}
        for sid, entries in station_data.items():
            total = station_counts.get(sid, 0)
            if total < MIN_DATA_POINTS:
                result[sid] = {
                    'peak_hours': [], 'distribution': {},
                    'total_entries': total, 'min_required': MIN_DATA_POINTS,
                    'message': f'Need at least {MIN_DATA_POINTS} entries. Currently have {total}.'
                }
            else:
                max_count = entries[0]['count']
                peak_list = [e['hour'] for e in entries if e['count'] == max_count]
                dist = {e['hour']: e['count'] for e in entries}
                result[sid] = {
                    'peak_hours': peak_list, 'distribution': dist,
                    'total_entries': total, 'min_required': MIN_DATA_POINTS
                }

        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ── Route: restaurant recommendations ────────────────────────────────────────
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
    app.run(host='0.0.0.0', port=5000, debug=True)
