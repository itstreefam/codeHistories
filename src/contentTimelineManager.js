const vscode = require('vscode');
const Diff = require('diff');
const diff2html = require('diff2html');
const path = require('path');
const fs = require('fs');
const { contentTimelineStyles } = require('./webViewStyles');
const { getCurrentDir } = require('./helpers');

class ContentTimelineManager {
    constructor(context, gitTracker, stayPersistent) {
        this.context = context;
        this.gitTracker = gitTracker;
        this.contentTimeline = [];
        this.webviewPanel = null;
        this.currentEvent = null;
        this.idCounter = 0;
        this.eventHtmlMap = {}; // Map to track event ID and its corresponding HTML element
        this.previousSaveContent = {}; // To store the previous version of the file content
        this.styles = contentTimelineStyles;
        this.isInitialized = false;
        this.isPanelClosed = false;
        this.stayPersistent = stayPersistent;
        this.hasRestoredFromLastSession = false; // Track if we restored from last session
    }

    async restoreStateFromFile() {
        if (this.hasRestoredFromLastSession) return; // Prevent re-loading

        try {
            const currentDir = getCurrentDir();
            const statePath = path.join(currentDir, 'CH_cfg_and_logs', 'content_timeline_session_state.json');

            if (fs.existsSync(statePath)) {
                const stateJSON = fs.readFileSync(statePath, 'utf8');
                const state = JSON.parse(stateJSON);

                this.contentTimeline = state.contentTimeline || [];
                this.eventHtmlMap = state.eventHtmlMap || {};
                this.previousSaveContent = state.previousSaveContent || {};
                this.idCounter = state.idCounter || 0;
                this.currentEvent = state.currentEvent || null;

                this.hasRestoredFromLastSession = true;
                console.log(`Successfully restored content timeline state from last session`);
            }
        } catch (error) {
            console.error('Could not restore content timeline session state, starting fresh:', error);
        
            this.contentTimeline = [];
            this.eventHtmlMap = {};
            this.previousSaveContent = {};
            this.idCounter = 0;
            this.currentEvent = null;
        }
    }

    async initializeContentTimelineManager() {
        await this.restoreStateFromFile(); // Restore state if available
        
        if (!this.hasRestoredFromLastSession) {
            const initialCodeEntries = await this.gitTracker.grabAllLatestCommitFiles();
            for (const entry of initialCodeEntries) {
                await this.processEvent(entry);
            }
        }
        
        this.isInitialized = true;
    }

    async initializeWebview(){
        if(this.isPanelClosed && this.stayPersistent === false){
            return;
        }

        // Check if the webview is already opened
        if (this.webviewPanel) {
            this.webviewPanel.reveal(vscode.ViewColumn.Beside);
            return;
        }

        this.webviewPanel = vscode.window.createWebviewPanel(
            'contentTimelineWebview',
            'Content Timeline Webview',
            vscode.ViewColumn.Beside,
            {
                enableScripts: true,
                enableFindWidget: true
            }
        );

        await this.updateWebPanel();

        // Save the state when the webview is closed
        this.webviewPanel.onDidDispose(() => {
            if (this.stayPersistent === false) this.isPanelClosed = true;
            this.webviewPanel = null; // Clean up the reference
        });
    }

    async processEvent(event) {
        this.currentEvent = {
            id: this.idCounter++,
            time: event.time,
            type: event.type,
            data: event
        };

        if (event.type === 'save' || event.type === 'code') {
            await this.handleSaveEvent(this.currentEvent);
        } else if (event.type === 'execution') {
            await this.handleExecutionEvent(this.currentEvent);
        }

        if(!this.isInitialized){
            return;
        }

        // Trigger webview if not opened
        if (!this.webviewPanel) {
            await this.initializeWebview();
        } else {
            // If webview is already opened, just update the content
            await this.updateWebPanel();
        }
    }

