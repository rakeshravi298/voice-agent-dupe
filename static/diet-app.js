/**
 * Diet App Logic using Gemini Live SDK Bridge
 */
const state = {
    client: null,
    media: new MediaHandler(),
    isConnected: false,
    audioActive: false,
    videoActive: false
};

const elements = {
    connectBtn: document.getElementById('connectBtn'),
    disconnectBtn: document.getElementById('disconnectBtn'),
    statusDot: document.getElementById('status-dot'),
    statusText: document.getElementById('connectionStatus'),
    chatContainer: document.getElementById('chatContainer'),
    chatInput: document.getElementById('chatInput'),
    sendBtn: document.getElementById('sendBtn'),
    micBtn: document.getElementById('startAudioBtn'),
    cameraBtn: document.getElementById('startVideoBtn'),
    videoPreview: document.getElementById('videoPreview'),
    debugInfo: document.getElementById('debugInfo'),
    volumeIndicator: null // We'll create this or use debugInfo
};

let lastMessageElement = null;
let lastMessageRole = null;

function log(msg, type = 'info') {
    const timestamp = new Date().toLocaleTimeString();
    if (elements.debugInfo) {
        // Keep only last 10 lines to avoid UI lag
        const lines = elements.debugInfo.innerHTML.split('\n').filter(l => l.trim());
        const newLines = `[${timestamp}] [${type.toUpperCase()}] ${msg}\n` + lines.slice(0, 10).join('\n');
        elements.debugInfo.innerHTML = newLines;
    }
    console.log(`[${type.toUpperCase()}] ${msg}`);
}

function addMessage(text, role, append = false) {
    if (append && lastMessageElement && lastMessageRole === role) {
        lastMessageElement.textContent += text;
    } else {
        const div = document.createElement('div');
        div.className = `message ${role}`;
        div.textContent = text;
        elements.chatContainer.appendChild(div);
        lastMessageElement = div;
        lastMessageRole = role;
    }
    elements.chatContainer.scrollTop = elements.chatContainer.scrollHeight;
}

function updateUI(connected) {
    state.isConnected = connected;
    elements.connectBtn.style.display = connected ? 'none' : 'block';
    elements.disconnectBtn.style.display = connected ? 'block' : 'none';
    elements.statusDot.className = `status-dot ${connected ? 'active' : ''}`;
    elements.statusText.textContent = connected ? 'Live' : 'Disconnected';
    
    const mediaControls = document.getElementById('mediaControls');
    if (mediaControls) mediaControls.style.display = connected ? 'grid' : 'none';
}

async function connect() {
    log("Initializing Audio System...");
    try {
        await state.media.initializeAudio();
    } catch (e) {
        log("Audio Context failed (expected if no user gesture yet)", "warn");
    }

    log("Connecting to Gemini...");
    state.client = new GeminiClient({
        onOpen: () => {
            log("WebSocket Open", "success");
            updateUI(true);
            addMessage("Connected to Diet Assistant", "system");
        },
        onMessage: (event) => {
            if (event.data instanceof ArrayBuffer) {
                // Audio data from Gemini
                state.media.playAudio(event.data);
            } else {
                // JSON Metadata from bridge
                const data = JSON.parse(event.data);
                if (data.type === 'user') {
                    // This is transcription of WHAT WE SAID
                    addMessage(data.text, 'user-transcript', true);
                } else if (data.type === 'gemini') {
                    // This is transcription of WHAT GEMINI SAID
                    addMessage(data.text, 'assistant', true);
                } else if (data.type === 'turn_complete') {
                    // Start new message next time
                    lastMessageElement = null;
                } else if (data.type === 'interrupted') {
                    log("Gemini Interrupted", "warn");
                    state.media.stopAudioPlayback();
                    lastMessageElement = null; // Don't append to a dead message
                    addMessage("[Interrupted]", "system");
                } else if (data.type === 'error') {
                    log(`Bridge Error: ${data.error}`, "error");
                }
            }
        },
        onClose: () => {
            log("WebSocket Closed", "warn");
            disconnect();
        },
        onError: (err) => {
            log(`WebSocket Error`, "error");
        }
    });

    state.client.connect();
}

function disconnect() {
    if (state.client) state.client.disconnect();
    state.media.stopAudio();
    state.media.stopVideo(elements.videoPreview);
    state.media.stopAudioPlayback();
    updateUI(false);
    state.audioActive = false;
    state.videoActive = false;
    elements.micBtn.textContent = "Start Audio";
    elements.cameraBtn.textContent = "Start Video";
}

async function toggleAudio() {
    if (!state.audioActive) {
        log("Requesting Microphone permit...");
        try {
            let chunkCount = 0;
            await state.media.startAudio((pcm) => {
                if (state.client && state.client.isConnected()) {
                    state.client.send(pcm);
                    chunkCount++;
                    if (chunkCount % 50 === 0) {
                        log("🎤 Audio stream healthy (flowing)...", "success");
                    }
                }
            });
            state.audioActive = true;
            elements.micBtn.textContent = "Stop Audio";
            elements.micBtn.style.background = "#FF7675";
            elements.micBtn.style.color = "white";
            log("Microphone successfully started!", "success");
        } catch (e) {
            log(`Audio Error: ${e.message}`, "error");
            alert("Could not start microphone. Please check browser permissions.");
        }
    } else {
        state.media.stopAudio();
        state.audioActive = false;
        elements.micBtn.textContent = "Start Audio";
        log("Microphone Disabled");
    }
}

async function toggleVideo() {
    if (!state.videoActive) {
        log("Starting Camera...");
        try {
            elements.videoPreview.hidden = false;
            await state.media.startVideo(elements.videoPreview, (base64) => {
                if (state.client && state.client.isConnected()) {
                    state.client.sendImage(base64);
                }
            });
            state.videoActive = true;
            elements.cameraBtn.textContent = "Stop Video";
            log("Camera Active", "success");
        } catch (e) {
            log(`Video Error: ${e.message}`, "error");
        }
    } else {
        state.media.stopVideo(elements.videoPreview);
        state.videoActive = false;
        elements.videoPreview.hidden = true;
        elements.cameraBtn.textContent = "Start Video";
        log("Camera Disabled");
    }
}

function sendMessage() {
    const text = elements.chatInput.value.trim();
    if (!text || !state.client) return;
    
    addMessage(text, 'user');
    lastMessageElement = null; // typed message should break any transcription append
    state.client.sendText(text);
    elements.chatInput.value = '';
}

// Bind events
elements.connectBtn.addEventListener('click', connect);
elements.disconnectBtn.addEventListener('click', disconnect);
elements.micBtn.addEventListener('click', toggleAudio);
elements.cameraBtn.addEventListener('click', toggleVideo);
elements.sendBtn.addEventListener('click', sendMessage);
elements.chatInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendMessage(); });

log("Diet Assistant Logic Initialized");
