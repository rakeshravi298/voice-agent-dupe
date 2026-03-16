import os
import json
import asyncio
from dotenv import load_dotenv
from google import genai
from google.genai import types
from google.cloud import firestore
from google.cloud.firestore_v1.vector import Vector

load_dotenv()

# CONFIGURATION
TARGET_USER_EMAIL = "rakeshravi796_at_gmail_com" # Matches your sanitized format
PROJECT_ID = os.getenv("FIREBASE_PROJECT_ID")

# MOCK DATA: These are documents a Dietitian would have uploaded for this user
MOCK_RECORDS = [
    {
        "title": "Official Diet Plan - March 2026",
        "content": """
        Daily Goals: 1800 Calories.
        Macros: 40% Protein, 30% Carbs, 30% Fats.
        Strict Instructions: 
        1. Start day with 500ml warm water and lemon.
        2. Breakfast: 3 egg whites, 1 whole egg, and half avocado. 
        3. Lunch: 150g grilled chicken/fish with sautéed broccoli and spinach.
        4. Dinner: Quinoa salad with chickpeas and Mediterranean dressing.
        Avoid: Processed sugars, soda, and white bread.
        """
    },
    {
        "title": "Medical Profile & Allergies",
        "content": """
        Known Allergies: Peanut, Shellfish.
        Health Conditions: Mild Vitamin D deficiency.
        Recent Blood Report Highlights (Feb 2026): 
        - HbA1c: 5.4 (Normal)
        - Cholesterol: 180 (Good)
        - Vitamin D: 22 ng/mL (Low, supplementation required).
        Note: Focus on calcium-rich foods like yogurt and kale.
        """
    },
    {
        "title": "Emergency Substitutes",
        "content": """
        If Grilled Chicken is unavailable: Replace with 150g Paneer (low fat) or 1 cup Tofu.
        If Broccoli is unavailable: Use Asparagus or Brussels sprouts.
        If feeling low energy: Add 10-12 soaked almonds to breakfast.
        """
    }
]

async def seed_data():
    if not PROJECT_ID:
        print("❌ Error: FIREBASE_PROJECT_ID not found in .env")
        return

    print(f"🚀 Seeding mock dietitian data for: {TARGET_USER_EMAIL}")
    
    # Initialize Clients
    client = genai.Client(vertexai=True, project=PROJECT_ID, location="us-central1")
    db = firestore.AsyncClient(project=PROJECT_ID)
    
    user_ref = db.collection("users").document(TARGET_USER_EMAIL)
    records_coll = user_ref.collection("records")

    for record in MOCK_RECORDS:
        print(f"📝 Processing: {record['title']}...")
        
        # 1. Generate Embedding
        embed_resp = client.models.embed_content(
            model='text-embedding-004',
            contents=record['content'],
            config=types.EmbedContentConfig(task_type="RETRIEVAL_DOCUMENT")
        )
        embedding = embed_resp.embeddings[0].values

        # 2. Store in Firestore
        doc_ref = records_coll.document()
        await doc_ref.set({
            "title": record["title"],
            "content": record["content"],
            "embedding": Vector(embedding),
            "timestamp": firestore.SERVER_TIMESTAMP,
            "source": "dietitian_upload"
        })
        print(f"✅ Indexed: {record['title']} (ID: {doc_ref.id})")

    print("\n✨ Seeding Complete! Vitality AI can now access these dietitian records.")

if __name__ == "__main__":
    asyncio.run(seed_data())
