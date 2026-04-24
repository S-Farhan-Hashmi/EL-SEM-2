import mysql.connector

# Update these credentials as needed!
DB_HOST = "localhost"
DB_USER = "root"
DB_PASSWORD = "Gourd@13" # Change this if your root user has a different password
DB_NAME = "chargeflow"

def setup():
    try:
        # Connect to MySQL server (without specifying DB first to create it if missing)
        print("Connecting to MySQL...")
        conn = mysql.connector.connect(
            host=DB_HOST,
            user=DB_USER,
            password=DB_PASSWORD
        )
        cursor = conn.cursor()

        print(f"Creating database '{DB_NAME}' if it doesn't exist...")
        cursor.execute(f"CREATE DATABASE IF NOT EXISTS {DB_NAME}")
        
        # Connect to the specific database
        conn.database = DB_NAME
        
        print("Creating 'station_timestamps' table...")
        # Create the table
        create_table_query = """
        CREATE TABLE IF NOT EXISTS station_timestamps (
            id INT AUTO_INCREMENT PRIMARY KEY,
            station_id VARCHAR(255) NOT NULL,
            entry_time DATETIME NOT NULL
        )
        """
        cursor.execute(create_table_query)
        
        conn.commit()
        print("Database setup complete!")

    except mysql.connector.Error as err:
        print(f"Error: {err}")
    finally:
        if 'conn' in locals() and conn.is_connected():
            cursor.close()
            conn.close()

if __name__ == "__main__":
    setup()
