import pandas as pd
from sklearn.neighbors import NearestNeighbors as KNN
import numpy as np
df=pd.read_csv("C:/Users/sfarh/OneDrive/Desktop/EL SEM 2/backend-ml/data/Bengaluru_Restaurants.csv")
df.dropna(subset=['latitude','longitude'],inplace=True)
df['rating']=df['rating'].fillna(3.0)
df['phone']=df['phone'].fillna("N/A")
X=df[['latitude','longitude']]
model_knn=KNN(n_neighbors=10,algorithm='ball_tree')
model_knn.fit(X)


test_lat=12.9235
test_lon=77.4987
test_point = pd.DataFrame([[test_lat, test_lon]], columns=['latitude', 'longitude'])
distance,indices=model_knn.kneighbors(test_point,n_neighbors=5)
print("\n--- Top 5 Recommendations near RVCE ---")
for i in range(len(indices[0])):
    row_idx = indices[0][i]
    name = df.iloc[row_idx]['name']
    rating = df.iloc[row_idx]['rating']
    dist = distance[0][i] # Optional: see the distance
    print(f"{i+1}. {name} | Rating: {rating}")
