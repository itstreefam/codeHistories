const fuzzball = require('fuzzball');
const vscode = require('vscode');
const Diff = require('diff');
const diff2html = require('diff2html');

class ClusterManager {
    constructor() {
        this.inCluster = false;  // Tracks if we are currently grouping events into a cluster
        this.clusterStartTime = 0;  // Tracks the start time of the current cluster
        this.groupedEvents = {}; // Stores grouped events with a common cluster identifier
        this.groupCounter = 0;  // Counter to track the number of groups
        this.strayEvents = [];  // Stores events that do not fit into any cluster
        this.pastEvent = null;  // Stores the previous event to compare against
        this.MAX_NEW_LINES = 3;  // Maximum number of new lines that can be added/deleted between events
        this.debug = false;  // Debug flag to print out additional information
        this.webviewPanel = null;
    }

    // Method to process a new event in real-time
    processEvent(codeEntry) {
        console.log(codeEntry);

        // only pay attention to code or save events
        if (!codeEntry.notes.startsWith("code") && !codeEntry.notes.startsWith("save")) {
            if(codeEntry.notes.startsWith("search") || codeEntry.notes.startsWith("research") || codeEntry.notes.startsWith("revisit") || codeEntry.notes.startsWith("visit")) {
                // display the event in the web panel
                this.strayEvents.push(codeEntry);
                this.updateWebPanel();
            }
            return;
        }

        // Only pay attention when there's actually some code
        if (codeEntry.code_text.trim().length > 0) {
            const filename = this.getFilename(codeEntry.notes);

            if (this.pastEvent) {
                const pastFilename = this.getFilename(this.pastEvent.notes);

                // Finalize the cluster if switching files
                if (filename !== pastFilename) {
                    if (this.inCluster) {
                        this.finalizeGroup(pastFilename);
                        this.inCluster = false;
                    }
                    // Treat the current event as the start of a new cluster
                    this.strayEvents.push(codeEntry);
                } else {
                    // Process as usual if it's the same file
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

        // Always add the current event to the strayEvents initially
        this.strayEvents.push(currEvt);

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
                this.finalizeGroup(pastFilename);
                this.inCluster = false;
            } else if (this.debug) {
                console.log(`\tDEBUG ${pastEvt.time}-${currEvt.time}: not in cluster ${pastFilename} != ${currFilename}`);
            }
            return;
        }

        // continue existing clusters only....
        // no changes made, don't start a cluster, but continue if there's an existing one.
        if (partialMatches === 0 && perfectMatches.length > 0 && newLines.length === 0 && currentLines.length === pastLines.length) {
            if (this.debug) console.log("\tcontinue cluster");
            if (this.inCluster) {
                this.inCluster = true;
            }
        }

        // start or continue clusters.
        // at least one line has been edited, but nothing has been added/deleted
        else if (partialMatches > 0 && currentLines.length === pastLines.length) {
            if (this.debug) console.log("\t>=1 line edited; start new cluster");
            if (!this.inCluster) {
                this.inCluster = true;
                this.clusterStartTime = pastEvt.time;
            }
        // at least one line has been added or deleted, but fewer than 4 new lines.
        } else if (perfectMatches.length > 0 && currentLines.length !== pastLines.length && (currentLines.length - pastLines.length <= this.MAX_NEW_LINES) && newLines.length <= this.MAX_NEW_LINES) {
            if (this.debug) console.log("\t1-3 lines added/deleted; start new cluster");
            if (!this.inCluster) {
                this.inCluster = true;
                this.clusterStartTime = pastEvt.time;
            }
        } 
        // at least one line has been replaced, but code is the same length
        else if (partialMatches === 0 && perfectMatches.length > 0 && newLines.length > 0 && currentLines.length === pastLines.length) {
            if (this.debug) console.log("\t>= 1 line replaced; start new cluster");
            if (!this.inCluster) {
                this.inCluster = true;
                this.clusterStartTime = pastEvt.time;
            }
        } 
        // only white space changes, no edits or additions/deletions
        else if (partialMatches === 0 && perfectMatches.length > 0 && newLines.length === 0 && currentLines.length !== pastLines.length) {
            if (this.debug) console.log("\twhitespace changes only; start new cluster");
            if (!this.inCluster) {
                this.inCluster = true;
                this.clusterStartTime = pastEvt.time;
            }
        } else {
            // we've just come out of a cluster, so print it out
            if (this.inCluster) {
                console.log(`${this.clusterStartTime},${pastEvt.time},'code',${pastFilename}`);
                this.finalizeGroup(pastFilename);
                if (this.debug) {
                    console.log(`${currTime}: partialMatches=${partialMatches} perfectMatches=${perfectMatches.length} newLines=${newLines.length} currLineLength=${currentLines.length} pastLineLength=${pastLines.length}`);
                    console.log("\n");
                }
            }

            // if there's a big clump that's come in, then we should start another cluster immediately
            if ( (pastFilename === currFilename) && (perfectMatches.length > 0) && (currentLines.length - pastLines.length > this.MAX_NEW_LINES) ) {
                console.log(`\t starting new cluster ${pastEvt.time}`)
                this.clusterStartTime = pastEvt.time;
                this.inCluster = true;
            }
            else {
                this.inCluster = false;
            }
        }

        // update the web panel after processing the event
        this.updateWebPanel();
    }

    finalizeGroup(pastFilename) {
        // console.log(`${this.clusterStartTime},${pastEvt.time},'code',${pastFilename}`);
        let groupKey = `group-${this.groupCounter++}`;
        let startTime = this.clusterStartTime;
        let endTime = this.pastEvent.time;
        let type = this.pastEvent.notes.substring(0, 4);
        let filename = pastFilename;

        this.groupedEvents[groupKey] = { startTime, endTime, type, filename, events: [...this.strayEvents] };
        this.strayEvents = [];
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
                <script src="https://cdn.jsdelivr.net/npm/diff2html@3.4.48/bundles/js/diff2html-ui.min.js"></script>
                <link href="https://cdn.jsdelivr.net/npm/diff2html@3.4.48/bundles/css/diff2html.min.css" rel="stylesheet">
                <style>
                    body {
                        font-family: Arial, sans-serif;
                        background-color: #f5f5f5; /* Light background */
                        color: #333; /* Darker text for contrast */
                    }
                    h1 {
                        color: #333; /* Darker text for headers */
                        font-size: 20px;
                        margin-bottom: 15px;
                    }
                    ul {
                        list-style-type: none;
                        padding-left: 0;
                    }
                    li {
                        background-color: #ffffff; /* White background for list items */
                        margin-bottom: 10px;
                        padding: 10px;
                        border-radius: 5px;
                        box-shadow: 0px 0px 5px rgba(0, 0, 0, 0.1); /* Subtle shadow for depth */
                    }
                    .collapsible {
                        background-color: #f0f0f0; /* Light grey background for collapsible headers */
                        color: #333; /* Dark text */
                        cursor: pointer;
                        padding: 10px;
                        width: 100%;
                        border: none;
                        text-align: left;
                        outline: none;
                        font-size: 15px;
                        border-radius: 5px;
                    }
                    .content {
                        padding: 10px;
                        display: none;
                        overflow: hidden;
                        background-color: #fafafa; /* Even lighter grey for content */
                        color: #333; /* Dark text */
                        margin-top: 5px;
                        border-radius: 5px;
                    }
                    .stray-event {
                        background-color: #ffffff; /* White background for stray events */
                        margin: 10px 0;
                        padding: 10px;
                        border-radius: 5px;
                        box-shadow: 0px 0px 5px rgba(0, 0, 0, 0.1);
                    }
                    pre {
                        background-color: #f0f0f0; /* Light grey for code blocks */
                        padding: 10px;
                        border-radius: 5px;
                        overflow-x: auto;
                    }
                    .diff-container {
                        background-color: #ffffff; /* White background for diff container */
                        padding: 10px;
                        border-radius: 5px;
                        box-shadow: 0px 0px 5px rgba(0, 0, 0, 0.1);
                    }

                    .d2h-wrapper {
                        background-color: #ffffff;
                        color: #333;
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
            </body>
            </html>`;
    }

    generateGroupedEventsHTML() {
        if (Object.keys(this.groupedEvents).length === 0) {
            return '<li>No grouped events.</li>';
        }

        return Object.keys(this.groupedEvents).map((groupKey) => {
            return this.generateGroupHTML(groupKey);
        }).join('');
    }

    generateStrayEventsHTML() {
        if (this.strayEvents.length === 0) {
            return '<li>No stray events.</li>';
        }

        return this.strayEvents.map((event, index) => {
            const humanReadableTime = new Date(event.time * 1000).toLocaleString();
            const filename = this.getFilename(event.notes);
            if(event.notes.startsWith("code") || event.notes.startsWith("save")) {
                return `
                    <li class="stray-event">
                        <p><strong>${humanReadableTime}</strong> - <em>${filename}</em></p>
                    </li>
                `;
            } else {
                return `
                    <li class="stray-event">
                        <p><strong>${humanReadableTime}</strong> - <em>${event.notes}</em></p>
                    </li>
                `;
            }
        }).join('');
    }

    generateGroupHTML(groupKey) {
        const group = this.groupedEvents[groupKey];
    
        // Check if the group has at least two events
        if (group.events.length < 2) {
            return '';  // Skip rendering if there are fewer than two events
        }
    
        // compare the start code and end code
        const DiffHTML = this.generateDiffHTML(group.events);
        
        return `
            <li>
                <button type="button" class="collapsible">Activity ${groupKey}</button>
                <div class="content">
                    <p><strong>Start Time:</strong> ${new Date(group.startTime * 1000).toLocaleString()}</p>
                    <p><strong>End Time:</strong> ${new Date(group.endTime * 1000).toLocaleString()}</p>
                    <p><strong>File:</strong> ${group.filename}</p>
                    ${DiffHTML}
                </div>
            </li>
        `;
    }

    generateDiffHTML (events) {
        // Get the event at startTime
        const startCodeEvent = events[0];
        const startCodeEventLines = this.get_code_lines(startCodeEvent.code_text);

        // Get the event at endTime
        const endCodeEvent = events[events.length - 1];
        const endCodeEventLines = this.get_code_lines(endCodeEvent.code_text);

        // // Generate diff
        // const diff = Diff.diffLines(endCodeEventLines.join('\n'), startCodeEventLines.join('\n'));
    
        // // Filter out the unchanged lines, leaving only the added and removed ones
        // const filteredDiff = diff.filter(part => part.added || part.removed);
    
        // // Check if there's any diff after filtering
        // if (filteredDiff.length === 0) {
        //     return null; // No differences detected, return null
        // }'

        // // Map through the filtered diff and render only added/removed lines
        // return `<pre>${filteredDiff.map((part, index) => {
        //     if (part.added) {
        //         return `<span class="diff-added">+ ${part.value.replace(/\n/g, '<br>')}</span>`;
        //     } else if (part.removed) {
        //         return `<span class="diff-removed">- ${part.value.replace(/\n/g, '<br>')}</span>`;
        //     }
        // }).join('<br>')}</pre>`;

        const diffString = Diff.createTwoFilesPatch(
            'start', 
            'end', 
            startCodeEvent.code_text, 
            endCodeEvent.code_text, 
            startCodeEvent.filename, 
            endCodeEvent.filename
        );

        // Render the diff as HTML
        const diffHtml = diff2html.html(diffString, {
            inputFormat: 'diff',
            showFiles: false,
            matching: 'lines',
            outputFormat: 'side-by-side', // or 'line-by-line'
            diffStyle: 'word', // 'word' or 'char' level diff
        });
    
        return `<div class="diff-container">${diffHtml}</div>`;
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