    async processWebEvents(webEventsList) {
        if (!webEventsList || webEventsList.length === 0) {
            return;
        }

        console.log('In processWebEvents', webEventsList);

        // Remove duplicate visits within 3 seconds
        const filteredEvents = this.removeDuplicateVisits(webEventsList);

        for (const entry of filteredEvents) {
            const webEvent = {
                id: this.idCounter++,
                time: entry.time,
                type: this.getWebEventType(entry.notes),
                data: entry
            };

            await this.handleWebEvent(webEvent);
        }

        if (!this.isInitialized) {
            return;
        }

        // Trigger webview if not opened
        if (!this.webviewPanel) {
            await this.initializeWebview();
        } else {
            // If webview is already opened, just update the content
            await this.updateWebPanel();
        }
    }

    removeDuplicateVisits(webEventsList) {
        const filtered = [];
        const visitTracker = new Map(); // Track URL -> last visit time

        for (const event of webEventsList) {
            const eventType = this.getWebEventType(event.notes);
            
            const url = event.timed_url;
            const currentTime = event.time;
            
            // Check if we've seen this URL recently (within 3 seconds)
            if (visitTracker.has(url)) {
                const lastVisitTime = visitTracker.get(url);
                if (currentTime - lastVisitTime < 3) {
                    // Skip this duplicate visit
                    console.log(`Skipping duplicate visit to ${url} within 3 seconds`);
                    continue;
                }
            }
            
            // Update the tracker with current visit time
            visitTracker.set(url, currentTime);
            
            filtered.push(event);
        }

        return filtered;
    }

    getWebEventType(notes) {
        if (notes.startsWith('search:')) {
            return 'search';
        } else if (notes.startsWith('visit:')) {
            return 'visit';
        } else if (notes.startsWith('revisit:')) {
            return 'revisit';
        }
        return 'unknown';
    }

    async handleWebEvent(event) {
        const eventType = event.type;
        
        // Clean up the notes to extract just the essential information
        let cleanedInfo = '';
        
        if (eventType === 'search') {
            // Extract just the search query (remove "search:" and trailing ";")
            cleanedInfo = event.data.notes.replace('search:', '').replace(';', '').trim();
        } else if (eventType === 'visit' || eventType === 'revisit') {
            // Extract just the page title (remove "visit:"/"revisit:" and trailing ";")
            cleanedInfo = event.data.notes.replace(/^(visit:|revisit:)/, '').replace(/;$/, '').trim();
        }

        // Store the cleaned info for display
        event.data.cleanedInfo = cleanedInfo;
        event.data.formattedTime = `${new Date(event.time * 1000).toLocaleDateString()} ${new Date(event.time * 1000).toLocaleTimeString()}`;

        this.contentTimeline.push(event);
        this.eventHtmlMap[event.id] = await this.generateWebEventHTML(event);
    }

    async handleSaveEvent(event) {
        console.log('In handleSaveEvent:', event);

        const documentPath = event.data.document;
        const newContent = event.data.code_text;
        const fileName = this.getFilename(documentPath);
    
        let diffHtml = '';
        if (this.previousSaveContent[fileName]) {
            // File has previous content, show normal diff
            const diff = Diff.createTwoFilesPatch(
                'Previous Version',
                'Current Version',
                this.previousSaveContent[fileName],
                newContent,
                '',
                ''
            );
    
            diffHtml = await this.generateDiffHTML(diff, fileName);
        } else {
            // First save of file (or no previous content), show entire content as additions
            const diff = Diff.createTwoFilesPatch(
                'Empty File',
                'New File',
                '', // Empty previous content
                newContent,
                '',
                ''
            );
    
            diffHtml = await this.generateDiffHTML(diff, fileName);
        }
    
        this.previousSaveContent[fileName] = newContent;
        // console.log('In handleSaveEvent:', this.previousSaveContent);
    
        event.data.diffHtml = diffHtml;
        event.data.notes = `Save at ${new Date(event.time * 1000).toLocaleDateString()} ${new Date(event.time * 1000).toLocaleTimeString()}`;
    
        this.contentTimeline.push(event);
        this.eventHtmlMap[event.id] = await this.generateEventHTML(event);
    }    
    
