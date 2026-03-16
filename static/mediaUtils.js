/**
 * Media Utilities - Audio and Video streaming helpers for Gemini Live API
 * Handles media capture, processing, and playback
 */

/**
 * Audio Streamer - Captures and streams microphone audio
 */
class AudioStreamer {
  constructor(geminiClient) {
    this.client = geminiClient;
    this.audioContext = null;
    this.audioWorklet = null;
    this.mediaStream = null;
    this.isStreaming = false;
    this.sampleRate = 16000; // Gemini requires 16kHz
  }

  /**
   * Start streaming audio from microphone
   * @param {string} deviceId - Optional device ID for specific microphone
   */
  async start(deviceId = null) {
    try {
      const audioConstraints = {
        sampleRate: this.sampleRate,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      };

      if (deviceId) {
        audioConstraints.deviceId = { exact: deviceId };
      }

      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints,
      });

      this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: this.sampleRate,
      });

      // EXACT SAME LOGIC - just fixed path for our app
      await this.audioContext.audioWorklet.addModule(
        "/static/audio-processors/capture.worklet.js"
      );
      // Small delay to ensure registration is processed
      await new Promise(resolve => setTimeout(resolve, 100));

      this.audioWorklet = new AudioWorkletNode(
        this.audioContext,
        "audio-capture-processor"
      );

      this.audioWorklet.port.onmessage = (event) => {
        if (!this.isStreaming) return;

        if (event.data.type === "audio") {
          const inputData = event.data.data;
          const pcmData = this.convertToPCM16(inputData);
          const base64Audio = this.arrayBufferToBase64(pcmData);

          if (this.client && this.client.connected) {
            this.client.sendAudioMessage(base64Audio);
          }
        }
      };

      const source = this.audioContext.createMediaStreamSource(this.mediaStream);
      source.connect(this.audioWorklet);

      this.isStreaming = true;
      console.log("🎤 Audio streaming started");
      return true;
    } catch (error) {
      console.error("Failed to start audio streaming:", error);
      throw error;
    }
  }

  stop() {
    this.isStreaming = false;
    if (this.audioWorklet) {
      this.audioWorklet.disconnect();
      this.audioWorklet.port.close();
      this.audioWorklet = null;
    }
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }
    console.log("🛑 Audio streaming stopped");
  }

  convertToPCM16(float32Array) {
    const int16Array = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
      const sample = Math.max(-1, Math.min(1, float32Array[i]));
      int16Array[i] = sample * 0x7fff;
    }
    return int16Array.buffer;
  }

  arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
  }
}

/**
 * Base Video Capture
 */
class BaseVideoCapture {
  constructor(geminiClient) {
    this.client = geminiClient;
    this.video = null;
    this.canvas = null;
    this.ctx = null;
    this.mediaStream = null;
    this.isStreaming = false;
    this.captureInterval = null;
    this.fps = 1;
    this.quality = 0.8;
  }

  initializeElements(width, height) {
    this.video = document.createElement("video");
    this.video.srcObject = this.mediaStream;
    this.video.autoplay = true;
    this.video.playsInline = true;
    this.video.muted = true;
    this.canvas = document.createElement("canvas");
    this.canvas.width = width;
    this.canvas.height = height;
    this.ctx = this.canvas.getContext("2d");
  }

  async waitForVideoReady() {
    await new Promise((resolve) => {
      this.video.onloadedmetadata = resolve;
    });
    this.video.play();
  }

  startCapturing() {
    const captureFrame = () => {
      if (!this.isStreaming) return;
      this.ctx.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);
      this.canvas.toBlob(
        (blob) => {
          if (!blob) return;
          const reader = new FileReader();
          reader.onloadend = () => {
            const base64 = reader.result.split(",")[1];
            if (this.client && this.client.connected) {
              this.client.sendImageMessage(base64, "image/jpeg");
            }
          };
          reader.readAsDataURL(blob);
        },
        "image/jpeg",
        this.quality
      );
    };
    this.captureInterval = setInterval(captureFrame, 1000 / this.fps);
  }

  stop() {
    this.isStreaming = false;
    if (this.captureInterval) clearInterval(this.captureInterval);
    if (this.mediaStream) this.mediaStream.getTracks().forEach(t => t.stop());
    this.video = this.canvas = this.ctx = this.mediaStream = null;
  }
}

/**
 * Video Streamer
 */
class VideoStreamer extends BaseVideoCapture {
  async start(options = {}) {
    try {
      const { fps = 1, width = 640, height = 480, facingMode = "user", quality = 0.8, deviceId = null } = options;
      this.fps = fps; this.quality = quality;
      const videoConstraints = { width: { ideal: width }, height: { ideal: height } };
      if (deviceId) videoConstraints.deviceId = { exact: deviceId }; else videoConstraints.facingMode = facingMode;
      this.mediaStream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints });
      this.initializeElements(width, height);
      await this.waitForVideoReady();
      this.isStreaming = true;
      this.startCapturing();
      return this.video;
    } catch (e) { throw e; }
  }
}

/**
 * Screen Capture
 */
class ScreenCapture extends BaseVideoCapture {
  async start(options = {}) {
    try {
      const { fps = 1, width = 1280, height = 720, quality = 0.7 } = options;
      this.fps = fps; this.quality = quality;
      this.mediaStream = await navigator.mediaDevices.getDisplayMedia({
        video: { width: { ideal: width }, height: { ideal: height } },
        audio: false
      });
      this.initializeElements(width, height);
      await this.waitForVideoReady();
      this.isStreaming = true;
      this.startCapturing();
      this.mediaStream.getVideoTracks()[0].onended = () => this.stop();
      return this.video;
    } catch (e) { throw e; }
  }
}

/**
 * Audio Player
 */
class AudioPlayer {
  constructor() {
    this.audioContext = null; this.workletNode = null; this.gainNode = null;
    this.isInitialized = false; this.volume = 1.0; this.sampleRate = 24000;
  }
  async init() {
    if (this.isInitialized) return;
    try {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: this.sampleRate });
      await this.audioContext.audioWorklet.addModule("/static/audio-processors/playback.worklet.js");
      this.workletNode = new AudioWorkletNode(this.audioContext, "pcm-processor");
      this.gainNode = this.audioContext.createGain();
      this.gainNode.gain.value = this.volume;
      this.workletNode.connect(this.gainNode);
      this.gainNode.connect(this.audioContext.destination);
      this.isInitialized = true;
    } catch (e) { throw e; }
  }
  async play(base64Audio) {
    if (!this.isInitialized) await this.init();
    try {
      if (this.audioContext.state === "suspended") await this.audioContext.resume();
      const binaryString = atob(base64Audio);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
      const inputArray = new Int16Array(bytes.buffer);
      const float32Data = new Float32Array(inputArray.length);
      for (let i = 0; i < inputArray.length; i++) float32Data[i] = inputArray[i] / 32768;
      
      // Update visualizer if it exists
      if (window.updateVisualizer) {
          window.updateVisualizer(float32Data);
          // Reset visualizer after chunk duration (approx)
          setTimeout(() => window.updateVisualizer([]), 100);
      }
      
      this.workletNode.port.postMessage(float32Data);
    } catch (e) { throw e; }
  }
  interrupt() { if (this.workletNode) this.workletNode.port.postMessage("interrupt"); }
  setVolume(v) { this.volume = Math.max(0, Math.min(1, v)); if (this.gainNode) this.gainNode.gain.value = this.volume; }
}