from flask import Flask, request, jsonify
from flask_cors import CORS
from inference import get_recommendations

app = Flask(__name__)
CORS(app) # Enable CORS for frontend

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
