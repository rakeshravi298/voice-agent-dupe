/**
 * Main application script for Gemini Live API Demo
 * Handles UI interactions, media streaming, and communication with Gemini API
 */

// Global state
const state = {
  client: null,
  audio: { streamer: null, player: null, isStreaming: false },
  video: { streamer: null, isStreaming: false },
  screen: { capture: null, isSharing: false },
  history: [],
  isSummarizing: false,
  currentTurn: { role: null, text: "" }
};

// DOM element cache
const elements = {};

// Initialize DOM references
function initDOM() {
  const ids = [
    "projectId",
    "model",
    "proxyUrl",
    "systemInstructions",
    "enableInputTranscription",
    "enableOutputTranscription",
    "enableGrounding",
    "enableAffectiveDialog",
    "enableAlertTool",
    "enableCssStyleTool",
    "enableHealthSearchTool",
    "indexDocBtn",
    "docTitle",
    "docContent",
    "enableProactiveAudio",
    "voiceSelect",
    "temperature",
    "temperatureValue",
    "disableActivityDetection",
    "silenceDuration",
    "prefixPadding",
    "endSpeechSensitivity",
    "startSpeechSensitivity",
    "activityHandling",
    "connectBtn",
    "disconnectBtn",
    "connectionStatus",
    "startAudioBtn",
    "startVideoBtn",
    "startScreenBtn",
    "videoPreview",
    "micSelect",
    "cameraSelect",
    "volume",
    "volumeValue",
    "chatContainer",
    "chatInput",
    "sendBtn",
    "debugInfo",
    "setupJsonSection",
    "setupJsonDisplay",
    "summaryContainer",
    "summaryContent",
    "tool-activity-label"
  ];

  ids.forEach((id) => {
    elements[id] = document.getElementById(id);
  });
}

// Populate media device selectors
async function populateMediaDevices() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();

    // Clear existing options
    if (elements.micSelect) {
      elements.micSelect.innerHTML = '<option value="">Default Microphone</option>';
      devices
        .filter((device) => device.kind === "audioinput")
        .forEach((device) => {
          const option = document.createElement("option");
          option.value = device.deviceId;
          option.textContent = device.label || `Microphone ${device.deviceId.substr(0, 8)}`;
          elements.micSelect.appendChild(option);
        });
    }

    if (elements.cameraSelect) {
      elements.cameraSelect.innerHTML = '<option value="">Default Camera</option>';
      devices
        .filter((device) => device.kind === "videoinput")
        .forEach((device) => {
          const option = document.createElement("option");
          option.value = device.deviceId;
          option.textContent = device.label || `Camera ${device.deviceId.substr(0, 8)}`;
          elements.cameraSelect.appendChild(option);
        });
    }
  } catch (error) {
    console.error("Error enumerating devices:", error);
  }
}

// Create reusable message element
function createMessage(text, className = "") {
  const div = document.createElement("div");
  div.textContent = text;
  if (className) div.className = className;
  return div;
}

// Update status display
function updateStatus(elementId, text) {
  if (elements[elementId]) {
    elements[elementId].textContent = text;
    if (elementId === "connectionStatus") {
       const dot = document.getElementById('status-dot');
       if (dot) {
         if (text === "Connected") dot.classList.add('active');
         else dot.classList.remove('active');
       }
    }
  }
}

