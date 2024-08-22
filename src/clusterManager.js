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

        console.log("Grouped Events: ", this.groupedEvents);
        console.log("Stray Events: ", this.strayEvents);

        // Display the resulting grouped and stray events
        return this.updateWebPanel(this.groupedEvents, this.strayEvents);
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
        } else if (perfectMatches.length > 0 && currentLines.length !== pastLines.length && (currentLines.length - pastLines.length <= this.MAX_NEW_LINES) && newLines.length <= this.MAX_NEW_LINES) {
            if (this.debug) console.log("\t1-3 lines added/deleted; start new cluster");
            if (!this.inCluster) {
                this.inCluster = true;
                this.clusterStartTime = pastEvt.time;
            }
            this.groupedEvents.push(currEvt);
        } else if (partialMatches === 0 && perfectMatches.length > 0 && newLines.length > 0 && currentLines.length === pastLines.length) {
            if (this.debug) console.log("\t>= 1 line replaced; start new cluster");
            if (!this.inCluster) {
                this.inCluster = true;
                this.clusterStartTime = pastEvt.time;
            }
            this.groupedEvents.push(currEvt);
        } else if (partialMatches === 0 && perfectMatches.length > 0 && newLines.length === 0 && currentLines.length !== pastLines.length) {
            if (this.debug) console.log("\twhitespace changes only; start new cluster");
            if (!this.inCluster) {
                this.inCluster = true;
                this.clusterStartTime = pastEvt.time;
            }
            this.groupedEvents.push(currEvt);
        } else {
            if (this.inCluster) {
                console.log(`${this.clusterStartTime},${pastEvt.time},'code',${pastFilename}`);
                this.groupedEvents.push(pastEvt);
                if (this.debug) {
                    console.log(`${currTime}: partialMatches=${partialMatches} perfectMatches=${perfectMatches.length} newLines=${newLines.length} currLineLength=${currentLines.length} pastLineLength=${pastLines.length}`);
                    console.log("\n");
                }
            }
            this.strayEvents.push(currEvt);  // Event does not fit into any cluster
            this.inCluster = false;
        }
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

    // Method to display the resulting grouped and stray events
    updateWebPanel(groupedEvents, strayEvents) {



        // Display as html table
        let html = "<table border='1'>";
        html += "<tr><th>Grouped Events</th></tr>";
        for (const event of groupedEvents) {
            html += `<tr><td>${event.time}</td><td>${event.notes}</td></tr>`;
        }
        html += "</table>";

        html += "<table border='1'>";
        html += "<tr><th>Stray Events</th></tr>";
        for (const event of strayEvents) {
            html += `<tr><td>${event.time}</td><td>${event.notes}</td></tr>`;
        }

        html += "</table>";

        const panel = vscode.window.createWebviewPanel(
            'historyWebview',
            'History Webview',
            vscode.ViewColumn.Beside, // Split the editor
            { enableScripts: true }
        );

        panel.webview.html = html;
    }

}

module.exports = ClusterManager;
