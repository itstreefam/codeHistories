const vscode = require('vscode');
const Diff = require('diff');
const diff2html = require('diff2html');
const path = require('path');
const { contentTimelineStyles } = require('./webViewStyles');

class ContentTimelineManager {
    constructor() {
        this.contentTimeline = [];
        this.webviewPanel = null;
        this.currentEvent = null;
        this.idCounter = 0;
        this.eventHtmlMap = {}; // Map to track event ID and its corresponding HTML element
        this.previousSaveContent = {}; // To store the previous version of the file content
    }

    processEvent(event) {
        this.currentEvent = {
            id: this.idCounter++,
            time: event.time,
            type: event.type,
            data: event
        };

        if (event.type === 'save') {
            this.handleSaveEvent(this.currentEvent);
        } else if (event.type === 'execution') {
            this.handleExecutionEvent(this.currentEvent);
        } else if (event.type === 'selection') {
            this.handleSelectionEvent(this.currentEvent);
        }

        this.updateWebPanel();
    }

    handleSelectionEvent(event) {
        const fileName = this.getFilename(event.data.document);
        let htmlLines = '';

        const startLine = event.data.range[0];
        const endLine = event.data.range[1];
        const startChar = event.data.charRange[0];
        const endChar = event.data.charRange[1];
        const documentText = event.data.allText.split('\n');

        htmlLines = documentText.slice(startLine - 1, endLine).map((line, index) => {
            const lineNumber = startLine + index;

            if (lineNumber === startLine && lineNumber === endLine) {
                const highlightedLine = line.substring(0, startChar) +
                    `<strong>${line.substring(startChar, endChar)}</strong>` +
                    line.substring(endChar);
                return `${lineNumber}: ${highlightedLine}`;
            } else if (lineNumber === startLine) {
                const highlightedLine = line.substring(0, startChar) +
                    `<strong>${line.substring(startChar)}</strong>`;
                return `${lineNumber}: ${highlightedLine}`;
            } else if (lineNumber === endLine) {
                const highlightedLine = `<strong>${line.substring(0, endChar)}</strong>` +
                    line.substring(endChar);
                return `${lineNumber}: ${highlightedLine}`;
            } else {
                return `${lineNumber}: <strong>${line}</strong>`;
            }
        }).join('<br>');

        event.data.notes = `Click: ${new Date(event.time * 1000).toLocaleDateString()} ${new Date(event.time * 1000).toLocaleTimeString()}`;
        event.data.diffHtml = htmlLines;

        this.contentTimeline.push(event);
        this.eventHtmlMap[event.id] = this.generateEventHTML(event);
    }

    handleSaveEvent(event) {
        const documentPath = event.data.document;
        const newContent = event.data.code_text;
    
        let diffHtml = '';
        if (this.previousSaveContent[documentPath]) {
            const diff = Diff.createTwoFilesPatch(
                'Previous Version',
                'Current Version',
                this.previousSaveContent[documentPath],
                newContent,
                '',
                ''
            );
    
            diffHtml = this.generateDiffHTML(diff);
        }
    
        this.previousSaveContent[documentPath] = newContent;
    
        event.data.diffHtml = diffHtml;
        event.data.notes = `Save at ${new Date(event.time * 1000).toLocaleDateString()} ${new Date(event.time * 1000).toLocaleTimeString()}`;
    
        this.contentTimeline.push(event);
        this.eventHtmlMap[event.id] = this.generateEventHTML(event);
    }    
    
    handleExecutionEvent(event) {
        const buildEvent = {
            id: this.idCounter++,
            time: event.time,
            type: 'build',
            data: {
                document: event.data.document,
                notes: `Build at ${new Date(event.time * 1000).toLocaleDateString()} ${new Date(event.time * 1000).toLocaleTimeString()}`
            }
        };

        this.contentTimeline.push(buildEvent);
        this.eventHtmlMap[buildEvent.id] = this.generateBuildHTML(buildEvent);
    }

    generateDiffHTML(diff) {
        const outputFormat = 'side-by-side';
    
        const diff2htmlOutput = diff2html.parse(diff, {
            drawFileList: false,
            outputFormat: outputFormat,
            matching: 'none'
        });
    
        const diffHtml = diff2html.html(diff2htmlOutput);
    
        // Wrapping the diff in a styled container to prevent CSS spillover
        return `
            <div class="diff-container">
                ${diffHtml}
            </div>
        `;
    }    

    generateEventHTML(event) {
        const fileName = this.getFilename(event.data.document);

        return `
            <div class="event" id="event-${event.id}">
                <strong>${fileName}</strong><br>
                <div class="event-content">
                    ${event.data.diffHtml || ''}
                </div>
                ${event.data.notes}
            </div>
        `;
    }

    generateBuildHTML(event) {
        return `
            <hr>
            <div id="event-${event.id}">
                <strong>${event.data.notes}</strong>
            </div>
            <hr>
        `;
    }

    updateWebPanel() {
        if (!this.webviewPanel) {
            this.webviewPanel = vscode.window.createWebviewPanel(
                'contentTimeline',
                'Content Timeline',
                vscode.ViewColumn.Beside,
                { enableScripts: true }
            );
        }

        this.webviewPanel.webview.html = `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <title>Content Timeline</title>
                <script src="https://cdn.jsdelivr.net/npm/diff2html@3.4.48/bundles/js/diff2html-ui.min.js"></script>
                <link href="https://cdn.jsdelivr.net/npm/diff2html@3.4.48/bundles/css/diff2html.min.css" rel="stylesheet">
                <style>
                    ${contentTimelineStyles}
                </style>
            </head>
            <body>
                <h1>Content Timeline</h1>
                <div id="content">
                    ${Object.values(this.eventHtmlMap).join('')}
                </div>
            </body>
            </html>
        `;
    }  

    getFilename(documentPath) {
        return path.basename(documentPath);
    }
}

module.exports = ContentTimelineManager;