// Connect to Gemini
async function connect() {
  // Dynamic Proxy URL
  let proxyUrl = elements.proxyUrl.value;
  if (!proxyUrl) {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      proxyUrl = `${protocol}//${window.location.host}/ws`;
      elements.proxyUrl.value = proxyUrl;
  }
  const projectId = elements.projectId.value;
  const model = elements.model.value;

  if (!proxyUrl && !projectId) {
    alert("Please provide either a Proxy URL and Project ID");
    return;
  }

  try {
    updateStatus("connectionStatus", "Connecting...");
    
    // Voice feedback: "I might take some time"
    const synth = window.speechSynthesis;
    const utterance = new SpeechSynthesisUtterance("I might take some time");
    synth.speak(utterance);

    // 1. Fetch Today's Session Context (Memory)
    let contextData = "";
    try {
        const fullEmail = document.getElementById('userEmailFull').value;
        const contextResp = await fetch(`/get_session_context?userEmail=${encodeURIComponent(fullEmail)}`);
        const cJson = await contextResp.json();
        contextData = cJson.context || "";
        if (contextData) {
            console.log("🧠 Context from previous sessions loaded");
        }
    } catch (e) {
        console.warn("⚠️ Failed to fetch session context:", e);
    }

    // Create GeminiLiveAPI instance directly
    state.client = new GeminiLiveAPI(proxyUrl, projectId, model);

    // Configure settings - Prepend context to instructions
    state.client.systemInstructions = contextData + elements.systemInstructions.value;
    state.client.inputAudioTranscription =
      elements.enableInputTranscription.checked;
    state.client.outputAudioTranscription =
      elements.enableOutputTranscription.checked;
    state.client.googleGrounding = elements.enableGrounding.checked;
    state.client.enableAffectiveDialog = elements.enableAffectiveDialog.checked;
    state.client.responseModalities = ["AUDIO"];
    state.client.voiceName = elements.voiceSelect.value;
    state.client.temperature = parseFloat(elements.temperature.value);

    // Set proactivity configuration
    state.client.proactivity = {
      proactiveAudio: elements.enableProactiveAudio.checked,
    };

    // Set automatic activity detection configuration
    state.client.automaticActivityDetection = {
      disabled: elements.disableActivityDetection.checked,
      silence_duration_ms: parseInt(elements.silenceDuration.value),
      prefix_padding_ms: parseInt(elements.prefixPadding.value),
      end_of_speech_sensitivity: elements.endSpeechSensitivity.value,
      start_of_speech_sensitivity: elements.startSpeechSensitivity.value,
    };

    // Set activity handling
    state.client.activityHandling = elements.activityHandling.value;

    // Add custom tools only if Google grounding is disabled
    const isGroundingEnabled = elements.enableGrounding.checked;

    if (!isGroundingEnabled) {
      // Add alert tool if enabled
      if (elements.enableAlertTool.checked) {
        const alertTool = new ShowAlertTool();
        state.client.addFunction(alertTool);
        console.log("✅ Alert tool enabled");
      }

      // Add CSS style tool if enabled
      if (elements.enableCssStyleTool.checked) {
        const cssStyleTool = new AddCSSStyleTool();
        state.client.addFunction(cssStyleTool);
        console.log("✅ CSS style tool enabled");
      }

      // Add health search tool if enabled
      if (elements.enableHealthSearchTool && elements.enableHealthSearchTool.checked) {
        const healthTool = new SearchHealthRecordsTool();
        state.client.addFunction(healthTool);
        console.log("✅ Health search tool (RAG) enabled");
      }
    } else {
      console.log(
        "⚠️ Custom tools disabled due to Google grounding being enabled"
      );
    }

    // Set callbacks to match geminilive.js original API
    state.client.onReceiveResponse = handleMessage;
    state.client.onErrorMessage = handleError;
    state.client.onConnectionStarted = handleOpen;
    state.client.onConnectionClosed = handleClose;

    await state.client.connect();

    // Initialize media handlers
    state.audio.streamer = new AudioStreamer(state.client);
    state.video.streamer = new VideoStreamer(state.client);
    state.screen.capture = new ScreenCapture(state.client);
    state.audio.player = new AudioPlayer();
    await state.audio.player.init();

    updateStatus("debugInfo", "Connected successfully");
    console.log("🚀 Connection established and handlers initialized");

    // Automatically start audio streaming
    setTimeout(async () => {
        if (!state.audio.isStreaming) {
            await toggleAudio();
            // Voice feedback: "I am ready"
            const readyUtterance = new SpeechSynthesisUtterance("I am ready");
            window.speechSynthesis.speak(readyUtterance);
        }
    }, 1000);
  } catch (error) {
    console.error("❌ Connection failed:", error);
    updateStatus("connectionStatus", "Connection failed: " + error.message);
    updateStatus("debugInfo", "Error: " + error.message);
    addMessage("Connection failed: " + error.message, "system");
  }
}

