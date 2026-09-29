/**
 * SATYA News Intelligence — Firebase Authentication & Firestore Service
 * Uses official Firebase Web SDK (v11 modular)
 */
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-app.js";
import { 
    getAuth, 
    GoogleAuthProvider, 
    signInWithPopup, 
    signOut, 
    onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/11.4.0/firebase-auth.js";
import { 
    getFirestore, 
    doc, 
    setDoc, 
    deleteDoc, 
    getDocs, 
    collection, 
    query, 
    orderBy 
} from "https://www.gstatic.com/firebasejs/11.4.0/firebase-firestore.js";

// Safe, production-ready Firebase configuration
export const firebaseConfig = {
    projectId: "gen-lang-client-0251055368",
    appId: "1:54742214433:web:49f156eb4d32be80cf4060",
    apiKey: "AIzaSyB_rPovD2QzxFhgjkdLm7LSHEJSppWLK8I",
    authDomain: "gen-lang-client-0251055368.firebaseapp.com",
    firestoreDatabaseId: "ai-studio-satya-e7242300-0785-426f-8bd6-93bf9f02716c",
    storageBucket: "gen-lang-client-0251055368.firebasestorage.app",
    messagingSenderId: "54742214433"
};

let app = null;
let auth = null;
let db = null;
let isInitialized = false;

try {
    app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
    auth = getAuth(app);
    // Initialize Firestore with the named database provisioned for this applet
    db = firebaseConfig.firestoreDatabaseId && firebaseConfig.firestoreDatabaseId !== "(default)"
        ? getFirestore(app, firebaseConfig.firestoreDatabaseId)
        : getFirestore(app);
    isInitialized = true;
    console.log("[SATYA FIREBASE] Initialized successfully with database:", firebaseConfig.firestoreDatabaseId);
} catch (err) {
    console.warn("[SATYA FIREBASE] Initialization warning:", err.message);
}

const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

/**
 * Sign in using Google OAuth Popup with friendly error handling
 */
export async function signInWithGoogle() {
    if (!auth) {
        throw new Error("Firebase Auth is not initialized. Please verify configuration.");
    }
    try {
        const result = await signInWithPopup(auth, googleProvider);
        const user = result.user;
        if (user && db) {
            // Upsert user profile document
            try {
                const userRef = doc(db, "users", user.uid);
                await setDoc(userRef, {
                    uid: user.uid,
                    displayName: user.displayName || "SATYA Reader",
                    email: user.email || "",
                    photoURL: user.photoURL || "",
                    lastLoginAt: new Date().toISOString()
                }, { merge: true });
            } catch (profileErr) {
                console.warn("[SATYA FIREBASE] Profile doc sync warning:", profileErr.message);
            }
        }
        return user;
    } catch (error) {
        if (error.code === 'auth/popup-closed-by-user' || error.code === 'auth/cancelled-popup-request') {
            const cancelErr = new Error("Sign-in popup was closed.");
            cancelErr.isCancelled = true;
            throw cancelErr;
        }
        if (error.code === 'auth/popup-blocked') {
            throw new Error("Sign-in popup was blocked by your browser. Please allow popups for this site.");
        }
        if (error.code === 'auth/unauthorized-domain') {
            throw new Error("This domain is not yet authorized in Firebase Console -> Authentication -> Settings -> Authorized domains.");
        }
        if (error.code === 'auth/network-request-failed') {
            throw new Error("Network connection failed. Please check your internet connection.");
        }
        console.error("[SATYA FIREBASE] Sign-in error:", error);
        throw error;
    }
}

/**
 * Sign out current user
 */
export async function signOutUser() {
    if (!auth) return;
    try {
        await signOut(auth);
    } catch (err) {
        console.error("[SATYA FIREBASE] Sign-out error:", err);
        throw err;
    }
}

/**
 * Listen to Auth State Changes
 */
export function onAuthChange(callback) {
    if (!auth) {
        callback(null);
        return () => {};
    }
    return onAuthStateChanged(auth, (user) => {
        callback(user);
    });
}

/**
 * Save an article for the authenticated user in Firestore
 */
export async function saveArticle(userId, article) {
    if (!db || !userId) {
        throw new Error("Authentication required to save articles.");
    }
    if (!article || !article.id) {
        throw new Error("Invalid article data for saving.");
    }

    const articleRef = doc(db, "users", userId, "savedArticles", String(article.id));
    const payload = {
        articleId: String(article.id),
        title: article.title || "Untitled Story",
        description: article.description || article.content || "",
        image: article.image || "",
        source: article.source || "SATYA Feed",
        sourceUrl: article.sourceUrl || "",
        category: article.category || "GENERAL",
        publishedAt: article.publishedAt || new Date().toISOString(),
        savedAt: new Date().toISOString(),
        verifiedStatus: article.verifiedStatus || "SUPPORTED"
    };

    await setDoc(articleRef, payload);
    return payload;
}

/**
 * Remove a saved article for the authenticated user from Firestore
 */
export async function removeArticle(userId, articleId) {
    if (!db || !userId) {
        throw new Error("Authentication required to remove saved articles.");
    }
    if (!articleId) return;

    const articleRef = doc(db, "users", userId, "savedArticles", String(articleId));
    await deleteDoc(articleRef);
}

/**
 * Fetch all saved articles for a given user from Firestore
 */
export async function getUserSavedArticles(userId) {
    if (!db || !userId) return [];
    try {
        const colRef = collection(db, "users", userId, "savedArticles");
        const q = query(colRef);
        const snapshot = await getDocs(q);
        const articles = [];
        snapshot.forEach(docSnap => {
            articles.push(docSnap.data());
        });
        return articles.sort((a, b) => new Date(b.savedAt || 0) - new Date(a.savedAt || 0));
    } catch (err) {
        console.warn("[SATYA FIREBASE] Fetch saved articles warning:", err.message);
        return [];
    }
}

export function isFirebaseReady() {
    return isInitialized;
}
