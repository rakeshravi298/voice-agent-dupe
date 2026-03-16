# NutriBuddy Cloud Deployment Script (PowerShell)
# This script automates the deployment of both the Embedding Service and the Website Service.

$REGION = "asia-south1"

# 1. Load environment variables from .env if it exists
if (Test-Path ".env") {
    Get-Content .env | ForEach-Object {
        $name, $value = $_.split('=', 2)
        if ($name -and $value) {
            Set-Item -Path "Env:$name" -Value $value
        }
    }
}

$PROJECT_ID = $env:FIREBASE_PROJECT_ID

if (-not $PROJECT_ID) {
    Write-Error "FIREBASE_PROJECT_ID not found in .env or environment. Please configure it first."
    exit
}

Write-Host "`n🛠️ Enabling Required APIs..." -ForegroundColor Yellow
gcloud services enable `
    run.googleapis.com `
    cloudbuild.googleapis.com `
    aiplatform.googleapis.com `
    firestore.googleapis.com `
    storage.googleapis.com `
    artifactregistry.googleapis.com

# --- STEP 1: Create Storage Bucket ---
Write-Host "`n🪣 Checking/Creating Storage Bucket..." -ForegroundColor Yellow
$BUCKET_NAME = $env:FIREBASE_STORAGE_BUCKET
if (-not $BUCKET_NAME) { $BUCKET_NAME = "$PROJECT_ID-media" }

# Check if bucket exists
$bucketCheck = gsutil ls -b "gs://$BUCKET_NAME" 2>&1
if ($bucketCheck -match "gs://") {
    Write-Host "✅ Bucket gs://$BUCKET_NAME already exists."
} else {
    Write-Host "Creating bucket gs://$BUCKET_NAME..."
    gcloud storage buckets create "gs://$BUCKET_NAME" --location=$REGION
}

# --- STEP 2: Deploy Embedding Service ---
Write-Host "`n📦 Deploying Embedding Service..." -ForegroundColor Yellow
$EMBED_SERVICE_URL = gcloud run deploy nutribuddy-worker `
    --source services/embedding_service `
    --region $REGION `
    --platform managed `
    --allow-unauthenticated `
    --set-env-vars="FIREBASE_PROJECT_ID=$PROJECT_ID,FIREBASE_STORAGE_BUCKET=$BUCKET_NAME" `
    --format="value(status.url)"

if (-not $EMBED_SERVICE_URL) {
    Write-Error "Failed to deploy Embedding Service."
    exit
}

Write-Host "✅ Embedding Service Live: $EMBED_SERVICE_URL" -ForegroundColor Green

# --- STEP 3: Deploy Website Service ---
Write-Host "`n🌐 Deploying Website Service..." -ForegroundColor Yellow

# Prepare environment variables for the main app
$ENV_VARS = @(
    "FIREBASE_PROJECT_ID=$PROJECT_ID",
    "FIREBASE_API_KEY=$($env:FIREBASE_API_KEY)",
    "FIREBASE_AUTH_DOMAIN=$($env:FIREBASE_AUTH_DOMAIN)",
    "FIREBASE_STORAGE_BUCKET=$BUCKET_NAME",
    "EMBEDDING_SERVICE_URL=$EMBED_SERVICE_URL"
) -join ","

gcloud run deploy nutribuddy-app `
    --source services/website_service `
    --region $REGION `
    --platform managed `
    --allow-unauthenticated `
    --set-env-vars="$ENV_VARS"

# --- STEP 4: Create Firestore Vector Index ---
Write-Host "`n🔍 Creating Firestore Vector Index..." -ForegroundColor Yellow
gcloud firestore indexes composite create --project=$PROJECT_ID --config=scripts/firestore_indexes.json

Write-Host "`n🎉 Infrastructure created successfully!" -ForegroundColor Green
Write-Host "Note: Firestore indexing may take a few minutes to complete."
