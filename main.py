#!/usr/bin/env python3
import asyncio
import json
import mimetypes
import os
import ssl
import certifi
import google.auth
import websockets
from aiohttp import web
from google.auth.transport.requests import Request
from websockets.exceptions import ConnectionClosed
from dotenv import load_dotenv
from google import genai
from google.genai import types
from google.cloud import firestore
from google.cloud import storage
from google.cloud.firestore_v1.vector import Vector
from google.cloud.firestore_v1.base_vector_query import DistanceMeasure

load_dotenv()

DEBUG = True
HTTP_PORT = int(os.getenv("PORT", 5000))
WS_PORT = 8080

def generate_access_token():
    try:
        creds, _ = google.auth.default()
        if not creds.valid:
            creds.refresh(Request())
        return creds.token
    except Exception as e:
        print(f"Error generating access token: {e}")
        return None

async def proxy_task(source_websocket, destination_websocket, is_server):
    prefix = "SERVER -> CLIENT" if is_server else "CLIENT -> SERVER"
    try:
        async for message in source_websocket:
            try:
                # Force JSON decoding and re-encoding to ensure TEXT frames for browser
                # and to match the 'Successful Implementation' logic exactly.
                data = json.loads(message)
                
                if DEBUG:
                    if "serverContent" in data or "server_content" in data:
                        sc = data.get("serverContent") or data.get("server_content")
                        if "modelTurn" in sc or "model_turn" in sc:
                            print(f"[{prefix}] Model Output (Audio/Text)")
                        elif "turnComplete" in sc or "turn_complete" in sc:
                            print(f"[{prefix}] Turn Complete")
                    elif "setupComplete" in data or "setup_complete" in data:
                        print(f"[{prefix}] Handshake Finalized")
                    elif "error" in data:
                        print(f"[{prefix}] ❌ ERROR: {data['error']}")
                    elif "realtimeInput" not in data and "realtime_input" not in data:
                        # Log other structural messages
                        print(f"[{prefix}] JSON keys: {list(data.keys())}")

                await destination_websocket.send(json.dumps(data))
            except Exception as e:
                # If it's pure binary that can't be JSON, relay it raw (e.g. if API changes)
                try:
                    await destination_websocket.send(message)
                    if DEBUG and is_server:
                        print(f"[{prefix}] Relayed Raw Binary ({len(message)} bytes)")
                except: pass
    except ConnectionClosed: pass
    finally: await destination_websocket.close()

async def create_proxy(client_websocket, bearer_token, service_url):
    headers = {"Authorization": f"Bearer {bearer_token}"}
    ssl_context = ssl.create_default_context(cafile=certifi.where())
    try:
        async with websockets.connect(service_url, additional_headers=headers, ssl=ssl_context) as server_websocket:
            print("🚀 SESSION ESTABLISHED WITH GEMINI")
            await asyncio.gather(
                proxy_task(client_websocket, server_websocket, is_server=False),
                proxy_task(server_websocket, client_websocket, is_server=True)
            )
    except Exception as e:
        print(f"❌ Handshake failed: {e}")
        if not client_websocket.closed: await client_websocket.close()

async def handle_websocket_client(client_websocket):
    print("🔌 Browser connecting...")
    try:
        msg = await asyncio.wait_for(client_websocket.recv(), timeout=10.0)
        setup = json.loads(msg)
        bearer = setup.get("bearer_token") or generate_access_token()
        url = setup.get("service_url")
        if not bearer or not url:
            await client_websocket.close(code=1008); return
        await create_proxy(client_websocket, bearer, url)
    except:
        if not client_websocket.closed: await client_websocket.close()

def get_firebase_config():
    return {
        "apiKey": os.getenv("FIREBASE_API_KEY", ""),
        "authDomain": os.getenv("FIREBASE_AUTH_DOMAIN", ""),
        "projectId": os.getenv("FIREBASE_PROJECT_ID", ""),
        "storageBucket": os.getenv("FIREBASE_STORAGE_BUCKET", ""),
        "messagingSenderId": os.getenv("FIREBASE_MESSAGING_SENDER_ID", ""),
        "appId": os.getenv("FIREBASE_APP_ID", "")
    }

