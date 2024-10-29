const fuzzball = require('fuzzball');
const vscode = require('vscode');
const Diff = require('diff');
const diff2html = require('diff2html');
const { historyStyles } = require('./webViewStyles');
const temporaryTest = require('./temporaryTest');
const fs = require('fs');
const cp = require('child_process');
const path = require('path');
const util = require('util');
const exec = util.promisify(cp.exec);
const { getCurrentDir } = require('./helpers');
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
        this.allPastEvents = {}; // Stores all past events for all files
        this.MAX_NEW_LINES = 4;  // Maximum number of new lines that can be added/deleted between events
        this.debug = true;  // Debug flag to print out additional information
        this.webviewPanel = null;
        this.currentCodeEvent = null;
        this.currentWebEvent = null;
        this.idCounter = 0;
        this.styles = historyStyles;
        // this.initializeTemporaryTest();
        // this.initializeResourcesTemporaryTest();
        this.debugging = true;
    }

    initializeTemporaryTest(){
        const testData = new temporaryTest(String.raw`C:\Users\user\Downloads\wordleStory.json`); // change path of test data here
        // codeActivities has id, title, and code changes
        // the focus atm would be code changes array which contains smaller codeActivity objects
        // for eg, to access before_code, we would do this.codeActivities[0].codeChanges[0].before_code
        this.codeActivities = testData.processSubgoals(testData.data);
        // console.log(this.codeActivities);
    }

    initializeResourcesTemporaryTest(){
        const testData = new temporaryTest(String.raw`C:\Users\user\Downloads\wordleStory.json`); // change path of test data here
        this.codeResources = testData.processResources(testData.data);
        console.log("Resources", this.codeResources);
    }

    async initializeWebview() {
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
            await this.updateWebPanel();
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

        console.log('In processEvents', eventList);

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
            await this.initializeWebview();
        } else {
            // If webview is already opened, just update the content
            await this.updateWebPanel();
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
            await this.initializeWebview();
        } else {
            // If webview is already opened, just update the content
            await this.updateWebPanel();
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

            // Handling switching files within the same commit group
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
                // console.log('In handleCodeEvent', this.strayEvents);
            }
        } else {
            // If this is the first event, it is treated as a stray until a cluster can be formed
            this.strayEvents.push(this.currentCodeEvent);

            // Initialize the cluster for this file
            if (!this.inCluster[filename]) {
                this.inCluster[filename] = true;
                this.clusterStartTime[filename] = event.time;
            }
        }

        // Update the pastEvent with the current event after processing
        this.pastEvents[filename] = event;
        
        if(this.allPastEvents[filename]){
            this.allPastEvents[filename].push(event);
        } else {
            this.allPastEvents[filename] = [event];
        }
        console.log('All past events:', this.allPastEvents);
    }

    // Method to match lines between events and determine if they belong in the same cluster
    // ensure that the comparison and clustering are done independently per file
    async match_lines(filename, pastEvt, currEvt) {
        const pastLines = this.get_code_lines(pastEvt.code_text);
        const currentLines = this.get_code_lines(currEvt.code_text);
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
        this.strayEvents.push(this.currentCodeEvent);

        // Continue cluster based on match conditions
        if (partialMatches === 0 && perfectMatches.length > 0 && newLines.length === 0 && currentLines.length === pastLines.length) {
            console.log("case 1");
            if (this.debug) console.log("\tcontinue cluster for", filename);
            if (this.inCluster[filename]) {
                this.inCluster[filename] = true;
            }
        }

        // start or continue clusters.
        // at least one line has been edited, but nothing has been added/deleted
        else if (partialMatches > 0 && currentLines.length === pastLines.length) {
            console.log("case 2");
            if (this.debug) console.log("\t>=1 line edited; start new cluster for", filename);
            if (!this.inCluster[filename]) {
                this.inCluster[filename] = true;
                this.clusterStartTime[filename] = pastEvt.time;
            }
            // at least one line has been added or deleted, but fewer than 4 new lines.
        } else if (perfectMatches.length > 0 && currentLines.length !== pastLines.length && (Math.abs(currentLines.length - pastLines.length) <= this.MAX_NEW_LINES) && newLines.length <= this.MAX_NEW_LINES) {
            console.log("case 3");
            if (this.debug) console.log("\t1-3 lines added/deleted; start new cluster for", filename);
            if (!this.inCluster[filename]) {
                this.inCluster[filename] = true;
                this.clusterStartTime[filename] = pastEvt.time;
            }
        }
        // at least one line has been replaced, but code is the same length
        else if (partialMatches === 0 && perfectMatches.length > 0 && newLines.length > 0 && currentLines.length === pastLines.length) {
            console.log("case 4");
            if (this.debug) console.log("\t>= 1 line replaced; start new cluster for", filename);
            if (!this.inCluster[filename]) {
                this.inCluster[filename] = true;
                this.clusterStartTime[filename] = pastEvt.time;
            }
        }
        // only white space changes, no edits or additions/deletions
        else if (partialMatches === 0 && perfectMatches.length > 0 && newLines.length === 0 && currentLines.length !== pastLines.length) {
            console.log("case 5");
            if (this.debug) console.log("\twhitespace changes only; start new cluster");
            if (!this.inCluster[filename]) {
                this.inCluster[filename] = true;
                this.clusterStartTime[filename] = pastEvt.time;
            }
        // else if (this.onlyWhitespaceChanges(pastLines, currentLines)) {
        //     if (this.debug) console.log("\tonly whitespace changes for", filename);
        //     if(this.inCluster[filename]) {
        //         if (this.debug) console.log(`Continuing cluster for ${filename}`);
        //     }
        } else {
            console.log("case 6");
            console.log(`this.inCluster[${filename}]`, this.inCluster[filename]);
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
        await this.updateWebPanel();
    }

    // Method to check if only whitespace changes have been made
    onlyWhitespaceChanges(pastLines, currentLines) {
        // Filter out empty lines from both past and current lines
        const filteredPastLines = pastLines.filter(line => line.trim().length > 0);
        const filteredCurrentLines = currentLines.filter(line => line.trim().length > 0);

        // If non-empty lines are identical, it’s only whitespace changes
        if (filteredPastLines.length !== filteredCurrentLines.length) {
            return false;  // If non-empty line count is different, it’s more than whitespace change
        }

        // Compare each non-empty line for content equality
        for (let i = 0; i < filteredPastLines.length; i++) {
            if (filteredPastLines[i] !== filteredCurrentLines[i]) {
                return false;  // If any non-empty lines differ, it's not just whitespace changes
            }
        }

        return true;  // Only whitespace or empty lines were added/removed
    }

    async finalizeGroup(filename) {
        // grab the first code event from the stray events
        const startCodeEvent = this.strayEvents.find(event => event.type === "code" && event.file === filename);

        // grab the last code event from the stray events
        const endCodeEvent = [...this.strayEvents].reverse().find(event => event.type === "code" && event.file === filename);

        // grab any stray code events that's not the filename
        // const strayCodeEvents = this.strayEvents.filter(event => event.type === "code" && event.file !== filename);

        let codeActivity = {
            type: "code",
            id: (++this.idCounter).toString(),
            file: filename,
            startTime: this.clusterStartTime[filename],
            endTime: endCodeEvent.time,
            before_code: startCodeEvent.code_text,
            after_code: endCodeEvent.code_text,
            related: {},
            // title: `Code changes in ${filename}`
        };
        
        //commented out for test only
        codeActivity.title = await this.generateSubGoalTitle(codeActivity);

        // // using gpt to determine if the code activity needs more context
        // const isValid = await this.validateClusterWithGPT(codeActivity, strayCodeEvents, this.allPastEvents);

        // if(isValid.includes("yes")){
        //     // "yes, file(s): insert file name(s) here, reason: insert reason here"
        //     let files = isValid.split("file(s):")[1].split("reason:")[0].trim();
        //     files = files.split(",");
        //     files = files.map(file => file.trim());

        //     for (const file of files) {
        //         let relatedCodeActivity = this.strayEvents.find(event => event.type === "code" && event.file === file);

        //         // remove the related code activity from the stray events
        //         this.strayEvents = this.strayEvents.filter(event => event.type !== "code" || event.file !== file);

        //         // add the related code activity to the current group
        //         codeActivity.related[file] = relatedCodeActivity;
        //     }
        // }

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

        console.log('Finalized group:', this.currentGroup);

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

    async validateClusterWithGPT(codeActivity, strayCodeEvents, allPastEvents) {
        const prompt = `The summary of the code changes in the file "${codeActivity.file}" is: "${codeActivity.title}". 
        Consider the information in "${strayCodeEvents}" and determine if the changes in other file(s) are related to the code changes in "${codeActivity.file}".
        If you think the changes should also be included in the same cluster, answer in the following format:
        "yes, file(s): insert file name(s) here, reason: insert reason here" or "no, reason: insert reason here".`;
        
        const response = await openai.chat.completions.create({
            model: 'gpt-3.5-turbo',
            max_tokens: 50,
            messages: [
                { role: "user", content: prompt }
            ]
        });

        const isValid = response?.choices?.[0]?.message?.content.toLocaleLowerCase() || "No response";

        if(this.debug){
            console.log('Validation response:', isValid);
        }

        return isValid;
    }

    async generateResources(activity) {
        try { 

            const prompt = `Compare the following code snippets of the file "${activity}":

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
            return summary;
        } catch (error) {
            console.error("Error generating title:", error.message);
            return `Code changes in ${activity.file}`;
        }
    }

    async updateWebPanel() {
        if (!this.webviewPanel) {
            this.webviewPanel = vscode.window.createWebviewPanel(
                'historyWebview',
                'History Webview',
                vscode.ViewColumn.Beside,
                { enableScripts: true }
            );
        }

        const groupedEventsHTML = await this.generateGroupedEventsHTML();
        const strayEventsHTML = await this.generateStrayEventsHTML();
        // const groupedEventsHTML = await this.generateGroupedEventsHTMLTest();
        // const strayEventsHTML = await this.generateStrayEventsHTMLTest();

        this.webviewPanel.webview.html = `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <title>Code Clusters</title>
                <link rel="stylesheet" type="text/css" href="https://cdn.jsdelivr.net/npm/diff2html/bundles/css/diff2html.min.css" />
                 <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css">
                <script type="text/javascript" src="https://cdn.jsdelivr.net/npm/diff2html/bundles/js/diff2html.min.js"></script>
                <style>
                    ${this.styles}
                </style>
            </head>
            <body>
             <!-- <h1 class="title">Goal: make a Wordle clone</h1> -->
            <div class="wrapper">
                <div class="box" id="upper">
                    <div class="tooltip">
                        <h2>Recent Development Highlights </h2>
                    </div>
                    <h4><em>Ordered from least recent to most recent</em></h4>
                    <ul id="grouped-events">
                        ${groupedEventsHTML}
                    </ul>
                </div>
                <div class="handler"></div>
                <div class="box" id="lower"> 
                    <div class="tooltip">
                        <h2>In Progressed Work</h2>
                    </div>
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
                    collapsibleItem.addEventListener('click', function () {
                        this.classList.toggle('active');
                        // const content = this.nextElementSibling;
                        const content = this.parentElement.nextElementSibling; 
                        if (content.style.display === 'flex') {
                            content.style.display = 'none';
                        } else {
                            content.style.display = 'flex';
                        }
                    });
                });
            }

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

            // Disable text selection globally
            function disableTextSelection() {
                document.body.style.userSelect = 'none'; // Disable text selection
                document.body.style.cursor = 'ns-resize'; // Show resize cursor during drag
            }

            // Re-enable text selection globally
            function enableTextSelection() {
                document.body.style.userSelect = ''; // Restore default text selection
                document.body.style.cursor = ''; // Restore default cursor
            }

            document.addEventListener('mousedown', function (e) {
                // If mousedown event is fired from .handler, toggle flag to true
                if (e.target === handler) {
                    isHandlerDragging = true;
                    disableTextSelection(); // Prevent text selection during drag
                    document.addEventListener('mousemove', handleMouseMove);
                }
            });

            document.addEventListener('mouseup', function () {
                if (isHandlerDragging) {
                    isHandlerDragging = false;
                    enableTextSelection(); // Re-enable text selection after drag
                    document.removeEventListener('mousemove', handleMouseMove);
                }
            });
        
        })();
    </script>
            </body>
            </html>
        `;
    }
  
    async generateGroupedEventsHTMLTest() {
        let html = '';

        if (!this.codeActivities || this.codeActivities.length === 0) {
            console.error("codeActivities is undefined or empty");
            return '<li>No grouped events.</li>';
        }
        if (!this.codeResources || this.codeResources.length === 0) {
            console.error("codeResources is undefined or empty");
            return '<li>No resources for you :(.</li>';
        }
    
        console.log('In generateGroupedEventsHTML, codeActivities', this.codeActivities);

        let feed_to_ai = [];
    
        for (let groupKey = 0; groupKey <= 8; groupKey++) {
            const group = this.codeActivities[groupKey];
            const links = this.codeResources[groupKey];
    
            for (let subgoalKey = 0; subgoalKey < group.codeChanges.length; subgoalKey++) {
                const subgoal = group.codeChanges[subgoalKey];

                const diffHTML = this.generateDiffHTML(subgoal);

                    html += `
                        <li data-eventid="${subgoalKey}">
                            <!-- Editable title for the code activity -->
                            <div class="li-header">
                                <button type="button" class="collapsible" id="plusbtn-${groupKey}-${subgoalKey}">+</button>
                                <input class="editable-title" id="code-title-${groupKey}-${subgoalKey}" value="${subgoal.title}" onchange="updateCodeTitle('${groupKey}', '${subgoalKey}')" size="50">
                                <!-- <i class="bi bi-pencil-square"></i> -->
                                <button type="button" class="btn btn-secondary" id="button-${groupKey}-${subgoalKey}">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-pencil-square" viewBox="0 0 16 16">
                                    <path d="M15.502 1.94a.5.5 0 0 1 0 .706L14.459 3.69l-2-2L13.502.646a.5.5 0 0 1 .707 0l1.293 1.293zm-1.75 2.456-2-2L4.939 9.21a.5.5 0 0 0-.121.196l-.805 2.414a.25.25 0 0 0 .316.316l2.414-.805a.5.5 0 0 0 .196-.12l6.813-6.814z"></path>
                                    <path fill-rule="evenodd" d="M1 13.5A1.5 1.5 0 0 0 2.5 15h11a1.5 1.5 0 0 0 1.5-1.5v-6a.5.5 0 0 0-1 0v6a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5v-11a.5.5 0 0 1 .5-.5H9a.5.5 0 0 0 0-1H2.5A1.5 1.5 0 0 0 1 2.5z"></path>
                                    </svg>
                                </button>
                                <b>in ${subgoal.file} </b>
                            </div>
                            <div class="content">
                                <div class="left-container">
                                    ${diffHTML}
                                </div>
                                <div class="resources">
                    `;
                    for(let linkKey = 0; linkKey <links.resources.length; linkKey++) {
                        const link = links.resources[linkKey];
                        for(let i = link.actions.length -1; i >= 0; i--) {
                            const eachLink = links.resources[linkKey].actions[i];
                            html += `   
                                    ${eachLink.webTitle}
                            `
                            feed_to_ai.push(eachLink.webpage);

                        }

                        // for(let i = link.actions.length -1; i >= 0; i--) {
                        //     const eachLink = links.resources[linkKey].actions[i];
                        // }
                    }

                    const resource_paragraph = await this.generateResources(feed_to_ai);
                    html += `   
                                    <a>${resource_paragraph}</a>
                            `
                    
                    html += `
                                </div>
                            </div>
                        </li>
                        <script> 
                            document.addEventListener('DOMContentLoaded', () => {
                                const button = document.getElementById('plusbtn-${groupKey}-${subgoalKey}');

                                button.addEventListener('click', () => {
                                    button.textContent = button.textContent === '+' ? '-' : '+';
                                });
                            });

                            document.getElementById('button-${groupKey}-${subgoalKey}').addEventListener('click', function() {
                                document.getElementById('code-title-${groupKey}-${subgoalKey}').focus();
                            });  
                        </script>
                    `;
            }
        }
    
        return html;
    }

    async generateGroupedEventsHTML() {
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
                    // html += `
                    //     <li data-eventid="${index}">
                    //         <!-- Editable title for the code activity -->
                    //         <b>${event.file}: </b><input class="editable-title" id="code-title-${groupKey}-${index}" value="${title}" onchange="updateCodeTitle('${groupKey}', '${index}')" size="50">
                    //         <button type="button" class="collapsible">+</button>
                    //         <div class="content">
                    //             ${diffHTML}
                    //         </div>
                    //     </li>
                    // `;
                    html += `
                        <li data-eventid="${index}">
                            <!-- Editable title for the code activity -->
                            <div class="li-header">
                                <button type="button" class="collapsible" id="plusbtn-${groupKey}-${index}">+</button>
                                <input class="editable-title" id="code-title-${groupKey}-${index}" value="${title}" onchange="updateCodeTitle('${groupKey}', '${index}')" size="50">
                                <!-- <i class="bi bi-pencil-square"></i> -->
                                <button type="button" class="btn btn-secondary" id="button-${groupKey}-${title}">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-pencil-square" viewBox="0 0 16 16">
                                    <path d="M15.502 1.94a.5.5 0 0 1 0 .706L14.459 3.69l-2-2L13.502.646a.5.5 0 0 1 .707 0l1.293 1.293zm-1.75 2.456-2-2L4.939 9.21a.5.5 0 0 0-.121.196l-.805 2.414a.25.25 0 0 0 .316.316l2.414-.805a.5.5 0 0 0 .196-.12l6.813-6.814z"></path>
                                    <path fill-rule="evenodd" d="M1 13.5A1.5 1.5 0 0 0 2.5 15h11a1.5 1.5 0 0 0 1.5-1.5v-6a.5.5 0 0 0-1 0v6a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5v-11a.5.5 0 0 1 .5-.5H9a.5.5 0 0 0 0-1H2.5A1.5 1.5 0 0 0 1 2.5z"></path>
                                    </svg>
                                </button>
                                <b>in ${event.file} </b>
                            </div>
                            <div class="content">
                                <div class="left-container">
                                    ${diffHTML}
                                </div>
                                <div class="resources">
                    `;
                } else if (event.type === 'search') {
                    // Render the search activity with collapsible visit events
                    title = event.query || "Untitled";  // Ensure search queries are not undefined

                    if(title === "Untitled") return;

                    const searchedTitle = title.substring(title.indexOf(":") + 1, title.lastIndexOf("-")).trim();

                    html += `
                        <li data-eventid="${index}">
                            You search for <em>${searchedTitle}</em>
                        </li>
                    `;
                } else if ((event.type === 'visit' || event.type === 'revisit') && !displayedVisits.has(`${event.webTitle}-${event.time}`)) {
                    const visitTitle = event.webTitle || "Untitled";

                    if(visitTitle === "Untitled") return;

                    const pageTitle = visitTitle.substring(visitTitle.indexOf(":") + 1, visitTitle.lastIndexOf(";")).trim();

                    html += `
                        <li data-eventid="${index}">
                            You visit the site <a href="${visit.webpage}" target="_blank">${pageTitle}</a>
                        </li>
                    `;
                    displayedVisits.add(`${event.webTitle}-${event.time}`);  // Mark this visit as displayed
                }

                html += `
                                </div>
                            </div>
                        </li>
                        <script> 
                            document.addEventListener('DOMContentLoaded', () => {
                                const button = document.getElementById('plusbtn-${groupKey}-${index}');

                                button.addEventListener('click', () => {
                                    button.textContent = button.textContent === '+' ? '-' : '+';
                                });
                            });

                            document.getElementById('button-${groupKey}-${index}').addEventListener('click', function() {
                                document.getElementById('code-title-${groupKey}-${index}').focus();
                            });  
                        </script>
                    `;
            }
        }

        return html;
    }

    async testDiffHTML(anEvent) {
        try {
            const currentDir = getCurrentDir();
            const gitDir = path.join(currentDir, 'codeHistories.git');
            const workTree = currentDir;
    
            // Get the content of the file from the previous commit (HEAD~1) using `git show`
            const previousFileCmd = `git --git-dir="${gitDir}" --work-tree="${workTree}" show HEAD~1:${anEvent.file}`;
            let previousFileContent = '';
            
            try {
                // Get the file content from the previous commit
                const { stdout } = await exec(previousFileCmd, { cwd: workTree });
                previousFileContent = stdout.trim(); // Ensure content is properly trimmed
            } catch (err) {
                // If the file did not exist in the previous commit, treat it as a newly created file
                previousFileContent = '';  // No content in previous commit
            }
    
            // Ensure current content is also trimmed properly
            const currentFileContent = anEvent.code_text.trim();
    
            // Check if the file is newly created (empty previous content)
            if (previousFileContent === '') {
                console.log(`New file created: ${anEvent.file}`);
            }
    
            // Generate the diff using Diff.createTwoFilesPatch
            const diffString = Diff.createTwoFilesPatch(
                'start', // Filename for the previous commit (for display purposes)
                'end',   // Filename for the current commit (for display purposes)
                previousFileContent,  // Content from the previous commit (empty if file was newly created)
                currentFileContent,   // Content from the current commit (new content)
                anEvent.file,  // File name (unchanged)
                anEvent.file   // File name (unchanged)
            );
    
            // Render the diff as HTML
            const diffHtml = diff2html.html(diffString, {
                outputFormat: 'side-by-side',
                drawFileList: false,
                colorScheme: 'light',
                showFiles: false,
            });
    
            return diffHtml;
    
        } catch (err) {
            console.error(`Error generating diff for ${anEvent.file}: ${err}`);
            return 'Error generating diff';
        }
    }
    

  async generateStrayEventsHTMLTest() {
        // console.log('In generateStrayEventsHTML', this.strayEvents);
        let html = '';

        if (this.strayEvents.length === 0) {
            return '<li>Your future changes goes here.</li>';
        }

        // the events in strayEvents are in processed form
        for (const event of this.strayEvents) {
            // all info is in event.notes
            const humanReadableTime = new Date(event.time * 1000).toLocaleString();
            
            if(event.type === "code") {
                html += `
                    <li class="stray-event">
                        <p><strong><em>${event.file}</em></strong></p>
                    </li>
                `;
            } else {
                if(event.type === "search") {
                    html += `
                        <li class="stray-event">
                            <p><strong>${humanReadableTime}</strong> - <em>${event.webTitle}</em></p>
                        </li>
                    `;
                } else {
                    // visit or revisit
                    // same thing but also including the url link
                    html += `
                        <li class="stray-event">
                            <p><strong>${humanReadableTime}</strong> - <a href="${event.webpage}"<em>${event.webTitle}</em></a></p>
                        </li>
                        `;
                }
            }
        }

        return html;
    }

    async generateStrayEventsHTML() {
        let html = '';
        let idx = 0;
    
        if (this.strayEvents.length === 0) {
            return '<li>Your future changes go here.</li>';
        }
    
        // Track the most recent change for each file
        const fileDiffs = {};
    
        for (const event of this.strayEvents) {
            if (event.type === "code") {
                // Get the latest diff for this file
                const diffHTMLForStrayChanges = await this.testDiffHTML(event);
                
                // Store the latest diff for this file, replacing any previous entry
                fileDiffs[event.file] = `
                    <li class="stray-event" id="code-${idx}">
                        <div class="li-header">
                            <button type="button" class="collapsible">+</button>
                            You made changes to <em>${event.file}</em>
                        </div>
                        <div class="content">
                            <div class="left-container">
                                ${diffHTMLForStrayChanges}
                            </div>
                        </div>
                    </li>
                `;
            } else if (event.type === "search") {
                // Handle search events
                const searchedTitle = event.webTitle.substring(event.webTitle.indexOf(":") + 1, event.webTitle.lastIndexOf("-")).trim();
                html += `
                    <li class="stray-event" id="search-${idx}">
                        <p>You searched for "${searchedTitle}"</p>
                    </li>
                `;
            } else if (event.type === "visit" || event.type === "revisit") {
                // Handle visit or revisit events
                const pageTitle = event.webTitle.substring(event.webTitle.indexOf(":") + 1, event.webTitle.lastIndexOf(";")).trim();
                html += `
                    <li class="stray-event" id="visit-${idx}">
                        <p>You visited the site <a href="${event.webpage}" target="_blank">${pageTitle}</a></p>
                    </li>
                `;
            }
    
            idx += 1;  // Increment index for the next item
        }
    
        // After processing all events, add the stored diffs to the HTML
        Object.values(fileDiffs).forEach(diff => {
            html += diff;
        });
    
        return html;  // Return the generated HTML
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
            colorScheme: 'light',
            showFiles: false,
        });

        if(codeActivity.related){
            for(const relatedFile in codeActivity.related){
                // the file variable has code_text instead of before_code and after_code
                // so if there are more than one occurence, we grab the first one and last one and compare their code_text
                // but if there is only one single occurence, we grab the code_text and compare it with the code_text information from this.allPastEvents
                
                if(Object.keys(codeActivity.related).length === 1){
                    const relatedCodeEvent = codeActivity.related[relatedFile];
                    
                    const infoFromAllPastEvents = this.allPastEvents.find(event => event.type === "code" && event.file === relatedFile);
                    
                    // technically speaking this event should happen in between the startTime and endTime of the current codeActivity
                    // so we will grab the event that is closest to the startTime of the current codeActivity
                    // and compare the code_text of that event with the code_text of the relatedCodeEvent

                    const closestEvent = infoFromAllPastEvents.find(event => event.time >= codeActivity.startTime && event.time <= relatedCodeEvent.time);
                    const closestEventCodeText = closestEvent.code_text;
                    const relatedCodeEventCodeText = relatedCodeEvent.code_text;

                    const diffStringRelated = Diff.createTwoFilesPatch(
                        'start',
                        'end',
                        closestEventCodeText,
                        relatedCodeEventCodeText,
                        relatedFile,
                        relatedFile
                    );

                    // Render the diff as HTML
                    const diffHtmlRelated = diff2html.html(diffStringRelated, {
                        outputFormat: 'side-by-side',
                        drawFileList: false,
                        colorScheme: 'light',
                        showFiles: false,
                    });

                    diffHtml += `
                        <div class="diff-container">
                            <h3>Changes in ${relatedFile}</h3>
                            ${diffHtmlRelated}
                        </div>
                    `;

                } else {
                    const relatedCodeEvent = codeActivity.related[relatedFile];
                    const startRelatedCodeEvent = relatedCodeEvent[0];
                    const endRelatedCodeEvent = relatedCodeEvent[relatedCodeEvent.length - 1];

                    const diffStringRelated = Diff.createTwoFilesPatch(
                        'start',
                        'end',
                        startRelatedCodeEvent.code_text,
                        endRelatedCodeEvent.code_text,
                        relatedFile,
                        relatedFile
                    );

                    // Render the diff as HTML
                    const diffHtmlRelated = diff2html.html(diffStringRelated, {
                        outputFormat: 'side-by-side',
                        drawFileList: false,
                        colorScheme: 'light',
                        showFiles: false,
                    });

                    diffHtml += `
                        <div class="diff-container">
                            <h3>Changes in ${relatedFile}</h3>
                            ${diffHtmlRelated}
                        </div>
                    `;
                }
            }
        }
      
        return diffHtml;
    }
      
    async updateTitle(groupKey, title) {
        this.displayForGroupedEvents[groupKey].title = title;
        await this.updateWebPanel();
    }

    async updateCodeTitle(groupKey, eventId, title) {
        this.displayForGroupedEvents[groupKey].actions[eventId].title = title;
        await this.updateWebPanel();
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

    getWebviewContent() {
        return this.webviewPanel;
    }
}

module.exports = ClusterManager;
