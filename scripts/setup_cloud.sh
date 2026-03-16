#!/bin/bash
# NutriBuddy Cloud Deployment Script (Bash)
# This script automates the deployment of both the Embedding Service and the Website Service.

REGION="asia-south1"

# 1. Load environment variables from .env if it exists
if [ -f .env ]; then
    export $(grep -v '^#' .env | xargs)
fi

PROJECT_ID=$FIREBASE_PROJECT_ID

if [ -z "$PROJECT_ID" ]; then
    echo "Error: FIREBASE_PROJECT_ID not found in .env or environment. Please configure it first."
    exit 1
fi

echo -e "\n\033[0;33m🛠️ Enabling Required APIs...\033[0m"
gcloud services enable \
    run.googleapis.com \
    cloudbuild.googleapis.com \
    aiplatform.googleapis.com \
    firestore.googleapis.com \
    storage.googleapis.com \
    artifactregistry.googleapis.com

# --- STEP 1: Create Storage Bucket ---
echo -e "\n\033[0;33m🪣 Checking/Creating Storage Bucket...\033[0m"
BUCKET_NAME=$FIREBASE_STORAGE_BUCKET
if [ -z "$BUCKET_NAME" ]; then BUCKET_NAME="$PROJECT_ID-media"; fi

# Check if bucket exists, create if not
if gsutil ls -b "gs://$BUCKET_NAME" > /dev/null 2>&1; then
    echo "✅ Bucket gs://$BUCKET_NAME already exists."
else
    echo "Creating bucket gs://$BUCKET_NAME..."
    gcloud storage buckets create "gs://$BUCKET_NAME" --location=$REGION
fi

# --- STEP 2: Deploy Embedding Service ---
echo -e "\n\033[0;33m📦 Deploying Embedding Service...\033[0m"
EMBED_SERVICE_URL=$(gcloud run deploy nutribuddy-worker \
    --source services/embedding_service \
    --region $REGION \
    --platform managed \
    --allow-unauthenticated \
    --set-env-vars="FIREBASE_PROJECT_ID=$PROJECT_ID,FIREBASE_STORAGE_BUCKET=$BUCKET_NAME" \
    --format="value(status.url)")

if [ -z "$EMBED_SERVICE_URL" ]; then
    echo "Error: Failed to deploy Embedding Service."
    exit 1
fi

echo -e "\033[0;32m✅ Embedding Service Live: $EMBED_SERVICE_URL\033[0m"

# --- STEP 3: Deploy Website Service ---
echo -e "\n\033[0;33m🌐 Deploying Website Service...\033[0m"

# Prepare environment variables for the main app
ENV_VARS="FIREBASE_PROJECT_ID=$PROJECT_ID,FIREBASE_API_KEY=$FIREBASE_API_KEY,FIREBASE_AUTH_DOMAIN=$FIREBASE_AUTH_DOMAIN,FIREBASE_STORAGE_BUCKET=$BUCKET_NAME,EMBEDDING_SERVICE_URL=$EMBED_SERVICE_URL"

gcloud run deploy nutribuddy-app \
    --source services/website_service \
    --region $REGION \
    --platform managed \
    --allow-unauthenticated \
    --set-env-vars="$ENV_VARS"

# --- STEP 4: Create Firestore Vector Index ---
echo -e "\n\033[0;33m🔍 Creating Firestore Vector Index...\033[0m"
gcloud firestore indexes composite create --project=$PROJECT_ID --config=scripts/firestore_indexes.json

echo -e "\n\033[0;32m🎉 Infrastructure created successfully!\033[0m"
echo "Note: Firestore indexing may take a few minutes to complete."
