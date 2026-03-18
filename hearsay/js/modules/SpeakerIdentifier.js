/**
 * SpeakerIdentifier - MFCC-based voice embeddings for real speaker identification
 * - Extracts MFCC features (mel-frequency cepstral coefficients)
 * - Computes voice embeddings: MFCCs + deltas + pitch + spectral features
 * - Clusters speakers using cosine similarity
 * - Voice Activity Detection (VAD) for clean segmentation
 * - All processing is client-side with Web Audio API + vanilla JS
 */

export class SpeakerIdentifier {
    constructor() {
        this._enabled = true;
        this.speakers = [];
        this.currentSpeakerId = null;
        
        // Speaker clustering thresholds
        this.similarityThreshold = 0.85;  // >0.85 = same speaker
        this.newSpeakerThreshold = 0.70;  // <0.70 = definitely new speaker
        this.profileUpdateAlpha = 0.3;    // EMA weight for profile updates
        
        // VAD parameters
        this.vadEnergyThreshold = 0.01;
        this.vadZcrThreshold = 0.3;
        
        // MFCC parameters
        this.sampleRate = 16000;
        this.frameSize = 400;       // 25ms at 16kHz
        this.hopSize = 160;         // 10ms at 16kHz
        this.numMfcc = 13;
        this.numFilters = 26;
        this.minFreq = 80;
        this.maxFreq = 7600;
        
        // Speaker colors
        this.speakerColors = [
            '#EF4444', '#3B82F6', '#10B981', '#F59E0B',
            '#8B5CF6', '#EC4899', '#14B8A6', '#F97316'
        ];
        
        // Pre-compute mel filterbank
        this.melFilterbank = this.createMelFilterbank();
        
        // Pre-compute DCT matrix
        this.dctMatrix = this.createDCTMatrix();
    }

    isEnabled() {
        return this._enabled;
    }

    setEnabled(enabled) {
        this._enabled = enabled;
    }

    toggle() {
        this._enabled = !this._enabled;
        return this._enabled;
    }

    reset() {
        this.speakers = [];
        this.currentSpeakerId = null;
    }

    /**
     * Identify speaker from audio segment using voice embeddings
     */
    async identifySpeaker(audioData, timestamp, duration) {
        if (!this._enabled) {
            return this.getOrCreateSpeaker(0);
        }

        // Voice Activity Detection - skip if silence
        if (!this.detectVoiceActivity(audioData)) {
            return this.currentSpeakerId || this.getOrCreateSpeaker(0);
        }

        // Extract voice embedding
        const embedding = this.extractVoiceEmbedding(audioData);
        
        if (!embedding || embedding.length === 0) {
            return this.currentSpeakerId || this.getOrCreateSpeaker(0);
        }

        // Find best matching speaker
        let bestSpeaker = null;
        let bestSimilarity = -1;

        for (const speaker of this.speakers) {
            if (!speaker.embedding) continue;
            
            const similarity = this.cosineSimilarity(embedding, speaker.embedding);
            
            if (similarity > bestSimilarity) {
                bestSimilarity = similarity;
                bestSpeaker = speaker;
            }
        }

        // Decide: same speaker, merge, or create new
        if (bestSimilarity > this.similarityThreshold) {
            // Same speaker - update profile with EMA
            this.updateSpeakerProfile(bestSpeaker, embedding, timestamp, duration);
            this.currentSpeakerId = bestSpeaker.id;
            
        } else if (bestSimilarity > this.newSpeakerThreshold && bestSimilarity <= this.similarityThreshold) {
            // Uncertain region - weighted merge if similar enough
            if (bestSimilarity > 0.78) {
                this.updateSpeakerProfile(bestSpeaker, embedding, timestamp, duration);
                this.currentSpeakerId = bestSpeaker.id;
            } else {
                // Create new speaker
                const newSpeaker = this.createNewSpeaker(embedding, timestamp);
                this.currentSpeakerId = newSpeaker.id;
            }
            
        } else {
            // Definitely new speaker
            const newSpeaker = this.createNewSpeaker(embedding, timestamp);
            this.currentSpeakerId = newSpeaker.id;
        }

        return this.currentSpeakerId;
    }

    /**
     * Voice Activity Detection using energy and zero-crossing rate
     */
    detectVoiceActivity(audioData) {
        const energy = this.calculateEnergy(audioData);
        const zcr = this.calculateZeroCrossingRate(audioData);
        
        // Speech typically has moderate energy and ZCR
        // Silence has low energy; noise has high ZCR
        const isSpeech = energy > this.vadEnergyThreshold && zcr < this.vadZcrThreshold;
        
        return isSpeech;
    }

