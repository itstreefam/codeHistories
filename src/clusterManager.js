const fuzzball = require('fuzzball');
const vscode = require('vscode');

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
                    .collapsible {
                        background-color: #777;
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
                        padding: 0 18px;
                        display: none;
                        overflow: hidden;
                        background-color: #f1f1f1;
                    }

                    .stray-event {
                        background-color: #f9f9f9;
                        margin: 5px 0;
                        padding: 10px;
                        border: 1px solid #ddd;
                    }
                </style>
            </head>
            <body>
                <h1>Grouped Events</h1>
                ${groupedEventsHTML}

                <h1>Stray Events</h1>
                ${strayEventsHTML}

                <script>
                    const vscode = acquireVsCodeApi();

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
            </body>
            </html>`;
    }

    generateGroupedEventsHTML() {
        if (this.groupedEvents.length === 0) {
            return '<p>No grouped events.</p>';
        }

        return this.groupedEvents.map((event, index) => `
            <button type="button" class="collapsible">Group ${index + 1}</button>
            <div class="content">
                <ul>
                    ${event.code_text}
                </ul>
            </div>
        `).join('');
    }

    generateStrayEventsHTML() {
        if (this.strayEvents.length === 0) {
            return '<p>No stray events.</p>';
        }

        return this.strayEvents.map((event, index) => `
            <div class="stray-event">
                <p>Event ${index + 1}: ${event.code_text}</p>
            </div>
        `).join('');
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