// Disconnect triggered by user
function userDisconnect() {
  if (state.client) {
    state.client.disconnect();
  }
}

// Internal cleanup
function disconnect() {
  // Stop all streams
  if (state.audio.streamer) state.audio.streamer.stop();
  if (state.video.streamer) state.video.streamer.stop();
  if (state.screen.capture) state.screen.capture.stop();

  // Reset states
  state.audio.isStreaming = false;
  state.video.isStreaming = false;
  state.screen.isSharing = false;
  state.client = null;

  // Reset UI
  if (elements.startAudioBtn) {
    elements.startAudioBtn.innerHTML = '<span style="font-size: 1.2rem;">🎙️</span> Start Voice Proxy';
    elements.startAudioBtn.style.background = "rgba(255, 255, 255, 0.03)";
    elements.startAudioBtn.style.color = "var(--text-main)";
    elements.startAudioBtn.style.display = "none";
  }
  
  if (elements.startVideoBtn) {
    elements.startVideoBtn.innerHTML = '<span style="font-size: 1.2rem;">👁️</span> Turn on Camera';
    elements.startVideoBtn.style.background = "rgba(255, 255, 255, 0.03)";
    elements.startVideoBtn.style.color = "var(--text-main)";
  }

  if (elements.videoPreview) {
    elements.videoPreview.hidden = true;
    elements.videoPreview.srcObject = null;
  }
  if (document.getElementById('camera-placeholder')) document.getElementById('camera-placeholder').style.display = 'block';
}

// Handle messages
function handleMessage(message) {
  console.log("Message:", message);
  updateStatus("debugInfo", `Message: ${message.type}`);

  switch (message.type) {
    case MultimodalLiveResponseType.TEXT:
      console.log("Text message:");
      addMessage(message.data, "assistant");
      // For immediate text responses, push to history and reset current turn
      state.history.push({ role: 'assistant', text: message.data });
      state.currentTurn = { role: null, text: "" };
      break;

    case MultimodalLiveResponseType.AUDIO:
      console.log("Audio message:");
      if (state.audio.player) {
        state.audio.player.play(message.data);
      }
      break;

    case MultimodalLiveResponseType.INPUT_TRANSCRIPTION:
      // Show progressive transcript in UI
      addMessage(message.data.text, "user-transcript", true);
      
      // Accumulate for history
      if (state.currentTurn.role !== 'user') {
        finalizeCurrentTurn();
        state.currentTurn = { role: 'user', text: "" };
      }
      state.currentTurn.text += message.data.text;
      break;

    case MultimodalLiveResponseType.OUTPUT_TRANSCRIPTION:
      // Show progressive transcript in UI
      addMessage(message.data.text, "assistant", true);
      
      // Accumulate for history
      if (state.currentTurn.role !== 'assistant') {
        finalizeCurrentTurn();
        state.currentTurn = { role: 'assistant', text: "" };
      }
      state.currentTurn.text += message.data.text;
      break;

    case MultimodalLiveResponseType.SETUP_COMPLETE:
      console.log("Setup complete:", message.data);
      addMessage("Ready!", "assistant");

      // Display the setup JSON
      if (state.client && state.client.lastSetupMessage) {
        if (elements.setupJsonDisplay) {
            elements.setupJsonDisplay.textContent = JSON.stringify(
                state.client.lastSetupMessage,
                null,
                2
            );
        }
        if (elements.setupJsonSection) elements.setupJsonSection.style.display = "block";
      }
      if (elements["tool-activity-label"]) elements["tool-activity-label"].style.opacity = '0';
      break;

    case MultimodalLiveResponseType.TOOL_CALL:
      console.log("🛠️ Tool call received: ", message.data);
      if (elements["tool-activity-label"]) elements["tool-activity-label"].style.opacity = '1';
      const functionCalls = message.data.functionCalls || [];
      const userEmail = document.getElementById('userEmailFull').value;
      
      for (const call of functionCalls) {
        const context = {
            userEmail,
            callId: call.id,
            client: state.client
        };
        state.client.callFunction(call.name, call.args, context);
      }
      break;

    case MultimodalLiveResponseType.TURN_COMPLETE:
      console.log("Turn complete");
      finalizeCurrentTurn();
      if (elements["tool-activity-label"]) elements["tool-activity-label"].style.opacity = '0';
      updateStatus("debugInfo", "Turn complete");
      break;

    case MultimodalLiveResponseType.INTERRUPTED:
      console.log("Interrupted");
      if (elements["tool-activity-label"]) elements["tool-activity-label"].style.opacity = '0';
      addMessage("[Interrupted]", "system");
      if (state.audio.player) state.audio.player.interrupt();
      break;
  }
}

