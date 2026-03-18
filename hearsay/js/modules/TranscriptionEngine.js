/**
 * TranscriptionEngine - Real browser-based transcription using Transformers.js (Whisper)
 * Runs entirely client-side via ONNX/WASM. No backend needed.
 */

export class TranscriptionEngine {
    constructor() {
        this._enabled = true;
        this.pipeline = null;
        this.isModelLoaded = false;
        this.isLoading = false;
        this.modelId = 'onnx-community/whisper-tiny.en';
        // Options: 
        //   'onnx-community/whisper-tiny.en'  (~40MB, fastest, English only)
        //   'onnx-community/whisper-base.en'  (~75MB, better accuracy, English only)
        //   'onnx-community/whisper-tiny'     (~40MB, multilingual)
        //   'onnx-community/whisper-base'     (~75MB, multilingual)
        //   'onnx-community/whisper-small'    (~250MB, best quality)
        this.onProgress = null; // callback for loading progress
    }

    isEnabled() {
        return this._enabled;
    }

    setEnabled(enabled) {
        this._enabled = enabled;
    }

    reset() {
        // Reset any state for new recording
    }

    async loadModel(modelSize = 'tiny.en') {
        if (this.isModelLoaded || this.isLoading) return;
        this.isLoading = true;

        const modelMap = {
            'tiny.en': 'onnx-community/whisper-tiny.en',
            'base.en': 'onnx-community/whisper-base.en',
            'tiny': 'onnx-community/whisper-tiny',
            'base': 'onnx-community/whisper-base',
            'small': 'onnx-community/whisper-small',
        };

        this.modelId = modelMap[modelSize] || modelMap['tiny.en'];

        console.log(`📦 Loading Whisper model: ${this.modelId}`);
        
        try {
            // Dynamic import of Transformers.js from CDN
            const { pipeline } = await import(
                'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3'
            );

            this.pipeline = await pipeline(
                'automatic-speech-recognition',
                this.modelId,
                {
                    dtype: 'q8',  // quantized for speed
                    device: 'wasm',
                    progress_callback: (progress) => {
                        if (progress.status === 'progress' && this.onProgress) {
                            this.onProgress({
                                loaded: progress.loaded,
                                total: progress.total,
                                percent: Math.round((progress.loaded / progress.total) * 100),
                                file: progress.file
                            });
                        }
                        if (progress.status === 'progress') {
                            const pct = Math.round((progress.loaded / progress.total) * 100);
                            console.log(`📦 Loading ${progress.file}: ${pct}%`);
                        }
                    }
                }
            );

            this.isModelLoaded = true;
            this.isLoading = false;
            console.log('✅ Whisper model loaded successfully');
        } catch (error) {
            this.isLoading = false;
            console.error('❌ Failed to load Whisper model:', error);
            throw error;
        }
    }

    async transcribe(audioData, timestamp) {
        if (!this._enabled) return null;

        // Ensure model is loaded
        if (!this.isModelLoaded) {
            await this.loadModel();
        }

        return await this.realTranscribe(audioData, timestamp);
    }

    async realTranscribe(audioData, timestamp) {
        if (!this.pipeline) return null;

        try {
            const startProcess = Date.now();
            const duration = audioData.length / 16000;

            // Check audio level - skip silence
            const level = this.calculateAudioLevel(audioData);
            if (level < 0.01) {
                return null;
            }

            // Transformers.js pipeline accepts Float32Array directly (expects 16kHz)
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

            // Skip empty or noise-only results
            if (!text || text === '.' || text === '...' || text.length < 2) {
                return null;
            }

            // Filter common Whisper hallucinations on silence/noise
            const hallucinations = [
                'thank you', 'thanks for watching', 'subscribe',
                'you', 'bye', 'the end', 'silence',
                '♪', '🎵', '[MUSIC]', '(music)',
            ];
            if (hallucinations.some(h => text.toLowerCase().replace(/[.!?,]/g, '') === h)) {
                console.log(`🔇 Filtered hallucination: "${text}"`);
                return null;
            }

            console.log(`✅ Transcribed (${realtimeFactor.toFixed(1)}x RT): "${text}"`);

            return {
                id: crypto.randomUUID(),
                startTime: timestamp,
                endTime: timestamp + duration,
                duration: duration,
                text: text,
                confidence: 0.9, // Whisper doesn't return per-segment confidence easily
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
        if (this.pipeline) {
            this.pipeline = null;
        }
        this.isModelLoaded = false;
        this.isLoading = false;
        console.log('🗑️ Model unloaded');
    }
}

export default TranscriptionEngine;
