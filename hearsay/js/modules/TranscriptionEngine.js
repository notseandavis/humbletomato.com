/**
 * TranscriptionEngine - Hybrid transcription
 * - Mobile/Safari: Web Speech API (native, zero download)
 * - Desktop: Transformers.js Whisper (client-side WASM)
 * Falls back gracefully between the two.
 */

export class TranscriptionEngine {
    constructor() {
        this._enabled = true;
        this.pipeline = null;
        this.isModelLoaded = false;
        this.isLoading = false;
        this.modelId = 'onnx-community/whisper-base.en';
        this.onProgress = null;
        this.mode = null; // 'webspeech' or 'whisper'
        this.recognition = null;
        this._pendingResolves = [];
        this._lastTranscript = '';
        this._segmentBuffer = [];
    }

    isEnabled() {
        return this._enabled;
    }

    setEnabled(enabled) {
        this._enabled = enabled;
    }

    reset() {
        this._lastTranscript = '';
        this._segmentBuffer = [];
    }

    /**
     * Detect best available transcription mode
     */
    detectMode() {
        if (this.mode) return this.mode;

        const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
        const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
        const hasWebSpeech = 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;

        if (isMobile || isSafari) {
            if (hasWebSpeech) {
                this.mode = 'webspeech';
                console.log('🎤 Using Web Speech API (native, mobile/Safari)');
            } else {
                this.mode = 'whisper';
                console.log('🎤 Web Speech API not available, falling back to Whisper');
            }
        } else {
            // Desktop Chrome/Firefox/Edge: try Whisper first
            this.mode = 'whisper';
            console.log('🎤 Using Whisper (desktop WASM)');
        }

        return this.mode;
    }

    async loadModel(modelSize = 'base.en') {
        const mode = this.detectMode();

        if (mode === 'webspeech') {
            this.initWebSpeech();
            this.isModelLoaded = true;
            return;
        }

        // Whisper path
        if (this.isModelLoaded || this.isLoading) return;
        this.isLoading = true;

        const modelMap = {
            'tiny.en': 'onnx-community/whisper-tiny.en',
            'base.en': 'onnx-community/whisper-base.en',
            'tiny': 'onnx-community/whisper-tiny',
            'base': 'onnx-community/whisper-base',
            'small': 'onnx-community/whisper-small',
        };

        this.modelId = modelMap[modelSize] || modelMap['base.en'];
        console.log(`📦 Loading Whisper model: ${this.modelId}`);

        try {
            const { pipeline } = await import(
                'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3'
            );

            this.pipeline = await pipeline(
                'automatic-speech-recognition',
                this.modelId,
                {
                    dtype: 'q8',
                    device: 'wasm',
                    progress_callback: (progress) => {
                        if (progress.status === 'progress') {
                            const pct = Math.round((progress.loaded / progress.total) * 100);
                            console.log(`📦 Loading ${progress.file}: ${pct}%`);
                            if (this.onProgress) {
                                this.onProgress({ loaded: progress.loaded, total: progress.total, percent: pct, file: progress.file });
                            }
                        }
                    }
                }
            );

            this.isModelLoaded = true;
            this.isLoading = false;
            console.log('✅ Whisper model loaded');
        } catch (error) {
            this.isLoading = false;
            console.error('❌ Whisper load failed, falling back to Web Speech API:', error);

            // Fallback to Web Speech API
            const hasWebSpeech = 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;
            if (hasWebSpeech) {
                this.mode = 'webspeech';
                this.initWebSpeech();
                this.isModelLoaded = true;
            } else {
                throw error;
            }
        }
    }

