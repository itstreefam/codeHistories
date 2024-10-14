const fuzzball = require('fuzzball');
const vscode = require('vscode');
const Diff = require('diff');
const diff2html = require('diff2html');
const { historyStyles } = require('./webViewStyles');
const express = require("express");
require('dotenv').config({ path: __dirname + '/../.env' });
const { OpenAI } = require("openai");
const app = express();

app.use(express.json());

console.log(process.env.OPENAI_API_KEY);

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

class ClusterManager {
    constructor(context) {
        this.context = context;
        this.displayForGroupedEvents = []; // This high-level array will have subgoal for each grouping found
        this.inCluster = {};  // Store a map where the key is a filename and the value tracks if we are currently grouping events into a cluster for that file
        this.clusterStartTime = {};  // Store a map where the key is a filename and the value tracks the start time of the current cluster for that file
        this.currentGroup = null; // Eventually will store both code and web events
        this.strayEvents = [];  // Stores events that do not fit into any cluster
        this.pastEvents = null;  // Stores a map where the key is a filename and the value is the last event for that specific file
        this.MAX_NEW_LINES = 3;  // Maximum number of new lines that can be added/deleted between events
        this.debug = false;  // Debug flag to print out additional information
        this.webviewPanel = null;
        this.currentCodeEvent = null;
        this.currentWebEvent = null;
        this.idCounter = 0;
        this.styles = historyStyles;
    }

    initializeWebview() {
        // Check if the webview is already opened
        if (this.webviewPanel) {
            this.webviewPanel.reveal(vscode.ViewColumn.Beside);
            return;
        }

        // Retrieve the previous state from globalState
        this.previousState = this.context.globalState.get('historyWebviewState', null);

        this.webviewPanel = vscode.window.createWebviewPanel(
            'historyWebview',
            'History Webview',
            vscode.ViewColumn.Beside,
            {
                enableScripts: true,
                enableFindWidget: true
            }
        );

        // If there's a previous state, restore it
        if (this.previousState) {
            this.webviewPanel.webview.html = this.previousState.html;
            this.webviewPanel.webview.postMessage({ command: 'restoreState', state: this.previousState });
        } else {
            // Set the initial HTML content if no previous state exists
            this.updateWebPanel();
        }

        // Save the state when the webview is closed
        this.webviewPanel.onDidDispose(() => {
            this.webviewPanel = null; // Clean up the reference
        });

        // Send a message to the webview just before it is closed
        this.webviewPanel.onDidDispose(() => {
            // Request the webview to send its current state before closing
            this.webviewPanel.webview.postMessage({ type: 'saveStateRequest' });

            // Set a small timeout to ensure the state is sent before we consider it disposed
            setTimeout(() => {
                this.webviewPanel = null;
            }, 1000); // Adjust timeout if necessary
        });

        // Listen for messages from the webview to save the state
        this.webviewPanel.webview.onDidReceiveMessage(message => {
            if (message.type === 'saveState') {
                // Save the state returned by the webview
                this.context.globalState.update('historyWebviewState', message.state);
            }

            if (message.command === 'updateCodeTitle') {
                this.updateCodeTitle(message.groupKey, message.eventId, message.title);
            }
        });
    }

    // Method to process a list of events in real-time
    async processEvents(eventList){
        if (!eventList || eventList.length === 0) {
            return;
        }

        for (const entry of eventList){
            const eventType = this.getEventType(entry);

            if(!this.currentGroup) {
                this.startNewGroup();
            }

            if (eventType === "code") {
                let filename = this.getFilename(entry.notes);
                this.currentCodeEvent = {
                    type: "code",
                    file: filename,
                    time: entry.time,
                    code_text: entry.code_text,
                    title: `Code changes in ${filename}`
                };

                await this.handleCodeEvent(entry); // this takes in raw event
            } else if (eventType === "search" || eventType === "visit" || eventType === "revisit") {
                this.currentWebEvent = {
                    type: eventType,
                    time: entry.time,
                    webTitle: entry.notes,
                    webpage: entry.timed_url,
                };

                this.strayEvents.push(this.currentWebEvent); // this is processed event
            }
        }

        // Trigger webview if not opened
        if (!this.webviewPanel) {
            this.initializeWebview();
        } else {
            // If webview is already opened, just update the content
            this.updateWebPanel();
        }
    }