    async handleExecutionEvent(event) {
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
        this.eventHtmlMap[buildEvent.id] = await this.generateBuildHTML(buildEvent);
    }

    async generateDiffHTML(diff, fileName) {
        const diffHtml = diff2html.html(diff, {
            outputFormat: 'side-by-side',
            drawFileList: false,
            colorScheme: 'light' // using light theme to be consistent with other webview styles
        });
        // console.log(diffHtml);

        let lastLineNumber = null;
        const modifiedHtml = diffHtml
            .replace(/<td class="d2h-code-side-linenumber(?: [\w-]+)*">\s*(\d+)\s*<\/td>/g, (match, lineNumber) => {
                lastLineNumber = lineNumber; // Store the current line number for later
                return `<td class="d2h-code-side-linenumber">
                            <span class="clickable-line" data-line-number="${lineNumber - 1}" data-filename="${fileName}">${lineNumber}</span>
                        </td>`;
            });

        const finalHtml = modifiedHtml.replace(/<span class="d2h-code-line-ctn">(.+?)<\/span>/g, (match, content) => {
            // Apply the line number to the corresponding code content
            if (lastLineNumber) {
                return `<span class="clickable-line d2h-code-line-ctn" data-line-number="${lastLineNumber}" data-filename="${fileName}" data-line-content="${content.trim()}">${content}</span>`;
            } else {
                return match; // If no valid line number, return the original match
            }
        });
            
        // Handle empty placeholder lines for deleted content
        finalHtml.replace(/<td class="d2h-code-side-linenumber d2h-code-side-emptyplaceholder(?: [\w-]+)*"><\/td>/g, () => {
                return `<td class="d2h-code-side-linenumber d2h-code-side-emptyplaceholder">
                            <span class="clickable-line" data-line-number="${lastLineNumber}" data-filename="${fileName}"></span>
                        </td>`;
            });

        return `<div class="diff-container">${finalHtml}</div>`;
    }    

    async generateWebEventHTML(event) {
        const eventType = event.type;
        let displayContent = '';
        const url = event.data.timed_url || '';
        const cleanedInfo = event.data.cleanedInfo || '';
        const timestamp = event.data.formattedTime || '';

        if (eventType === 'search') {
            // Show only the search query in bold
            displayContent = `<div class="web-event">
                <strong>${cleanedInfo}</strong>
            </div>`;
        } else if (eventType === 'visit' || eventType === 'revisit') {
            // Show page title in bold + clickable URL
            displayContent = `<div class="web-event">
                <strong>${cleanedInfo}</strong>
                ${url ? `<br><a href="${url}" target="_blank">${url}</a>` : ''}
            </div>`;
        }

        return `
            <div class="event" id="event-${event.id}">
                <div class="event-content">
                    ${displayContent}
                </div>
                <div class="event-timestamp">
                    ${timestamp}
                </div>
            </div>
        `;
    }

    async generateEventHTML(event) {
        const fileName = this.getFilename(event.data.document);

        return `
            <div class="event" id="event-${event.id}">
                <span data-file="${fileName}">
                    <strong>${fileName}</strong>
                </span>    
                <br>
                <div class="event-content">
                    ${event.data.diffHtml || ''}
                </div>
                ${event.data.notes}
            </div>
        `;
    }

