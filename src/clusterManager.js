const fuzzball = require('fuzzball');
const vscode = require('vscode');
const Diff = require('diff');

class ClusterManager {
    constructor() {
        this.inCluster = false;  // Tracks if we are currently grouping events into a cluster
        this.clusterStartTime = 0;  // Tracks the start time of the current cluster
        this.groupedEvents = [];  // Stores events that are part of a cluster
        this.strayEvents = [];  // Stores events that do not fit into any cluster
        this.pastEvent = null;  // Stores the previous event to compare against
        this.MAX_NEW_LINES = 5;  // Maximum number of new lines that can be added/deleted between events
        this.debug = false;  // Debug flag to print out additional information
        this.webviewPanel = null;
    }

    // Method to process a new event in real-time
    processEvent(codeEntry) {
        // only pay attention to code or save events
        if (!codeEntry.notes.startsWith("code") && !codeEntry.notes.startsWith("save")) {
            return;
        }

        // Only pay attention when there's actually some code
        if (codeEntry.code_text.trim().length > 0) {
            if (this.pastEvent) {
                const filename = this.getFilename(codeEntry.notes);

                if (filename !== "webData") {
                    this.match_lines(filename, this.pastEvent, codeEntry);
                }
            } else {
                // If this is the first event, it is treated as a stray until a cluster can be formed
                this.strayEvents.push(codeEntry);
            }
            // Update the pastEvent with the current event after processing
            this.pastEvent = codeEntry;
        }

        this.updateWebPanel();
    }

    // Method to match lines between events and determine if they belong in the same cluster
    match_lines(filename, pastEvt, currEvt) {
        const pastLines = this.get_code_lines(pastEvt.code_text);
        const currentLines = this.get_code_lines(currEvt.code_text);

        const pastFilename = this.getFilename(pastEvt.notes);
        const currFilename = this.getFilename(currEvt.notes);
        const currTime = currEvt.time;

        let idx = 0;
        let partialMatches = 0;
        let partialMatchLines = [];
        let newLines = [];
        let perfectMatches = [];

        for (const currentLine of currentLines) {
            const trimmedLine = currentLine.trim();  // Remove whitespace
            if (trimmedLine.length > 1) {
                const bestMatch = this.best_match(trimmedLine, pastLines);
                if (bestMatch.ratio >= 90 && bestMatch.ratio < 100) {
                    partialMatches += 1;
                    partialMatchLines.push(idx);
                } else if (bestMatch.ratio === 100) {
                    perfectMatches.push(idx);
                } else {
                    newLines.push(idx);
                }
                idx += 1;  // Ignore blank lines
            }
        }

        if (this.debug) {
            console.log(currFilename);
            if (pastFilename === currFilename) {
                console.log(`\tDEBUG ${pastEvt.time}-${currEvt.time} (${currFilename}): partialMatches=${partialMatches} perfectMatches=${perfectMatches.length} newLines=${newLines.length} currLineLength=${currentLines.length} pastLineLength=${pastLines.length}`);
            } else {
                console.log(`\tDEBUG ${pastEvt.time}-${currEvt.time}: Filename mismatch ${pastFilename} != ${currFilename}`);
            }

            if (pastEvt.time === currEvt.time) {
                console.log(`\tPAST ${pastEvt}\n`);
                console.log(`\tCURR ${currEvt}\n`);
            }
        }

        if (pastFilename !== currFilename) {
            if (this.inCluster) {
                console.log(`${this.clusterStartTime},${pastEvt.time},'code',${pastFilename}`);
                this.groupedEvents.push(pastEvt);
                this.inCluster = false;
            } else if (this.debug) {
                console.log(`\tDEBUG ${pastEvt.time}-${currEvt.time}: not in cluster ${pastFilename} != ${currFilename}`);
            }
            this.strayEvents.push(currEvt);  // Different file, consider it a stray event
            return;
        }

        // Continue existing clusters only if conditions are met
        if (partialMatches === 0 && perfectMatches.length > 0 && newLines.length === 0 && currentLines.length === pastLines.length) {
            if (this.debug) console.log("\tcontinue cluster");
            if (this.inCluster) {
                this.groupedEvents.push(currEvt);
            }
        }

        // Start or continue clusters when conditions are met
        else if (partialMatches > 0 && currentLines.length === pastLines.length) {
            if (this.debug) console.log("\t>=1 line edited; start new cluster");
            if (!this.inCluster) {
                this.inCluster = true;
                this.clusterStartTime = pastEvt.time;
            }
            this.groupedEvents.push(currEvt);
            this.clearStrayEvents(currEvt); // Remove from stray events if grouped
        } else if (perfectMatches.length > 0 && currentLines.length !== pastLines.length && (currentLines.length - pastLines.length <= this.MAX_NEW_LINES) && newLines.length <= this.MAX_NEW_LINES) {
            if (this.debug) console.log("\t1-3 lines added/deleted; start new cluster");
            if (!this.inCluster) {
                this.inCluster = true;
                this.clusterStartTime = pastEvt.time;
            }
            this.groupedEvents.push(currEvt);
            this.clearStrayEvents(currEvt); // Remove from stray events if grouped
        } else if (partialMatches === 0 && perfectMatches.length > 0 && newLines.length > 0 && currentLines.length === pastLines.length) {
            if (this.debug) console.log("\t>= 1 line replaced; start new cluster");
            if (!this.inCluster) {
                this.inCluster = true;
                this.clusterStartTime = pastEvt.time;
            }
            this.groupedEvents.push(currEvt);
            this.clearStrayEvents(currEvt); // Remove from stray events if grouped
        } else if (partialMatches === 0 && perfectMatches.length > 0 && newLines.length === 0 && currentLines.length !== pastLines.length) {
            if (this.debug) console.log("\twhitespace changes only; start new cluster");
            if (!this.inCluster) {
                this.inCluster = true;
                this.clusterStartTime = pastEvt.time;
            }
            this.groupedEvents.push(currEvt);
            this.clearStrayEvents(currEvt); // Remove from stray events if grouped
        } else {
            if (this.inCluster) {
                // console.log(`${this.clusterStartTime},${pastEvt.time},'code',${pastFilename}`);
                // this.groupedEvents.push(pastEvt);
                if (this.debug) {
                    console.log(`${currTime}: partialMatches=${partialMatches} perfectMatches=${perfectMatches.length} newLines=${newLines.length} currLineLength=${currentLines.length} pastLineLength=${pastLines.length}`);
                    console.log("\n");
                }
                this.finalizeGroup();
            }
            this.strayEvents.push(currEvt);  // Event does not fit into any cluster
            this.inCluster = false;
        }
    }