async def handle_http(request):
    path = request.match_info.get("path", "").strip("/")
    if not path or path == "index.html" or path == "gemini-live.html":
        target = "gemini-live.html"
    elif path == "login":
        target = "landing.html"
    else:
        target = path

    # Search in order: root, static/
    search_paths = [os.path.join(os.getcwd(), target), os.path.join(os.getcwd(), "static", target)]
    # Also handle 'static/filename' explicitly if requested
    if target.startswith("static/"):
        search_paths.append(os.path.join(os.getcwd(), target[7:]))

    for fp in search_paths:
        if os.path.exists(fp) and os.path.isfile(fp):
            if target in ["gemini-live.html", "landing.html"]:
                with open(fp, "r", encoding="utf-8") as f: content = f.read()
                config = get_firebase_config()
                content = content.replace('// CONFIG_PLACEHOLDER', f"const firebaseConfig = {json.dumps(config, indent=4)};")
                if target == "gemini-live.html":
                    content = content.replace('id="projectId" value=""', f'id="projectId" value="{config["projectId"]}"')
                    content = content.replace('</html>\n\n\n</html>', '</html>')
                return web.Response(body=content, content_type="text/html")
            
            ctype, _ = mimetypes.guess_type(fp)
            if fp.endswith(".js"): ctype = "application/javascript"
            with open(fp, "rb") as f: return web.Response(body=f.read(), content_type=ctype or "application/octet-stream")

    return web.Response(text=f"Not Found: {target}", status=404)

