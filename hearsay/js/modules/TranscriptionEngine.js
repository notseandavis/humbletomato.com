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
        this.modelId = 'onnx-community/whisper-small.en';
        this.onProgress = null;
        this.mode = null; // 'webspeech' or 'whisper'
        this.recognition = null;
        this._pendingResolves = [];
        this._lastTranscript = '';
        this._segmentBuffer = [];
        
        // Adaptive threshold tracking
        this.ambientNoiseLevel = 0.002;
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

    async loadModel(modelSize = 'small.en') {
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
            'small.en': 'onnx-community/whisper-small.en',
            'tiny': 'onnx-community/whisper-tiny',
            'base': 'onnx-community/whisper-base',
            'small': 'onnx-community/whisper-small',
        };

        this.modelId = modelMap[modelSize] || modelMap['small.en'];
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
     * Spectral noise reduction via frequency-domain noise profiling.
     * Learns which frequency bins have persistent energy (fans, HVAC, hum)
     * and surgically suppresses them while preserving speech frequencies.
     */
    applyNoiseGate(audioData, sampleRate = 16000) {
        const fftSize = 512;
        const hopSize = fftSize / 2;
        const numFrames = Math.floor((audioData.length - fftSize) / hopSize) + 1;
        if (numFrames < 1) return audioData;

        // Hanning window
        const window = new Float32Array(fftSize);
        for (let i = 0; i < fftSize; i++) {
            window[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (fftSize - 1)));
        }

        const halfFFT = fftSize / 2 + 1;

        // Compute magnitude spectrogram for this chunk
        const magnitudes = [];
        const phases = [];
        for (let f = 0; f < numFrames; f++) {
            const offset = f * hopSize;
            const real = new Float32Array(fftSize);
            const imag = new Float32Array(fftSize);
            for (let i = 0; i < fftSize; i++) {
                real[i] = (audioData[offset + i] || 0) * window[i];
                imag[i] = 0;
            }
            this._fftInPlace(real, imag);
            const mag = new Float32Array(halfFFT);
            const phase = new Float32Array(halfFFT);
            for (let i = 0; i < halfFFT; i++) {
                mag[i] = Math.sqrt(real[i] * real[i] + imag[i] * imag[i]);
                phase[i] = Math.atan2(imag[i], real[i]);
            }
            magnitudes.push(mag);
            phases.push(phase);
        }

        // Update the running noise profile (EMA of magnitude per bin)
        // Bins with consistently high energy relative to their variance = noise
        if (!this._noiseProfile) {
            // First chunk: initialize noise profile from this audio
            this._noiseProfile = new Float32Array(halfFFT);
            this._noiseVariance = new Float32Array(halfFFT);
            this._noiseFrameCount = 0;
        }

        // Compute mean magnitude per bin for this chunk
        const chunkMean = new Float32Array(halfFFT);
        for (let i = 0; i < halfFFT; i++) {
            let sum = 0;
            for (let f = 0; f < numFrames; f++) sum += magnitudes[f][i];
            chunkMean[i] = sum / numFrames;
        }

        // Compute variance per bin for this chunk (low variance = steady noise)
        const chunkVar = new Float32Array(halfFFT);
        for (let i = 0; i < halfFFT; i++) {
            let sum = 0;
            for (let f = 0; f < numFrames; f++) {
                const diff = magnitudes[f][i] - chunkMean[i];
                sum += diff * diff;
            }
            chunkVar[i] = sum / numFrames;
        }

        // Update noise profile with EMA
        const alpha = this._noiseFrameCount < 5 ? 0.5 : 0.1; // Learn fast initially
        for (let i = 0; i < halfFFT; i++) {
            this._noiseProfile[i] = this._noiseProfile[i] * (1 - alpha) + chunkMean[i] * alpha;
            this._noiseVariance[i] = this._noiseVariance[i] * (1 - alpha) + chunkVar[i] * alpha;
        }
        this._noiseFrameCount++;

        // Determine which bins are "stationary noise" vs speech
        // Low coefficient of variation (CV = stddev/mean) = steady = noise
        const suppressionGain = new Float32Array(halfFFT);
        for (let i = 0; i < halfFFT; i++) {
            const mean = this._noiseProfile[i];
            const stddev = Math.sqrt(this._noiseVariance[i]);
            if (mean < 1e-8) {
                suppressionGain[i] = 1.0; // Nothing there, leave it
                continue;
            }
            const cv = stddev / mean; // Coefficient of variation

            // cv < 0.3 = very steady (fan/HVAC), suppress aggressively
            // cv 0.3-0.8 = somewhat steady, moderate suppression
            // cv > 0.8 = dynamic (speech), don't suppress
            if (cv < 0.3) {
                suppressionGain[i] = 0.05; // Kill it (95% reduction)
            } else if (cv < 0.8) {
                // Smooth transition
                const t = (cv - 0.3) / 0.5; // 0..1
                suppressionGain[i] = 0.05 + t * 0.95;
            } else {
                suppressionGain[i] = 1.0; // Leave speech alone
            }
        }

        // Apply spectral subtraction and reconstruct via overlap-add
        const output = new Float32Array(audioData.length);
        const windowSum = new Float32Array(audioData.length);

        for (let f = 0; f < numFrames; f++) {
            const offset = f * hopSize;
            // Apply suppression in frequency domain
            const real = new Float32Array(fftSize);
            const imag = new Float32Array(fftSize);
            for (let i = 0; i < halfFFT; i++) {
                const newMag = magnitudes[f][i] * suppressionGain[i];
                real[i] = newMag * Math.cos(phases[f][i]);
                imag[i] = newMag * Math.sin(phases[f][i]);
            }
            // Mirror for inverse FFT
            for (let i = halfFFT; i < fftSize; i++) {
                real[i] = real[fftSize - i];
                imag[i] = -imag[fftSize - i];
            }
            // Inverse FFT
            this._ifftInPlace(real, imag);
            // Overlap-add with window
            for (let i = 0; i < fftSize; i++) {
                if (offset + i < output.length) {
                    output[offset + i] += real[i] * window[i];
                    windowSum[offset + i] += window[i] * window[i];
                }
            }
        }

        // Normalize by window sum
        const result = new Float32Array(audioData.length);
        for (let i = 0; i < audioData.length; i++) {
            result[i] = windowSum[i] > 1e-8 ? output[i] / windowSum[i] : audioData[i];
        }

        return result;
    }

    /** Radix-2 in-place FFT */
    _fftInPlace(real, imag) {
        const n = real.length;
        // Bit-reversal permutation
        for (let i = 1, j = 0; i < n; i++) {
            let bit = n >> 1;
            for (; j & bit; bit >>= 1) j ^= bit;
            j ^= bit;
            if (i < j) {
                [real[i], real[j]] = [real[j], real[i]];
                [imag[i], imag[j]] = [imag[j], imag[i]];
            }
        }
        // FFT butterflies
        for (let len = 2; len <= n; len <<= 1) {
            const halfLen = len >> 1;
            const angle = -2 * Math.PI / len;
            const wR = Math.cos(angle), wI = Math.sin(angle);
            for (let i = 0; i < n; i += len) {
                let curR = 1, curI = 0;
                for (let j = 0; j < halfLen; j++) {
                    const tR = curR * real[i + j + halfLen] - curI * imag[i + j + halfLen];
                    const tI = curR * imag[i + j + halfLen] + curI * real[i + j + halfLen];
                    real[i + j + halfLen] = real[i + j] - tR;
                    imag[i + j + halfLen] = imag[i + j] - tI;
                    real[i + j] += tR;
                    imag[i + j] += tI;
                    const newR = curR * wR - curI * wI;
                    curI = curR * wI + curI * wR;
                    curR = newR;
                }
            }
        }
    }

    /** Inverse FFT via conjugate trick */
    _ifftInPlace(real, imag) {
        const n = real.length;
        for (let i = 0; i < n; i++) imag[i] = -imag[i];
        this._fftInPlace(real, imag);
        for (let i = 0; i < n; i++) {
            real[i] /= n;
            imag[i] = -imag[i] / n;
        }
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
            this.ambientNoiseLevel = Math.max(0.001, Math.min(0.03, median * 2));
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
