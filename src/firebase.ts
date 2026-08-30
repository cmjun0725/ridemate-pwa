import { initializeApp, type FirebaseOptions } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
import { getFunctions } from 'firebase/functions'

const config: FirebaseOptions = { apiKey: import.meta.env.VITE_FIREBASE_API_KEY, authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN, projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID, storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET, messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID, appId: import.meta.env.VITE_FIREBASE_APP_ID, measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID }
export const isFirebaseConfigured = Boolean(config.apiKey && config.projectId)
export const app = isFirebaseConfigured ? initializeApp(config) : undefined
export const auth = app ? getAuth(app) : undefined
export const db = app ? getFirestore(app) : undefined
export const functions = app ? getFunctions(app, 'asia-northeast3') : undefined