// Connection handlers
function handleOpen() {
  updateStatus("connectionStatus", "Connected");
  if (elements.connectBtn) elements.connectBtn.style.display = "none";
  if (elements.disconnectBtn) elements.disconnectBtn.style.display = "block";
  const mediaControls = document.getElementById('mediaControls');
  if (mediaControls) mediaControls.style.display = "grid";
}

function handleClose() {
  updateStatus("connectionStatus", "Disconnected");
  if (elements.connectBtn) elements.connectBtn.style.display = "block";
  if (elements.disconnectBtn) elements.disconnectBtn.style.display = "none";
  const mediaControls = document.getElementById('mediaControls');
  if (mediaControls) mediaControls.style.display = "none";
  
  // Automatically summarize if there is history
  if (state.history.length > 0) {
      summarizeSession(true);
  }
  
  disconnect();
}

function handleError(error) {
  console.error("Error:", error);
  updateStatus("connectionStatus", "Error: " + error);
  updateStatus("debugInfo", "Error: " + error);
}

// Toggle audio
async function toggleAudio() {
  if (!state.audio.isStreaming) {
    try {
      // Initialize streamer if needed
      if (!state.audio.streamer && state.client) {
        state.audio.streamer = new AudioStreamer(state.client);
      }

      if (state.audio.streamer) {
        // Get selected microphone device ID
        const selectedMicId = elements.micSelect.value;
        await state.audio.streamer.start(selectedMicId);
        state.audio.isStreaming = true;
        elements.startAudioBtn.innerHTML = '<span style="font-size: 1.2rem;">🛑</span> Stop Voice Proxy';
        elements.startAudioBtn.style.background = "rgba(255, 118, 117, 0.1)";
        elements.startAudioBtn.style.color = "#FF7675";
        addMessage("[Microphone on]", "system");
        console.log("🎤 Audio streamer started successfully");
      } else {
        addMessage("[Connect to Gemini first]", "system");
      }
    } catch (error) {
      console.error("❌ Audio error:", error);
      addMessage("[Audio error: " + error.message + "]", "system");
      updateStatus("debugInfo", "Audio error: " + error.message);
    }
  } else {
    if (state.audio.streamer) state.audio.streamer.stop();
    state.audio.isStreaming = false;
    elements.startAudioBtn.innerHTML = '<span style="font-size: 1.2rem;">🎙️</span> Start Voice Proxy';
    elements.startAudioBtn.style.background = "rgba(255, 255, 255, 0.03)";
    elements.startAudioBtn.style.color = "var(--text-main)";
    addMessage("[Microphone off]", "system");
  }
}

