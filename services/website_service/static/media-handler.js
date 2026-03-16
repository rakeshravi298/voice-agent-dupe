/**
 * MediaHandler: Manages Audio/Video capture and playback for the SDK Bridge
 */
class MediaHandler {
    constructor() {
        this.audioContext = null;
        this.mediaStream = null;
        this.audioWorkletNode = null;
        this.videoStream = null;
        this.videoInterval = null;
        this.nextStartTime = 0;
        this.scheduledSources = [];
        this.isRecording = false;
        this.videoCanvas = document.createElement("canvas");
        this.canvasCtx = this.videoCanvas.getContext("2d");
    }

    async initializeAudio() {
        if (!this.audioContext) {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            // Official path from server mount
            await this.audioContext.audioWorklet.addModule("/static/pcm-processor.js");
        }
        if (this.audioContext.state === "suspended") {
            await this.audioContext.resume();
        }
    }

    async startAudio(onAudioData) {
        await this.initializeAudio();
        try {
            this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const source = this.audioContext.createMediaStreamSource(this.mediaStream);
            this.audioWorkletNode = new AudioWorkletNode(this.audioContext, "pcm-processor");

            this.audioWorkletNode.port.onmessage = (event) => {
                if (this.isRecording) {
                    const downsampled = this.downsampleBuffer(event.data, this.audioContext.sampleRate, 16000);
                    const pcm16 = this.convertFloat32ToInt16(downsampled);
                    onAudioData(pcm16);
                }
            };
            
            source.connect(this.audioWorkletNode);
            
            // Connect to destination via mute gain to ensure the worklet 'process' loop runs
            const muteGain = this.audioContext.createGain();
            muteGain.gain.value = 0;
            this.audioWorkletNode.connect(muteGain);
            muteGain.connect(this.audioContext.destination);

            this.isRecording = true;
        } catch (e) {
            console.error("Error starting audio:", e);
            throw e;
        }
    }

    stopAudio() {
        this.isRecording = false;
        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach((t) => t.stop());
            this.mediaStream = null;
        }
        if (this.audioWorkletNode) {
            this.audioWorkletNode.disconnect();
            this.audioWorkletNode = null;
        }
    }

    async startVideo(videoElement, onFrame) {
        try {
            this.videoStream = await navigator.mediaDevices.getUserMedia({ video: true });
            if (videoElement) videoElement.srcObject = this.videoStream;
            this.videoInterval = setInterval(() => {
                this.captureFrame(videoElement, onFrame);
            }, 1000); 
        } catch (e) {
            console.error("Error starting video:", e);
            throw e;
        }
    }

    stopVideo(videoElement) {
        if (this.videoStream) {
            this.videoStream.getTracks().forEach((t) => t.stop());
            this.videoStream = null;
        }
        if (this.videoInterval) {
            clearInterval(this.videoInterval);
            this.videoInterval = null;
        }
        if (videoElement) videoElement.srcObject = null;
    }

    captureFrame(videoElement, onFrame) {
        if (!this.videoStream || !videoElement) return;
        this.videoCanvas.width = 640;
        this.videoCanvas.height = 480;
        this.canvasCtx.drawImage(videoElement, 0, 0, 640, 480);
        const base64 = this.videoCanvas.toDataURL("image/jpeg", 0.7).split(",")[1];
        onFrame(base64);
    }

    playAudio(arrayBuffer) {
        if (!this.audioContext) return;
        const pcmData = new Int16Array(arrayBuffer);
        const float32Data = new Float32Array(pcmData.length);
        for (let i = 0; i < pcmData.length; i++) {
            float32Data[i] = pcmData[i] / 32768.0;
        }

        const buffer = this.audioContext.createBuffer(1, float32Data.length, 24000);
        buffer.getChannelData(0).set(float32Data);

        const source = this.audioContext.createBufferSource();
        source.buffer = buffer;
        source.connect(this.audioContext.destination);

        const now = this.audioContext.currentTime;
        this.nextStartTime = Math.max(now, this.nextStartTime);
        source.start(this.nextStartTime);
        this.nextStartTime += buffer.duration;
        this.scheduledSources.push(source);
    }

    stopAudioPlayback() {
        this.scheduledSources.forEach((s) => { try { s.stop(); } catch (e) {} });
        this.scheduledSources = [];
    }

    downsampleBuffer(buffer, sampleRate, outSampleRate) {
        if (outSampleRate === sampleRate) return buffer;
        const ratio = sampleRate / outSampleRate;
        const newLength = Math.round(buffer.length / ratio);
        const result = new Float32Array(newLength);
        let or = 0, ob = 0;
        while (or < result.length) {
            const n = Math.round((or + 1) * ratio);
            let a = 0, c = 0;
            for (let i = ob; i < n && i < buffer.length; i++) { a += buffer[i]; c++; }
            result[or] = a / c; or++; ob = n;
        }
        return result;
    }

    convertFloat32ToInt16(buffer) {
        let l = buffer.length;
        const buf = new Int16Array(l);
        while (l--) buf[l] = Math.min(1, Math.max(-1, buffer[l])) * 0x7fff;
        return buf.buffer;
    }
}