    /**
     * Calculate zero-crossing rate (sign changes per sample)
     */
    calculateZeroCrossingRate(audioData) {
        let crossings = 0;
        for (let i = 1; i < audioData.length; i++) {
            if ((audioData[i] >= 0 && audioData[i - 1] < 0) ||
                (audioData[i] < 0 && audioData[i - 1] >= 0)) {
                crossings++;
            }
        }
        return crossings / audioData.length;
    }

    /**
     * Extract voice embedding: MFCCs + deltas + pitch + spectral features
     * Returns a 30-dimensional vector that characterizes the voice
     */
    extractVoiceEmbedding(audioData) {
        try {
            // Extract MFCC features for all frames
            const mfccFrames = this.extractMFCC(audioData);
            
            if (mfccFrames.length === 0) {
                return null;
            }

            // Average MFCCs across all frames -> 13-dim vector
            const avgMfcc = this.averageFrames(mfccFrames);

            // Compute delta MFCCs (first derivative) -> 13-dim vector
            const deltaMfcc = this.computeDeltaMFCC(mfccFrames);

            // Extract pitch features (F0 mean and variance) -> 2-dim vector
            const pitchFeatures = this.extractPitchFeatures(audioData);

            // Extract spectral features (centroid, rolloff) -> 2-dim vector
            const spectralFeatures = this.extractSpectralFeatures(audioData);

            // Concatenate all features -> 30-dim embedding
            const embedding = [
                ...avgMfcc,      // 13
                ...deltaMfcc,    // 13
                ...pitchFeatures, // 2
                ...spectralFeatures // 2
            ];

            // Normalize embedding to unit length for cosine similarity
            return this.normalizeVector(embedding);
            
        } catch (error) {
            console.error('Error extracting voice embedding:', error);
            return null;
        }
    }

    /**
     * Extract MFCC features from audio
     * Returns array of MFCC vectors (one per frame)
     */
    extractMFCC(audioData) {
        const frames = this.frameSignal(audioData);
        const mfccFrames = [];

        for (const frame of frames) {
            // Apply pre-emphasis
            const emphasized = this.preEmphasis(frame);

            // Apply Hamming window
            const windowed = this.applyHammingWindow(emphasized);

            // Compute magnitude spectrum via FFT
            const spectrum = this.computeMagnitudeSpectrum(windowed);

            // Apply mel filterbank
            const melEnergies = this.applyMelFilterbank(spectrum);

            // Convert to log scale
            const logMel = melEnergies.map(e => Math.log(Math.max(e, 1e-10)));

            // Apply DCT to get MFCCs
            const mfcc = this.applyDCT(logMel);

            mfccFrames.push(mfcc);
        }

        return mfccFrames;
    }

    /**
     * Frame signal into overlapping windows
     */
    frameSignal(audioData) {
        const frames = [];
        let offset = 0;

        while (offset + this.frameSize <= audioData.length) {
            const frame = audioData.slice(offset, offset + this.frameSize);
            frames.push(frame);
            offset += this.hopSize;
        }

        return frames;
    }

    /**
     * Pre-emphasis filter to boost high frequencies
     */
    preEmphasis(frame, alpha = 0.97) {
        const emphasized = new Float32Array(frame.length);
        emphasized[0] = frame[0];

        for (let i = 1; i < frame.length; i++) {
            emphasized[i] = frame[i] - alpha * frame[i - 1];
        }

        return emphasized;
    }

    /**
     * Apply Hamming window to reduce spectral leakage
     */
    applyHammingWindow(frame) {
        const windowed = new Float32Array(frame.length);

        for (let i = 0; i < frame.length; i++) {
            const window = 0.54 - 0.46 * Math.cos(2 * Math.PI * i / (frame.length - 1));
            windowed[i] = frame[i] * window;
        }

        return windowed;
    }

    /**
     * Compute magnitude spectrum using FFT
     */
    computeMagnitudeSpectrum(frame) {
        // Pad to next power of 2 for efficient FFT
        const fftSize = this.nextPowerOf2(frame.length);
        const padded = new Float32Array(fftSize);
        padded.set(frame);

        // Perform FFT
        const complex = this.fft(padded);

        // Compute magnitude spectrum
        const magnitude = new Float32Array(fftSize / 2 + 1);
        for (let i = 0; i < magnitude.length; i++) {
            const real = complex.real[i];
            const imag = complex.imag[i];
            magnitude[i] = Math.sqrt(real * real + imag * imag);
        }

        return magnitude;
    }

