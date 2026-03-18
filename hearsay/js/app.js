/**
 * Hearsay Web - Main Application Entry Point
 * Privacy-first meeting recorder with real-time transcription
 */

import { RecordingEngine } from './modules/RecordingEngine.js';
import { TranscriptionEngine } from './modules/TranscriptionEngine.js';
import { SpeakerIdentifier } from './modules/SpeakerIdentifier.js';
import { TranslationService } from './modules/TranslationService.js';
import { StorageManager } from './modules/StorageManager.js';
import { UIManager } from './modules/UIManager.js';
import { ExportManager } from './modules/ExportManager.js';

class HearsayApp {
    constructor() {
        this.recordingEngine = null;
        this.transcriptionEngine = null;
        this.speakerIdentifier = null;
        this.translationService = null;
        this.storageManager = null;
        this.uiManager = null;
        this.exportManager = null;
        
        this.currentMeeting = null;
        this.isRecording = false;
    }

    async init() {
        console.log('🎙️ Initializing Hearsay...');
        
        try {
            // Initialize storage first
            this.storageManager = new StorageManager();
            await this.storageManager.init();
            
            // Initialize services
            this.transcriptionEngine = new TranscriptionEngine();
            this.speakerIdentifier = new SpeakerIdentifier();
            this.translationService = new TranslationService();
            this.exportManager = new ExportManager();
            
            // Initialize recording engine
            this.recordingEngine = new RecordingEngine({
                onAudioData: this.handleAudioData.bind(this),
                onRecordingStart: this.handleRecordingStart.bind(this),
                onRecordingStop: this.handleRecordingStop.bind(this)
            });
            
            // Initialize UI
            this.uiManager = new UIManager(this);
            this.uiManager.init();
            
            // Set up event listeners
            this.setupEventListeners();
            
            // Load settings
            this.loadSettings();
            
            console.log('✅ Hearsay initialized successfully');
        } catch (error) {
            console.error('❌ Failed to initialize Hearsay:', error);
            this.uiManager?.showToast('Failed to initialize app', 'error');
        }
    }

    setupEventListeners() {
        // Record button
        document.getElementById('record-button').addEventListener('click', () => {
            this.toggleRecording();
        });

        // Settings listeners
        document.getElementById('realtime-transcription').addEventListener('change', (e) => {
            this.transcriptionEngine.setEnabled(e.target.checked);
        });

        document.getElementById('enable-translation').addEventListener('change', (e) => {
            this.translationService.setEnabled(e.target.checked);
        });

        document.getElementById('detect-speakers').addEventListener('change', (e) => {
            this.speakerIdentifier.setEnabled(e.target.checked);
        });

        // Translation toggle in recording view
        document.getElementById('translation-toggle').addEventListener('click', () => {
            const enabled = this.translationService.toggle();
            document.getElementById('translation-toggle').classList.toggle('active', enabled);
            document.getElementById('enable-translation').checked = enabled;
        });

        // Speaker detection toggle
        document.getElementById('speaker-detection-toggle').addEventListener('click', () => {
            const enabled = this.speakerIdentifier.toggle();
            document.getElementById('speaker-detection-toggle').classList.toggle('active', enabled);
            document.getElementById('detect-speakers').checked = enabled;
        });

        // Clear all data
        document.getElementById('clear-all-data').addEventListener('click', async () => {
            if (confirm('Are you sure you want to delete all meetings? This cannot be undone.')) {
                await this.storageManager.clearAll();
                this.uiManager.refreshMeetingsList();
                this.uiManager.showToast('All data cleared', 'success');
            }
        });
    }

    async toggleRecording() {
        if (this.isRecording) {
            await this.stopRecording();
        } else {
            await this.startRecording();
        }
    }

    async startRecording() {
        try {
            // Request microphone permission
            await this.recordingEngine.requestPermission();

            // Load Whisper model if not loaded (first recording only)
            if (this.transcriptionEngine.isEnabled() && !this.transcriptionEngine.isModelLoaded) {
                this.uiManager.showToast('Loading speech recognition model...', 'info');
                
                this.transcriptionEngine.onProgress = (progress) => {
                    const statusEl = document.querySelector('.status-text');
                    if (statusEl) {
                        statusEl.textContent = `Loading model: ${progress.percent}%`;
                    }
                };

                await this.transcriptionEngine.loadModel('base.en');
                this.transcriptionEngine.onProgress = null;
                this.uiManager.showToast('Model loaded! Starting recording...', 'success');
            }
            
            // Create new meeting
            this.currentMeeting = {
                id: crypto.randomUUID(),
                startDate: new Date(),
                segments: [],
                speakers: [],
                audioBlob: null,
                translationEnabled: this.translationService.isEnabled(),
                targetLanguage: this.translationService.getTargetLanguage()
            };
            
            // Reset services
            this.speakerIdentifier.reset();
            this.transcriptionEngine.reset();
            
            // Start Web Speech listening if in that mode
            if (this.transcriptionEngine.mode === 'webspeech') {
                this.transcriptionEngine.startListening();
            }

            // Start recording
            await this.recordingEngine.startRecording();
            
            this.isRecording = true;
            console.log('🎙️ Recording started');
        } catch (error) {
            console.error('❌ Failed to start recording:', error);
            this.uiManager.showToast('Failed to start recording: ' + error.message, 'error');
        }
    }