    // Method to process a new event in real-time
    async processEvent(entry) {
        const eventType = this.getEventType(entry);

        if (!this.currentGroup) {
            this.startNewGroup();
        }

        // console.log('In processEvent', entry, eventType);

        if (eventType === "code") {
            let filename = this.getFilename(entry.notes);
            this.currentCodeEvent = {
                type: "code",
                file: filename,
                time: entry.time,
                code_text: entry.code_text,
                title: `Code changes in ${filename}`
            };

            await this.handleCodeEvent(entry); // this takes in raw event
        } else if (eventType === "search" || eventType === "visit" || eventType === "revisit") {
            this.currentWebEvent = {
                type: eventType,
                time: entry.time,
                webTitle: entry.notes,
                webpage: entry.timed_url,
            };

            this.strayEvents.push(this.currentWebEvent); // this is processed event
        }

        // Trigger webview if not opened
        if (!this.webviewPanel) {
            this.initializeWebview();
        } else {
            // If webview is already opened, just update the content
            this.updateWebPanel();
        }
    }

    getEventType(event) {
        // Determine the type of the event based on its attributes
        if (event.notes.startsWith("code")) {
            return "code";
        }

        if (event.notes.startsWith("search")) {
            return "search";
        }

        if (event.notes.startsWith("visit")) {
            return "visit";
        }

        if (event.notes.startsWith("revisit")) {
            return "revisit";
        }

        return "unknown";
    }

    startNewGroup() {
        this.idCounter += 1;
        this.currentGroup = {
            type: "subgoal",
            id: this.idCounter.toString(),
            title: "Title of the subgoal",
            actions: [],
        };
    }

    async handleCodeEvent(event) {
        const filename = this.getFilename(event.notes);

        // Init pastEvents if it doesnt exist for this file
        if (!this.pastEvents) {
            this.pastEvents = {};
        }

        const pastEvent = this.pastEvents[filename];

        if (pastEvent) {
            const pastFilename = this.getFilename(pastEvent.notes);

            // Finalize the cluster if switching files
            if (filename !== pastFilename) {
                if (this.inCluster[pastFilename]) {
                    await this.finalizeGroup(pastFilename);
                    this.inCluster[pastFilename] = false;
                }
                // Treat the current event as the start of a new cluster
                this.strayEvents.push(this.currentCodeEvent);
            } else {
                // Process as usual if it's the same file
                await this.match_lines(filename, pastEvent, event);
                // console.log('In handleCodeEvent', this.currentGroup);
            }
        } else {
            // If this is the first event, it is treated as a stray until a cluster can be formed
            this.strayEvents.push(this.currentCodeEvent);
        }

        // Update the pastEvent with the current event after processing
        this.pastEvents[filename] = event;
    }

