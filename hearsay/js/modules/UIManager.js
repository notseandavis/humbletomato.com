/**
 * UIManager - Handle all UI interactions and view management
 */

export class UIManager {
    constructor(app) {
        this.app = app;
        this.currentView = 'record';
        this.currentMeetingId = null;
    }

    init() {
        this.setupNavigation();
        this.setupViewTransitions();
        this.setupStorageDisplay();
        this.refreshMeetingsList();
        this.setupSettingsListeners();
    }

    setupNavigation() {
        const navButtons = document.querySelectorAll('.nav-button');
        
        navButtons.forEach(button => {
            button.addEventListener('click', () => {
                const view = button.dataset.view;
                this.showView(view);
                
                // Update active state
                navButtons.forEach(b => b.classList.remove('active'));
                button.classList.add('active');
            });
        });
    }

    setupViewTransitions() {
        // Back button in meeting detail
        const backButton = document.getElementById('back-to-meetings');
        if (backButton) {
            backButton.addEventListener('click', () => {
                this.showView('meetings');
                this.currentMeetingId = null;
            });
        }

        // Export modal
        const exportModal = document.getElementById('export-modal');
        const exportButton = document.getElementById('export-meeting');
        
        if (exportButton) {
            exportButton.addEventListener('click', () => {
                this.showExportModal();
            });
        }

        // Close modal
        const modalClose = exportModal?.querySelector('.modal-close');
        if (modalClose) {
            modalClose.addEventListener('click', () => {
                exportModal.classList.remove('active');
            });
        }

        // Export options
        const exportOptions = exportModal?.querySelectorAll('.export-option');
        exportOptions?.forEach(option => {
            option.addEventListener('click', async () => {
                const format = option.dataset.format;
                await this.app.exportMeeting(this.currentMeetingId, format);
                exportModal.classList.remove('active');
            });
        });

        // Delete button
        const deleteButton = document.getElementById('delete-meeting');
        if (deleteButton) {
            deleteButton.addEventListener('click', async () => {
                await this.app.deleteMeeting(this.currentMeetingId);
            });
        }

        // Meeting search
        const searchInput = document.getElementById('meeting-search');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                this.filterMeetings(e.target.value);
            });
        }
    }

    showView(viewName) {
        const views = document.querySelectorAll('.view');
        views.forEach(view => view.classList.remove('active'));
        
        const targetView = document.getElementById(`${viewName}-view`);
        if (targetView) {
            targetView.classList.add('active');
            this.currentView = viewName;

            // Refresh view content if needed
            if (viewName === 'meetings') {
                this.refreshMeetingsList();
            } else if (viewName === 'settings') {
                this.updateStorageDisplay();
            }
        }
    }

    setRecordingState(isRecording) {
        const recordButton = document.getElementById('record-button');
        const statusIndicator = document.querySelector('.status-indicator');
        const statusText = document.querySelector('.status-text');

        if (isRecording) {
            recordButton.classList.add('recording');
            statusIndicator.classList.add('recording');
            statusText.textContent = 'Recording';
        } else {
            recordButton.classList.remove('recording');
            statusIndicator.classList.remove('recording');
            statusText.textContent = 'Ready';
        }
    }

    addTranscriptSegment(segment) {
        const transcriptContent = document.getElementById('transcript-content');
        
        // Remove empty state if present
        const emptyState = transcriptContent.querySelector('.transcript-empty');
        if (emptyState) {
            emptyState.remove();
        }

        // Create segment element
        const segmentEl = document.createElement('div');
        segmentEl.className = 'transcript-segment';
        if (segment.confidence < 0.6) {
            segmentEl.classList.add('segment-confidence-low');
        }

        // Get speaker info
        const speaker = this.app.speakerIdentifier.getSpeaker(segment.speakerId);
        const speakerName = speaker ? speaker.name : 'Unknown';
        const speakerColor = speaker ? speaker.color : '#9CA3AF';

        // Build HTML
        let html = `
            <div class="segment-header">
                <span class="speaker-label" style="color: ${speakerColor}">
                    ${speakerName}
                </span>
                <span class="segment-timestamp">
                    ${this.formatTimestamp(segment.startTime)}
                </span>
            </div>
            <div class="segment-text">${this.escapeHtml(segment.text)}</div>
        `;

        if (segment.translatedText) {
            html += `
                <div class="segment-translation">
                    ${this.escapeHtml(segment.translatedText)}
                </div>
            `;
        }

        segmentEl.innerHTML = html;
        transcriptContent.appendChild(segmentEl);

        // Auto-scroll to bottom
        transcriptContent.scrollTop = transcriptContent.scrollHeight;
    }

    async refreshMeetingsList() {
        const meetingsList = document.getElementById('meetings-list');
        if (!meetingsList) return;

        try {
            const meetings = await this.app.storageManager.getAllMeetings();
            
            if (meetings.length === 0) {
                meetingsList.innerHTML = '<p class="empty-state">No meetings yet. Start your first recording!</p>';
                return;
            }

            meetingsList.innerHTML = '';
            
            meetings.forEach(meeting => {
                const card = this.createMeetingCard(meeting);
                meetingsList.appendChild(card);
            });
        } catch (error) {
            console.error('Failed to load meetings:', error);
            meetingsList.innerHTML = '<p class="empty-state">Error loading meetings</p>';
        }
    }

    createMeetingCard(meeting) {
        const card = document.createElement('div');
        card.className = 'meeting-card';
        card.dataset.meetingId = meeting.id;

        const date = new Date(meeting.startDate);
        const formattedDate = new Intl.DateTimeFormat('en-US', {
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit'
        }).format(date);

        const duration = this.app.storageManager.formatDuration(meeting.duration || 0);
        const wordCount = meeting.segments?.reduce((sum, s) => sum + s.text.split(' ').length, 0) || 0;
        const speakerCount = meeting.speakers?.length || 0;

        // Get preview text
        const previewText = meeting.segments
            ?.slice(0, 3)
            .map(s => s.text)
            .join(' ')
            .substring(0, 150) || 'No transcript available';

        card.innerHTML = `
            <div class="meeting-title">${this.escapeHtml(meeting.title || 'Untitled Meeting')}</div>
            <div class="meeting-meta">
                <span class="meeting-meta-item">
                    <svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z" fill="currentColor"/><path d="M12.5 7H11v6l5.25 3.15.75-1.23-4.5-2.67z" fill="currentColor"/></svg>
                    ${formattedDate}
                </span>
                <span class="meeting-meta-item">
                    <svg viewBox="0 0 24 24"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8z" fill="currentColor"/><path d="M12.5 7H11v6l5.25 3.15.75-1.23-4.5-2.67z" fill="currentColor"/></svg>
                    ${duration}
                </span>
                ${speakerCount > 0 ? `
                <span class="meeting-meta-item">
                    <svg viewBox="0 0 24 24"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" fill="currentColor"/></svg>
                    ${speakerCount} ${speakerCount === 1 ? 'speaker' : 'speakers'}
                </span>
                ` : ''}
                <span class="meeting-meta-item">
                    <svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" stroke="currentColor" stroke-width="2"/></svg>
                    ${wordCount} words
                </span>
            </div>
            <div class="meeting-preview">${this.escapeHtml(previewText)}</div>
        `;

        card.addEventListener('click', () => {
            this.showMeetingDetail(meeting.id);
        });

        return card;
    }

    async showMeetingDetail(meetingId) {
        this.currentMeetingId = meetingId;
        
        try {
            const meeting = await this.app.storageManager.getMeeting(meetingId);
            if (!meeting) {
                this.showToast('Meeting not found', 'error');
                return;
            }

            const detailBody = document.getElementById('meeting-detail-body');
            detailBody.innerHTML = this.buildMeetingDetailHTML(meeting);

            this.showView('meeting-detail');
        } catch (error) {
            console.error('Failed to load meeting detail:', error);
            this.showToast('Failed to load meeting', 'error');
        }
    }

    buildMeetingDetailHTML(meeting) {
        const date = new Date(meeting.startDate);
        const formattedDate = new Intl.DateTimeFormat('en-US', {
            dateStyle: 'full',
            timeStyle: 'short'
        }).format(date);

        const duration = this.app.storageManager.formatDuration(meeting.duration || 0);
        const wordCount = meeting.segments?.reduce((sum, s) => sum + s.text.split(' ').length, 0) || 0;

        let html = `
            <div class="meeting-info-section">
                <h2>${this.escapeHtml(meeting.title || 'Untitled Meeting')}</h2>
                <div class="meeting-metadata">
                    <div class="metadata-item">
                        <div class="metadata-label">Date & Time</div>
                        <div class="metadata-value">${formattedDate}</div>
                    </div>
                    <div class="metadata-item">
                        <div class="metadata-label">Duration</div>
                        <div class="metadata-value">${duration}</div>
                    </div>
                    <div class="metadata-item">
                        <div class="metadata-label">Words</div>
                        <div class="metadata-value">${wordCount.toLocaleString()}</div>
                    </div>
                    <div class="metadata-item">
                        <div class="metadata-label">Speakers</div>
                        <div class="metadata-value">${meeting.speakers?.length || 0}</div>
                    </div>
                </div>
            </div>
        `;

        // Speakers section
        if (meeting.speakers && meeting.speakers.length > 0) {
            html += `
                <div class="speakers-section">
                    <h3>Speakers</h3>
                    <div class="speakers-list">
            `;

            meeting.speakers.forEach(speaker => {
                const percentage = ((speaker.totalDuration / meeting.duration) * 100).toFixed(1);
                html += `
                    <div class="speaker-item">
                        <div class="speaker-color-dot" style="background: ${speaker.color}"></div>
                        <div class="speaker-info">
                            <div class="speaker-name">${this.escapeHtml(speaker.name)}</div>
                            <div class="speaker-stats">${speaker.segmentCount} segments • ${percentage}% of meeting</div>
                        </div>
                    </div>
                `;
            });

            html += `
                    </div>
                </div>
            `;
        }

        // Transcript section
        if (meeting.segments && meeting.segments.length > 0) {
            html += `
                <div class="transcript-section">
                    <h3>Transcript</h3>
                    <div class="transcript-content">
            `;

            let currentSpeakerId = null;
            
            meeting.segments.forEach(segment => {
                const speaker = meeting.speakers?.find(s => s.id === segment.speakerId);
                const speakerName = speaker ? speaker.name : 'Unknown';
                const speakerColor = speaker ? speaker.color : '#9CA3AF';

                html += `
                    <div class="transcript-segment">
                        <div class="segment-header">
                            <span class="speaker-label" style="color: ${speakerColor}">
                                ${this.escapeHtml(speakerName)}
                            </span>
                            <span class="segment-timestamp">
                                ${this.formatTimestamp(segment.startTime)}
                            </span>
                        </div>
                        <div class="segment-text">${this.escapeHtml(segment.text)}</div>
                        ${segment.translatedText ? `
                            <div class="segment-translation">
                                ${this.escapeHtml(segment.translatedText)}
                            </div>
                        ` : ''}
                    </div>
                `;
            });

            html += `
                    </div>
                </div>
            `;
        }

        return html;
    }

    async filterMeetings(query) {
        const meetingsList = document.getElementById('meetings-list');
        if (!meetingsList) return;

        try {
            const meetings = query 
                ? await this.app.storageManager.searchMeetings(query)
                : await this.app.storageManager.getAllMeetings();
            
            if (meetings.length === 0) {
                meetingsList.innerHTML = '<p class="empty-state">No meetings found</p>';
                return;
            }

            meetingsList.innerHTML = '';
            meetings.forEach(meeting => {
                const card = this.createMeetingCard(meeting);
                meetingsList.appendChild(card);
            });
        } catch (error) {
            console.error('Search failed:', error);
        }
    }

    showExportModal() {
        const modal = document.getElementById('export-modal');
        if (modal) {
            modal.classList.add('active');
        }
    }

    async updateStorageDisplay() {
        const estimate = await this.app.storageManager.getStorageEstimate();
        const usedBar = document.getElementById('storage-used');
        const storageText = document.getElementById('storage-text');

        if (usedBar) {
            usedBar.style.width = `${estimate.percentage}%`;
        }

        if (storageText) {
            const usedMB = (estimate.usage / (1024 * 1024)).toFixed(2);
            const quotaMB = (estimate.quota / (1024 * 1024)).toFixed(0);
            storageText.textContent = `Using ${usedMB} MB of ${quotaMB} MB (${estimate.percentage.toFixed(1)}%)`;
        }
    }

    setupStorageDisplay() {
        setInterval(() => {
            if (this.currentView === 'settings') {
                this.updateStorageDisplay();
            }
        }, 5000);
    }

    setupSettingsListeners() {
        // Save settings on change
        const settingsInputs = document.querySelectorAll('#settings-view input, #settings-view select');
        settingsInputs.forEach(input => {
            input.addEventListener('change', () => {
                this.app.saveSettings();
            });
        });
    }

    showToast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        if (!container) return;

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;

        container.appendChild(toast);

        // Remove after 3 seconds
        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    formatTimestamp(seconds) {
        const minutes = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

export default UIManager;
