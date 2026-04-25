// ========= FIREBASE CONFIG =========
const FIREBASE_CONFIG = {
    apiKey: 'AIzaSyDAF5cDSgVwUog6mHYSSUCPywS4DF9FkoU',
    authDomain: 'el-project-e45df.firebaseapp.com',
    databaseURL: 'https://el-project-e45df-default-rtdb.asia-southeast1.firebasedatabase.app/',
    projectId: 'el-project-e45df',
    storageBucket: 'el-project-e45df.firebasestorage.app',
    messagingSenderId: '633518271724',
    appId: '1:633518271724:web:5267bdecf1756cd7ce89c9'
};

let firebaseApp = null;
let firebaseDatabase = null;

function initializeFirebase(onReady) {
    // Already fully initialized — call onReady immediately
    if (firebaseApp && firebaseDatabase) {
        if (onReady) onReady(firebaseDatabase);
        return true;
    }

    if (typeof firebase === 'undefined') {
        console.warn('Firebase SDK not loaded yet. Retrying in 500ms...');
        setTimeout(() => initializeFirebase(onReady), 500);
        return false;
    }

    try {
        // Initialize app only once
        if (!firebaseApp) {
            firebaseApp = firebase.initializeApp(FIREBASE_CONFIG);
        }

        // firebase.database(app) — compat SDK does NOT accept a URL as 2nd arg.
        // The databaseURL is already read from FIREBASE_CONFIG automatically.
        firebaseDatabase = firebase.database(firebaseApp);

        console.log('✅ Firebase Realtime Database connected:', FIREBASE_CONFIG.databaseURL);
        if (onReady) onReady(firebaseDatabase);
        return true;

    } catch (error) {
        console.error('❌ Firebase initialization error:', error);
        // Reset so a retry can re-attempt the database() call
        firebaseDatabase = null;
        setTimeout(() => initializeFirebase(onReady), 1000);
        return false;
    }
}

function getDatabase() {
    return firebaseDatabase;
}

export { FIREBASE_CONFIG, initializeFirebase, getDatabase };
