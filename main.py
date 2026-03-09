from flask import Flask, send_file, request, redirect, Response, render_template_string
import os
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)

def get_firebase_config():
    return {
        "apiKey": os.getenv("FIREBASE_API_KEY", ""),
        "authDomain": os.getenv("FIREBASE_AUTH_DOMAIN", ""),
        "projectId": os.getenv("FIREBASE_PROJECT_ID", ""),
        "storageBucket": os.getenv("FIREBASE_STORAGE_BUCKET", ""),
        "messagingSenderId": os.getenv("FIREBASE_MESSAGING_SENDER_ID", ""),
        "appId": os.getenv("FIREBASE_APP_ID", "")
    }

def render_html_with_config(filename):
    with open(filename, 'r', encoding='utf-8') as f:
        html = f.read()
    
    config = get_firebase_config()
    # Build a clean JS object based on available environment variables
    config_items = []
    for key, value in config.items():
        if value:
            config_items.append(f'{key}: "{value}"')
    
    config_js = "const firebaseConfig = {\n            " + ",\n            ".join(config_items) + "\n        };"
    
    html = html.replace('// CONFIG_PLACEHOLDER', config_js)
    # Return as a direct Response to avoid Flask trying to parse JS/CSS { } as Jinja templates
    return Response(html, mimetype='text/html')

@app.route("/", methods=['GET'])
def index():
    return render_html_with_config('gemini-live.html')

@app.route("/login", methods=['GET'])
def login():
    return render_html_with_config('landing.html')

@app.route('/favicon.ico')
def favicon():
    return send_file('favicon.ico', mimetype='image/x-icon')

@app.route('/screenshot.png')
def screenshot():
    return send_file('screenshot.png', mimetype='image/png')

@app.route('/robots.txt')
def robots():
    return Response("User-agent: *\nAllow: /\n",
                    mimetype='text/plain')

if __name__ == '__main__':
    # Setting port to 5000 to match user's environment
    app.run(port=int(os.environ.get('PORT', 5000)), host='0.0.0.0')