    async stopRecording() {
        try {
            // Stop Web Speech listening
            if (this.transcriptionEngine.mode === 'webspeech') {
                this.transcriptionEngine.stopListening();
            }

            // Stop recording
            const audioBlob = await this.recordingEngine.stopRecording();
            
            if (this.currentMeeting) {
                this.currentMeeting.audioBlob = audioBlob;
                this.currentMeeting.endDate = new Date();
                this.currentMeeting.duration = (this.currentMeeting.endDate - this.currentMeeting.startDate) / 1000;
                
                // Save meeting
                await this.storageManager.saveMeeting(this.currentMeeting);
                
                this.uiManager.showToast('Meeting saved successfully', 'success');
                this.uiManager.refreshMeetingsList();
            }
            
            this.isRecording = false;
            this.currentMeeting = null;
            
            console.log('✅ Recording stopped');
        } catch (error) {
            console.error('❌ Failed to stop recording:', error);
            this.uiManager.showToast('Failed to stop recording: ' + error.message, 'error');
        }
    }

    async handleAudioData(audioData, timestamp) {
        if (!this.currentMeeting) return;
        if (this._transcribing) return; // Skip if still processing previous chunk

        try {
            // Transcribe audio
            if (this.transcriptionEngine.isEnabled()) {
                this._transcribing = true;
                console.log(`🎤 Processing chunk at ${timestamp.toFixed(1)}s (${audioData.length} samples)`);
                
                const transcriptSegment = await this.transcriptionEngine.transcribe(audioData, timestamp);
                
                this._transcribing = false;

                if (transcriptSegment) {
                    // Identify speaker
                    if (this.speakerIdentifier.isEnabled()) {
                        const speakerId = this.speakerIdentifier.identifySpeaker(
                            audioData,
                            timestamp,
                            transcriptSegment.duration
                        );
                        transcriptSegment.speakerId = speakerId;
                    }
                    
                    // Translate if enabled
                    if (this.translationService.isEnabled()) {
                        transcriptSegment.translatedText = await this.translationService.translate(
                            transcriptSegment.text
                        );
                    }
                    
                    // Add to current meeting
                    this.currentMeeting.segments.push(transcriptSegment);
                    
                    // Update UI
                    this.uiManager.addTranscriptSegment(transcriptSegment);
                    console.log(`📝 Segment added: "${transcriptSegment.text}"`);
                }
            }
        } catch (error) {
            this._transcribing = false;
            console.error('❌ Error processing audio data:', error);
        }
    }

    handleRecordingStart() {
        this.uiManager.setRecordingState(true);
    }

    handleRecordingStop(duration) {
        this.uiManager.setRecordingState(false);
    }

    loadSettings() {
        const settings = this.storageManager.getSettings();
        
        // Apply settings
        document.getElementById('realtime-transcription').checked = settings.realtimeTranscription ?? true;
        document.getElementById('enable-translation').checked = settings.enableTranslation ?? false;
        document.getElementById('detect-speakers').checked = settings.detectSpeakers ?? true;
        document.getElementById('transcription-language').value = settings.transcriptionLanguage ?? 'en';
        document.getElementById('target-language').value = settings.targetLanguage ?? 'en';
        document.getElementById('speaker-sensitivity').value = settings.speakerSensitivity ?? 'medium';
        document.getElementById('audio-quality').value = settings.audioQuality ?? 'high';
        
        // Apply to services
        this.transcriptionEngine.setEnabled(settings.realtimeTranscription ?? true);
        this.translationService.setEnabled(settings.enableTranslation ?? false);
        this.translationService.setTargetLanguage(settings.targetLanguage ?? 'en');
        this.speakerIdentifier.setEnabled(settings.detectSpeakers ?? true);
        
        // Update UI
        document.getElementById('translation-toggle').classList.toggle('active', settings.enableTranslation ?? false);
        document.getElementById('speaker-detection-toggle').classList.toggle('active', settings.detectSpeakers ?? true);
    }

    saveSettings() {
        const settings = {
            realtimeTranscription: document.getElementById('realtime-transcription').checked,
            enableTranslation: document.getElementById('enable-translation').checked,
            detectSpeakers: document.getElementById('detect-speakers').checked,
            transcriptionLanguage: document.getElementById('transcription-language').value,
            targetLanguage: document.getElementById('target-language').value,
            speakerSensitivity: document.getElementById('speaker-sensitivity').value,
            audioQuality: document.getElementById('audio-quality').value
        };
        
        this.storageManager.saveSettings(settings);
    }

    async exportMeeting(meetingId, format) {
        try {
            const meeting = await this.storageManager.getMeeting(meetingId);
            if (!meeting) {
                throw new Error('Meeting not found');
            }
            
            await this.exportManager.export(meeting, format);
            this.uiManager.showToast(`Exported as ${format.toUpperCase()}`, 'success');
        } catch (error) {
            console.error('❌ Export failed:', error);
            this.uiManager.showToast('Export failed: ' + error.message, 'error');
        }
    }

    async deleteMeeting(meetingId) {
        if (confirm('Are you sure you want to delete this meeting?')) {
            try {
                await this.storageManager.deleteMeeting(meetingId);
                this.uiManager.refreshMeetingsList();
                this.uiManager.showToast('Meeting deleted', 'success');
                this.uiManager.showView('meetings');
            } catch (error) {
                console.error('❌ Delete failed:', error);
                this.uiManager.showToast('Delete failed: ' + error.message, 'error');
            }
        }
    }
}

// Initialize app when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.hearsayApp = new HearsayApp();
        window.hearsayApp.init();
    });
} else {
    window.hearsayApp = new HearsayApp();
    window.hearsayApp.init();
}

export default HearsayApp;
