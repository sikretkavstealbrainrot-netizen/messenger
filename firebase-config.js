import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, sendEmailVerification, createUserWithEmailAndPassword, signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getDatabase, ref, set, get, push, onValue, update } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyA9em9ZlLjols-7dH4v7ySmlxhOI5TPAX4",
  authDomain: "mymessenger-ea808.firebaseapp.com",
  databaseURL: "https://mymessenger-ea808-default-rtdb.firebaseio.com",
  projectId: "mymessenger-ea808",
  storageBucket: "mymessenger-ea808.firebasestorage.app",
  messagingSenderId: "586055304904",
  appId: "1:586055304904:web:97f8721c26a029bae147fd",
  measurementId: "G-76F47FJQ41"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getDatabase(app);
export { sendEmailVerification, createUserWithEmailAndPassword, signInWithEmailAndPassword, ref, set, get, push, onValue, update };