    // Method to match lines between events and determine if they belong in the same cluster
    // ensure that the comparison and clustering are done independently per file
    async match_lines(filename, pastEvt, currEvt) {
        const pastLines = this.get_code_lines(pastEvt.code_text);
        const currentLines = this.get_code_lines(currEvt.code_text);

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
        this.strayEvents.push(this.currentCodeEvent);

        // Continue cluster based on match conditions
        if (partialMatches === 0 && perfectMatches.length > 0 && newLines.length === 0 && currentLines.length === pastLines.length) {
            if (this.debug) console.log("\tcontinue cluster");
            if (this.inCluster[filename]) {
                this.inCluster[filename] = true;
            }
        }

        // start or continue clusters.
        // at least one line has been edited, but nothing has been added/deleted
        else if (partialMatches > 0 && currentLines.length === pastLines.length) {
            if (this.debug) console.log("\t>=1 line edited; start new cluster");
            if (!this.inCluster[filename]) {
                this.inCluster[filename] = true;
                this.clusterStartTime[filename] = pastEvt.time;
            }
            // at least one line has been added or deleted, but fewer than 4 new lines.
        } else if (perfectMatches.length > 0 && currentLines.length !== pastLines.length && (currentLines.length - pastLines.length <= this.MAX_NEW_LINES) && newLines.length <= this.MAX_NEW_LINES) {
            if (this.debug) console.log("\t1-3 lines added/deleted; start new cluster");
            if (!this.inCluster[filename]) {
                this.inCluster[filename] = true;
                this.clusterStartTime[filename] = pastEvt.time;
            }
        }
        // at least one line has been replaced, but code is the same length
        else if (partialMatches === 0 && perfectMatches.length > 0 && newLines.length > 0 && currentLines.length === pastLines.length) {
            if (this.debug) console.log("\t>= 1 line replaced; start new cluster");
            if (!this.inCluster[filename]) {
                this.inCluster[filename] = true;
                this.clusterStartTime[filename] = pastEvt.time;
            }
        }
        // only white space changes, no edits or additions/deletions
        else if (partialMatches === 0 && perfectMatches.length > 0 && newLines.length === 0 && currentLines.length !== pastLines.length) {
            if (this.debug) console.log("\twhitespace changes only; start new cluster");
            if (!this.inCluster[filename]) {
                this.inCluster[filename] = true;
                this.clusterStartTime[filename] = pastEvt.time;
            }
        } else {
            // we've just come out of a cluster, so print it out
            if (this.inCluster[filename]) {
                console.log(`${this.clusterStartTime[filename]},${pastEvt.time},'code',${filename}`);
                await this.finalizeGroup(filename);
                if (this.debug) {
                    console.log(`${currTime}: partialMatches=${partialMatches} perfectMatches=${perfectMatches.length} newLines=${newLines.length} currLineLength=${currentLines.length} pastLineLength=${pastLines.length}`);
                    console.log("\n");
                }
            }

            // if there's a big clump that's come in, then we should start another cluster immediately
            if ((filename === pastEvt.file) && (perfectMatches.length > 0) && (currentLines.length - pastLines.length > this.MAX_NEW_LINES)) {
                console.log(`\t starting new cluster ${pastEvt.time}`)
                this.clusterStartTime[filename] = pastEvt.time;
                this.inCluster[filename] = true;
                this.startNewGroup();
            }
            else {
                this.inCluster[filename] = false;
            }
        }

        // update the web panel after processing the event
        this.updateWebPanel();
    }

    async finalizeGroup(filename) {
        // grab the first code event from the stray events
        const startCodeEvent = this.strayEvents.find(event => event.type === "code" && event.file === filename);

        // grab the last code event from the stray events
        const endCodeEvent = [...this.strayEvents].reverse().find(event => event.type === "code" && event.file === filename);

        let codeActivity = {
            type: "code",
            id: (++this.idCounter).toString(),
            file: filename,
            time: endCodeEvent.time,
            before_code: startCodeEvent.code_text,
            after_code: endCodeEvent.code_text,
            // title: `Code changes in ${filename}`
        };

        codeActivity.title = await this.generateSubGoalTitle(codeActivity);

        // grab all the web events from the stray events
        const webEvents = this.strayEvents.filter(event => event.type !== "code");

        // Initialize an empty array to hold structured web events
        let structureWebEvents = [];

        // Temporary storage for the current search event being structured
        let currentSearchEvent = null;

        // Iterate over stray events and structure web events
        for (const event of webEvents) {
            // console.log('Processing event', event);
            if (event.type === "search") {
                // If there's an existing search event, push it to the structured events
                if (currentSearchEvent) {
                    structureWebEvents.push(currentSearchEvent);
                }

                // Start a new search event structure
                currentSearchEvent = {
                    type: "search",
                    query: event.webTitle || "Search query missing",  // Use webTitle instead of notes
                    time: event.time,
                    actions: [],
                };
            } else if (event.type === "visit" || event.type === "revisit") {
                // If the current event is a visit, add it to the current search event's actions
                if (currentSearchEvent) {
                    currentSearchEvent.actions.push({
                        type: event.type,
                        webTitle: event.webTitle || "Visit title missing",  // Use webTitle instead of notes
                        webpage: event.webpage || "URL missing",  // Use webpage instead of timed_url
                        time: event.time,
                    });
                } else {
                    // If there's no search event, treat it as a stray visit
                    structureWebEvents.push({
                        type: event.type,
                        webTitle: event.webTitle || "Visit title missing",  // Use webTitle instead of notes
                        webpage: event.webpage || "URL missing",  // Use webpage instead of timed_url
                        time: event.time,
                    });
                }
            }
        }

        // After iterating, push the last currentSearchEvent if it exists
        if (currentSearchEvent) {
            structureWebEvents.push(currentSearchEvent);
        }

        // Combine code and structured non-code events into the group
        this.currentGroup.actions = [codeActivity, ...structureWebEvents];

        // Sort the currentGroup actions by time
        this.currentGroup.actions.sort((a, b) => a.time - b.time);

        // Set the title and add the group to display
        // this.currentGroup.title = this.generateSubGoalTitle(this.currentGroup);
        this.displayForGroupedEvents.push(this.currentGroup);

        // Clear the stray events and reset the current group
        this.strayEvents = this.strayEvents.filter(event => event.type === "code" && event.file !== filename);
        this.currentGroup = null;
    }

