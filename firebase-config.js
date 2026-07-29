// ============================================================
// Fill this in with YOUR Firebase project config.
// Firebase Console → Project settings → General → Your apps → SDK setup and config
// These values are safe to be public in a client-side app; access is controlled
// by your Firestore security rules (see README.md), not by hiding this file.
// ============================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAWjegirobVR-7bTr1VMP7O3zk_D0WRWGE",
  authDomain: "recipeo-bdf64.firebaseapp.com",
  projectId: "recipeo-bdf64",
  storageBucket: "recipeo-bdf64.firebasestorage.app",
  messagingSenderId: "266605426171",
  appId: "1:266605426171:web:6f673d07b8429d36b1075e"
};

export const firebaseApp = initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp);
export const db = getFirestore(firebaseApp);
