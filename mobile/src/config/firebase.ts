import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

export const firebaseConfig = {
  apiKey: 'AIzaSyBKC5qrnJ6HGGOR0F5qf-CbYHcmvvmnqAA',
  authDomain: 'chalkie-app.firebaseapp.com',
  projectId: 'chalkie-app',
  storageBucket: 'chalkie-app.firebasestorage.app',
  messagingSenderId: '947789418402',
  appId: '1:947789418402:web:e3cc81d9fe166cd865ecfb',
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

export const auth = getAuth(app);
export const db = getFirestore(app);