    /**
     * Web Speech API initialization
     */
    initWebSpeech() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            throw new Error('Web Speech API not supported');
        }

        this.recognition = new SpeechRecognition();
        this.recognition.continuous = true;
        this.recognition.interimResults = true;
        this.recognition.lang = 'en-US';
        this.recognition.maxAlternatives = 1;

        this.recognition.onresult = (event) => {
            for (let i = event.resultIndex; i < event.results.length; i++) {
                const result = event.results[i];
                if (result.isFinal) {
                    const text = result[0].transcript.trim();
                    const confidence = result[0].confidence;

                    if (text && text.length > 1) {
                        const segment = {
                            id: crypto.randomUUID(),
                            startTime: (Date.now() - this._recordingStartTime) / 1000,
                            endTime: (Date.now() - this._recordingStartTime) / 1000 + 1,
                            duration: 1,
                            text: text,
                            confidence: confidence || 0.85,
                            isPartial: false,
                            translatedText: null,
                            speakerId: null
                        };
                        this._segmentBuffer.push(segment);
                        console.log(`📝 Web Speech: "${text}" (${(confidence * 100).toFixed(0)}%)`);
                    }
                }
            }
        };

        this.recognition.onerror = (event) => {
            if (event.error === 'no-speech') return; // Normal, ignore
            console.warn('🎤 Web Speech error:', event.error);
            // Auto-restart on recoverable errors
            if (event.error === 'network' || event.error === 'aborted') {
                setTimeout(() => {
                    if (this._listening) {
                        try { this.recognition.start(); } catch(e) {}
                    }
                }, 500);
            }
        };

        this.recognition.onend = () => {
            // Auto-restart if still supposed to be listening
            if (this._listening) {
                try { this.recognition.start(); } catch(e) {}
            }
        };

        this._listening = false;
        this._recordingStartTime = null;
        console.log('✅ Web Speech API initialized');
    }

    /**
     * Start continuous listening (Web Speech mode)
     */
    startListening() {
        if (this.mode !== 'webspeech' || !this.recognition) return;
        this._listening = true;
        this._recordingStartTime = Date.now();
        this._segmentBuffer = [];
        try {
            this.recognition.start();
            console.log('🎤 Web Speech listening started');
        } catch(e) {
            console.warn('🎤 Recognition start error:', e);
        }
    }

    /**
     * Stop continuous listening (Web Speech mode)
     */
    stopListening() {
        if (this.mode !== 'webspeech' || !this.recognition) return;
        this._listening = false;
        try {
            this.recognition.stop();
        } catch(e) {}
        console.log('🎤 Web Speech listening stopped');
    }

    /**
     * Transcribe audio chunk
     * - Web Speech mode: returns buffered segments (recognition runs continuously)
     * - Whisper mode: processes the audio data directly
     */
    async transcribe(audioData, timestamp) {
        if (!this._enabled) return null;

        if (!this.isModelLoaded) {
            await this.loadModel();
        }

        if (this.mode === 'webspeech') {
            // Return any buffered segments from the continuous recognizer
            if (this._segmentBuffer.length > 0) {
                const segment = this._segmentBuffer.shift();
                return segment;
            }
            return null;
        }

        // Whisper path
        return await this.whisperTranscribe(audioData, timestamp);
    }

    async whisperTranscribe(audioData, timestamp) {
        if (!this.pipeline) return null;

        try {
            const startProcess = Date.now();
            const duration = audioData.length / 16000;

            const level = this.calculateAudioLevel(audioData);
            if (level < 0.01) return null;

            const result = await this.pipeline(audioData, {
                language: 'english',
                task: 'transcribe',
                chunk_length_s: 30,
                stride_length_s: 5,
                return_timestamps: false,
            });

            const processingTime = Date.now() - startProcess;
            const realtimeFactor = (processingTime / 1000) / duration;
            const text = result.text.trim();

            if (!text || text === '.' || text === '...' || text.length < 2) return null;

            const hallucinations = [
                'thank you', 'thanks for watching', 'subscribe',
                'you', 'bye', 'the end', 'silence', '♪', '🎵',
            ];
            if (hallucinations.some(h => text.toLowerCase().replace(/[.!?,]/g, '') === h)) {
                console.log(`🔇 Filtered: "${text}"`);
                return null;
            }

            console.log(`✅ Whisper (${realtimeFactor.toFixed(1)}x RT): "${text}"`);

            return {
                id: crypto.randomUUID(),
                startTime: timestamp,
                endTime: timestamp + duration,
                duration: duration,
                text: text,
                confidence: 0.9,
                isPartial: false,
                translatedText: null,
                speakerId: null
            };
        } catch (error) {
            console.error('Transcription error:', error);
            return null;
        }
    }

    calculateAudioLevel(audioData) {
        let sum = 0;
        for (let i = 0; i < audioData.length; i++) {
            sum += audioData[i] * audioData[i];
        }
        return Math.sqrt(sum / audioData.length);
    }

    async unloadModel() {
        if (this.recognition) {
            this.stopListening();
            this.recognition = null;
        }
        if (this.pipeline) {
            this.pipeline = null;
        }
        this.isModelLoaded = false;
        this.isLoading = false;
        this.mode = null;
        console.log('🗑️ Model unloaded');
    }
}

export default TranscriptionEngine;