async def handle_summarize(request):
    try:
        data = await request.json()
        history = data.get("history", [])
        user_email = data.get("userEmail", "anonymous").replace("@", "_at_").replace(".", "_")
        project_id = os.getenv("FIREBASE_PROJECT_ID")
        
        if not history:
            return web.json_response({"summary": "No conversation history found to summarize."})

        # Format history for the prompt
        formatted_history = ""
        for item in history:
            role = "User" if item['role'] == 'user' else "Vitality AI"
            formatted_history += f"{role}: {item['text']}\n"
        
        # Initialize GenAI Client for Vertex AI
        client = genai.Client(vertexai=True, project=project_id, location="us-central1")
        
        prompt = f"""
        SYSTEM ROLE: MULTIMODAL CLINICAL CONVERSATION SUMMARY AGENT

        You are an AI system responsible for generating structured summaries of conversations between a dietician assistant agent and a client.

        The conversation may occur through multiple interaction types:

        * Text chat
        * Voice conversations
        * Video interactions
        * Image uploads
        * Video uploads

        Your task is to review the full conversation transcript and extract all clinically and nutritionally relevant information for the dietician.

        You DO NOT interact with the client.

        You ONLY generate summaries for the dietician to review.

        The goal is to help the dietician quickly understand what happened during the interaction without reading the entire conversation.

        CORE OBJECTIVE

        Analyze the full interaction and summarize key information related to:

        * Meals consumed
        * Meal timing
        * Diet adherence
        * Snacks or off-plan foods
        * Exercise or physical activity
        * Mood, hunger, cravings, or energy levels
        * Client questions
        * Diet change requests
        * Symptoms or concerns
        * New personal or lifestyle information
        * Images or videos shared
        * Observations made during video interactions
        * Educational explanations provided by the assistant
        * Any information requiring dietician attention

        MULTIMODAL DATA SOURCES

        You must extract information from all interaction types:

        TEXT CHAT
        Messages typed by the client or assistant.

        VOICE INTERACTION
        Spoken statements from the client. Treat spoken content exactly the same as text information.

        VIDEO INTERACTION
        If the client appears on video and relevant observations are mentioned in the conversation, record them.

        Examples:

        * Client showing meal on camera
        * Client discussing exercise while on video
        * Body progress discussion

        Only record observations explicitly mentioned in the transcript.

        IMAGE UPLOADS
        If a meal photo, food label, grocery item, or body progress photo was shared, log it.

        INFORMATION EXTRACTION REQUIREMENTS

        Extract the following categories.

        CLIENT INFORMATION

        Client Name:
        Date of Interaction:
        Interaction Types Used: (Chat / Voice / Video / Image Upload / Video Upload)

        Total Messages or Interaction Duration (if available)

        MEAL LOG

        Capture every meal mentioned.

        For each meal record:

        Meal Type: Breakfast / Lunch / Dinner
        Time (if mentioned)
        Food items consumed
        Portions or quantities (if mentioned)
        Whether the meal followed the assigned diet plan (Yes / No / Unknown)

        Format:

        Breakfast
        Time:
        Foods:
        Diet Plan Followed:

        SNACKS OR OFF-PLAN FOODS

        Record snacks separately from main meals.

        Include:

        * Food item
        * Time (if mentioned)
        * Whether it was part of the diet plan

        EXERCISE OR PHYSICAL ACTIVITY

        Extract any exercise information.

        Include:

        * Type of activity
        * Duration
        * Intensity if mentioned
        * Whether the activity followed the recommended plan

        MOOD / ENERGY / HUNGER FEEDBACK

        Record any statements related to:

        * Hunger
        * Cravings
        * Mood
        * Energy levels
        * Fatigue
        * Motivation
        * Sleep issues

        CLIENT QUESTIONS

        List all questions the client asked.

        Examples:

        * Food substitutions
        * Nutritional information
        * Portion questions
        * Meal timing
        * Lifestyle habits

        REQUESTS FOR DIET CHANGES

        Log if the client requested:

        * Diet plan changes
        * Calorie adjustments
        * Meal replacements
        * Supplement advice
        * Alternative foods

        CONCERNS OR SYMPTOMS

        Record any health concerns mentioned such as:

        * Digestive discomfort
        * Bloating
        * Weakness
        * Headaches
        * Low energy
        * Difficulty following the diet

        MEDIA SHARED BY CLIENT

        Images Uploaded:

        * Meal photos
        * Food labels
        * Grocery items
        * Body progress photos

        Videos Shared:

        * Meal preparation
        * Exercise
        * Progress updates

        For each item record:

        * Type of media
        * What it showed
        * Any assistant description

        VIDEO INTERACTION OBSERVATIONS

        If the client appeared on video and relevant information was mentioned, log it.

        Examples:

        * Client showed meal on camera
        * Client demonstrated exercise
        * Client discussed progress

        NEW CLIENT INFORMATION

        Record any new facts learned about the client such as:

        * Food preferences
        * Allergies or intolerances
        * Lifestyle changes
        * Work schedule
        * Travel
        * Social events affecting diet

        EDUCATIONAL INFORMATION PROVIDED BY ASSISTANT

        Briefly list nutrition concepts explained by the assistant.

        Examples:

        * Macronutrient explanation
        * Hydration guidance
        * Fiber benefits
        * Food comparisons

        POTENTIAL ALERTS FOR DIETICIAN

        Highlight items that may require dietician attention:

        * Repeated off-plan foods
        * Symptoms
        * Confusion about the diet plan
        * Requests for diet modification
        * Strong cravings
        * Adherence difficulties

        OVERALL DIET ADHERENCE

        Provide an objective adherence summary.

        Breakfast adherence: Yes / No / Unknown
        Lunch adherence: Yes / No / Unknown
        Dinner adherence: Yes / No / Unknown

        Additional Notes:

        OUTPUT FORMAT

        Always produce the summary in the following structure:

        ---

        CLIENT INTERACTION SUMMARY FOR DIETICIAN

        Client Name:
        Date:
        Interaction Types Used:

        1. Meal Log

        Breakfast:
        Lunch:
        Dinner:

        2. Snacks / Off-Plan Foods

        3. Exercise / Physical Activity

        4. Mood / Energy / Hunger Feedback

        5. Client Questions

        6. Requests for Diet Changes

        7. Concerns or Symptoms

        8. Media Shared by Client

        9. Video Interaction Observations

        10. New Client Information

        11. Educational Topics Discussed

        12. Potential Alerts for Dietician

        13. Overall Diet Adherence

        SUMMARY RULES

        * Only include information explicitly mentioned in the conversation.
        * Do not invent missing details.
        * Maintain neutral clinical tone.
        * Avoid conversational language.
        * Do not repeat the full conversation.
        * Keep the summary concise but complete.
        * Ensure the dietician can understand the entire interaction in under one minute of reading.


        Conversation:
        {formatted_history}
        """
        
        response = client.models.generate_content(
            model='gemini-2.5-flash',
            contents=prompt
        )
        
        summary_text = response.text
        
        # Save to Google Cloud Storage (GCS)
        from datetime import datetime
        now = datetime.now()
        year = now.strftime("%Y")
        month = now.strftime("%m")
        day = now.strftime("%d")
        timestamp = now.strftime("%H:%M:%S")
        
        # Determine bucket name
        bucket_name = os.getenv("FIREBASE_STORAGE_BUCKET")
        if not bucket_name:
            # Fallback if not specified, often project-id.appspot.com
            bucket_name = f"{project_id}.appspot.com"
            
        storage_client = storage.Client(project=project_id)
        bucket = storage_client.bucket(bucket_name)
        
        # Paths for split storage
        summary_path = f"summaries/{user_email}/{year}/{month}/{day}.json"
        history_path = f"raw_conversations/{user_email}/{year}/{month}/{day}.json"
        
        # --- 1. SAVE SUMMARY ---
        summary_blob = bucket.blob(summary_path)
        summary_entry = {
            "timestamp": timestamp,
            "summary": summary_text
        }
        
        daily_summaries = []
        if summary_blob.exists():
            try:
                content = summary_blob.download_as_text()
                daily_summaries = json.loads(content)
            except: daily_summaries = []
            
        daily_summaries.append(summary_entry)
        summary_blob.upload_from_string(
            data=json.dumps(daily_summaries, indent=4, ensure_ascii=False),
            content_type='application/json'
        )

        # --- 2. SAVE RAW HISTORY ---
        history_blob = bucket.blob(history_path)
        history_entry = {
            "timestamp": timestamp,
            "raw_history": history
        }
        
        daily_history = []
        if history_blob.exists():
            try:
                content = history_blob.download_as_text()
                daily_history = json.loads(content)
            except: daily_history = []
            
        daily_history.append(history_entry)
        history_blob.upload_from_string(
            data=json.dumps(daily_history, indent=4, ensure_ascii=False),
            content_type='application/json'
        )

        print(f"✅ Session stored in GCS: gs://{bucket_name}/summaries/... and gs://{bucket_name}/raw_conversations/...")
        return web.json_response({"summary": summary_text})
    except Exception as e:
        print(f"❌ Summarization Error: {e}")
        return web.json_response({"error": str(e)}, status=500)

