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
        Summarize the following dietitian assistant session. 
        Focus on:
        1. Main concerns/questions from the user.
        2. Key nutritional advice provided.
        3. Actionable next steps or goals.
        
        Keep it concise, supportive, and formatted with markdown.

        Conversation:
        {formatted_history}
        """
        
        response = client.models.generate_content(
            model='gemini-2.5-flash',
            contents=prompt
        )
        
        summary_text = response.text
        
        # Save to local storage
        from datetime import datetime
        now = datetime.now()
        date_str = now.strftime("%Y-%m-%d")
        timestamp = now.strftime("%H:%M:%S")
        
        storage_dir = os.path.join("sessions", user_email)
        os.makedirs(storage_dir, exist_ok=True)
        
        file_path = os.path.join(storage_dir, f"{date_str}.json")
        
        session_entry = {
            "timestamp": timestamp,
            "summary": summary_text,
            "raw_history": history
        }
        
        daily_record = []
        if os.path.exists(file_path):
            try:
                with open(file_path, "r", encoding="utf-8") as f:
                    daily_record = json.load(f)
            except: daily_record = []
            
        daily_record.append(session_entry)
        
        with open(file_path, "w", encoding="utf-8") as f:
            json.dump(daily_record, f, indent=4, ensure_ascii=False)
            
        return web.json_response({"summary": summary_text})
    except Exception as e:
        print(f"❌ Summarization Error: {e}")
        return web.json_response({"error": str(e)}, status=500)

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