// Toggle video
async function toggleVideo() {
  if (!state.video.isStreaming) {
    try {
      // Initialize streamer if needed
      if (!state.video.streamer && state.client) {
        state.video.streamer = new VideoStreamer(state.client);
      }

      if (state.video.streamer) {
        // Get selected camera device ID
        const selectedCameraId = elements.cameraSelect.value;
        const video = await state.video.streamer.start({
          fps: 1,
          width: 640,
          height: 480,
          deviceId: selectedCameraId || null,
        });
        state.video.isStreaming = true;

        elements.videoPreview.srcObject = video.srcObject;
        elements.videoPreview.hidden = false;
        if (document.getElementById('camera-placeholder')) document.getElementById('camera-placeholder').style.display = 'none';
        elements.startVideoBtn.innerHTML = '<span style="font-size: 1.2rem;">✖</span> Stop Camera';
        elements.startVideoBtn.style.background = "rgba(255, 118, 117, 0.1)";
        elements.startVideoBtn.style.color = "#FF7675";
        addMessage("[Camera on]", "system");
      } else {
        addMessage("[Connect to Gemini first]", "system");
      }
    } catch (error) {
      addMessage("[Video error: " + error.message + "]", "system");
    }
  } else {
    if (state.video.streamer) state.video.streamer.stop();
    state.video.isStreaming = false;

    elements.videoPreview.srcObject = null;
    elements.videoPreview.hidden = true;
    if (document.getElementById('camera-placeholder')) document.getElementById('camera-placeholder').style.display = 'block';
    elements.startVideoBtn.innerHTML = '<span style="font-size: 1.2rem;">👁️</span> Turn on Camera';
    elements.startVideoBtn.style.background = "rgba(255, 255, 255, 0.03)";
    elements.startVideoBtn.style.color = "var(--text-main)";
    addMessage("[Camera off]", "system");
  }
}

// Toggle screen
async function toggleScreen() {
  if (!state.screen.isSharing) {
    try {
      // Initialize capture if needed
      if (!state.screen.capture && state.client) {
        state.screen.capture = new ScreenCapture(state.client);
      }

      if (state.screen.capture) {
        const video = await state.screen.capture.start({ fps: 0.5 });
        state.screen.isSharing = true;

        // Show screen preview in the same video element
        elements.videoPreview.srcObject = video.srcObject;
        elements.videoPreview.hidden = false;
        if (elements.startScreenBtn) elements.startScreenBtn.textContent = "Stop Sharing";
        addMessage("[Screen sharing on]", "system");
      } else {
        addMessage("[Connect to Gemini first]", "system");
      }
    } catch (error) {
      addMessage("[Screen share error: " + error.message + "]", "system");
    }
  } else {
    if (state.screen.capture) state.screen.capture.stop();
    state.screen.isSharing = false;

    // Hide preview if not using camera
    if (!state.video.isStreaming) {
      if (elements.videoPreview) {
        elements.videoPreview.srcObject = null;
        elements.videoPreview.hidden = true;
      }
    }

    if (elements.startScreenBtn) elements.startScreenBtn.textContent = "Share Screen";
    addMessage("[Screen sharing off]", "system");
  }
}

// Send message
function sendMessage() {
  const message = elements.chatInput.value.trim();
  if (!message) return;

  if (state.client) {
    addMessage(message, "user");
    finalizeCurrentTurn();
    state.history.push({ role: 'user', text: message });
    state.client.sendTextMessage(message);
    elements.chatInput.value = "";
  } else {
    addMessage("[Connect to Gemini first]", "system");
  }
}

// Add message to chat
function addMessage(text, type, append = false) {
  if (!text) return;
  
  // Get all div children (messages)
  const messages = elements.chatContainer.querySelectorAll("div");
  const lastMessage = messages[messages.length - 1];

  // Check if we should append to the last message
  if (append && lastMessage && lastMessage.classList.contains(type)) {
    // Append to existing message of the same type
    lastMessage.textContent += text;
  } else {
    // Create new message
    const message = createMessage(text, type);
    elements.chatContainer.appendChild(message);
  }

  elements.chatContainer.scrollTop = elements.chatContainer.scrollHeight;
}

// Finalize pending transcript into history
function finalizeCurrentTurn() {
    if (state.currentTurn.role && state.currentTurn.text.trim()) {
        state.history.push({ ...state.currentTurn });
        console.log("📁 Finalized turn in history:", state.currentTurn);
    }
    state.currentTurn = { role: null, text: "" };
}

// Update volume
function updateVolume() {
  const value = elements.volume.value;
  const volume = value / 100;
  if (state.audio.player) {
    state.audio.player.setVolume(volume);
  }
  updateStatus("volumeValue", value + "%");
}

