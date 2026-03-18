/**
 * TranscriptionEngine - Hybrid transcription with advanced audio processing
 * - Mobile/Safari: Web Speech API (native, zero download)
 * - Desktop: Transformers.js Whisper (client-side WASM)
 * - Audio pre-processing: high-pass filter, normalization, noise gate
 * - Adaptive silence threshold based on ambient noise
 * - Overlapping chunks with deduplication
 * - Enhanced hallucination filtering
 * - Confidence estimation and retry logic
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
        
        // Adaptive threshold tracking
        this.ambientNoiseLevel = 0.01;
        this.noiseSamples = [];
        this.maxNoiseSamples = 50;
        
        // Chunk overlap tracking
        this.lastChunkAudio = null;
        this.lastChunkText = '';
        this.overlapDuration = 1.0; // seconds
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
        this.lastChunkAudio = null;
        this.lastChunkText = '';
        this.noiseSamples = [];
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

    /**
     * High-pass filter to remove low-frequency rumble/HVAC
     * Simple first-order IIR filter at 80Hz
     */
    applyHighPassFilter(audioData, sampleRate = 16000, cutoffFreq = 80) {
        const RC = 1.0 / (2 * Math.PI * cutoffFreq);
        const dt = 1.0 / sampleRate;
        const alpha = RC / (RC + dt);
        
        const filtered = new Float32Array(audioData.length);
        filtered[0] = audioData[0];
        
        for (let i = 1; i < audioData.length; i++) {
            filtered[i] = alpha * (filtered[i - 1] + audioData[i] - audioData[i - 1]);
        }
        
        return filtered;
    }

    /**
     * Normalize audio to peak amplitude
     */
    normalizeAudio(audioData) {
        let maxAbs = 0;
        for (let i = 0; i < audioData.length; i++) {
            const abs = Math.abs(audioData[i]);
            if (abs > maxAbs) maxAbs = abs;
        }
        
        if (maxAbs < 0.001) return audioData; // Too quiet, skip normalization
        
        const normalized = new Float32Array(audioData.length);
        const scale = 0.95 / maxAbs; // Normalize to 95% to avoid clipping
        
        for (let i = 0; i < audioData.length; i++) {
            normalized[i] = audioData[i] * scale;
        }
        
        return normalized;
    }

    /**
     * Spectral noise gate: estimate noise floor from first 0.5s, subtract it
     */
    applyNoiseGate(audioData, sampleRate = 16000) {
        const noiseSampleLength = Math.min(Math.floor(sampleRate * 0.5), audioData.length);
        
        // Estimate noise floor from first 0.5s
        let noiseFloorSum = 0;
        for (let i = 0; i < noiseSampleLength; i++) {
            noiseFloorSum += Math.abs(audioData[i]);
        }
        const noiseFloor = noiseFloorSum / noiseSampleLength;
        
        // Apply gate with smooth transition
        const gateThreshold = noiseFloor * 2.0;
        const gated = new Float32Array(audioData.length);
        
        for (let i = 0; i < audioData.length; i++) {
            const abs = Math.abs(audioData[i]);
            if (abs > gateThreshold) {
                gated[i] = audioData[i];
            } else {
                // Soft gate (reduce but don't eliminate)
                const ratio = abs / gateThreshold;
                gated[i] = audioData[i] * ratio * 0.5;
            }
        }
        
        return gated;
    }

    /**
     * Update adaptive silence threshold based on ambient noise
     */
    updateAdaptiveThreshold(level) {
        this.noiseSamples.push(level);
        
        // Keep only recent samples
        if (this.noiseSamples.length > this.maxNoiseSamples) {
            this.noiseSamples.shift();
        }
        
        // Calculate median noise level (more robust than mean)
        if (this.noiseSamples.length >= 10) {
            const sorted = [...this.noiseSamples].sort((a, b) => a - b);
            const median = sorted[Math.floor(sorted.length / 2)];
            
            // Adaptive threshold is 3x the median noise level
            this.ambientNoiseLevel = Math.max(0.005, Math.min(0.05, median * 3));
        }
    }

    /**
     * Calculate audio level (RMS)
     */
    calculateAudioLevel(audioData) {
        let sum = 0;
        for (let i = 0; i < audioData.length; i++) {
            sum += audioData[i] * audioData[i];
        }
        return Math.sqrt(sum / audioData.length);
    }

    /**
     * Deduplicate overlapping transcription segments
     * Compares new text with previous to remove partial repeats at boundaries
     */
    deduplicateOverlap(newText, prevText) {
        if (!prevText || prevText.length < 5) return newText;
        
        // Try to find overlap by comparing end of previous with start of new
        const wordsNew = newText.split(/\s+/);
        const wordsPrev = prevText.split(/\s+/);
        
        // Look for longest matching sequence at boundary
        let bestOverlap = 0;
        const maxCheck = Math.min(10, wordsPrev.length, wordsNew.length);
        
        for (let overlap = 1; overlap <= maxCheck; overlap++) {
            const prevEnd = wordsPrev.slice(-overlap).join(' ').toLowerCase();
            const newStart = wordsNew.slice(0, overlap).join(' ').toLowerCase();
            
            if (prevEnd === newStart) {
                bestOverlap = overlap;
            }
        }
        
        // Remove overlapping words from new text
        if (bestOverlap > 0) {
            const deduplicated = wordsNew.slice(bestOverlap).join(' ');
            console.log(`🔄 Dedup: removed ${bestOverlap} overlapping words`);
            return deduplicated;
        }
        
        return newText;
    }

    /**
     * Enhanced hallucination filter
     */
    isHallucination(text) {
        const cleaned = text.toLowerCase().replace(/[.!?,;:\-()]/g, '').trim();
        
        // Common Whisper hallucinations
        const hallucinations = [
            // Generic filler
            'thank you', 'thanks for watching', 'subscribe', 'like and subscribe',
            'you', 'bye', 'the end', 'silence', 'music', 'applause',
            
            // Music/audio tags
            '♪', '🎵', 'music playing', 'background music', '[music]', '(music)',
            
            // Foreign greetings that appear in silence
            'amara', 'amara org', 'sous titres', 'subtitles', 'subtítulos',
            'merci', 'gracias', 'danke', 'grazie',
            
            // Repeated phrases
            'mmm', 'uh huh', 'mm hmm', 'um', 'uh',
            
            // Timestamps and markers
            '00', '000', '0000', 'beep', 'beeping',
            
            // Empty content
            '', ' ', '.', '...', '..', '....', 
        ];
        
        // Exact match
        if (hallucinations.includes(cleaned)) {
            return true;
        }
        
        // Repeated character patterns (e.g., "aaaaaa", ".........")
        if (/^(.)\1{4,}$/.test(cleaned)) {
            return true;
        }
        
        // Very short fragments
        if (cleaned.length < 2 && cleaned !== 'a' && cleaned !== 'i') {
            return true;
        }
        
        // All non-alphanumeric
        if (!/[a-z0-9]/i.test(cleaned)) {
            return true;
        }
        
        return false;
    }

    /**
     * Estimate confidence based on heuristics
     * - Text length vs audio duration (too short = suspicious)
     * - Presence of multiple words (single words = lower confidence)
     * - Consistent speaking rate
     */
    estimateConfidence(text, audioDuration) {
        let confidence = 0.9; // Base confidence
        
        const words = text.trim().split(/\s+/);
        const wordCount = words.length;
        
        // Typical speaking rate: 2-3 words per second
        const expectedWords = audioDuration * 2.5;
        const wordRatio = wordCount / expectedWords;
        
        // Penalize if too few words (possible hallucination)
        if (wordRatio < 0.3) {
            confidence *= 0.7;
        }
        
        // Penalize single-word responses
        if (wordCount === 1) {
            confidence *= 0.6;
        }
        
        // Penalize very short text
        if (text.length < 5) {
            confidence *= 0.5;
        }
        
        // Boost confidence for longer, coherent text
        if (wordCount >= 5 && wordRatio > 0.5 && wordRatio < 5) {
            confidence = Math.min(0.95, confidence * 1.1);
        }
        
        return Math.max(0.3, Math.min(0.95, confidence));
    }

    async whisperTranscribe(audioData, timestamp) {
        if (!this.pipeline) return null;

        try {
            const startProcess = Date.now();
            const duration = audioData.length / 16000;

            // Pre-process audio
            let processed = audioData;
            processed = this.applyHighPassFilter(processed);
            processed = this.applyNoiseGate(processed);
            processed = this.normalizeAudio(processed);

            // Calculate level after processing for adaptive threshold
            const level = this.calculateAudioLevel(processed);
            this.updateAdaptiveThreshold(level);
            
            // Check against adaptive threshold
            if (level < this.ambientNoiseLevel) {
                console.log(`🔇 Silence: level ${level.toFixed(4)} < threshold ${this.ambientNoiseLevel.toFixed(4)}`);
                return null;
            }

            // First attempt with standard parameters
            let result = await this.runWhisperPipeline(processed, false);
            let text = result.text.trim();
            
            // If result is empty or hallucination, retry with different params
            if (!text || this.isHallucination(text)) {
                console.log(`🔄 Retry: first pass failed ("${text}"), trying with longer chunk`);
                result = await this.runWhisperPipeline(processed, true);
                text = result.text.trim();
            }

            const processingTime = Date.now() - startProcess;
            const realtimeFactor = (processingTime / 1000) / duration;

            // Final validation
            if (!text || this.isHallucination(text)) {
                console.log(`🔇 Filtered: "${text}"`);
                return null;
            }

            // Deduplicate with previous chunk
            const dedupText = this.deduplicateOverlap(text, this.lastChunkText);
            if (!dedupText || dedupText.trim().length === 0) {
                console.log(`🔇 Deduplication removed all text`);
                return null;
            }

            // Estimate confidence
            const confidence = this.estimateConfidence(dedupText, duration);

            console.log(`✅ Whisper (${realtimeFactor.toFixed(1)}x RT, conf: ${(confidence * 100).toFixed(0)}%): "${dedupText}"`);

            // Update state for next chunk
            this.lastChunkText = text;

            return {
                id: crypto.randomUUID(),
                startTime: timestamp,
                endTime: timestamp + duration,
                duration: duration,
                text: dedupText,
                confidence: confidence,
                isPartial: false,
                translatedText: null,
                speakerId: null
            };
        } catch (error) {
            console.error('Transcription error:', error);
            return null;
        }
    }

    /**
     * Run Whisper pipeline with specified parameters
     */
    async runWhisperPipeline(audioData, useAlternateParams) {
        // English-only models (.en) don't accept language/task params
        const isEnglishOnly = this.modelId.endsWith('.en');
        
        const pipelineOptions = {
            chunk_length_s: useAlternateParams ? 15 : 30,
            stride_length_s: useAlternateParams ? 3 : 5,
            return_timestamps: false,
        };
        
        if (!isEnglishOnly) {
            pipelineOptions.language = 'english';
            pipelineOptions.task = 'transcribe';
        }
        
        return await this.pipeline(audioData, pipelineOptions);
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