    /**
     * Radix-2 FFT implementation
     */
    fft(signal) {
        const n = signal.length;
        
        if (n <= 1) {
            return { real: signal, imag: new Float32Array(n) };
        }

        // Bit reversal
        const real = new Float32Array(n);
        const imag = new Float32Array(n);
        
        for (let i = 0; i < n; i++) {
            const j = this.reverseBits(i, Math.log2(n));
            real[j] = signal[i];
        }

        // FFT computation
        for (let size = 2; size <= n; size *= 2) {
            const halfSize = size / 2;
            const step = 2 * Math.PI / size;

            for (let i = 0; i < n; i += size) {
                for (let j = 0; j < halfSize; j++) {
                    const angle = step * j;
                    const twiddleReal = Math.cos(angle);
                    const twiddleImag = -Math.sin(angle);

                    const evenIdx = i + j;
                    const oddIdx = i + j + halfSize;

                    const oddReal = real[oddIdx];
                    const oddImag = imag[oddIdx];

                    const prodReal = oddReal * twiddleReal - oddImag * twiddleImag;
                    const prodImag = oddReal * twiddleImag + oddImag * twiddleReal;

                    real[oddIdx] = real[evenIdx] - prodReal;
                    imag[oddIdx] = imag[evenIdx] - prodImag;

                    real[evenIdx] += prodReal;
                    imag[evenIdx] += prodImag;
                }
            }
        }

        return { real, imag };
    }

    /**
     * Reverse bits for FFT bit-reversal
     */
    reverseBits(x, numBits) {
        let result = 0;
        for (let i = 0; i < numBits; i++) {
            result = (result << 1) | (x & 1);
            x >>= 1;
        }
        return result;
    }

    /**
     * Next power of 2
     */
    nextPowerOf2(x) {
        return Math.pow(2, Math.ceil(Math.log2(x)));
    }

    /**
     * Create mel filterbank
     */
    createMelFilterbank() {
        const filterbank = [];
        const fftSize = this.nextPowerOf2(this.frameSize);
        const numBins = fftSize / 2 + 1;

        // Convert Hz to mel scale
        const melMin = this.hzToMel(this.minFreq);
        const melMax = this.hzToMel(this.maxFreq);

        // Create equally spaced mel points
        const melPoints = [];
        for (let i = 0; i <= this.numFilters + 1; i++) {
            const mel = melMin + (melMax - melMin) * i / (this.numFilters + 1);
            melPoints.push(this.melToHz(mel));
        }

        // Convert to FFT bin indices
        const binPoints = melPoints.map(hz => 
            Math.floor((fftSize + 1) * hz / this.sampleRate)
        );

        // Create triangular filters
        for (let i = 1; i <= this.numFilters; i++) {
            const filter = new Float32Array(numBins);
            const left = binPoints[i - 1];
            const center = binPoints[i];
            const right = binPoints[i + 1];

            // Rising slope
            for (let j = left; j < center; j++) {
                filter[j] = (j - left) / (center - left);
            }

            // Falling slope
            for (let j = center; j < right; j++) {
                filter[j] = (right - j) / (right - center);
            }

            filterbank.push(filter);
        }

        return filterbank;
    }

    /**
     * Convert Hz to mel scale
     */
    hzToMel(hz) {
        return 2595 * Math.log10(1 + hz / 700);
    }

    /**
     * Convert mel to Hz
     */
    melToHz(mel) {
        return 700 * (Math.pow(10, mel / 2595) - 1);
    }

    /**
     * Apply mel filterbank to spectrum
     */
    applyMelFilterbank(spectrum) {
        const melEnergies = new Float32Array(this.numFilters);

        for (let i = 0; i < this.numFilters; i++) {
            let energy = 0;
            const filter = this.melFilterbank[i];

            for (let j = 0; j < spectrum.length && j < filter.length; j++) {
                energy += spectrum[j] * filter[j];
            }

            melEnergies[i] = energy;
        }

        return melEnergies;
    }

    /**
     * Create DCT matrix for MFCC computation
     */
    createDCTMatrix() {
        const matrix = [];
        
        for (let i = 0; i < this.numMfcc; i++) {
            const row = new Float32Array(this.numFilters);
            for (let j = 0; j < this.numFilters; j++) {
                row[j] = Math.cos(Math.PI * i * (j + 0.5) / this.numFilters);
            }
            matrix.push(row);
        }

        return matrix;
    }