    async updateWebPanel() {
        if(!this.webviewPanel){
            this.webviewPanel = vscode.window.createWebviewPanel(
                'contentTimelineWebview',
                'Content Timeline Webview',
                vscode.ViewColumn.Beside,
                { 
                    enableScripts: true,
                    enableFindWidget: true
                }
            );
        }

        this.webviewPanel.webview.html = `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <title>Content Timeline</title>
                <link rel="stylesheet" type="text/css" href="https://cdn.jsdelivr.net/npm/diff2html/bundles/css/diff2html.min.css" />
                <script type="text/javascript" src="https://cdn.jsdelivr.net/npm/diff2html/bundles/js/diff2html.min.js"></script>
                <style>
                    ${this.styles}
                </style>
            </head>
            <body>
                <h1>Content Timeline</h1>
                <div id="content">
                    ${Object.values(this.eventHtmlMap).join('')}
                </div>
            </body>
            <script>
                (function() {
                    const vscode = acquireVsCodeApi();

                    window.addEventListener('click', function(event) {
                        const target = event.target;

                        // Find the closest clickable-line SPAN or DIV (for both line content and line numbers)
                        const lineElement = target.closest('.clickable-line');
                        if (lineElement) {
                            // Print out the HTML tag of the clicked element for debugging
                            console.log("Clicked element:", lineElement.outerHTML);

                            // Continue with the existing logic (optional)
                            const lineNumber = lineElement.getAttribute('data-line-number');
                            const fileName = lineElement.getAttribute('data-filename');

                            console.log('Line Number:', lineNumber);
                            console.log('File Name:', fileName);

                            vscode.postMessage({
                                command: 'navigateToLine',
                                line: lineNumber,
                                fileName: fileName
                            });
                        }
                    });
                })();
            </script>
            </html>
        `;

        this.webviewPanel.webview.onDidReceiveMessage(async (message) => {
            if (message.command === 'navigateToLine') {
                await this.navigateToLine(message.fileName, message.line);
            }
        });
    }

    async navigateToLine(fileName, lineNumber) {
        let fileUri;
        if(path.isAbsolute(fileName)){
            fileUri = vscode.Uri.file(fileName);
        } else {
            // resolve the filename relative to the workspace
            const workspaceFolder = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
            if(workspaceFolder){
                const resolvedPath = path.join(workspaceFolder.uri.fsPath, fileName);
                fileUri = vscode.Uri.file(resolvedPath);
            } else {
                vscode.window.showErrorMessage('No workspace folder is open. Unable to resolve relative file path.');
                return;
            }
        }
    
        try {
            // Check if the file is already opened in any visible editor
            const openedEditor = vscode.window.visibleTextEditors.find(editor => {
                const editorFilePath = editor.document.uri.fsPath;
                return editorFilePath === fileUri.fsPath;
            });

            if (openedEditor) {
                // The file is already opened, navigate to the correct line
                const document = openedEditor.document;
                const lineCount = document.lineCount;

                // Validate the line number and find the nearest valid line if necessary
                const validLine = Math.min(Math.max(0, lineNumber), lineCount - 1);

                // Create a range for the target line
                const range = new vscode.Range(validLine, 0, validLine, 0);

                // Reveal the target line in the editor
                openedEditor.revealRange(range, vscode.TextEditorRevealType.InCenter);
                openedEditor.selection = new vscode.Selection(range.start, range.end);
            } else {
                // The file is not opened, open it in a new tab on the main editor (ViewColumn.One)
                const document = await vscode.workspace.openTextDocument(fileUri);
                const editor = await vscode.window.showTextDocument(document, {
                    viewColumn: vscode.ViewColumn.One, // Open in the left/main editor tab
                    preserveFocus: false // Focus on the new tab
                });
                const lineCount = document.lineCount;

                // Validate the line number and find the nearest valid line if necessary
                const validLine = Math.min(Math.max(0, lineNumber), lineCount - 1);

                // Create a range for the target line
                const range = new vscode.Range(validLine, 0, validLine, 0);

                // Reveal the target line in the editor
                editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
                editor.selection = new vscode.Selection(range.start, range.end);
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Unable to open or navigate to file: ${fileName}. Error: ${error.message}`);
        }
    }
    
    getFilename(documentPath) {
        // Extract the filename from the full path
        return path.basename(documentPath);
    }

    getWebviewContent() {
        return this.webviewPanel.webview.html;
    }

    disposeWebview() {
        if (this.webviewPanel) {
            this.webviewPanel.dispose();
        }
    }
}

module.exports = ContentTimelineManager;