    clearStrayEvents(event) {
        this.strayEvents = this.strayEvents.filter(e => e !== event);
    }

    finalizeGroup() {
        console.log('Finalizing group', this.groupedEvents);
        this.groupedEvents = [];
        this.inCluster = false;
        this.updateWebPanel();
    }

    updateWebPanel() {
        if (!this.webviewPanel) {
            this.webviewPanel = vscode.window.createWebviewPanel(
                'historyWebview',
                'History Webview',
                vscode.ViewColumn.Beside,
                { enableScripts: true }
            );
        }

        const groupedEventsHTML = this.generateGroupedEventsHTML();
        const strayEventsHTML = this.generateStrayEventsHTML();

        this.webviewPanel.webview.html = `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <title>Code Clusters</title>
                <style>
                    body {
                        font-family: Arial, sans-serif;
                        background-color: #1e1e1e;
                        color: #d4d4d4;
                    }
                    h1 {
                        color: #f0f0f0;
                        font-size: 20px;
                        margin-bottom: 15px;
                    }
                    ul {
                        list-style-type: none;
                        padding-left: 0;
                    }
                    li {
                        background-color: #2e2e2e;
                        margin-bottom: 10px;
                        padding: 10px;
                        border-radius: 5px;
                    }
                    .collapsible {
                        background-color: #444;
                        color: white;
                        cursor: pointer;
                        padding: 10px;
                        width: 100%;
                        border: none;
                        text-align: left;
                        outline: none;
                        font-size: 15px;
                    }
                    .content {
                        padding: 10px;
                        display: none;
                        overflow: hidden;
                        background-color: #333;
                        color: white;
                        margin-top: 5px;
                    }
                    .stray-event {
                        background-color: #444;
                        margin: 10px 0;
                        padding: 10px;
                        border-radius: 5px;
                        color: white;
                    }
                    pre {
                        background-color: #2e2e2e;
                        padding: 10px;
                        border-radius: 5px;
                        overflow-x: auto;
                    }
                    .diff-added {
                        color: #00ff00;
                    }
                    .diff-removed {
                        color: #ff0000;
                    }
                    .diff-context {
                        color: #ffffff;
                    }
                </style>
            </head>
            <body>
                <h1>Grouped Events</h1>
                <ul>
                    ${groupedEventsHTML}
                </ul>

                <h1>Stray Events</h1>
                <ul>
                    ${strayEventsHTML}
                </ul>

                <script>
                    document.querySelectorAll('.collapsible').forEach(coll => {
                        coll.addEventListener('click', function() {
                            this.classList.toggle('active');
                            const content = this.nextElementSibling;
                            if (content.style.display === 'block') {
                                content.style.display = 'none';
                            } else {
                                content.style.display = 'block';
                            }
                        });
                    });
                </script>
                <script src="https://cdn.jsdelivr.net/npm/diff2html/bundles/js/diff2html.min.js"></script>
            </body>
            </html>`;
    }

