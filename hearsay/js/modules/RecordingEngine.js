/**
 * RecordingEngine - Web Audio API based recording with real-time processing
 * Equivalent to iOS RecordingEngine.swift
 */

// Test mode: ?fakemic in URL creates a synthetic audio stream (440Hz tone)
// so the app can be tested without a real microphone.
const FAKE_MIC = new URLSearchParams(window.location.search).has('fakemic');
if (FAKE_MIC) console.log('[FAKE MIC] Test mode enabled via ?fakemic');

async function createFakeStream() {
    const ctx = new AudioContext({ sampleRate: 48000 });
    const dest = ctx.createMediaStreamDestination();

    // Try loading test-speech.wav for realistic audio, fall back to 440Hz tone
    try {
        const response = await fetch('test-speech.wav');
        if (response.ok) {
            const arrayBuffer = await response.arrayBuffer();
            const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
            const source = ctx.createBufferSource();
            source.buffer = audioBuffer;
            source.loop = true; // Loop the speech for continuous testing
            source.connect(dest);
            source.start();
            console.log('[FAKE MIC] Using test-speech.wav (' + audioBuffer.duration.toFixed(1) + 's, looping)');
            dest._keepAlive = { ctx, source };
            return dest.stream;
        }
    } catch (e) {
        console.log('[FAKE MIC] Could not load test-speech.wav, using 440Hz tone:', e.message);
    }

    // Fallback: 440Hz tone
    const osc = ctx.createOscillator();
    osc.frequency.value = 440;
    const gain = ctx.createGain();
    gain.gain.value = 0.3;
    osc.connect(gain);
    gain.connect(dest);
    osc.start();
    console.log('[FAKE MIC] Using 440Hz tone (no test-speech.wav found)');
    dest._keepAlive = { ctx, osc, gain };
    return dest.stream;
}

export class RecordingEngine {
    constructor(callbacks = {}) {
        this.callbacks = callbacks;
        this.audioContext = null;
        this.mediaStream = null;
        this.mediaRecorder = null;
        this.sourceNode = null;
        this.analyserNode = null;
        this.processorNode = null;
        
        this.isRecording = false;
        this.audioChunks = [];
        this.startTime = null;
        this.recordingDuration = 0;
        this.animationFrame = null;
        
        // Audio buffer for real-time transcription
        this.audioBuffer = [];
        this.chunkSize = 16000 * 3; // 3 seconds at 16kHz
        this.chunkId = 0;
        
        // Audio level for visualization
        this.audioLevel = 0;
    }