    /**
     * Apply DCT to get MFCCs from log mel energies
     */
    applyDCT(logMel) {
        const mfcc = new Float32Array(this.numMfcc);

        for (let i = 0; i < this.numMfcc; i++) {
            let sum = 0;
            for (let j = 0; j < this.numFilters; j++) {
                sum += logMel[j] * this.dctMatrix[i][j];
            }
            mfcc[i] = sum;
        }

        return mfcc;
    }

    /**
     * Average MFCC frames
     */
    averageFrames(mfccFrames) {
        if (mfccFrames.length === 0) return new Float32Array(this.numMfcc);

        const avg = new Float32Array(this.numMfcc);

        for (const frame of mfccFrames) {
            for (let i = 0; i < this.numMfcc; i++) {
                avg[i] += frame[i];
            }
        }

        for (let i = 0; i < this.numMfcc; i++) {
            avg[i] /= mfccFrames.length;
        }

        return avg;
    }

    /**
     * Compute delta MFCCs (first derivative across frames)
     */
    computeDeltaMFCC(mfccFrames) {
        if (mfccFrames.length < 3) {
            return new Float32Array(this.numMfcc); // Not enough frames
        }

        const deltas = [];
        const n = 2; // Use n=2 for delta computation

        for (let t = n; t < mfccFrames.length - n; t++) {
            const delta = new Float32Array(this.numMfcc);

            for (let i = 0; i < this.numMfcc; i++) {
                let numerator = 0;
                let denominator = 0;

                for (let k = 1; k <= n; k++) {
                    numerator += k * (mfccFrames[t + k][i] - mfccFrames[t - k][i]);
                    denominator += k * k;
                }

                delta[i] = numerator / (2 * denominator);
            }

            deltas.push(delta);
        }

        // Average deltas
        return this.averageFrames(deltas);
    }

    /**
     * Extract pitch features (F0 mean and variance)
     */
    extractPitchFeatures(audioData) {
        const pitchValues = this.estimatePitchFrames(audioData);

        if (pitchValues.length === 0) {
            return [0, 0];
        }

        // Calculate mean
        const mean = pitchValues.reduce((sum, val) => sum + val, 0) / pitchValues.length;

        // Calculate variance
        const variance = pitchValues.reduce((sum, val) => 
            sum + Math.pow(val - mean, 2), 0
        ) / pitchValues.length;

        return [mean / 500, Math.sqrt(variance) / 100]; // Normalize
    }

    /**
     * Estimate pitch for multiple frames using autocorrelation
     */
    estimatePitchFrames(audioData) {
        const frames = this.frameSignal(audioData);
        const pitches = [];

        for (const frame of frames) {
            const pitch = this.estimatePitch(frame);
            if (pitch > 0) {
                pitches.push(pitch);
            }
        }

        return pitches;
    }

    /**
     * Estimate pitch using autocorrelation
     */
    estimatePitch(audioData) {
        const minPeriod = Math.floor(this.sampleRate / 400); // 400 Hz max
        const maxPeriod = Math.floor(this.sampleRate / 80);  // 80 Hz min

        let maxCorr = 0;
        let period = minPeriod;

        for (let p = minPeriod; p < maxPeriod && p < audioData.length / 2; p++) {
            let corr = 0;
            for (let i = 0; i < audioData.length - p; i++) {
                corr += audioData[i] * audioData[i + p];
            }
            if (corr > maxCorr) {
                maxCorr = corr;
                period = p;
            }
        }

        return this.sampleRate / period; // Hz
    }

