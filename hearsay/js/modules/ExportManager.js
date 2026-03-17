/**
 * ExportManager - Export meetings to various formats
 * Supports: TXT, Markdown, SRT, JSON
 */

export class ExportManager {
    constructor() {
        this.exportFormats = ['txt', 'md', 'srt', 'json'];
    }

    async export(meeting, format) {
        switch (format) {
            case 'txt':
                return this.exportAsText(meeting);
            case 'md':
                return this.exportAsMarkdown(meeting);
            case 'srt':
                return this.exportAsSRT(meeting);
            case 'json':
                return this.exportAsJSON(meeting);
            default:
                throw new Error(`Unsupported format: ${format}`);
        }
    }

    exportAsText(meeting) {
        let output = '';

        // Header
        output += `Meeting: ${meeting.title || 'Untitled'}\n`;
        output += `Date: ${new Date(meeting.startDate).toLocaleString()}\n`;
        output += `Duration: ${this.formatDuration(meeting.duration)}\n`;
        
        if (meeting.speakers && meeting.speakers.length > 0) {
            output += `Speakers: ${meeting.speakers.length}\n`;
        }

        output += '\n---\n\n';

        // Transcript
        if (meeting.segments && meeting.segments.length > 0) {
            let currentSpeakerId = null;

            meeting.segments.forEach(segment => {
                const speaker = meeting.speakers?.find(s => s.id === segment.speakerId);
                const speakerName = speaker ? speaker.name : 'Unknown Speaker';

                // Speaker change
                if (segment.speakerId !== currentSpeakerId) {
                    output += `\n${speakerName}:\n`;
                    currentSpeakerId = segment.speakerId;
                }

                output += `${segment.text}\n`;

                if (segment.translatedText) {
                    output += `  [Translation: ${segment.translatedText}]\n`;
                }
            });
        }

        this.downloadFile(output, `${this.sanitizeFilename(meeting.title)}.txt`, 'text/plain');
    }

    exportAsMarkdown(meeting) {
        let output = '';

        // Header
        output += `# ${meeting.title || 'Untitled Meeting'}\n\n`;
        output += `**Date:** ${new Date(meeting.startDate).toLocaleString()}  \n`;
        output += `**Duration:** ${this.formatDuration(meeting.duration)}  \n`;

        if (meeting.speakers && meeting.speakers.length > 0) {
            output += `**Speakers:** ${meeting.speakers.length}  \n`;
        }

        output += '\n---\n\n';

        // Speakers section
        if (meeting.speakers && meeting.speakers.length > 0) {
            output += '## Speakers\n\n';
            
            meeting.speakers.forEach((speaker, index) => {
                const percentage = ((speaker.totalDuration / meeting.duration) * 100).toFixed(1);
                output += `- **${speaker.name}** - ${percentage}% of meeting (${speaker.segmentCount} segments)\n`;
            });

            output += '\n';
        }

        // Transcript
        if (meeting.segments && meeting.segments.length > 0) {
            output += '## Transcript\n\n';
            
            let currentSpeakerId = null;

            meeting.segments.forEach(segment => {
                const speaker = meeting.speakers?.find(s => s.id === segment.speakerId);
                const speakerName = speaker ? speaker.name : 'Unknown Speaker';
                const timestamp = this.formatTimestamp(segment.startTime);

                // Speaker change
                if (segment.speakerId !== currentSpeakerId) {
                    output += `\n**${speakerName}** \`${timestamp}\`  \n`;
                    currentSpeakerId = segment.speakerId;
                }

                output += `${segment.text}\n\n`;

                if (segment.translatedText) {
                    output += `> *Translation: ${segment.translatedText}*\n\n`;
                }
            });
        }

        this.downloadFile(output, `${this.sanitizeFilename(meeting.title)}.md`, 'text/markdown');
    }

    exportAsSRT(meeting) {
        let output = '';
        let index = 1;

        if (!meeting.segments || meeting.segments.length === 0) {
            throw new Error('No transcript available to export');
        }

        meeting.segments.forEach(segment => {
            const speaker = meeting.speakers?.find(s => s.id === segment.speakerId);
            const speakerName = speaker ? speaker.name : 'Unknown';

            const startTime = this.formatSRTTime(segment.startTime);
            const endTime = this.formatSRTTime(segment.endTime);

            // Subtitle index
            output += `${index}\n`;

            // Timestamp
            output += `${startTime} --> ${endTime}\n`;

            // Text with speaker label
            output += `[${speakerName}] ${segment.text}\n`;

            // Translation as second line if available
            if (segment.translatedText) {
                output += `${segment.translatedText}\n`;
            }

            output += '\n';
            index++;
        });

        this.downloadFile(output, `${this.sanitizeFilename(meeting.title)}.srt`, 'text/srt');
    }

    exportAsJSON(meeting) {
        // Clean up meeting data for export
        const exportData = {
            title: meeting.title,
            startDate: meeting.startDate,
            endDate: meeting.endDate,
            duration: meeting.duration,
            speakers: meeting.speakers,
            segments: meeting.segments.map(s => ({
                startTime: s.startTime,
                endTime: s.endTime,
                text: s.text,
                confidence: s.confidence,
                speakerId: s.speakerId,
                translatedText: s.translatedText
            })),
            translationEnabled: meeting.translationEnabled,
            targetLanguage: meeting.targetLanguage,
            metadata: {
                exportedAt: new Date().toISOString(),
                version: '1.0.0'
            }
        };

        const json = JSON.stringify(exportData, null, 2);
        this.downloadFile(json, `${this.sanitizeFilename(meeting.title)}.json`, 'application/json');
    }

    downloadFile(content, filename, mimeType) {
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        
        // Cleanup
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        console.log(`📥 Exported: ${filename}`);
    }

    sanitizeFilename(filename) {
        return filename.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    }

    formatDuration(seconds) {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);

        if (hours > 0) {
            return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
        } else {
            return `${minutes}:${String(secs).padStart(2, '0')}`;
        }
    }

    formatTimestamp(seconds) {
        const minutes = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }

    formatSRTTime(seconds) {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);
        const ms = Math.floor((seconds % 1) * 1000);

        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
    }
}

export default ExportManager;