    async generateSubGoalTitle(activity) {
        try {
            const before_code = activity.before_code;
            const after_code = activity.after_code;
            // const prompt = `Please summarize the code change from "${before_code}" to "${after_code}" in one one-liner, simple, fast to read, and easy-to-understand phrase, does not have to be complete sentence and can be a very general description`;
            // console.log('Prompt:', prompt); 

            const prompt = `Compare the following code snippets of the file "${activity.file}":

    Code A (before): "${before_code}"
    Code B (after): "${after_code}"

    Identify whether the changes are addition, deletion, or modification without explicitly stating them.
    Also do not explicitly mention Code A or Code B.
    Summarize the changes in a single, simple, easy-to-read line. So no listing or bullet points. 
    Start out with a verb and no need to end with a period.
    Make sure it sound like a natural conversation.`;

            console.log('Prompt:', prompt);

            const completions = await openai.chat.completions.create({
                model: 'gpt-3.5-turbo',
                max_tokens: 25,
                messages: [
                    {
                        role: "system",
                        content: "You are a code change history summarizer that helps programmers that get interrupted from coding, and the programmers you are helping require simple and prcise points that they can glance over and understand your point"
                    },
                    { role: "user", content: prompt }
                ]
            });
            console.log('API Response:', completions);

            let summary = completions?.choices?.[0]?.message?.content || "Summary not available";
            console.log('Summary:', summary);

            // if summary contains double quotes, make them single quotes
            summary = summary.replace(/"/g, "'");

            if (activity.type === "code") {
                return `${summary}`;
            } else if (activity.type === "subgoal") {
                return `test subgoal ${activity.id}: ${summary}`;
            } else {
                return `test placeholder test: ${summary}`;
            }

        } catch (error) {
            console.error("Error generating title:", error.message);
            return `Code changes in ${activity.file}`;
        }
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
                <link rel="stylesheet" type="text/css" href="https://cdn.jsdelivr.net/npm/diff2html/bundles/css/diff2html.min.css" />
                <script type="text/javascript" src="https://cdn.jsdelivr.net/npm/diff2html/bundles/js/diff2html.min.js"></script>
                <style>
                    ${this.styles}
                </style>
            </head>
            <body>
            <h1 class="title">Goal: make a Wordle clone</h1>
            <div class="wrapper">
                <div class="box">
                    <h2>Subgoals</h2>
                    <ul id="grouped-events">
                        ${groupedEventsHTML}
                    </ul>
                </div>
                <div class="handler"></div>
                <div class="box"> 
                    <h2>Unsorted Changes</h2>
                    <ul id="stray-events">
                        ${strayEventsHTML}
                    </ul>
                </div>
            </div>
                

                <script>
                    (function() {
                        const vscode = acquireVsCodeApi();

                        window.updateTitle = function(groupKey) {
                            const titleInput = document.getElementById('title-' + groupKey).value;
                            vscode.postMessage({
                                command: 'updateTitle',
                                groupKey: groupKey,
                                title: titleInput,
                            });
                        };

                        window.updateCodeTitle = function(groupKey, eventId) {
                            const codeTitleInput = document.getElementById('code-title-' + groupKey + '-' + eventId).value;
                            vscode.postMessage({
                                command: 'updateCodeTitle',
                                groupKey: groupKey,
                                eventId: eventId,
                                title: codeTitleInput,
                            });
                        };

                        // Function to get the state of all collapsible elements
                        function getCollapsibleState() {
                            const collapsibleElements = document.querySelectorAll('.collapsible');
                            const collapsibleState = [];

                            collapsibleElements.forEach((element, index) => {
                                collapsibleState.push({
                                    index: index,
                                    isActive: element.classList.contains('active') // Track if it's active (expanded)
                                });
                            });

                            return collapsibleState;
                        }

                        // Function to restore the state of collapsible elements
                        function restoreCollapsibleState(collapsibleState) {
                            const collapsibleElements = document.querySelectorAll('.collapsible');

                            collapsibleState.forEach(state => {
                                const element = collapsibleElements[state.index];
                                if (element && state.isActive) {
                                    element.classList.add('active'); // Reapply the active state
                                    const content = element.nextElementSibling;
                                    if (content) {
                                        content.style.display = 'block'; // Ensure content is visible if active
                                    }
                                }
                            });
                        }

                        // Attach collapsible event listeners
                        function attachCollapsibleListeners() {
                            document.querySelectorAll('.collapsible').forEach(collapsibleItem => {
                                collapsibleItem.addEventListener('click', function() {
                                    this.classList.toggle('active');
                                    const content = this.nextElementSibling;
                                    if (content.style.display === 'block') {
                                        content.style.display = 'none';
                                    } else {
                                        content.style.display = 'block';
                                    }
                                });
                            });
                        }

                        // Listen for messages from the extension
                        window.addEventListener('message', event => {
                            const message = event.data;

                            if (message.type === 'restoreState') {
                                const previousState = message.state;
                                if (previousState) {
                                    document.body.innerHTML = previousState.html || '';

                                    // Restore scroll position
                                    window.scrollTo(previousState.scrollX || 0, previousState.scrollY || 0);

                                    // Reattach collapsible listeners after HTML restoration
                                    attachCollapsibleListeners();

                                    // Restore collapsible state
                                    if (previousState.collapsibleState) {
                                        restoreCollapsibleState(previousState.collapsibleState);
                                    }
                                }
                            } else if (message.type === 'saveStateRequest') {
                                // Get the current state of collapsible elements
                                const collapsibleState = getCollapsibleState();

                                // Send the current state back to the extension
                                vscode.postMessage({
                                    type: 'saveState',
                                    state: {
                                        html: document.body.innerHTML,
                                        scrollX: window.scrollX,
                                        scrollY: window.scrollY,
                                        collapsibleState: collapsibleState // Include the collapsible state
                                    }
                                });
                            }
                        });

                        // Initial listener attachment on page load
                        attachCollapsibleListeners();

                        var handler = document.querySelector('.handler');
                        var wrapper = handler.closest('.wrapper');
                        var boxA = wrapper.querySelector('.box');
                        var isHandlerDragging = false;

                        function handleMouseMove(e) {
                            if (!isHandlerDragging) {
                                return;
                            }

                            var containerOffsetTop = wrapper.offsetTop;
                            var pointerRelativeXpos = e.clientY - containerOffsetTop;
                            var boxAminHeight = 60;

                            boxA.style.height = (Math.max(boxAminHeight, pointerRelativeXpos - 8)) + 'px';
                            boxA.style.flexGrow = 0;
                        }


                        document.addEventListener('mousedown', function (e) {
                            // If mousedown event is fired from .handler, toggle flag to true
                            if (e.target === handler) {
                                isHandlerDragging = !isHandlerDragging;

                                if (isHandlerDragging) {
                                    document.addEventListener('mousemove', handleMouseMove);
                                } else {
                                    document.removeEventListener('mousemove', handleMouseMove);
                                }
                            }
                        });

                        document.addEventListener('mouseup', function () {
                            if (isHandlerDragging) {
                                isHandlerDragging = false;
                                document.removeEventListener('mousemove', handleMouseMove);
                            }
                        });
                                    })();
                </script>
            </body>
            </html>
        `;
    }


    generateGroupedEventsHTML() {
        // this.displayForGroupedEvents is an array of objects, each object is a group
        // each group has a title and an array containing code and web activity
        let html = '';

        if (this.displayForGroupedEvents.length === 0) {
            return '<li>No grouped events.</li>';
        }

        console.log('In generateGroupedEventsHTML', this.displayForGroupedEvents);

        for (const [groupKey, group] of this.displayForGroupedEvents.entries()) {
            // this is for subgoal-level grouping
            // html += `
            //     <li>
            //         <!-- Editable title for the subgoal (group) -->
            //         <input class="editable-title" id="title-${groupKey}" value="${group.title}" onchange="updateTitle('${groupKey}')">
            //         <button type="button" class="collapsible">Subgoal ${groupKey}</button>
            //         <div class="content">
            //             <ul id="group-${groupKey}" data-groupkey="${groupKey}">
            // `;

            const displayedVisits = new Set();  // To track which visits have been displayed

            for (const [index, event] of group.actions.entries()) {

                let title = event.title || "Untitled";  // Provide a default title if undefined

                if (event.type === 'code') {
                    // Render the code activity with editable title and collapsible diff
                    const diffHTML = this.generateDiffHTML(event);
                    html += `
                        <li data-eventid="${index}">
                            <!-- Editable title for the code activity -->
                            <b>${event.file}: </b><input class="editable-title" id="code-title-${groupKey}-${index}" value="${title}" onchange="updateCodeTitle('${groupKey}', '${index}')" size="50">
                            <button type="button" class="collapsible">+</button>
                            <div class="content">
                                ${diffHTML}
                            </div>
                        </li>
                    `;
                } else if (event.type === 'search') {
                    // Render the search activity with collapsible visit events
                    title = event.query || "Untitled";  // Ensure search queries are not undefined
                    html += `
                        <li data-eventid="${index}">
                            <button type="button" class="collapsible">${title}</button>
                            <div class="content">
                                <ul>
                    `;

                    for (const [visitIndex, visit] of event.actions.entries()) {
                        const visitKey = `${visit.webTitle}-${visit.time}`;  // Unique identifier for each visit

                        // Only render if this visit has not been displayed
                        if (!displayedVisits.has(visitKey)) {
                            const visitTitle = visit.webTitle || "Untitled";  // Ensure visit titles are not undefined
                            html += `
                                <li>
                                    <a href="${visit.webpage}" target="_blank">${visitTitle}</a> - ${new Date(visit.time * 1000).toLocaleString()}
                                </li>
                            `;
                            displayedVisits.add(visitKey);  // Mark this visit as displayed
                        }
                    }

                    html += `
                                </ul>
                            </div>
                        </li>
                    `;
                } else if ((event.type === 'visit' || event.type === 'revisit') && !displayedVisits.has(`${event.webTitle}-${event.time}`)) {
                    // Handle standalone visit and revisit events (not part of a search)
                    const visitTitle = event.webTitle || "Untitled";
                    html += `
                        <li data-eventid="${index}">
                            <a href="${event.webpage}" target="_blank">${visitTitle}</a> - ${new Date(event.time * 1000).toLocaleString()}
                        </li>
                    `;
                    displayedVisits.add(`${event.webTitle}-${event.time}`);  // Mark this visit as displayed
                }
            }
        }

        return html;
    }


