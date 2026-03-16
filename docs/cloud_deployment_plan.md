# NutriBuddy Deployment Plan (Cloud Run)

This document outlines the strategy and steps to deploy the NutriBuddy application to Google Cloud Run.

## 🏗️ Architecture Overview

The system is now split into two main services:

1.  **Main Application (`main.py`)**: Handles the UI, Authentication (Firebase), API endpoints, and real-time Voice Proxying (WebSockets).
2.  **Embedding Service (`services/embedding_service/main.py`)**: A worker service that processes uploaded PDFs, extracts text, and generates vector embeddings to Firestore for RAG.

Both services will run on **Cloud Run** because of its simplicity, scalability, and built-in support for WebSockets (needed for the voice agent).

---

## 📋 Prerequisites

1.  **GCP Project**: A Google Cloud Project with Billing enabled.
2.  **APIs Enabled**:
    *   Cloud Run API
    *   Cloud Build API
    *   Artifact Registry API
    *   Vertex AI API
    *   Cloud Storage API
    *   Cloud Firestore API
3.  **Firebase**: Project initialized with Auth, Firestore, and Storage.

---

## 🚀 Step 1: Deploy the Embedding Service

This service acts as the background worker.

### Build and Push Image
```bash
gcloud builds submit --tag gcr.io/[PROJECT_ID]/nutribuddy-worker ./services/embedding_service
```

### Deploy to Cloud Run
```bash
gcloud run deploy nutribuddy-worker \
  --image gcr.io/[PROJECT_ID]/nutribuddy-worker \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars="FIREBASE_PROJECT_ID=[PROJECT_ID]"
```
> [!NOTE]  
> Copy the **Service URL** generated after deployment. You will need it for the Main App.

---

## 🚀 Step 2: Deploy the Main Application

This is your primary web server and proxy.

### Setup Environment Variables
Ensure you have your Firebase config and the Worker URL.

### Build and Push Image
```bash
gcloud builds submit --tag gcr.io/[PROJECT_ID]/nutribuddy-app .
```

### Deploy to Cloud Run
```bash
gcloud run deploy nutribuddy-app \
  --image gcr.io/[PROJECT_ID]/nutribuddy-app \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars="FIREBASE_PROJECT_ID=[PROJECT_ID],FIREBASE_API_KEY=[API_KEY],FIREBASE_AUTH_DOMAIN=[AUTH_DOMAIN],FIREBASE_STORAGE_BUCKET=[BUCKET],EMBEDDING_SERVICE_URL=[WORKER_SERVICE_URL]"
```

---

## 🛠️ Infrastructure Configuration

### 1. Firestore Indexing
Vector search requires an index in Firestore.
- Field: `embedding`
- Type: `Vector`
- Dimension: `768` (for `text-embedding-004`)
- Distance Measure: `COSINE`

### 2. Cloud Storage CORS
To allow the browser to talk to Storage (if needed), configure CORS:
```json
[
  {
    "origin": ["*"],
    "method": ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    "responseHeader": ["Content-Type", "Authorization"],
    "maxAgeSeconds": 3600
  }
]
```

---

## 🔌 Unified Port & WebSockets
I have refactored `main.py` to use a **single port** (defined by `$PORT`) for both HTTP and WebSockets.
- The web app serves on `/`
- The voice proxy connects on `/ws`
- Cloud Run handles this automatically.

## 📂 File Organization
- `templates/`: Contains all `.html` files (Home, Login, Dietician Dashboard).
- `static/`: Contains all `.js`, `.css`, and image assets.
- `main.py`: The entry point for the unified server.
- `services/embedding_service/`: The standalone worker for RAG ingestion.
- `archive/`: Old reference files.
- `scripts/`: Dev and setup utilities.
- `docs/`: Deployment guides and documentation.