async def handle_get_context(request):
    try:
        user_email = request.query.get("userEmail", "anonymous").replace("@", "_at_").replace(".", "_")
        project_id = os.getenv("FIREBASE_PROJECT_ID")
        
        from datetime import datetime
        now = datetime.now()
        year = now.strftime("%Y")
        month = now.strftime("%m")
        day = now.strftime("%d")
        
        # Determine bucket name
        bucket_name = os.getenv("FIREBASE_STORAGE_BUCKET")
        if not bucket_name:
            bucket_name = f"{project_id}.appspot.com"
            
        storage_client = storage.Client(project=project_id)
        bucket = storage_client.bucket(bucket_name)
        
        # Path: summaries/user@email.com/YYYY/MM/DD.json
        blob_path = f"summaries/{user_email}/{year}/{month}/{day}.json"
        blob = bucket.blob(blob_path)
        
        context_text = ""
        if blob.exists():
            content = blob.download_as_text()
            daily_record = json.loads(content)
            
            context_text = "\n--- CONTEXT FROM PREVIOUS SESSIONS TODAY ---\n"
            for session in daily_record:
                ts = session.get("timestamp", "N/A")
                summary = session.get("summary", "")
                context_text += f"\n[Session at {ts}]\n{summary}\n"
            context_text += "\n--------------------------------------------\n"
        
        return web.json_response({"context": context_text})
    except Exception as e:
        print(f"❌ Get Context Error: {e}")
        return web.json_response({"context": ""})

