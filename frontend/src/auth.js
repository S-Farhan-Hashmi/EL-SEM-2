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
    try {
        if (typeof firebase === 'undefined') {
            console.error('Firebase SDK not loaded. Waiting...');
            setTimeout(() => initializeFirebase(onReady), 500);
            return false;
        }

        if (firebaseApp) {
            console.log('Firebase already initialized');
            if (onReady) onReady(firebaseDatabase);
            return true;
        }

        firebaseApp = firebase.initializeApp(FIREBASE_CONFIG);
        firebaseDatabase = firebase.database(firebaseApp, FIREBASE_CONFIG.databaseURL);
        console.log('Firebase Realtime Database initialized successfully');
        console.log('Database URL:', FIREBASE_CONFIG.databaseURL);

        if (onReady) onReady(firebaseDatabase);
        return true;
    } catch (error) {
        console.error('Error initializing Firebase:', error);
        return false;
    }
}

function getDatabase() {
    return firebaseDatabase;
}

export { FIREBASE_CONFIG, initializeFirebase, getDatabase };
