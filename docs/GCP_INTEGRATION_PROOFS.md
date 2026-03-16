# Google Cloud Backend Integration Evidence

> [!IMPORTANT]  
> This document provides technical proof of Google Cloud Platform (GCP) integration for project verification.

## 🚀 1. Live Deployment Metadata (Behind the Scenes)
The following metadata is retrieved directly from the live Google Cloud project environment using the `gcloud` SDK.

**Service Status**:
```yaml
Service: nutribuddy-app
Region: asia-south1 (Mumbai)
URL: https://nutribuddy-app-wjfpnzjwba-el.a.run.app
Latest Revision: nutribuddy-app-00003-fiv
Status: Ready (Up and running)
Service Account: project-c5d04450-508c-41e4-a42@developer.gserviceaccount.com
```

**Recent Deployment Logs (Success)**:
```text
OK Building and deploying new service... Done.
OK Validating configuration...
OK Uploading sources...
OK Building Container...
OK Creating Revision...
OK Routing traffic...
OK Setting IAM Policy...
```
This document serves as technical proof that the NutriBuddy application is built on a "GCP-native" architecture, utilizing Google's enterprise-grade cloud services for compute, storage, and AI.

## 🟢 1. Compute: Google Cloud Run (Serverless)
The application is deployed on **Google Cloud Run** in the `asia-south1` region.
- **Proof**: The live URL uses the `.a.run.app` domain: `https://nutribuddy-app-wjfpnzjwba-el.a.run.app`.
- **Logic**: We use a containerized approach (`Dockerfile`) that Cloud Run orchestrates, providing automatic scaling and built-in WebSocket support.

## 🟢 2. AI & Machine Learning: Vertex AI (Gemini)
The core "brain" of the agent is powered by **Google Gemini**.
- **Proof (Code)**: In `main.py`, we initialize the Google GenAI client:
  ```python
  from google import genai
  client = genai.Client(vertexai=True, project=PROJECT_ID, location="us-central1")
  ```
- **Live Interaction**: The real-time voice proxy connects to `wss://us-central1-aiplatform.googleapis.com` via our unified backend.

## 🟢 3. Database: Google Cloud Firestore
We use **Firestore** for both user profile management and high-speed vector searches.
- **Proof (Code)**: In `main.py`, we import and use the Firestore SDK:
  ```python
  from google.cloud import firestore
  from google.cloud.firestore_v1.vector import Vector
  ```
- **Vector Search**: NutriBuddy implements semantic retrieval (RAG) using Firestore's native vector indexing:
  ```python
  vector_query = collection.find_nearest(
      vector_field="embedding",
      query_vector=Vector(query_embedding),
      distance_measure=DistanceMeasure.COSINE
  )
  ```

## 🟢 4. Object Storage: Google Cloud Storage (GCS)
Patient records (PDFs) and conversation summaries are stored in GCS buckets.
- **Proof (Code)**:
  ```python
  from google.cloud import storage
  storage_client = storage.Client(project=project_id)
  bucket = storage_client.bucket(bucket_name)
  ```

## 🟢 5. Security & Identity: GCP IAM & OIDC
The service uses Google's Service Accounts and OpenID Connect (OIDC) for secure communication between the Main App and the Embedding Worker.
- **Proof**: We fetch OIDC tokens using `google.auth`:
  ```python
  import google.auth.transport.requests
  from google.oauth2 import id_token
  token = id_token.fetch_id_token(auth_req, audience)
  ```

## 📂 Configuration Proof (Environment Variables)
The deployment is managed via GCP Environment variables:
- `FIREBASE_PROJECT_ID`: Verified GCP Project ID.
- `EMBEDDING_SERVICE_URL`: Cross-service Cloud Run endpoint.

---
**Technical Verification**: All backend services are orchestrated through the Google Cloud SDK (`gcloud`) and logs are managed via **Google Cloud Logging**.
