/**
 * StorageManager - IndexedDB for meetings, transcripts, and audio storage
 * Equivalent to iOS StorageManager.swift with SwiftData
 */

export class StorageManager {
    constructor() {
        this.dbName = 'HearsayDB';
        this.dbVersion = 1;
        this.db = null;
    }

    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.dbVersion);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
                console.log('✅ IndexedDB initialized');
                resolve();
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;

                // Meetings store
                if (!db.objectStoreNames.contains('meetings')) {
                    const meetingsStore = db.createObjectStore('meetings', { keyPath: 'id' });
                    meetingsStore.createIndex('startDate', 'startDate', { unique: false });
                    meetingsStore.createIndex('title', 'title', { unique: false });
                }

                // Settings store
                if (!db.objectStoreNames.contains('settings')) {
                    db.createObjectStore('settings', { keyPath: 'key' });
                }

                console.log('📦 Database schema created');
            };
        });
    }

    async saveMeeting(meeting) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['meetings'], 'readwrite');
            const store = transaction.objectStore('meetings');

            // Prepare meeting data
            const meetingData = {
                id: meeting.id,
                title: meeting.title || this.generateMeetingTitle(meeting.startDate),
                startDate: meeting.startDate,
                endDate: meeting.endDate || new Date(),
                duration: meeting.duration || 0,
                segments: meeting.segments || [],
                speakers: meeting.speakers || [],
                audioBlob: meeting.audioBlob,
                translationEnabled: meeting.translationEnabled || false,
                targetLanguage: meeting.targetLanguage || null,
                createdAt: new Date(),
                modifiedAt: new Date()
            };

            const request = store.put(meetingData);

            request.onsuccess = () => {
                console.log('✅ Meeting saved:', meeting.id);
                resolve(meeting.id);
            };

            request.onerror = () => reject(request.error);
        });
    }

    async getMeeting(meetingId) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['meetings'], 'readonly');
            const store = transaction.objectStore('meetings');
            const request = store.get(meetingId);

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async getAllMeetings() {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['meetings'], 'readonly');
            const store = transaction.objectStore('meetings');
            const index = store.index('startDate');
            const request = index.openCursor(null, 'prev'); // Newest first

            const meetings = [];

            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    meetings.push(cursor.value);
                    cursor.continue();
                } else {
                    resolve(meetings);
                }
            };

            request.onerror = () => reject(request.error);
        });
    }

    async searchMeetings(query) {
        const allMeetings = await this.getAllMeetings();
        const lowercaseQuery = query.toLowerCase();

        return allMeetings.filter(meeting => {
            // Search in title
            if (meeting.title?.toLowerCase().includes(lowercaseQuery)) {
                return true;
            }

            // Search in transcript
            const fullText = meeting.segments
                .map(s => s.text)
                .join(' ')
                .toLowerCase();

            if (fullText.includes(lowercaseQuery)) {
                return true;
            }

            // Search in speaker names
            if (meeting.speakers?.some(s => s.name?.toLowerCase().includes(lowercaseQuery))) {
                return true;
            }

            return false;
        });
    }

    async deleteMeeting(meetingId) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['meetings'], 'readwrite');
            const store = transaction.objectStore('meetings');
            const request = store.delete(meetingId);

            request.onsuccess = () => {
                console.log('🗑️ Meeting deleted:', meetingId);
                resolve();
            };

            request.onerror = () => reject(request.error);
        });
    }

    async clearAll() {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['meetings'], 'readwrite');
            const store = transaction.objectStore('meetings');
            const request = store.clear();

            request.onsuccess = () => {
                console.log('🗑️ All meetings cleared');
                resolve();
            };

            request.onerror = () => reject(request.error);
        });
    }

    async getStorageEstimate() {
        if ('storage' in navigator && 'estimate' in navigator.storage) {
            const estimate = await navigator.storage.estimate();
            return {
                usage: estimate.usage,
                quota: estimate.quota,
                percentage: (estimate.usage / estimate.quota) * 100
            };
        }
        return { usage: 0, quota: 0, percentage: 0 };
    }

    // Settings management
    saveSettings(settings) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['settings'], 'readwrite');
            const store = transaction.objectStore('settings');
            const request = store.put({ key: 'app-settings', value: settings });

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    getSettings() {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['settings'], 'readonly');
            const store = transaction.objectStore('settings');
            const request = store.get('app-settings');

            request.onsuccess = () => {
                resolve(request.result?.value || {});
            };

            request.onerror = () => {
                // Return defaults if error
                resolve({});
            };
        });
    }

    // Utility methods
    generateMeetingTitle(date) {
        const formatter = new Intl.DateTimeFormat('en-US', {
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit'
        });
        return `Meeting - ${formatter.format(date)}`;
    }

    formatDuration(seconds) {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);

        if (hours > 0) {
            return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
        } else {
            return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
        }
    }

    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
    }
}

export default StorageManager;
