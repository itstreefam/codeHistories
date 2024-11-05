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
        this.debug = false;  // Debug flag to print out additional information
        this.webviewPanel = null;
        this.currentCodeEvent = null;
        this.currentWebEvent = null;
        this.idCounter = 0;
        this.styles = historyStyles;
        // this.initializeTemporaryTest();
        // this.initializeResourcesTemporaryTest();
        this.debugging = true;
        this.prevCommittedEvents = [];
    }

    initializeTemporaryTest(){
        const testData = new temporaryTest(String.raw`C:\users\thien\Downloads\wordleStory.json`); // change path of test data here
        // codeActivities has id, title, and code changes
        // the focus atm would be code changes array which contains smaller codeActivity objects
        // for eg, to access before_code, we would do this.codeActivities[0].codeChanges[0].before_code
        this.codeActivities = testData.processSubgoals(testData.data);
        console.log("initialization test");
        console.log(this.codeActivities);
    }

    initializeResourcesTemporaryTest(){
        const testData = new temporaryTest(String.raw`C:\users\thien\Downloads\wordleStory.json`); // change path of test data here
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
            }
        }
        
        this.prevCommittedEvents = codeEventsList;

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
        let startCodeEvent = this.strayEvents.find(event => event.type === "code" && event.file === filename);

        // grab the last code event from the stray events
        let endCodeEvent = [...this.strayEvents].reverse().find(event => event.type === "code" && event.file === filename);

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

        // grab only the web events from the stray events that has time between the start and end time of codeActivity
        let webEvents = this.strayEvents.filter(event => event.type !== "code" && event.time >= codeActivity.startTime && event.time <= codeActivity.endTime);

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

        // Clear the items that have been grouped in the currentGroup from strayEvents
        this.strayEvents = this.strayEvents.filter(event => event.file !== filename);

        // Remove the events from webEvents from this.strayEvents
        this.strayEvents = this.strayEvents.filter(event => !webEvents.includes(event));
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
                    <div>
                        <h2>Recent Development Highlights </h2>
                    </div>
                    <h4><em>Ordered from least recent to most recent</em></h4>
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

                const diffHTML = this.generateDiffHTML(subgoal);

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
                                for(let i = 0; i < link.actions.length; i++) {
                                    const eachLink = links.resources[count].actions[i];
                                    html += `   
                                        <div class="tooltip">
                                            ${eachLink.webTitle}: <a>${eachLink.webpage}</a>
                                            <span class="tooltiptext"  style="scale: 2"><img class="thumbnail" src="${eachLink.img}" alt="Thumbnail"></span>
                                            <br>
                                        </div>
                                    `
                                }
                                html += `</div>`
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
            return '<li>No grouped events.</li>';
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

            // check if there are any related resources (structured web events)
            let resourcesExist = group.actions.some(action => action.type === 'search' || action.type === 'visit' || action.type === 'revisit');
            let containerClass = resourcesExist ? 'left-container' : 'full-container';

            for (const [index, event] of group.actions.entries()) {

                let title = event.title || "Untitled";  // Provide a default title if undefined

                if (event.type === 'code') {
                    // Render the code activity with editable title and collapsible diff
                    const diffHTML = this.generateDiffHTML(event);

                    html += `
                        <li data-eventid="${index}">
                            <!-- Editable title for the code activity -->
                            <div class="li-header">
                                <button type="button" class="collapsible" id="plusbtn-${groupKey}-${index}">+</button>
                                <input class="editable-title" id="code-title-${groupKey}-${index}" value="${title}" onchange="updateCodeTitle('${groupKey}', '${index}')" size="50">
                                <button type="button" class="btn btn-secondary" id="button-${groupKey}-${title}">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-pencil-square" viewBox="0 0 16 16">
                                    <path d="M15.502 1.94a.5.5 0 0 1 0 .706L14.459 3.69l-2-2L13.502.646a.5.5 0 0 1 .707 0l1.293 1.293zm-1.75 2.456-2-2L4.939 9.21a.5.5 0 0 0-.121.196l-.805 2.414a.25.25 0 0 0 .316.316l2.414-.805a.5.5 0 0 0 .196-.12l6.813-6.814z"></path>
                                    <path fill-rule="evenodd" d="M1 13.5A1.5 1.5 0 0 0 2.5 15h11a1.5 1.5 0 0 0 1.5-1.5v-6a.5.5 0 0 0-1 0v6a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5v-11a.5.5 0 0 1 .5-.5H9a.5.5 0 0 0 0-1H2.5A1.5 1.5 0 0 0 1 2.5z"></path>
                                    </svg>
                                </button>
                                <b>in ${event.file} </b>
                    `;
                
                    if (resourcesExist) {
                        const action = group.actions.find(a => a.type === 'search');
                        if (action && action.actions.length > 0) {
                            html += `
                                <div class="container">
                                    <i class="bi bi-bookmark"></i>
                                    <div class="centered">${action.actions.length}</div>
                                </div>
                            `;
                        }
                    }
    
                    html += `</div>`; // Close li-header div
    
                    // Content section with diff and resources
                    html += `
                        <div class="content">
                            <div class="${containerClass}">
                                ${diffHTML}
                            </div>
                    `;
    
                    if (resourcesExist) {
                        html += `<div class="resources">`;
                        for (let action of group.actions) {
                            if (action.type === "search") {
                                html += `<h4> You searched for: ${action.query}</h4>`;
    
                                if (action.actions.length > 0) {
                                    for (let visit of action.actions) {
                                        html += `
                                            <div class="tooltip">
                                                ${visit.webTitle}: <a href="${visit.webpage}" target="_blank">${visit.webpage}</a>
                                                <span class="tooltiptext" style="scale: 2">
                                                    <img class="thumbnail" src="${visit.img || 'default-image.jpg'}" alt="Thumbnail">
                                                </span>
                                                <br>
                                            </div>
                                        `;
                                    }
                                }
                            } else if (action.type === "visit" || action.type === "revisit") {
                                html += `<h4> You visited: <a href="${action.webpage}" target="_blank">${action.webTitle}</a></h4>`;
                            }
                        }
                        html += `</div>`; // Close resources div
                    }
                    html += `</div>`; // Close content div
                }
    
                html += `</li>`; // Close list item
    
                // Add JavaScript for the toggle button and focus on input
                html += `
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
    
            const diffHtml = diff2html.html(diffString, {
                outputFormat: 'line-by-line',
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
            codeActivity.file,
            { ignoreWhitespace: true } // this is important
        );

        // Render the diff as HTML
        const diffHtml = diff2html.html(diffString, {
            outputFormat: 'line-by-line',
            drawFileList: false,
            colorScheme: 'light',
            showFiles: false,
        });
      
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
        if (this.webviewPanel && this.webviewPanel.webview) {
            return this.webviewPanel.webview.html;
        }
        return null;
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
