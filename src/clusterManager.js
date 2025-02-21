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
const { getCurrentDir, extractText } = require('./helpers');
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
    constructor(context, gitTracker, stayPersistent) {
        this.context = context;
        this.gitTracker = gitTracker;
        this.displayForGroupedEvents = []; // This high-level array will have subgoal for each grouping found
        this.inCluster = {};  // Store a map where the key is a filename and the value tracks if we are currently grouping events into a cluster for that file
        this.clusterStartTime = {};  // Store a map where the key is a filename and the value tracks the start time of the current cluster for that file
        this.currentGroup = null; // Eventually will store both code and web events
        this.strayEvents = [];  // Stores events that do not fit into any cluster
        this.pastEvents = null;  // Stores a map where the key is a filename and the value is the last event for that specific file
        this.allPastEvents = {}; // Stores all past events for all files
        this.MAX_NEW_LINES = 3;  // Maximum number of new lines that can be added/deleted between events
        this.debug = true;  // Debug flag to print out additional information
        this.webviewPanel = null;
        this.currentCodeEvent = null;
        this.currentWebEvent = null;
        this.idCounter = 0;
        this.styles = historyStyles;
        this.initializeTemporaryTest();
        this.initializeResourcesTemporaryTest();
        this.debugging = true;
        this.prevCommittedEvents = [];
        this.isInitialized = false;
        this.isPanelClosed = false;
        this.stayPersistent = stayPersistent;
        this.allSaves = {}; // Stores all save events per file
        this.initialSaves = {}; // Tracks the first save for comparison
        this.currentDiffView = 'line-by-line'; //default view
        
    }

    initializeTemporaryTest(){
        const testData = new temporaryTest(String.raw`C:\users\zhouh\Downloads\wordleStory.json`); // change path of test data here
        // codeActivities has id, title, and code changes
        // the focus atm would be code changes array which contains smaller codeActivity objects
        // for eg, to access before_code, we would do this.codeActivities[0].codeChanges[0].before_code
        this.codeActivities = testData.processSubgoals(testData.data);
        this.documentedHistory = testData.processHistories(testData.data);
        
        console.log("initialization test");
        console.log(this.codeActivities);
        // console.log("why doesn't it work im so confused: " + this.documentedHistory);
    }

    initializeResourcesTemporaryTest(){
        const testData = new temporaryTest(String.raw`C:\users\zhouh\Downloads\wordleStory.json`); // change path of test data here
        this.codeResources = testData.processResources(testData.data);
        console.log("Resources", this.codeResources);
    }

    async initializeClusterManager() {
        // Grab the initial commit data without displaying it in the web panel
        const initialCodeEntries = await this.gitTracker.grabAllLatestCommitFiles();
        await this.processCodeEvents(initialCodeEntries);
        this.isInitialized = true;
    }

    async initializeWebview() {
        if(this.isPanelClosed && this.stayPersistent === false){
            return;
        }

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
            if(this.stayPersistent === false) this.isPanelClosed = true;
            this.webviewPanel = null; // Clean up the reference
        });

        // Send a message to the webview just before it is closed
        this.webviewPanel.onDidDispose(() => {
            // Request the webview to send its current state before closing
            this.webviewPanel.webview.postMessage({ type: 'saveStateRequest' });

            // Set a small timeout to ensure the state is sent before we consider it disposed
            setTimeout(() => {
                if(this.stayPersistent === false) this.isPanelClosed = true;
                this.webviewPanel = null;
            }, 1000); // Adjust timeout if necessary
        });

        // Listen for messages from the webview to save the state
        this.webviewPanel.webview.onDidReceiveMessage(async message => {
            if (message.type === 'saveState') {
                // Save the state returned by the webview
                await this.context.globalState.update('historyWebviewState', message.state);
            }

            if (message.command === 'updateCodeTitle') {
                await this.updateCodeTitle(message.groupKey, message.eventId, message.title);
            }

            if (message.command === 'changeViewMode') {
                this.currentDiffView = message.view;
                await this.updateWebPanel();
            }

            if (message.command === "askChatGPT") {
                console.log("Received askChatGPT message:", message);
                await this.handleChatGPTRequest(message.question);
            }
        });
    }

    // Method to process a list of events in real-time
    async processCodeEvents(codeEventsList) {
        if (!codeEventsList || codeEventsList.length === 0) {
            return;
        }

        console.log('In processCodeEvents', codeEventsList);
        let previousEventList = this.prevCommittedEvents || [];

        for (const entry of codeEventsList){
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

                await this.handleCodeEvent(entry, previousEventList); // this takes in raw event
                
                await this.handleSaveEvent(entry);
            }
        }
        
        this.prevCommittedEvents = codeEventsList;

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

    async processWebEvents(webEventsList){
        if (!webEventsList || webEventsList.length === 0) {
            return;
        }

        console.log('In processWebEvents', webEventsList);

        for (const entry of webEventsList){
            const eventType = this.getEventType(entry);

            if(!this.currentGroup) {
                this.startNewGroup();
            }

            this.currentWebEvent = {
                type: eventType,
                time: entry.time,
                webTitle: entry.notes,
                webpage: entry.timed_url,
            };

            this.strayEvents.push(this.currentWebEvent); // this is processed event
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

    async handleSaveEvent(event) {
        console.log('In handleSaveEvent', event);

        const documentPath = event.document;
        const newContent = event.code_text;
        
        // Extract the filename from the document path
        const filename = path.basename(documentPath);
    
        // Initialize save tracking for the file if not already done
        if (!this.allSaves[filename]) {
            this.allSaves[filename] = [];
        }
    
        // Add the current save event to allSaves
        this.allSaves[filename].push({file: filename, time: event.time, code_text: newContent});
    
        // Set the initial save if not already set
        if (!this.initialSaves[filename]) {
            this.initialSaves[filename] = {file: filename, time: event.time, code_text: newContent};
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

    // event: code event of a file in the current commit
    // previousEventList: list of code events in the previous commit
    // case 1: if the previousEventList is empty, the code event is new addition and should be treated as a stray event
    // case 2: if the code event exists in the previousEventList, compare the code changes for that file
    // case 3: if the code event does not exist in the previousEventList and it does not exist in this.allPastEvents, it is a new addition and should be treated as a stray event
    // case 4: if the code event does not exist in the previousEventList but exists in this.allPastEvents, we asssume file switching and compare the code changes for that file
    async handleCodeEvent(event, previousEventList) {
        const filename = this.getFilename(event.notes); // event is always guaranteed to exist

        // Ensure required objects are initialized
        this.inCluster = this.inCluster || {};
        this.allPastEvents = this.allPastEvents || {};
        this.pastEvents = this.pastEvents || {};

        console.log('In handleCodeEvent', filename, event);

        // case 1: no events in the previous commit, treat as new addition
        // no files -> commit 1: file 1
        if(previousEventList.length === 0){
            this.strayEvents.push(this.currentCodeEvent);

            // Initialize the cluster for this file
            if (!this.inCluster[filename]) {
                this.inCluster[filename] = true;
                this.clusterStartTime[filename] = event.time;
            }

            if(!this.allPastEvents[filename]){
                this.allPastEvents[filename] = [event];
            } else {
                this.allPastEvents[filename].push(event);
            }

            if(this.debug) {
                console.log('No previous events, treating as new addition');
            }
            return;
        }

        // see if the event exists in the previous commit
        const eventIsInPrevCommit = previousEventList.some(event => this.getFilename(event.notes) === filename);

        // case 2: event exists in the previous commit, compare the code changes
        // commit 1: file 1 -> commit 2: file 1
        if(eventIsInPrevCommit){
            // get the past event from the previous commit
            const pastEvent = previousEventList.find(event => this.getFilename(event.notes) === filename);

            // compare the code changes for the file
            await this.match_lines(filename, pastEvent, event);

            // update the pastEvent with the current event after processing
            this.pastEvents[filename] = event;

            if(this.debug) {
                console.log('Event exists in previous commit, comparing code changes');
                console.log('Current event:', event);
                console.log('Previous events:', previousEventList);
                console.log('All past events:', this.allPastEvents);
            }
        } 

        // case 3: event does not exist in the previous commit and does not exist in this.allPastEvents
        // commit 1: file 1 -> commit 2: file 2
        else if(!eventIsInPrevCommit && !this.allPastEvents[filename]){
            // should finalize the cluster for file 1 (and any other file) and treat the current event (file 2) as a stray
            for (const otherFile of previousEventList) {
                const otherFilename = this.getFilename(otherFile.notes);
                if (this.inCluster[otherFilename]) {
                    await this.finalizeGroup(otherFilename);
                    this.inCluster[otherFilename] = false;
                }
            }

            this.strayEvents.push(this.currentCodeEvent);
            if (!this.inCluster[filename]) {
                this.inCluster[filename] = true;
                this.clusterStartTime[filename] = event.time;
            }

            if(this.debug) {
                console.log('Event does not exist in previous commit and allPastEvents, treating as new addition');
                console.log('Current event:', event);
                console.log('Previous events:', previousEventList);
                console.log('All past events:', this.allPastEvents);
            }
        }

        // case 4: event does not exist in the previous commit but exists in this.allPastEvents
        // commit 1: file 1, file 2 -> commit 2: file 1 -> commit 3: file 2
        else if(!eventIsInPrevCommit && this.allPastEvents[filename]){
            // get the past event from the allPastEvents
            const pastEvent = this.allPastEvents[filename].slice(-1)[0]; // last known event for this file

            await this.match_lines(filename, pastEvent, event);

            this.pastEvents[filename] = event;

            if(this.debug) {
                console.log('Event does not exist in previous commit but exists in allPastEvents');
                console.log('Current event:', event);
                console.log('Previous events:', previousEventList);
                console.log('All past events:', this.allPastEvents);
            }
        }

        // update the allPastEvents with the current event
        if(this.allPastEvents[filename]){
            this.allPastEvents[filename].push(event);
        } else {
            this.allPastEvents[filename] = [event];
        }
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

        // echo decision making info
        if (this.debugging) {
            console.log(`\tDEBUG ${pastEvt.time}-${currEvt.time} (${filename}): partialMatches=${partialMatches} perfectMatches=${perfectMatches.length} newLines=${newLines.length} currLineLength=${currentLines.length} pastLineLength=${pastLines.length}`);
            
            if (pastEvt.time ==  currEvt.time) {
                console.log(`\tPAST ${pastEvt}\n`);
                console.log(`\tCURR ${currEvt}\n`);
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
        // else if (partialMatches === 0 && perfectMatches.length > 0 && newLines.length === 0 && currentLines.length !== pastLines.length) {
        //     console.log("case 5");
        //     if (this.debug) console.log("\twhitespace changes only; start new cluster");
        //     if (!this.inCluster[filename]) {
        //         this.inCluster[filename] = true;
        //         this.clusterStartTime[filename] = pastEvt.time;
        //     }
        else if (this.onlyWhitespaceChanges(pastLines, currentLines)) {
            console.log("case 5");
            if (this.debug) console.log("\twhitespace changes only; start new cluster");
            if (!this.inCluster[filename]) {
                this.inCluster[filename] = true;
                this.clusterStartTime[filename] = pastEvt.time;
            }
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

                // the file is now in allPastEvents, so we can continue starting the cluster from here
                // this is equivalent to the big clump case below
                this.inCluster[filename] = true;
                this.clusterStartTime[filename] = pastEvt.time;
                this.startNewGroup();
            } 

            // if there's a big clump that's come in, then we should start another cluster immediately
            // const pastEvtFile = this.getFilename(pastEvt.notes);
            // if ((filename === pastEvtFile) && (perfectMatches.length > 0) && (currentLines.length - pastLines.length > this.MAX_NEW_LINES)) {
            //     console.log(`\t starting new cluster ${pastEvt.time}`)
            //     this.clusterStartTime[filename] = pastEvt.time;
            //     this.inCluster[filename] = true;
            //     this.startNewGroup();
            // }
            // else {
            //     this.inCluster[filename] = false;
            // }
        }
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
        let startCodeEvent = this.strayEvents.find(event => event.type === "code" && event.file === filename);

        // grab the last code event from the stray events
        let endCodeEvent = [...this.strayEvents].reverse().find(event => event.type === "code" && event.file === filename);

        if (endCodeEvent) {
            this.initialSaves[filename] = {
                file: filename,
                time: endCodeEvent.time,
                code_text: endCodeEvent.code_text,
            };
        }

        console.log('Finalizing group:', filename, startCodeEvent, endCodeEvent);

        let codeActivity = {};

        if (startCodeEvent.code_text !== endCodeEvent.code_text) {
        // grab any stray code events that's not the filename
        // const strayCodeEvents = this.strayEvents.filter(event => event.type === "code" && event.file !== filename);

            codeActivity = {
                type: "code",
                id: (++this.idCounter).toString(),
                file: filename,
                startTime: this.clusterStartTime[filename],
                endTime: endCodeEvent.time,
                before_code: startCodeEvent.code_text,
                after_code: endCodeEvent.code_text,
                // title: `Code changes in ${filename}`
            };
            
            codeActivity.title = await this.generateSubGoalTitle(codeActivity);
        }

        // if both events are the same, this means that this file had clustering occurred before
        // and so the startCodeEvent should be from allPastEvents instead
        else {
            // grab the last code event from all past events
            startCodeEvent = this.allPastEvents[filename].slice(-1)[0];

            codeActivity = {
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

            codeActivity.title = await this.generateSubGoalTitle(codeActivity);
        }

        // grab only the web events from the stray events that has time before the endCodeEvent
        let webEvents = this.strayEvents.filter(event => event.type !== "code" && event.time <= endCodeEvent.time);

        // Initialize an empty array to hold structured web events
        let structureWebEvents = [];

        // Temporary storage for the current search event being structured
        let currentSearchEvent = null;

        // // Iterate over stray events and structure web events
        // for (const event of webEvents) {
        //     // console.log('Processing event', event);
        //     if (event.type === "search") {
        //         // If there's an existing search event, push it to the structured events
        //         if (currentSearchEvent) {
        //             structureWebEvents.push(currentSearchEvent);
        //         }

        //         // Start a new search event structure
        //         currentSearchEvent = {
        //             type: "search",
        //             query: event.webTitle || "Search query missing",  // Use webTitle instead of notes
        //             time: event.time,
        //             actions: [],
        //         };
        //     } else if (event.type === "visit" || event.type === "revisit") {
        //         // If the current event is a visit, add it to the current search event's actions
        //         if (currentSearchEvent) {
        //             currentSearchEvent.actions.push({
        //                 type: event.type,
        //                 webTitle: event.webTitle || "Visit title missing",  // Use webTitle instead of notes
        //                 webpage: event.webpage || "URL missing",  // Use webpage instead of timed_url
        //                 time: event.time,
        //             });
        //         } else {
        //             // If there's no search event, treat it as a stray visit
        //             structureWebEvents.push({
        //                 type: event.type,
        //                 webTitle: event.webTitle || "Visit title missing",  // Use webTitle instead of notes
        //                 webpage: event.webpage || "URL missing",  // Use webpage instead of timed_url
        //                 time: event.time,
        //             });
        //         }
        //     }
        // }

        // Sort stray events by time to
        const sortedWebEvents = webEvents.sort((a, b) => a.time - b.time);

        for (const event of sortedWebEvents) {
            if(event.type === "search") {
                //If there was a previous search event, finalize it
                if(currentSearchEvent) {
                    structureWebEvents.push(currentSearchEvent);
                }

                //Start a new search event
                currentSearchEvent = {
                    type: "search",
                    query: event.webTitle || "Search query missing",
                    time: event.time,
                    actions: [],
                    id: (++this.idCounter).toString(),
                };
            } else if (event.type === "visit" || event.type === "revisit") {
                // If no current search event, treat as stray visit
                if(!currentSearchEvent) {
                    structureWebEvents.push({
                        type: event.type,
                        webTitle: event.webTitle || "Visit title missing",
                        webpage: event.webpage || "URL missing",
                        time: event.time,
                        id: (++this.idCounter).toString(),
                    });
                } else {
                    // Add visit to current search event
                    currentSearchEvent.actions.push({
                        type: event.type,
                        webTitle: event.webTitle || "Visit title missing",
                        webpage: event.webpage || "URL missing",
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
        this.currentGroup.actions = [codeActivity, ...sortedWebEvents];

        // Sort the currentGroup actions by time
        this.currentGroup.actions.sort((a, b) => a.time - b.time);

        console.log('Finalized group:', this.currentGroup);

        // Set the title and add the group to display
        // this.currentGroup.title = this.generateSubGoalTitle(this.currentGroup);
        this.displayForGroupedEvents.push(this.currentGroup);

        // Clear the items that have been grouped in the currentGroup from strayEvents
        this.strayEvents = this.strayEvents.filter(event => event.file !== filename);

        // Remove the events from webEvents from this.strayEvents
        this.strayEvents = this.strayEvents.filter(event => !sortedWebEvents.includes(event));
        console.log('Stray events after finalizing group:', this.strayEvents);

        // Once the stray events have been processed, reset the currentGroup
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

    async generateAnswer(question) {
        try {
            console.log("User Question:", question);
            // 'Here if the context for you if the user are to ask you any questions regarding the data I have provided. Here is the data: ' + 
            // let context = "you are a coding debug helper. The users will copy and paste in their code and ask you to debug their code. Here is the context: " + JSON.stringify(this.codeActivities, null, 2);
            console.log('In generateAnswer, codeActivities', this.codeActivities);

            let prompt = 'The user will ask you base on the context of this code history I provided: "' + JSON.stringify(this.codeActivities, null, 2) + '" and here is the question: ' + question;
            console.log("Context:", prompt);
            const completions = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                max_tokens: 400,
                messages: [
                    {
                        role: "system",
                        content: "you are a code history reviewer. The user will provide a json file like info to you and expect you to find information base on the json file. "
                        // content: context

                    },
                    // { role: "user", content: context},
                    // { role: "assistant", content: "got it, I will use this information to answer whatever questions that you ask."},
                    { role: "user", content: prompt }
                ]
            });
            console.log('API Response:', completions);

            let summary = completions?.choices?.[0]?.message?.content || "Summary not available";
            console.log('Summary:', summary);

            // if summary contains double quotes, make them single quotes
            summary = summary.replace(/"/g, "'");
            return `${summary}`;


        } catch (error) {
            console.error("Error generating title:", error.message);
            return `response generation failed`;
        }
    }


    async generateResources(activity) {
        try { 

            const prompt = `You have this list of links "${activity}":

go through each link and see if theres any repetition, explain in natural language, how each links can be useful for the user's programming process. 
Omit those repeating links and have a paragraph corresponding to each link. Be really brief in each paragraph so the text doesn't take too much space`;

            // console.log('Prompt:', prompt);

            const completions = await openai.chat.completions.create({
                model: 'gpt-3.5-turbo',
                max_tokens: 400,
                messages: [
                    { 
                        role: "system", 
                        content: "You are a resource provider where you will write several small paragraphs explaining why each link is helpful in natural langauage, the paragraphs will be easy to read and understand" 
                    }, 
                    { role: "user", content: prompt }
                ]
            });
            // console.log('API Response:', completions);

            let summary = completions?.choices?.[0]?.message?.content || "Summary not available";
            // console.log('Summary:', summary);

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

        if (!this.webviewPanel) {
            this.webviewPanel = vscode.window.createWebviewPanel(
                "chatPanel",
                "Chat Panel",
                vscode.ViewColumn.One,
                { enableScripts: true }
            );

            this.webviewPanel.onDidDispose(() => {
                this.webviewPanel = null;
            });
        }
        

        // const groupedEventsHTML = await this.generateGroupedEventsHTML();
        // const strayEventsHTML = await this.generateStrayEventsHTML();

        console.log("line 864");
        const chatboxHTML = await this.generateChatGPTResponseHTML('');
        const groupedEventsHTML = await this.generateGroupedEventsHTMLTest();
        const strayEventsHTML = await this.generateStrayEventsHTMLTest();

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
            <div class="wrapper">
                <div class="box" id="upper">
                    <div>
                        <h2>Recent Development Highlights </h2>
                    </div>
                    <h4><em>Ordered from least recent to most recent</em></h4>
                    <div class="view-controls">
                        <div class="view-buttons">
                            <button id="toggle-view">Switch to ${this.currentDiffView === 'line-by-line' ? 'Side-by-Side' : 'Line-by-Line'} View</button>
                        </div>
                        <p class="description">Click line numbers to jump to code</p>
                    </div>
                    <ul id="grouped-events">
                        ${groupedEventsHTML}
                    </ul>
                </div>
                <div class="handler"></div>
                <div class="box" id="lower"> 
                    <div>
                        <h2>In Progress Work</h2>
                    </div>
                    <ul id="stray-events">
                        ${strayEventsHTML}
                    </ul>
                </div>
                
                <button id="open-button">Chat with ChatGPT</button>
                <div class="chat-area" id="myForm"> 
                    <form id="chat-form" class="form-container">
                        <h1 for="msg">Chat with ChatGPT</h1>
                        <div id="response_area">
                            ${chatboxHTML}
                        </div>
                        <label>Ask ChatGPT a question!</label><br>
                        <div class="question-area">
                            <input type="text" id="question" name="user_question" placeholder="How do I do this...">
                            <button type="submit" class="btn">Submit</button>
                            <button type="button" class="btn" id="cancel">Close</button>
                        </div>
                    </form>
                    <div id="answer"></div>
                <div>
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
                            content.style.display = 'flex'; // Ensure content is visible if active
                        }
                    }
                });
            }

            // Attach collapsible event listeners
            function attachCollapsibleListeners() {
                document.querySelectorAll('.collapsible').forEach(button => {
                    button.addEventListener('click', function () {
                        this.classList.toggle('active');
                        const content = this.parentElement.nextElementSibling;
                        if (content) {
                            content.style.display = content.style.display === 'flex' ? 'none' : 'flex';
                            this.textContent = this.textContent === '+' ? '-' : '+';
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
           
            var openChat = document.getElementById("open-button");
            var closeChat = document.getElementById("cancel");
            const responseArea = document.getElementById("response_area");
            const questionInput = document.getElementById("question");
            const chatForm = document.getElementById("chat-form");

            function openForm() {
                console.log("clicked open");
                document.getElementById("myForm").style.display = "block";
            }

            openChat.addEventListener("click", openForm);

            function closeForm() {
                document.getElementById("myForm").style.display = "none";
            }

            closeChat.addEventListener("click", closeForm);

            // chatForm.addEventListener("submit", async function(event) {
            //         event.preventDefault();
            //         responseArea.innerHTML = "<p>Loading...</p>"; // Display loading message

            //         const userQuestion = questionInput.value.trim();
            //         if (!userQuestion) return;

            //         try {
            //             // Generate and display the chat response
            //             console.log("line 1028");
            //             const chatResponse = await this.generateChatGPTResponseHTML(userQuestion);
            //             responseArea.innerHTML = chatResponse; // Insert response into the chat area
            //         } catch (error) {
            //             console.error("Error generating response:", error);
            //             responseArea.innerHTML = '<p style="color:red;">Error: Could not generate response</p>';
            //         }
            //     });

            chatForm.addEventListener("submit", async function(event) {
                    event.preventDefault();
                    console.log("Submit button clicked!");

                    const userQuestion = questionInput.value.trim();
                    if (!userQuestion) return;
                    
                    responseArea.innerHTML = "<p>Loading...</p>";
                    
                    vscode.postMessage({
                        command: "askChatGPT",
                        question: userQuestion
                    });

            });

            window.addEventListener("message", (event) => {
                console.log("Received message:", event.data);
                if (event.data.command === "updateChatResponse") {
                    const response = event.data.response;
                    responseArea.innerHTML = response; // Update the response
                }
            });

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

            // Add event for line navigation in line-by-line view
            document.querySelectorAll('.line-num2').forEach(lineNumber => {
                lineNumber.addEventListener('click', function () {
                    const fileName = lineNumber.getAttribute('data-filename');
                    const line = lineNumber.getAttribute('data-linenumber');
                    vscode.postMessage({
                        command: 'navigateToLine',
                        fileName: fileName,
                        line: line
                    });
                });    
            });

            // Add event for line navigation in side-by-side view
            document.querySelectorAll('.clickable-line').forEach(lineNumber => {
                lineNumber.addEventListener('click', function () {
                    const fileName = lineNumber.getAttribute('data-filename');
                    const line = lineNumber.getAttribute('data-linenumber');
                    vscode.postMessage({
                        command: 'navigateToLine',
                        fileName: fileName,
                        line: line
                    });
                });    
            });

            let currentView = '${this.currentDiffView}';

            document.getElementById('toggle-view').addEventListener('click', () => {
                currentView = currentView === 'line-by-line' ? 'side-by-side' : 'line-by-line';
                document.getElementById('toggle-view').innerText = currentView === 'line-by-line' 
                    ? 'Switch to Side-by-Side View' 
                    : 'Switch to Line-by-Line View';
                vscode.postMessage({ command: 'changeViewMode', view: currentView });
            });
        
        })();
    </script>
            </body>
            </html>
        `;

        // vscode.window.onDidReceiveMessage((message) => {
        //     console.log("Received message from webview:", message);
        
        //     if (message.command === "askChatGPT") {
        //         this.handleChatGPTRequest(message.question);
        //     }
        // });

        this.webviewPanel.webview.onDidReceiveMessage(async (message) => {
            if (message.command === 'navigateToLine') {
                await this.navigateToLine(message.fileName, message.line);
            }
        });

        this.webviewPanel.webview.onDidReceiveMessage(async (message) => {
            if (message.command === "generateChatResponse") {
                try {
                    const chatResponse = await this.generateChatGPTResponseHTML(message.question);
                    this.webviewPanel.webview.postMessage({
                        command: "updateChatResponse",
                        response: chatResponse
                    });
                } catch (error) {
                    console.error("Error generating response:", error);
                    this.webviewPanel.webview.postMessage({
                        command: "updateChatResponse",
                        response: '<p style="color:red;">Error: Could not generate response</p>'
                    });
                }
            }
        });
        
    }

    async handleChatGPTRequest(question) {
        console.log("Handling ChatGPT request:", question);
    
        if (!this.webviewPanel) {
            console.error("Webview panel is not initialized!");
            return;
        }
    
        const response = await this.generateChatGPTResponseHTML(question);
    
        if (this.webviewPanel.webview) {
            this.webviewPanel.webview.postMessage({
                command: "updateChatResponse",
                response: response
            });
        } else {
            console.error("Webview is not available.");
        }
    }
    

    async navigateToLine(fileName, lineNumber) {
        console.log(fileName);

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
  
    async generateGroupedEventsHTMLTest() {
        let html = '';

        if (!this.codeResources || this.codeResources.length === 0) {
            console.error("codeResources is undefined or empty");
            return '<li>No resources for you :(.</li>';
        }
    
        console.log('In generateGroupedEventsHTML, codeActivities', this.codeActivities);

    
        for (let groupKey = 0; groupKey <= 8; groupKey++) {
            const group = this.codeActivities[groupKey];
            const links = this.codeResources[groupKey];
            
            let count = 0; 
            for (let subgoalKey = 0; subgoalKey < group.codeChanges.length; subgoalKey++) {
                const subgoal = group.codeChanges[subgoalKey];

                const diffHTML = this.generateDiffHTMLGroup(subgoal);

                    if(links.resources.length != 0 && count < links.resources.length) {
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
                                <b>in ${subgoal.file} </b> `
                        const link = links.resources[count];
                        console.log(link.actions.length);
                        html += `
                        <div class="container">
                            <i class="bi bi-bookmark"></i>
                            <div class="centered">${link.actions.length}</div>
                        </div>`
                        
                        html += `
                        </div>
                        <div class="content">
                            <div class="left-container">
                                ${diffHTML}
                            </div>
                            <div class="resources">
                        `
                        
                            if (count < links.resources.length) {
                                const link = links.resources[count];
                                // html += `<ul class="link_list">`
                                for(let i = 0; i < link.actions.length; i++) {
                                    const eachLink = links.resources[count].actions[i];
                                    html += `   
                                        <div class="tooltip">
                                            <a href="${eachLink.webpage}">${eachLink.webTitle}</a><br>
                                            <span class="tooltiptext"  style="scale: 2"><img class="thumbnail" src="${eachLink.img}" alt="Thumbnail"></span>
                                            <br>
                                        </div>
                                        <br>
                                    `
                                }
                                //  </ul>
                                html += `
                                   
                                </div>`
                            } else {
                                html += `</div>`
                            }
                        } else {
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
                                <div class="placeholder">
                                </div>
                            </div>
                            <div class="content">
                                <div class="full-container">
                                    ${diffHTML}
                                </div>
                            </div>`
                    }
                    
                    count ++;

                    html += `
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

        console.log('In generateGroupedEventsHTML', this.displayForGroupedEvents);
        if (this.displayForGroupedEvents.length === 0) {
            return '';
        }

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

            // Filter and extract web resources
            const webResources = group.actions.filter(
                action => action.type === 'search' || action.type.includes('visit')
            );

            // Track unique web visits and searches
            const uniqueSearches = new Set();
            const uniqueVisits = new Set();

            webResources.forEach(resource => {
                if (resource.type === 'search') {
                    const searchQuery = extractText(resource.webTitle, "search:", "- Google Search;");
                    uniqueSearches.add(searchQuery);
                } else if (resource.type.includes('visit')) {
                    // Skip visits that are just Google Search revisits
                    if (!resource.webTitle.toLowerCase().includes("search")) {
                        uniqueVisits.add(JSON.stringify({
                            webpage: resource.webpage,
                            webTitle: extractText(resource.webTitle, "visit:", ";"),
                            img: resource.img || 'default-image.jpg'
                        }));
                    }
                }
            });

            // Convert unique sets to arrays
            const searchQueries = Array.from(uniqueSearches);
            const visitResources = Array.from(uniqueVisits).map(item => JSON.parse(item));

            for (const [index, event] of group.actions.entries()) {
                if (event.type === 'code') {
                    // Generate diff HTML for code event
                    const diffHTML = this.generateDiffHTMLGroup(event);

                    // Determine if resources exist
                    const resourcesExist = webResources.length > 0;
                    const containerClass = resourcesExist ? 'left-container' : 'full-container';

                    // Start HTML generation for code event
                    const title = event.title || "Untitled";
                    html += `
                        <li data-eventid="${index}">
                            <div class="li-header">
                                <button type="button" class="collapsible" id="plusbtn-${groupKey}-${index}">+</button>
                                <input class="editable-title" id="code-title-${groupKey}-${index}" 
                                    value="${title}" 
                                    onchange="updateCodeTitle('${groupKey}', '${index}')" 
                                    size="50">
                                <button type="button" class="btn btn-secondary" id="button-${groupKey}-${index}">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-pencil-square" viewBox="0 0 16 16">
                                        <path d="M15.502 1.94a.5.5 0 0 1 0 .706L14.459 3.69l-2-2L13.502.646a.5.5 0 0 1 .707 0l1.293 1.293zm-1.75 2.456-2-2L4.939 9.21a.5.5 0 0 0-.121.196l-.805 2.414a.25.25 0 0 0 .316.316l2.414-.805a.5.5 0 0 0 .196-.12l6.813-6.814z"></path>
                                        <path fill-rule="evenodd" d="M1 13.5A1.5 1.5 0 0 0 2.5 15h11a1.5 1.5 0 0 0 1.5-1.5v-6a.5.5 0 0 0-1 0v6a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5v-11a.5.5 0 0 1 .5-.5H9a.5.5 0 0 0 0-1H2.5A1.5 1.5 0 0 0 1 2.5z"></path>
                                    </svg>
                                </button>
                                <b>in ${event.file} </b>
                                ${resourcesExist ? `
                                <div class="container">
                                    <i class="bi bi-bookmark"></i>
                                    <div class="centered">${visitResources.length}</div>
                                </div>
                                ` : ''}
                            </div>

                            <div class="content">
                                <div class="${containerClass}">
                                    ${diffHTML}
                                </div>

                                ${resourcesExist ? `
                                <div class="resources">
                                    <h4>Helpful Resources</h4>

                                    ${searchQueries.length > 0 ? `
                                    <div class="search-resources">
                                        <p>
                                            You searched for 
                                            ${searchQueries.map(query => `<i>${query}</i>`).join(', ')}.
                                        </p>
                                    </div>
                                    ` : ''}

                                    ${visitResources.length > 0 ? `
                                    <div class="visit-resources">
                                        <p>You visited the following resources:</p>
                                        <ul class="resource-list">
                                            ${visitResources.map(resource => `
                                                <li>
                                                    <div class="resource-item tooltip">
                                                        <a href="${resource.webpage}" target="_blank">
                                                            ${resource.webTitle}
                                                        </a>
                                                        <!-- <span class="tooltiptext">
                                                            <img class="thumbnail" src="${resource.img}" alt="Thumbnail">
                                                        </span> -->
                                                    </div>
                                                </li>
                                            `).join('')}
                                        </ul>
                                    </div>
                                    ` : ''}
                                </div>
                                ` : ''}
                            </div>
                        </li>

                        <script> 
                            (() => {
                                const editButton = document.getElementById('button-${groupKey}-${index}');
                                if (editButton) {
                                    editButton.addEventListener('click', function() {
                                        const titleInput = document.getElementById('code-title-${groupKey}-${index}');
                                        if (titleInput) {
                                            titleInput.focus();
                                        }
                                    });  
                                }
                            })();
                        </script>
                    `;
                }
            }
        }

        return html;
    }

    // Generate the HTML for the diff view of a code activity
    // This happens after a "test" occurrence (comparing two versions of commit)
    async generateDiffHtmlStray(anEvent) {
        try {
            const currentDir = getCurrentDir();
            const gitDir = path.join(currentDir, 'codeHistories.git');
            const workTree = currentDir;
    
            // Get the second-to-last commit hash
            const logCmd = `git --git-dir="${gitDir}" --work-tree="${workTree}" log -2 --format="%H"`;
            const { stdout: logOutput } = await exec(logCmd, { cwd: workTree });
            const commitHashes = logOutput.trim().split('\n');
            const previousCommitHash = commitHashes[1];  // HEAD~1 is the second hash
    
            // Get the content of the file from the previous commit
            const previousFilePath = path.join(currentDir, anEvent.file);
            let previousFileContent = '';
    
            try {
                // Simulating reading the file content from the previous commit using fs.promises.readFile
                const showCmd = `git --git-dir="${gitDir}" --work-tree="${workTree}" show ${previousCommitHash}:${anEvent.file}`;
                const { stdout: previousFileOutput } = await exec(showCmd, { cwd: workTree });
                previousFileContent = previousFileOutput;
            } catch (err) {
                // If the file did not exist in the previous commit, treat it as a newly created file
                console.log(`File didn't exist in the previous commit. Treating as a new file: ${anEvent.file}`);
                previousFileContent = '';  // No content in previous commit
            }
    
            const currentFileContent = await fs.promises.readFile(previousFilePath, 'utf8')
    
            const diffString = Diff.createTwoFilesPatch(
                `start`,
                `end`,
                previousFileContent,
                currentFileContent,
                anEvent.file,
                anEvent.file,
                { ignoreWhitespace: true } // this is important
            );

            // Check if there are real content changes (e.g., additions or deletions)
            const hasRealChanges = diffString.includes('@@') && (diffString.includes('+') || diffString.includes('-'));
            if (!hasRealChanges) {
                // If no real content changes, return an empty string
                // Indicating we should skip displaying this event in the webview
                return '';
            }

            const diffHtml = diff2html.html(diffString, {
                outputFormat: this.currentDiffView,
                drawFileList: false,
                colorScheme: 'light',
                showFiles: false,
            });

            let modifiedHtml = '';

            if(this.currentDiffView === 'line-by-line') {
                modifiedHtml = diffHtml.replace(/<div class="line-num2">(.*?)<\/div>/g, (match) => {
                    const lineNumber = match.match(/<div class="line-num2">(.*?)<\/div>/)[1];
                    return `<div class="line-num2" data-linenumber="${lineNumber-1}" data-filename="${anEvent.file}">${lineNumber}</div>`;
                });
            }

            if(this.currentDiffView === 'side-by-side') {
                modifiedHtml = diffHtml.replace(/<td class="d2h-code-side-linenumber(?: [\w-]+)*">\s*(\d+)\s*<\/td>/g, (match) => {
                    const lineNumber = match.match(/<td class="d2h-code-side-linenumber(?: [\w-]+)*">\s*(\d+)\s*<\/td>/)[1];
                    return `<td class="d2h-code-side-linenumber clickable-line" data-linenumber="${lineNumber - 1}" data-filename="${anEvent.file}">${lineNumber}</td>`;
                });
            }

            return modifiedHtml;
        } catch (err) {
            console.error(`Error generating diff for ${anEvent.file}: ${err}`);
            return 'Error generating diff';
        }
    }
    

  async generateStrayEventsHTMLTest() {
        // console.log('In generateStrayEventsHTML', this.strayEvents);
        let html = '';

        // if (this.strayEvents.length === 0) {
            return '<li>Your future changes goes here.</li>';
        // }

        // the events in strayEvents are in processed form
        // for (const event of this.strayEvents) {
        //     // all info is in event.notes
        //     const humanReadableTime = new Date(event.time * 1000).toLocaleString();
            
        //     if(event.type === "code") {
        //         html += `
        //             <li class="stray-event">
        //                 <p><strong><em>${event.file}</em></strong></p>
        //             </li>
        //         `;
        //     } else {
        //         if(event.type === "search") {
        //             html += `
        //                 <li class="stray-event">
        //                     <p><strong>${humanReadableTime}</strong> - <em>${event.webTitle}</em></p>
        //                 </li>
        //             `;
        //         } else {
        //             // visit or revisit
        //             // same thing but also including the url link
        //             html += `
        //                 <li class="stray-event">
        //                     <p><strong>${humanReadableTime}</strong> - <a href="${event.webpage}"<em>${event.webTitle}</em></a></p>
        //                 </li>
        //                 `;
        //         }
        //     }
        // }

        return html;
    }

    // This happens after a "save" occurrence (comparing two versions of file save)
    async generateDiffHtmlSave(filename) {
        try {
            const initialSave = this.initialSaves[filename];
            const allSavesForFile = this.allSaves[filename] || [];
            const latestSave = allSavesForFile[allSavesForFile.length - 1];
    
            // If no initial or latest save exists, return an empty string
            if (!initialSave || !latestSave) {
                return '';
            }
    
            const initialContent = initialSave.code_text || '';
            const latestContent = latestSave.code_text || '';
    
            const diffString = Diff.createTwoFilesPatch(
                'Initial Save',
                'Latest Save',
                initialContent,
                latestContent,
                filename,
                filename,
                { ignoreWhitespace: true } // Ignore whitespace-only changes
            );

            // Check if there are real content changes (e.g., additions or deletions)
            const hasRealChanges = diffString.includes('@@') && (diffString.includes('+') || diffString.includes('-'));
            if (!hasRealChanges) {
                // If no real content changes, return an empty string
                // Indicating we should skip displaying this event in the webview
                return '';
            }

            const diffHtml = diff2html.html(diffString, {
                outputFormat: this.currentDiffView,
                drawFileList: false,
                colorScheme: 'light',
                showFiles: false,
            });

            let modifiedHtml = '';

            if(this.currentDiffView === 'line-by-line') {
                modifiedHtml = diffHtml.replace(/<div class="line-num2">(.*?)<\/div>/g, (match) => {
                    const lineNumber = match.match(/<div class="line-num2">(.*?)<\/div>/)[1];
                    return `<div class="line-num2" data-linenumber="${lineNumber-1}" data-filename="${filename}">${lineNumber}</div>`;
                });
            }

            if(this.currentDiffView === 'side-by-side') {
                modifiedHtml = diffHtml.replace(/<td class="d2h-code-side-linenumber(?: [\w-]+)*">\s*(\d+)\s*<\/td>/g, (match) => {
                    const lineNumber = match.match(/<td class="d2h-code-side-linenumber(?: [\w-]+)*">\s*(\d+)\s*<\/td>/)[1];
                    return `<td class="d2h-code-side-linenumber clickable-line" data-linenumber="${lineNumber - 1}" data-filename="${filename}">${lineNumber}</td>`;
                });
            }

            return modifiedHtml;
        } catch (err) {
            console.error(`Error generating diff for file: ${filename}`, err);
            return 'Error generating diff';
        }
    }    

    async generateStrayEventsHTML() {
        let html = '';
        let idx = 0;
    
        // if (this.strayEvents.length === 0) {
        //     return '<li>Your future changes go here.</li>';
        // }
    
        // Track the most recent change for each file
        const fileDiffs = {};
        
        // Track unique web visits and searches
        const uniqueVisits = new Set();
        const uniqueSearches = new Set();
        
        for (const event of this.strayEvents) {
            if (event.type === "code") {
                // Uncomment this if comparing code test events
                // const diffHTMLForStrayChanges = await this.generateDiffHtmlStray(event);

                // // Only store the diff if there's content to display
                // if (diffHTMLForStrayChanges.trim()) {
                //     // Store the latest diff for this file, replacing any previous entry
                //     fileDiffs[event.file] = `
                //         <li class="stray-event" id="code-stray-${idx}">
                //             <div class="li-header">
                //                 <button type="button" class="collapsible active" id="plusbtn-code-stray-${idx}">-</button>
                //                 You made changes to <em>${event.file}</em>
                //                 <div class="placeholder"></div>
                //             </div>
                //             <div class="content" id="content-code-stray-${idx}" style="display: flex;">
                //                 <div class="full-container">
                //                     ${diffHTMLForStrayChanges}
                //                 </div>
                //             </div>
                //         </li>
                //     `;
                // }
                continue;
            } else if (event.type === "search") {
                // Handle search events and avoid duplicates
                const searchedTitle = event.webTitle.substring(event.webTitle.indexOf(":") + 1, event.webTitle.lastIndexOf("-")).trim();
                if (!uniqueSearches.has(searchedTitle)) {
                    uniqueSearches.add(searchedTitle);
                    html += `
                        <li class="stray-event" id="search-stray-${idx}">
                            <p>You searched for "${searchedTitle}"</p>
                        </li>
                    `;
                }
            } else if (event.type === "visit" || event.type === "revisit") {
                // Handle visit or revisit events and avoid duplicates
                const pageTitle = event.webTitle.substring(event.webTitle.indexOf(":") + 1, event.webTitle.lastIndexOf(";")).trim();

                // if pageTitle contains "search", skip this visit
                if (pageTitle.toLowerCase().includes("search")) {
                    continue;
                }

                if (!uniqueVisits.has(event.webpage)) {
                    uniqueVisits.add(event.webpage);
                    html += `
                        <li class="stray-event" id="visit-stray-${idx}">
                            <p>You visited the site <a href="${event.webpage}" target="_blank">${pageTitle}</a></p>
                        </li>
                    `;
                }
            }
    
            idx += 1;  // Increment index for the next item
        }

        // Iterate over all saves and generate diffs
        for (const [filename, saves] of Object.entries(this.allSaves)) {
            const diffHtml = await this.generateDiffHtmlSave(filename);

            if (diffHtml.trim()) {
                fileDiffs[filename] = `
                    <li class="stray-event" id="code-stray-${filename}">
                        <div class="li-header">
                            <button type="button" class="collapsible active" id="plusbtn-code-stray-${filename}">-</button>
                            You made changes to <em>${filename}</em>
                            <div class="placeholder"></div>
                        </div>
                        <div class="content" id="content-code-stray-${filename}" style="display: flex;">
                            <div class="full-container">
                                ${diffHtml}
                            </div>
                        </div>
                    </li>
                `;
            }
        }
    
        // After processing all events, add the stored diffs to the HTML
        Object.values(fileDiffs).forEach(diff => {
            html += diff;
        });
    
        return html;  // Return the generated HTML
    }    
    
    async generateChatGPTResponseHTML(question) {
        try {
            const response = await this.generateAnswer(question);
            console.log(response);
    
            if (!response) {
                return `<p style="color:red;">Error: No response received.</p>`;
            }
    
            let html = '';

            if(question === '') {
                html+= 
                `<div class="chat-response">
                    <strong>ChatGPT:</strong>
                    <p>${response}</p>
                </div>`;
            } else {
                html +=
                `
                <div class="user-question">
                    <p class="user-question-area">${question}</p>
                </div>
                <div class="chat-response">
                    <strong>ChatGPT:</strong>
                    <p>${response}</p>
                </div>
            `;
            }

            return html;
        } catch (err) {
            console.error("Error generating response:", err);
            return `<p style="color:red;">Error: ${err.message}</p>`;
        }
    }

    // async initialize() {
    //     console.log("line 1793");
    //     const chatboxHTML = await generateChatGPTResponseHTML();
    //     this.responseArea.innerHTML = chatboxHTML;
    // }

    async initialize() {
        console.log("line 1793");
    
        const userQuestion = document.getElementById('question').value.trim();
    
        if (userQuestion) {
            const chatboxHTML = await this.generateChatGPTResponseHTML(userQuestion);
            this.responseArea.innerHTML = chatboxHTML;
        } else {
            console.log("No question provided.");
        }
    }

    generateDiffHTMLGroup(codeActivity) {
        // Get the event at startTime
        let startCodeEventLines = this.get_code_lines(codeActivity.before_code);

        // Get the event at endTime
        let endCodeEventLines = this.get_code_lines(codeActivity.after_code);

        let diffString = Diff.createTwoFilesPatch(
            'start',
            'end',
            codeActivity.before_code,
            codeActivity.after_code,
            codeActivity.file,
            codeActivity.file,
            { ignoreWhitespace: true } // this is important
        );

        // Render the diff as HTML
        let diffHtml = diff2html.html(diffString, {
            outputFormat: this.currentDiffView,
            drawFileList: false,
            colorScheme: 'light',
            showFiles: false,
        });

        let modifiedHtml = '';

        if(this.currentDiffView === 'line-by-line') {
            modifiedHtml = diffHtml.replace(/<div class="line-num2">(.*?)<\/div>/g, (match) => {
                const lineNumber = match.match(/<div class="line-num2">(.*?)<\/div>/)[1];
                return `<div class="line-num2" data-linenumber="${lineNumber-1}" data-filename="${codeActivity.file}">${lineNumber}</div>`;
            });
        }

        if(this.currentDiffView === 'side-by-side') {
            modifiedHtml = diffHtml.replace(/<td class="d2h-code-side-linenumber(?: [\w-]+)*">\s*(\d+)\s*<\/td>/g, (match) => {
                const lineNumber = match.match(/<td class="d2h-code-side-linenumber(?: [\w-]+)*">\s*(\d+)\s*<\/td>/)[1];
                return `<td class="d2h-code-side-linenumber clickable-line" data-linenumber="${lineNumber - 1}" data-filename="${codeActivity.file}">${lineNumber}</td>`;
            });
        }

        return modifiedHtml;
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
        return this.webviewPanel.webview.html;
    }

    disposeWebview() {
        if (this.webviewPanel) {
            this.webviewPanel.dispose();
        }
    }
    
    // Function to comment out VS Code API calls before saving the HTML
    commentOutVSCodeApi(htmlContent) {
        // Comment out 'const vscode = acquireVsCodeApi();'
        htmlContent = htmlContent.replace(/const vscode = acquireVsCodeApi\(\);/, '// const vscode = acquireVsCodeApi();');

        // Comment out 'vscode.postMessage({...})' related to 'updateTitle'
        htmlContent = htmlContent.replace(
            /vscode\.postMessage\(\s*\{\s*command:\s*'updateTitle'[\s\S]*?\}\s*\);/g, 
            `// vscode.postMessage({ 
                // command: 'updateTitle', 
                // groupKey: groupKey, 
                // title: titleInput 
            // });`
        );

        // Comment out 'vscode.postMessage({...})' related to 'updateCodeTitle'
        htmlContent = htmlContent.replace(
            /vscode\.postMessage\(\s*\{\s*command:\s*'updateCodeTitle'[\s\S]*?\}\s*\);/g, 
            `// vscode.postMessage({ 
                // command: 'updateCodeTitle', 
                // groupKey: groupKey, 
                // eventId: eventId, 
                // title: codeTitleInput 
            // });`
        );

        return htmlContent;
    }
}

module.exports = ClusterManager;