async def handle_index_record(request):
    try:
        data = await request.json()
        user_email = data.get("userEmail", "anonymous").replace("@", "_at_").replace(".", "_")
        text_content = data.get("text", "")
        title = data.get("title", "Untitled Record")
        project_id = os.getenv("FIREBASE_PROJECT_ID")

        if not text_content:
            return web.json_response({"error": "No content to index"}, status=400)

        # 1. Generate Embedding
        client = genai.Client(vertexai=True, project=project_id, location="us-central1")
        embed_resp = client.models.embed_content(
            model='text-embedding-004',
            contents=text_content,
            config=types.EmbedContentConfig(task_type="RETRIEVAL_DOCUMENT")
        )
        embedding = embed_resp.embeddings[0].values

        # 2. Store in Firestore
        db = firestore.AsyncClient(project=project_id)
        doc_ref = db.collection("users").document(user_email).collection("records").document()
        
        await doc_ref.set({
            "title": title,
            "content": text_content,
            "embedding": Vector(embedding),
            "timestamp": firestore.SERVER_TIMESTAMP
        })

        return web.json_response({"status": "indexed", "id": doc_ref.id})
    except Exception as e:
        print(f"❌ Indexing Error: {e}")
        return web.json_response({"error": str(e)}, status=500)

async def handle_query_records(request):
    try:
        data = await request.json()
        user_email = data.get("userEmail", "anonymous").replace("@", "_at_").replace(".", "_")
        query = data.get("query", "")
        project_id = os.getenv("FIREBASE_PROJECT_ID")

        if not query:
            return web.json_response({"results": []})

        # 1. Embed Query
        client = genai.Client(vertexai=True, project=project_id, location="us-central1")
        embed_resp = client.models.embed_content(
            model='text-embedding-004',
            contents=query,
            config=types.EmbedContentConfig(task_type="RETRIEVAL_QUERY")
        )
        query_vector = embed_resp.embeddings[0].values

        # 2. Vector Search in Firestore
        db = firestore.AsyncClient(project=project_id)
        collection_ref = db.collection("users").document(user_email).collection("records")
        
        # Firestore Vector Search (KNN)
        results = []
        docs = collection_ref.find_nearest(
            vector_field="embedding",
            query_vector=Vector(query_vector),
            distance_measure=DistanceMeasure.COSINE,
            limit=3
        )
        
        async for doc in docs.stream():
            d = doc.to_dict()
            results.append({
                "title": d.get("title"),
                "content": d.get("content")
            })

        return web.json_response({"results": results})
    except Exception as e:
        print(f"❌ Query Error: {e}")
        return web.json_response({"error": str(e)}, status=500)

async def start_servers():
    app = web.Application()
    app.router.add_get("/{path:.*}", handle_http)
    app.router.add_post("/summarize", handle_summarize)
    app.router.add_get("/get_session_context", handle_get_context)
    app.router.add_post("/index_record", handle_index_record)
    app.router.add_post("/query_records", handle_query_records)
    runner = web.AppRunner(app)
    await runner.setup()
    await web.TCPSite(runner, "0.0.0.0", HTTP_PORT).start()
    print(f"🌍 WEB: http://localhost:{HTTP_PORT} | 🔌 PROXY: {WS_PORT}")
    async with websockets.serve(handle_websocket_client, "0.0.0.0", WS_PORT):
        await asyncio.Future()

if __name__ == "__main__":
    try: asyncio.run(start_servers())
    except KeyboardInterrupt: pass