    generateGroupedEventsHTML() {
        if (this.groupedEvents.length === 0) {
            return '<li>No grouped events.</li>';
        }

        return this.groupedEvents.map((event, index) => {
            const diffSnippet = this.generateDiffSnippet(event);

            // example time: 1723572314
            // convert this to MM/DD/YYYY HH:MM:SS
            const humanReadableTime = new Date(event.time * 1000).toLocaleString();
            const filename = this.getFilename(event.notes);

            // Condense content: Only show a few lines or the diff if there's a diff
            const contentSnippet = diffSnippet ? diffSnippet : this.condenseContent(event.code_text);

            return `
                <li>
                    <button type="button" class="collapsible">Group ${index + 1}</button>
                    <div class="content">
                        <p><strong>${humanReadableTime}</strong> - <em>${filename}</em></p>
                        <div>${contentSnippet}</div>
                    </div>
                </li>
            `;
        }).join('');
    }

    generateStrayEventsHTML() {
        if (this.strayEvents.length === 0) {
            return '<li>No stray events.</li>';
        }

        return this.strayEvents.map((event, index) => {
            const diffSnippet = this.generateDiffSnippet(event);
            const humanReadableTime = new Date(event.time * 1000).toLocaleString();
            const filename = this.getFilename(event.notes);

            // Condense content: Only show a few lines or the diff if there's a diff
            const contentSnippet = diffSnippet ? diffSnippet : this.condenseContent(event.code_text);

            return `
                <li class="stray-event">
                    <p><strong>${humanReadableTime}</strong> - <em>${filename}</em></p>
                    <div>${contentSnippet}</div>
                </li>
            `;
        }).join('');
    }  

    generateDiffSnippet(event) {
        const pastLines = this.pastEvent ? this.get_code_lines(this.pastEvent.code_text) : [];
        const currentLines = this.get_code_lines(event.code_text);
    
        // Generate diff
        const diff = Diff.diffLines(pastLines.join('\n'), currentLines.join('\n'));
    
        // Check if there's any diff
        const hasDiff = diff.some(part => part.added || part.removed);
    
        if (!hasDiff) {
            return null; // No differences detected, return null
        }
    
        // Map through the diff and render it with line numbers
        return `<pre>${diff.map((part, index) => {
            if (part.added) {
                return `<span class="diff-added">+ ${part.value.replace(/\n/g, '<br>')}</span>`;
            } else if (part.removed) {
                return `<span class="diff-removed">- ${part.value.replace(/\n/g, '<br>')}</span>`;
            } else {
                return `<span class="diff-context"> ${part.value.replace(/\n/g, '<br>')}</span>`;
            }
        }).join('<br>')}</pre>`;
    }

    condenseContent(codeText) {
        const lines = codeText.split('\n');
        const snippet = lines.slice(0, 3).join('<br>'); // Display only the first 3 lines
        return `<pre>${snippet}</pre>`;
    }  

    best_match(target, lines) {
        if (target.length > 0) {
            let match = null;
            let maxRatio = 0.0;
            for (const line of lines) {
                if (line.length > 0) {
                    const ratio = fuzzball.ratio(target, line);
                    if (ratio > maxRatio) {
                        maxRatio = ratio;
                        match = line;
                    }
                }
            }
            return { target: target, match: match, ratio: maxRatio };
        } else {
            return { target: target, match: null, ratio: 0.0 };
        }
    }

    get_code_lines(code_text) {
        return code_text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    }

    getFilename(notes) {
        let filename = notes.substring(6);
        if (filename.includes(';')) {
            filename = filename.split(';')[0];
        }
        return filename;
    }
}

module.exports = ClusterManager;