    async requestPermission() {
        if (FAKE_MIC) {
            console.log('[FAKE MIC] Skipping permission (test mode)');
            return true;
        }
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                } 
            });
            stream.getTracks().forEach(track => track.stop());
            return true;
        } catch (error) {
            throw new Error('Microphone permission denied');
        }
    }

    async startRecording() {
        if (this.isRecording) {
            console.warn('Already recording');
            return;
        }

        try {
            // Create audio context
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
                sampleRate: 48000 // High quality, will be downsampled for Whisper
            });

            // Get microphone stream (or fake stream in test mode)
            if (FAKE_MIC) {
                this.mediaStream = await createFakeStream();
            } else {
                this.mediaStream = await navigator.mediaDevices.getUserMedia({
                    audio: {
                        echoCancellation: true,
                        noiseSuppression: true,
                        autoGainControl: true,
                        sampleRate: 48000
                    }
                });
            }

            // Create source node
            this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);

            // Create gain node for boosting quiet audio
            this.gainNode = this.audioContext.createGain();
            this.gainNode.gain.value = 1.0; // Start at unity, auto-adjust below
            this.targetGain = 1.0;
            this.sourceNode.connect(this.gainNode);

            // Create analyser for visualization
            this.analyserNode = this.audioContext.createAnalyser();
            this.analyserNode.fftSize = 256;
            this.gainNode.connect(this.analyserNode);

            // Create script processor for real-time audio data
            // Note: ScriptProcessorNode is deprecated but AudioWorklet requires separate file
            // TODO: Migrate to AudioWorklet for better performance
            const bufferSize = 4096;
            this.processorNode = this.audioContext.createScriptProcessor(bufferSize, 1, 1);
            
            this.processorNode.onaudioprocess = (e) => {
                if (!this.isRecording) return;
                
                const inputData = e.inputBuffer.getChannelData(0);
                this.autoAdjustGain(inputData);
                this.processAudioChunk(inputData);
            };

            this.gainNode.connect(this.processorNode);
            this.processorNode.connect(this.audioContext.destination);

            // Set up MediaRecorder for full audio backup
            const options = {
                mimeType: 'audio/webm;codecs=opus',
                audioBitsPerSecond: 128000
            };

            if (!MediaRecorder.isTypeSupported(options.mimeType)) {
                options.mimeType = 'audio/webm';
            }

            this.mediaRecorder = new MediaRecorder(this.mediaStream, options);
            
            this.mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) {
                    this.audioChunks.push(e.data);
                }
            };

            this.mediaRecorder.start(1000); // Collect data every second

            // Start recording
            this.isRecording = true;
            this.startTime = Date.now();
            this.audioChunks = [];
            this.audioBuffer = [];
            this.chunkId = 0;

            // Start timer update
            this.updateTimer();

            // Start audio level monitoring
            this.updateAudioLevel();

            if (this.callbacks.onRecordingStart) {
                this.callbacks.onRecordingStart();
            }

            console.log('🎙️ Recording started');
        } catch (error) {
            console.error('Failed to start recording:', error);
            throw error;
        }
    }

    autoAdjustGain(audioData) {
        // Calculate RMS level of the current buffer
        let sumSquares = 0;
        for (let i = 0; i < audioData.length; i++) {
            sumSquares += audioData[i] * audioData[i];
        }
        const rms = Math.sqrt(sumSquares / audioData.length);

        // Target RMS ~0.1 (good level for speech recognition)
        // Quiet speech is often 0.005-0.02 RMS
        const targetRMS = 0.1;
        const minGain = 1.0;   // Never reduce below unity
        const maxGain = 20.0;  // Cap to avoid blowing up noise

        if (rms > 0.001) { // Only adjust if there's actual signal (not silence)
            const desiredGain = Math.min(maxGain, Math.max(minGain, targetRMS / rms));
            // Smooth towards target (slow attack, slower release) to avoid pumping
            const smoothing = desiredGain > this.targetGain ? 0.05 : 0.02;
            this.targetGain += (desiredGain - this.targetGain) * smoothing;
        } else {
            // In silence, slowly drift back to unity
            this.targetGain += (minGain - this.targetGain) * 0.01;
        }

        // Apply smoothly to avoid clicks
        this.gainNode.gain.setTargetAtTime(this.targetGain, this.audioContext.currentTime, 0.1);
    }

    processAudioChunk(audioData) {
        // Downsample to 16kHz for Whisper compatibility
        const downsampled = this.downsample(audioData, this.audioContext.sampleRate, 16000);
        
        // Add to buffer
        this.audioBuffer.push(...downsampled);

        // When buffer reaches chunk size, send for transcription
        if (this.audioBuffer.length >= this.chunkSize) {
            const chunk = this.audioBuffer.splice(0, this.chunkSize);
            const timestamp = (Date.now() - this.startTime) / 1000;
            
            if (this.callbacks.onAudioData) {
                this.callbacks.onAudioData(
                    new Float32Array(chunk),
                    timestamp
                );
            }

            this.chunkId++;
        }
    }

    downsample(buffer, fromSampleRate, toSampleRate) {
        if (fromSampleRate === toSampleRate) {
            return Array.from(buffer);
        }

        const sampleRateRatio = fromSampleRate / toSampleRate;
        const newLength = Math.round(buffer.length / sampleRateRatio);
        const result = new Float32Array(newLength);

        let offsetResult = 0;
        let offsetBuffer = 0;

        while (offsetResult < result.length) {
            const nextOffsetBuffer = Math.round((offsetResult + 1) * sampleRateRatio);
            let accum = 0;
            let count = 0;

            for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
                accum += buffer[i];
                count++;
            }

            result[offsetResult] = accum / count;
            offsetResult++;
            offsetBuffer = nextOffsetBuffer;
        }

        return result;
    }

    updateTimer() {
        if (!this.isRecording) return;

        this.recordingDuration = (Date.now() - this.startTime) / 1000;

        // Update UI
        const minutes = Math.floor(this.recordingDuration / 60);
        const seconds = Math.floor(this.recordingDuration % 60);
        const display = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        
        const timerElement = document.querySelector('.timer-display');
        if (timerElement) {
            timerElement.textContent = display;
        }

        // Continue updating
        this.animationFrame = requestAnimationFrame(() => this.updateTimer());
    }

    updateAudioLevel() {
        if (!this.isRecording || !this.analyserNode) return;

        const dataArray = new Uint8Array(this.analyserNode.frequencyBinCount);
        this.analyserNode.getByteFrequencyData(dataArray);

        // Calculate RMS level
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
            sum += dataArray[i] * dataArray[i];
        }
        const rms = Math.sqrt(sum / dataArray.length);
        this.audioLevel = rms / 255; // Normalize to 0-1

        // Update visualizer
        this.updateVisualizer(dataArray);

        // Continue updating
        requestAnimationFrame(() => this.updateAudioLevel());
    }

    updateVisualizer(frequencyData) {
        const visualizer = document.getElementById('audio-visualizer');
        if (!visualizer) return;

        let barsContainer = visualizer.querySelector('.visualizer-bars');
        if (!barsContainer) {
            barsContainer = document.createElement('div');
            barsContainer.className = 'visualizer-bars';
            visualizer.appendChild(barsContainer);
        }

        // Create bars if they don't exist
        const barCount = 20;
        if (barsContainer.children.length !== barCount) {
            barsContainer.innerHTML = '';
            for (let i = 0; i < barCount; i++) {
                const bar = document.createElement('div');
                bar.className = 'visualizer-bar';
                barsContainer.appendChild(bar);
            }
        }

        // Update bar heights
        const bars = barsContainer.querySelectorAll('.visualizer-bar');
        const dataStep = Math.floor(frequencyData.length / barCount);
        
        bars.forEach((bar, i) => {
            const value = frequencyData[i * dataStep] / 255;
            const height = Math.max(2, value * 100); // Min 2% height
            bar.style.height = `${height}%`;
            bar.style.opacity = 0.3 + (value * 0.7);
        });

        visualizer.classList.add('active');
    }

    async stopRecording() {
        if (!this.isRecording) {
            console.warn('Not recording');
            return null;
        }

        return new Promise((resolve) => {
            this.mediaRecorder.onstop = async () => {
                const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
                
                // Clean up
                this.cleanup();

                if (this.callbacks.onRecordingStop) {
                    this.callbacks.onRecordingStop(this.recordingDuration);
                }

                console.log('✅ Recording stopped, duration:', this.recordingDuration);
                
                resolve(audioBlob);
            };

            this.mediaRecorder.stop();
        });
    }

    cleanup() {
        this.isRecording = false;

        // Cancel animation frames
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
            this.animationFrame = null;
        }

        // Disconnect audio nodes
        if (this.processorNode) {
            this.processorNode.disconnect();
            this.processorNode = null;
        }

        if (this.analyserNode) {
            this.analyserNode.disconnect();
            this.analyserNode = null;
        }

        if (this.sourceNode) {
            this.sourceNode.disconnect();
            this.sourceNode = null;
        }

        // Stop media stream
        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(track => track.stop());
            this.mediaStream = null;
        }

        // Close audio context
        if (this.audioContext && this.audioContext.state !== 'closed') {
            this.audioContext.close();
            this.audioContext = null;
        }

        // Hide visualizer
        const visualizer = document.getElementById('audio-visualizer');
        if (visualizer) {
            visualizer.classList.remove('active');
        }

        // Reset timer display
        const timerElement = document.querySelector('.timer-display');
        if (timerElement) {
            timerElement.textContent = '00:00';
        }
    }

    getAudioLevel() {
        return this.audioLevel;
    }

    getDuration() {
        return this.recordingDuration;
    }
}

export default RecordingEngine;
