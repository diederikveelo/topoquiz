import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyCPUsU1k2FWvnIgCJAvYjL9e9WTVgTAdnk",
  authDomain: "topoquiz.firebaseapp.com",
  projectId: "topoquiz",
  storageBucket: "topoquiz.firebasestorage.app",
  messagingSenderId: "446815797883",
  appId: "1:446815797883:web:26d1af8a0fa8e9ec79d8de"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);