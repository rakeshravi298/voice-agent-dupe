import os
import json
import asyncio
from typing import List
from google.cloud import storage, firestore
from google.cloud.firestore_v1.vector import Vector
from google import genai
from google.genai import types
import PyPDF2
import io
import re
import functions_framework

def get_client():
    project_id = os.getenv("GOOGLE_CLOUD_PROJECT") or os.getenv("FIREBASE_PROJECT_ID")
    return genai.Client(vertexai=True, project=project_id, location="asia-south1")

def split_into_sentences(text: str) -> List[str]:
    # Basic sentence splitter
    sentences = re.split(r'(?<=[.!?])\s+', text)
    return [s.strip() for s in sentences if s.strip()]

def chunk_sentences(sentences: List[str], chunk_size: int = 5) -> List[str]:
    """Simple chunking: group N sentences together."""
    chunks = []
    for i in range(0, len(sentences), chunk_size):
        group = sentences[i : i + chunk_size]
        chunk = " ".join(group)
        if chunk.strip():
            chunks.append(chunk)
    return chunks

@functions_framework.http
def embed_pdf(request):
    """HTTP Cloud Function to process PDF and store embeddings."""
    if request.method == 'OPTIONS':
        # Handles CORS preflight
        headers = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Max-Age': '3600'
        }
        return ('', 204, headers)

    # Set CORS headers for the main request
    headers = {'Access-Control-Allow-Origin': '*'}

    request_json = request.get_json(silent=True)
    if not request_json:
        return ({"error": "Invalid JSON"}, 400, headers)

    bucket_name = request_json.get('bucket')
    file_path = request_json.get('path')
    user_email = request_json.get('userEmail')

    if not all([bucket_name, file_path, user_email]):
        return ({"error": "Missing parameters"}, 400, headers)

    # Run the async main logic
    try:
        results = asyncio.run(process_pdf_async(bucket_name, file_path, user_email))
        return (results, 200, headers)
    except Exception as e:
        print(f"❌ Error: {e}")
        return ({"error": str(e)}, 500, headers)

async def process_pdf_async(bucket_name, file_path, user_email):
    # 1. Download PDF
    storage_client = storage.Client()
    bucket = storage_client.bucket(bucket_name)
    blob = bucket.blob(file_path)
    content = blob.download_as_bytes()

    # 2. Extract Text
    pdf_reader = PyPDF2.PdfReader(io.BytesIO(content))
    full_text = ""
    for page in pdf_reader.pages:
        text = page.extract_text()
        if text:
            full_text += text + "\n"

    if not full_text.strip():
        return {"status": "error", "message": "No text found in PDF"}

    # 3. Simple Sentence Chunking
    sentences = split_into_sentences(full_text)
    chunks = chunk_sentences(sentences, chunk_size=5)

    # 4. Embed Chunks & Store
    project_id = os.getenv("GOOGLE_CLOUD_PROJECT") or os.getenv("FIREBASE_PROJECT_ID")
    db = firestore.AsyncClient(project=project_id)
    sanitized_email = user_email.replace("@", "_at_").replace(".", "_")
    records_coll = db.collection("users").document(sanitized_email).collection("records")

    client = get_client()

    for i, chunk_text in enumerate(chunks):
        if not chunk_text.strip(): continue
        
        # Embed the chunk
        chunk_embed_resp = client.models.embed_content(
            model='text-embedding-004',
            contents=chunk_text,
            config=types.EmbedContentConfig(task_type="RETRIEVAL_DOCUMENT")
        )
        embedding = chunk_embed_resp.embeddings[0].values

        # Store in Firestore
        await records_coll.document().set({
            "title": f"{os.path.basename(file_path)} - Part {i+1}",
            "content": chunk_text,
            "embedding": Vector(embedding),
            "timestamp": firestore.SERVER_TIMESTAMP,
            "source": "pdf_upload",
            "file_path": file_path
        })

    return {"status": "success", "chunks_processed": len(chunks)}