    /**
     * Extract spectral features (centroid and rolloff)
     */
    extractSpectralFeatures(audioData) {
        const frames = this.frameSignal(audioData);
        const centroids = [];
        const rolloffs = [];

        for (const frame of frames) {
            const windowed = this.applyHammingWindow(frame);
            const spectrum = this.computeMagnitudeSpectrum(windowed);

            // Spectral centroid
            let weightedSum = 0;
            let totalEnergy = 0;

            for (let i = 0; i < spectrum.length; i++) {
                const freq = i * this.sampleRate / (2 * spectrum.length);
                weightedSum += freq * spectrum[i];
                totalEnergy += spectrum[i];
            }

            const centroid = totalEnergy > 0 ? weightedSum / totalEnergy : 0;
            centroids.push(centroid);

            // Spectral rolloff (frequency below which 85% of energy is contained)
            let cumulativeEnergy = 0;
            const rolloffThreshold = totalEnergy * 0.85;
            let rolloff = 0;

            for (let i = 0; i < spectrum.length; i++) {
                cumulativeEnergy += spectrum[i];
                if (cumulativeEnergy >= rolloffThreshold) {
                    rolloff = i * this.sampleRate / (2 * spectrum.length);
                    break;
                }
            }

            rolloffs.push(rolloff);
        }

        // Average features
        const avgCentroid = centroids.reduce((sum, val) => sum + val, 0) / centroids.length;
        const avgRolloff = rolloffs.reduce((sum, val) => sum + val, 0) / rolloffs.length;

        return [avgCentroid / 5000, avgRolloff / 5000]; // Normalize
    }

    /**
     * Normalize vector to unit length
     */
    normalizeVector(vector) {
        let magnitude = 0;
        for (const val of vector) {
            magnitude += val * val;
        }
        magnitude = Math.sqrt(magnitude);

        if (magnitude < 1e-10) {
            return vector;
        }

        return vector.map(val => val / magnitude);
    }

    /**
     * Compute cosine similarity between two vectors
     */
    cosineSimilarity(vec1, vec2) {
        if (vec1.length !== vec2.length) {
            return 0;
        }

        let dotProduct = 0;
        let mag1 = 0;
        let mag2 = 0;

        for (let i = 0; i < vec1.length; i++) {
            dotProduct += vec1[i] * vec2[i];
            mag1 += vec1[i] * vec1[i];
            mag2 += vec2[i] * vec2[i];
        }

        mag1 = Math.sqrt(mag1);
        mag2 = Math.sqrt(mag2);

        if (mag1 < 1e-10 || mag2 < 1e-10) {
            return 0;
        }

        return dotProduct / (mag1 * mag2);
    }

    /**
     * Calculate audio energy (RMS)
     */
    calculateEnergy(audioData) {
        let sum = 0;
        for (let i = 0; i < audioData.length; i++) {
            sum += audioData[i] * audioData[i];
        }
        return Math.sqrt(sum / audioData.length);
    }

    /**
     * Create new speaker with voice embedding
     */
    createNewSpeaker(embedding, timestamp) {
        const index = this.speakers.length;
        const speaker = {
            id: crypto.randomUUID(),
            name: `Speaker ${index + 1}`,
            color: this.speakerColors[index % this.speakerColors.length],
            embedding: embedding,
            segmentCount: 1,
            totalDuration: 0,
            firstAppearance: timestamp,
            lastAppearance: timestamp
        };

        this.speakers.push(speaker);
        console.log(`🎤 New speaker detected: ${speaker.name} (total: ${this.speakers.length})`);

        return speaker;
    }

    /**
     * Update speaker profile with new embedding (exponential moving average)
     */
    updateSpeakerProfile(speaker, newEmbedding, timestamp, duration) {
        // Update embedding with EMA
        for (let i = 0; i < speaker.embedding.length; i++) {
            speaker.embedding[i] = 
                (1 - this.profileUpdateAlpha) * speaker.embedding[i] +
                this.profileUpdateAlpha * newEmbedding[i];
        }

        // Renormalize
        speaker.embedding = this.normalizeVector(speaker.embedding);

        // Update stats
        speaker.segmentCount++;
        speaker.totalDuration += duration;
        speaker.lastAppearance = timestamp;
    }

    /**
     * Get or create speaker by index (for fallback when disabled)
     */
    getOrCreateSpeaker(index) {
        let speaker = this.speakers[index];

        if (!speaker) {
            speaker = {
                id: crypto.randomUUID(),
                name: `Speaker ${index + 1}`,
                color: this.speakerColors[index % this.speakerColors.length],
                embedding: null,
                segmentCount: 0,
                totalDuration: 0,
                firstAppearance: Date.now() / 1000,
                lastAppearance: Date.now() / 1000
            };
            this.speakers.push(speaker);
        }

        return speaker.id;
    }

    getSpeakers() {
        return this.speakers;
    }

    getSpeaker(speakerId) {
        return this.speakers.find(s => s.id === speakerId);
    }

    renameSpeaker(speakerId, name) {
        const speaker = this.getSpeaker(speakerId);
        if (speaker) {
            speaker.name = name;
        }
    }
}

export default SpeakerIdentifier;
