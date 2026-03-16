import os
import asyncio
from dotenv import load_dotenv
from google import genai
from google.genai import types
from google.cloud import firestore
from google.cloud.firestore_v1.vector import Vector
from google.cloud.firestore_v1.base_vector_query import DistanceMeasure

load_dotenv()

# CONFIGURATION
TARGET_USER_EMAIL = "rakeshravi796_at_gmail_com" # Matches your seed data
PROJECT_ID = os.getenv("FIREBASE_PROJECT_ID")

async def test_rag_search(query_text):
    if not PROJECT_ID:
        print("❌ Error: FIREBASE_PROJECT_ID not found in .env")
        return

    print(f"🔍 Testing RAG Search for: '{query_text}'")
    print(f"👤 User: {TARGET_USER_EMAIL}")
    
    # 1. Initialize Clients
    client = genai.Client(vertexai=True, project=PROJECT_ID, location="us-central1")
    db = firestore.AsyncClient(project=PROJECT_ID)
    
    try:
        # 2. Generate Embedding for the query
        print("🪄 Generating query embedding...")
        embed_resp = client.models.embed_content(
            model='text-embedding-004',
            contents=query_text,
            config=types.EmbedContentConfig(task_type="RETRIEVAL_QUERY")
        )
        query_vector = embed_resp.embeddings[0].values

        # 3. Perform Vector Search
        print("📡 Querying Firestore Vector Index...")
        collection_ref = db.collection("users").document(TARGET_USER_EMAIL).collection("records")
        
        # Firestore Vector Search (KNN)
        docs = collection_ref.find_nearest(
            vector_field="embedding",
            query_vector=Vector(query_vector),
            distance_measure=DistanceMeasure.COSINE,
            limit=2
        )
        
        results = []
        async for doc in docs.stream():
            results.append(doc.to_dict())

        # 4. Show Results
        if not results:
            print("\n❌ No results found. (Is the Index still building? Did you run seed_mock_data.py?)")
        else:
            print(f"\n✅ Found {len(results)} relevant documents:\n" + "="*50)
            for idx, res in enumerate(results):
                print(f"Result #{idx+1}: {res.get('title')}")
                print(f"Content: {res.get('content')[:200]}...")
                print("-" * 50)

    except Exception as e:
        print(f"\n💥 SEARCH ERROR: {e}")
        if "requires a vector index" in str(e):
            print("\n💡 TIP: The error above contains a link to create the index. Click it!")

if __name__ == "__main__":
    # Test with a question related to the mock data
    user_query = "What should I have for breakfast?"
    asyncio.run(test_rag_search(user_query))