    generateStrayEventsHTML() {
        // console.log('In generateStrayEventsHTML', this.strayEvents);
        let html = '';

        if (this.strayEvents.length === 0) {
            return '<li>No stray events.</li>';
        }

        // the events in strayEvents are in processed form
        for (const event of this.strayEvents) {
            // all info is in event.notes
            // const humanReadableTime = new Date(event.time * 1000).toLocaleString();

            if (event.type === "code") {
                html += `
                    <li class="stray-event">
                        <p><em>${event.file}</em></p>
                    </li>
                `;
            } else {
                if (event.type === "search") {
                    html += `
                        <li class="stray-event">
                            <p><em>${event.webTitle}</em></p>
                        </li>
                    `;
                } else {
                    // visit or revisit
                    // same thing but also including the url link
                    html += `
                        <li class="stray-event">
                            <p><a href="${event.webpage}"<em>${event.webTitle}</em></a></p>
                        </li>
                        `;
                }
            }
        }

        return html;
    }

    generateDiffHTML(codeActivity) {
        // Get the event at startTime
        const startCodeEventLines = this.get_code_lines(codeActivity.before_code);

        // Get the event at endTime
        const endCodeEventLines = this.get_code_lines(codeActivity.after_code);

        const diffString = Diff.createTwoFilesPatch(
            'start',
            'end',
            codeActivity.before_code,
            codeActivity.after_code,
            codeActivity.file,
            codeActivity.file
        );

        // Render the diff as HTML
        const diffHtml = diff2html.html(diffString, {
            outputFormat: 'side-by-side',
            drawFileList: false,
            colorScheme: 'light'
        });

        return `<div class="diff-container">${diffHtml}</div>`;
    }

    updateTitle(groupKey, title) {
        this.displayForGroupedEvents[groupKey].title = title;
        this.updateWebPanel();
    }

    updateCodeTitle(groupKey, eventId, title) {
        this.displayForGroupedEvents[groupKey].actions[eventId].title = title;
        this.updateWebPanel();
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
