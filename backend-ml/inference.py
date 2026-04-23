import pandas as pd
from sklearn.neighbors import NearestNeighbors as KNN
import numpy as np
import os

# Get absolute path relative to this script
base_dir = os.path.dirname(os.path.abspath(__file__))
csv_path = os.path.join(base_dir, "data", "Bengaluru_Restaurants.csv")

# Load and prepare data globally so it's only done once on server start
try:
    df = pd.read_csv(csv_path)
    df.dropna(subset=['latitude', 'longitude'], inplace=True)
    df['rating'] = df['rating'].fillna(3.0)
    df['phone'] = df['phone'].fillna("N/A")
    X = df[['latitude', 'longitude']]
    
    # Train the model
    model_knn = KNN(n_neighbors=10, algorithm='ball_tree')
    model_knn.fit(X)
    print("KNN Model successfully loaded and trained.")
except Exception as e:
    print(f"Error loading model data: {e}")
    df = None
    model_knn = None

def get_recommendations(lat, lon, top_n=5):
    if df is None or model_knn is None:
        return []
        
    test_point = pd.DataFrame([[lat, lon]], columns=['latitude', 'longitude'])
    distance, indices = model_knn.kneighbors(test_point, n_neighbors=top_n)
    
    recommendations = []
    for i in range(len(indices[0])):
        row_idx = indices[0][i]
        name = df.iloc[row_idx]['name']
        rating = df.iloc[row_idx]['rating']
        dist = distance[0][i]
        
        recommendations.append({
            "name": str(name),
            "rating": float(rating),
            "distance": float(dist)
        })
        
    return recommendations

if __name__ == "__main__":
    # Test execution
    print("\n--- Top 5 Recommendations near RVCE ---")
    recs = get_recommendations(12.9235, 77.4987)
    for i, r in enumerate(recs):
        print(f"{i+1}. {r['name']} | Rating: {r['rating']}")