// Update temperature display
function updateTemperature() {
  const value = elements.temperature.value;
  updateStatus("temperatureValue", value);
}

// Session Summarization
async function summarizeSession(silent = false) {
    if (state.history.length === 0) {
        if (!silent) alert("No conversation history to summarize.");
        return;
    }

    if (state.isSummarizing) return;
    
    try {
        if (silent) {
            console.log("🤫 Silent summarization started in background...");
        } else {
            state.isSummarizing = true;
            elements.summarizeBtn.disabled = true;
            elements.summarizeBtn.innerHTML = '<span class="spinner">⏳</span> Summarizing...';
            elements.summaryContainer.style.display = "block";
            elements.summaryContent.innerHTML = "Generating your session summary...";
        }

        const userEmail = document.getElementById('userEmailFull').value;

        const response = await fetch('/summarize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                history: state.history,
                userEmail: userEmail
            })
        });

        const data = await response.json();
        
        if (data.summary) {
            console.log("✅ Background summarization complete");
            if (!silent) {
                // Simple markdown to HTML conversion (basic)
                elements.summaryContent.innerHTML = data.summary
                    .replace(/\n/g, '<br>')
                    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                    .replace(/\*(.*?)\*/g, '<em>$1</em>');
            }
        } else {
            if (!silent) elements.summaryContent.textContent = "Failed to generate summary: " + (data.error || "Unknown error");
        }
    } catch (error) {
        console.error("Summarization Error:", error);
        if (!silent) elements.summaryContent.textContent = "Error: " + error.message;
    } finally {
        if (!silent) {
            state.isSummarizing = false;
            elements.summarizeBtn.disabled = false;
            elements.summarizeBtn.innerHTML = '<span style="font-size: 1.2rem;">📝</span> Summarize Session';
        }
    }
}

// Document Indexing (RAG)
async function indexDocument() {
    const title = elements.docTitle.value.trim();
    const text = elements.docContent.value.trim();
    const userEmail = document.getElementById('userEmailFull').value;

    if (!text) {
        alert("Please provide content to index.");
        return;
    }

    try {
        elements.indexDocBtn.disabled = true;
        elements.indexDocBtn.textContent = "⚙️ Indexing...";
        
        const response = await fetch('/index_record', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, text, userEmail })
        });

        const data = await response.json();
        if (data.status === "indexed") {
            alert("Document indexed successfully! Vitality AI can now reference it.");
            elements.docTitle.value = "";
            elements.docContent.value = "";
        } else {
            alert("Indexing failed: " + (data.error || "Unknown error"));
        }
    } catch (error) {
        console.error("Indexing error:", error);
        alert("Error indexing document: " + error.message);
    } finally {
        elements.indexDocBtn.disabled = false;
        elements.indexDocBtn.textContent = "Add to Memory";
    }
}

// Event listeners
function initEventListeners() {
  if (elements.connectBtn) elements.connectBtn.addEventListener("click", connect);
  if (elements.disconnectBtn) elements.disconnectBtn.addEventListener("click", userDisconnect);
  if (elements.startAudioBtn) elements.startAudioBtn.addEventListener("click", toggleAudio);
  if (elements.startVideoBtn) elements.startVideoBtn.addEventListener("click", toggleVideo);
  if (elements.startScreenBtn) elements.startScreenBtn.addEventListener("click", toggleScreen);
  if (elements.indexDocBtn) elements.indexDocBtn.addEventListener("click", indexDocument);
  if (elements.sendBtn) elements.sendBtn.addEventListener("click", sendMessage);
  if (elements.volume) elements.volume.addEventListener("input", updateVolume);
  if (elements.temperature) elements.temperature.addEventListener("input", updateTemperature);

  if (elements.chatInput) {
    elements.chatInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter") sendMessage();
    });
  }
}

// Initialize
window.addEventListener("DOMContentLoaded", () => {
  initDOM();
  initEventListeners();
  populateMediaDevices();
  updateStatus("debugInfo", "Application initialized");
});
