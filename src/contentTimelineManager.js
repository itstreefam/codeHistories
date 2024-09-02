const vscode = require('vscode');
const Diff = require('diff');
const diff2html = require('diff2html');
const path = require('path');

class ContentTimelineManager {
    constructor() {
        this.contentTimeline = [];
        this.webviewPanel = null;
        this.currentEvent = null;
        this.idCounter = 0;
        this.eventHtmlMap = {}; // Map to track event ID and its corresponding HTML element
    }

    processEvent(event) {
        this.currentEvent = {
            id: this.idCounter++,
            time: event.time,
            type: event.type,
            data: event
        };

        // Treat each event as an individual event
        this.contentTimeline.push(this.currentEvent);
        this.eventHtmlMap[this.currentEvent.id] = this.generateEventHTML(this.currentEvent);

        this.updateWebPanel();
    }

    generateEventHTML(event) {
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
                // Single line selection
                const highlightedLine = line.substring(0, startChar) +
                    `<strong>${line.substring(startChar, endChar)}</strong>` +
                    line.substring(endChar);
                return `${lineNumber}: ${highlightedLine}`;
            } else if (lineNumber === startLine) {
                // Start of a multi-line selection
                const highlightedLine = line.substring(0, startChar) +
                    `<strong>${line.substring(startChar)}</strong>`;
                return `${lineNumber}: ${highlightedLine}`;
            } else if (lineNumber === endLine) {
                // End of a multi-line selection
                const highlightedLine = `<strong>${line.substring(0, endChar)}</strong>` +
                    line.substring(endChar);
                return `${lineNumber}: ${highlightedLine}`;
            } else {
                // Fully selected line in the middle
                return `${lineNumber}: <strong>${line}</strong>`;
            }
        }).join('<br>');
    
        const html = `
            <div id="event-${event.id}">
                <strong>${fileName}</strong><br>
                <code style="color:black;">
                    ${htmlLines}
                </code><br>
                Click: ${new Date(event.time * 1000).toLocaleTimeString()}
            </div>
        `;
    
        return html;
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
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Content Timeline</title>
                <style>
                    body {
                        font-family: Arial, sans-serif;
                    }
                    .event {
                        margin: 10px;
                        padding: 10px;
                        border: 1px solid #ccc;
                    }
                    .event-type {
                        font-size: 1.2em;
                    }
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