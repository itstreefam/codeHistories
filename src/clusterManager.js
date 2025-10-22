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

app.use(express.json())

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
        // this.initializeTemporaryTest();
        // this.initializeResourcesTemporaryTest();
        this.debugging = true;
        this.prevCommittedEvents = [];
        this.isInitialized = false;
        this.isPanelClosed = false;
        this.stayPersistent = stayPersistent;
        this.allSaves = {}; // Stores all save events per file
        this.initialSaves = {}; // Tracks the first save for comparison
        this.currentDiffView = 'line-by-line'; //default view
        this.generateJSON = [];
        this.userQuestion = '';
        this.queryHistory = []; // Store previous queries and responses
        this.activeDecorations = []; // Task active decorations/highlights
        this.hasRestoredFromLastSession = false; // Track if we restored from last session
        this.chatResponseHTML = null;

        //map to document asked user questions and to store answers for faster regeneration when user asks a similar question again 
        this.questionCache = new Map();

        this.currentBatchId = 0;
        this.batchColorMap = {}; // Store colors by batch ID (for denoting related subgoal changes)
    }

    async initializeOpenAI(context) {
        const apiKey = await context.secrets.get('openaiApiKey');

        if (!apiKey) {
            vscode.window.showErrorMessage('OpenAI API key is not set. Please set it in the extension settings.');
            return;
        }
        console.log('Retrieved OpenAI API key:', apiKey);
        this.openai = new OpenAI({
            apiKey: apiKey
        });
        console.log('OpenAI initialized successfully');
    }

    initializeTemporaryTest() {
        const testData = new temporaryTest(String.raw`C:\Users\Tin Pham\Downloads\tileMakingPuzzle.json`); // change path of test data here
        // codeActivities has id, title, and code changes
        // the focus atm would be code changes array which contains smaller codeActivity objects
        // for eg, to access before_code, we would do this.codeActivities[0].codeChanges[0].before_code
        this.codeActivities = testData.processSubgoals(testData.data);
        // this.documentedHistory = testData.processHistories(testData.data);

        console.log("initialization test");
        console.log(this.codeActivities);
        // console.log("why doesn't it work im so confused: " + this.documentedHistory);
    }

    initializeResourcesTemporaryTest() {
        const testData = new temporaryTest(String.raw`C:\Users\Tin Pham\Downloads\tileMakingPuzzle.json`); // change path of test data here
        this.codeResources = testData.processResources(testData.data);
        console.log("Resources", this.codeResources);
    }

    async restoreStateFromFile() {
        if (this.hasRestoredFromLastSession) return; // Prevent re-loading

        try {
            const currentDir = getCurrentDir();
            const statePath = path.join(currentDir, 'CH_cfg_and_logs', 'history_session_state.json');

            if (fs.existsSync(statePath)) {
                const stateJSON = fs.readFileSync(statePath, 'utf8');
                const state = JSON.parse(stateJSON);

                this.displayForGroupedEvents = state.groupedEvents || [];
                this.strayEvents = state.strayEvents || [];
                this.currentDiffView = state.currentDiffView || 'line-by-line';
				this.allSaves = state.allSaves || {};
				this.initialSaves = state.initialSaves || {};
                this.allPastEvents = state.allPastEvents || {};
                this.prevCommittedEvents = state.prevCommittedEvents || [];
                this.currentGroup = state.currentGroup || null;

                this.inCluster = state.inCluster || {};
                this.clusterStartTime = state.clusterStartTime || {};
                this.pastEvents = state.pastEvents || null;
                this.currentCodeEvent = state.currentCodeEvent || null;
                this.currentWebEvent = state.currentWebEvent || null;
                this.idCounter = state.idCounter || 0;
                this.currentBatchId = state.currentBatchId || 0;
                this.batchColorMap = state.batchColorMap || {};

                this.hasRestoredFromLastSession = true;
                console.log(`Successfully restored state from last session`);
            }
        } catch (error) {
            // console.error('Error restoring session state:', error);
            // // In case of error, start with a fresh state
            // this.displayForGroupedEvents = [];
            // this.strayEvents = [];

            console.error('Could not restore session state, starting fresh:', error);
        
            this.displayForGroupedEvents = [];
            this.strayEvents = [];
            this.currentDiffView = 'line-by-line';
            this.allSaves = {};
            this.initialSaves = {};
            this.allPastEvents = {};
            this.prevCommittedEvents = [];
            this.currentGroup = null;
            this.inCluster = {};
            this.clusterStartTime = {};
            this.pastEvents = [];
            this.currentCodeEvent = null;
            this.currentWebEvent = null;
            this.idCounter = 0;
            this.currentBatchId = 0;
            this.batchColorMap = {};
        }
    }

    async initializeClusterManager() {
        await this.initializeOpenAI(this.context); // ensure OpenAI is initialized
        await this.restoreStateFromFile(); // if there is data to restore
        
        if(!this.hasRestoredFromLastSession) {
            const initialCodeEntries = await this.gitTracker.grabAllLatestCommitFiles();
            await this.processCodeEvents(initialCodeEntries);
        }

        this.isInitialized = true;
    }

    async initializeWebview() {
        if (this.isPanelClosed && this.stayPersistent === false) {
            return;
        }

        // Check if the webview is already opened
        if (this.webviewPanel) {
            this.webviewPanel.reveal(vscode.ViewColumn.Beside);
            return;
        }
        
        this.webviewPanel = vscode.window.createWebviewPanel(
            'historyWebview',
            'History Webview',
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

        // Save webview's html just before it is closed
        this.webviewPanel.onDidDispose(() => {
            // this.context.workspaceState.update('previousWebviewState', this.webviewPanel.webview.html);

            // Set a small timeout to ensure the state is sent before we consider it disposed
            setTimeout(() => {
                if (this.stayPersistent === false) this.isPanelClosed = true;
                this.webviewPanel = null;
            }, 1000); // Adjust timeout if necessary
        });

        // Listen for messages from the webview to save the state
        this.webviewPanel.webview.onDidReceiveMessage(async message => {
            if (message.command === 'updateCodeTitle') {
                await this.updateCodeTitle(message.groupKey, message.eventId, message.title);
            }

            if (message.command === 'changeViewMode') {
                this.currentDiffView = message.view;
                console.log("ERROR IN INITIALIZEWEBVIEW, LINE 170!")
                await this.updateWebPanel('');
            }

            if (message.command === "askChatGPT") {
                console.log("Received askChatGPT message:", message);
                this.userQuestion = message.question;
                await this.handleChatGPTRequest(message.question);
            }

            if (message.command === "resetPanel") {
                console.log("ERROR IN INITIALIZEWEBVIEW, LINE 181!")
                this.chatResponseHTML = null;
                this.userQuestion = '';
                // await this.updateWebPanel('');

                // Generate the default history HTML explicitly
                const defaultHistoryHTML = await this.generateFullHistoryHTML();

                // 1. Update the webview's internal HTML (in case of a full refresh)
                await this.updateWebPanel(''); 

                // 2. Explicitly send the default HTML via the message channel to update the inner content
                this.webviewPanel.webview.postMessage({
                    command: "updateChatResponse", // Reuse this command
                    response: defaultHistoryHTML
                });
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

        this.currentBatchId += 1;

        for (const entry of codeEventsList) {
            const eventType = this.getEventType(entry);

            if (!this.currentGroup) {
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

                // await this.handleSaveEvent(entry);
            }
        }

        if (!this.isInitialized) {
            return;
        }

        // Trigger webview if not opened
        if (!this.webviewPanel) {
            await this.initializeWebview();
        } else {
            // If webview is already opened, just update the content
            console.log("ERROR IN PROCESSCODEEVENT, LINE 231!")
            await this.updateWebPanel();
        }
    }

    async processWebEvents(webEventsList) {
        if (!webEventsList || webEventsList.length === 0) {
            return;
        }

        console.log('In processWebEvents', webEventsList);

        for (const entry of webEventsList) {
            const eventType = this.getEventType(entry);

            if (!this.currentGroup) {
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

        if (!this.isInitialized) {
            return;
        }

        // Trigger webview if not opened
        if (!this.webviewPanel) {
            await this.initializeWebview();
        } else {
            // If webview is already opened, just update the content
            console.log("ERROR IN PROCESSWEBEVENTS, LINE 269!")
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

    getBatchColor(batchId) {
        // If color already generated for this batch, return it
        if (this.batchColorMap[batchId]) {
            return this.batchColorMap[batchId];
        }
        
        // Generate new color using golden angle for good distribution
        const hue = (batchId * 137.508) % 360;
        const saturation = 65;
        const lightness = 55;
        const color = `hsl(${hue}, ${saturation}%, ${lightness}%)`;
        
        // Store it for consistency
        this.batchColorMap[batchId] = color;
        return color;
    }

    startNewGroup() {
        this.idCounter += 1;
        this.currentGroup = {
            type: "subgoal",
            id: this.idCounter.toString(),
            title: "Title of the subgoal",
            actions: [],
            // batchId: this.currentBatchId, // Add batch ID to track related subgoals
        };
    }

    async handleSaveEvent(event) {
        // console.log('In handleSaveEvent', event);

        const documentPath = event.document;
        const newContent = event.code_text;

        // Extract the filename from the document path
        const filename = path.basename(documentPath);

        // Initialize save tracking for the file if not already done
        if (!this.allSaves[filename]) {
            this.allSaves[filename] = [];
        }

        // Add the current save event to allSaves
        this.allSaves[filename].push({ file: filename, time: event.time, code_text: newContent });

        // Set the initial save baseline if not already set
        if (!this.initialSaves[filename]) {
            // Check if this file has ever been committed (exists in allPastEvents)
            const isNewFile = !this.allPastEvents[filename] || this.allPastEvents[filename].length === 0;
            
            if (isNewFile) {
                // New file: baseline is empty (show all additions on first save)
                this.initialSaves[filename] = { file: filename, time: event.time, code_text: '' };
            } else {
                // Existing file: baseline is the last committed state
                const lastCommittedEvent = this.allPastEvents[filename][this.allPastEvents[filename].length - 1];
                this.initialSaves[filename] = { 
                    file: filename, 
                    time: event.time, 
                    code_text: lastCommittedEvent.code_text 
                };
            }
        } else {
            // For consecutive save comparison: update baseline to previous save content
            // But only if this isn't the first save after setting the baseline
            if (this.allSaves[filename].length > 1) {
                const previousSave = this.allSaves[filename][this.allSaves[filename].length - 2];
                this.initialSaves[filename] = {
                    file: filename,
                    time: previousSave.time,
                    code_text: previousSave.code_text
                };
            }
        }

        if (!this.isInitialized) {
            return;
        }

        // Instead of a full refresh, generate just the stray events HTML
        const strayEventsHTML = await this.generateStrayEventsHTML();

        if (this.webviewPanel) {
            // Send a partial update for only the "in-progress" section
            this.webviewPanel.webview.postMessage({
                command: 'updateStrayEvents',
                response: strayEventsHTML
            });
        }
    }

    // event: code event of a file in the current commit
    // previousEventList: list of code events in the previous commit
    // case 1: if the previousEventList is empty, the code event is new addition (check significance)
    // case 2: if the code event exists in the previousEventList, compare the code changes for that file
    // case 3: if the code event does not exist in the previousEventList and it does not exist in this.allPastEvents, it is a new addition (check significance)
    // case 4: if the code event does not exist in the previousEventList but exists in this.allPastEvents, we asssume file switching and compare the code changes for that file
    async handleCodeEvent(event, previousEventList) {
        const filename = this.getFilename(event.notes); // event is always guaranteed to exist

        // Ensure required objects are initialized
        this.inCluster = this.inCluster || {};
        this.allPastEvents = this.allPastEvents || {};
        this.pastEvents = this.pastEvents || {};

        // console.log('In handleCodeEvent', filename, event);

        // case 1: no events in the previous commit
        if (previousEventList.length === 0) {
            // Check if this initial file has significant changes
            const codeLines = this.get_code_lines(event.code_text);
            const isSignificantFile = codeLines.length > this.MAX_NEW_LINES;

            this.strayEvents.push(this.currentCodeEvent);

            // Initialize the cluster for this file
            if (!this.inCluster[filename]) {
                this.inCluster[filename] = true;
                this.clusterStartTime[filename] = event.time;
            }

            if (!this.allPastEvents[filename]) {
                this.allPastEvents[filename] = [event];
            } else {
                this.allPastEvents[filename].push(event);
            }

            // If significant, immediately finalize as a subgoal
            if (isSignificantFile) {
                await this.finalizeGroup(filename);
                this.inCluster[filename] = false;
                
                if (this.debug) {
                    console.log('Initial file with significant changes, finalized as subgoal');
                }
            } else {
                if (this.debug) {
                    console.log('Initial file with minor changes, keeping as stray');
                }
            }

            return;
        }

        // see if the event exists in the previous commit
        const eventIsInPrevCommit = previousEventList.some(event => this.getFilename(event.notes) === filename);

        // case 2: event exists in the previous commit, compare the code changes
        if (eventIsInPrevCommit) {
            // get the past event from the previous commit
            const pastEvent = previousEventList.find(event => this.getFilename(event.notes) === filename);

            // compare the code changes for the file
            await this.match_lines(filename, pastEvent, event);

            // update the pastEvent with the current event after processing
            this.pastEvents[filename] = event;

            if (this.debug) {
                console.log('Event exists in previous commit, comparing code changes');
                console.log('Current event:', event);
                console.log('Previous events:', previousEventList);
                console.log('All past events:', this.allPastEvents);
            }
        }

        // case 3: NEW FILE with significant changes appearing for first time
        else if (!eventIsInPrevCommit && !this.allPastEvents[filename]) {
            // Check if this is a significant new file (not just a few lines)
            const codeLines = this.get_code_lines(event.code_text);
            const isSignificantFile = codeLines.length > this.MAX_NEW_LINES;

            // Finalize any open clusters from previous files
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

            // If significant, immediately finalize as a subgoal
            if (isSignificantFile) {
                await this.finalizeGroup(filename);
                this.inCluster[filename] = false;
                
                if (this.debug) {
                    console.log('New significant file detected, finalized as subgoal');
                }
            } else {
                if (this.debug) {
                    console.log('New minor file detected, keeping as stray');
                }
            }
        }

        // case 4: file doesn't exist in prev commit but exists in allPastEvents (file switching)
        else if (!eventIsInPrevCommit && this.allPastEvents[filename]) {
            const pastEvent = this.allPastEvents[filename].slice(-1)[0];  // last known event for this file
            await this.match_lines(filename, pastEvent, event);
            this.pastEvents[filename] = event;

            if (this.debug) {
                console.log('Event does not exist in previous commit but exists in allPastEvents');
                console.log('Current event:', event);
                console.log('Previous events:', previousEventList);
                console.log('All past events:', this.allPastEvents);
            }
        }

        // Update allPastEvents
        if (this.allPastEvents[filename]) {
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

            if (pastEvt.time == currEvt.time) {
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
        // update: the "end" state is the last code event from the current session's in-progress work.
        let endCodeEvent = [...this.strayEvents].reverse().find(event => event.type === "code" && event.file === filename);

        // if there's no code event to process, we can't create a subgoal
        if (!endCodeEvent) {
            return;
        }

        // find the true "before" state by looking at the last event in the history
        // const lastHistoricalEvent = this.allPastEvents[filename] ? this.allPastEvents[filename].slice(-1)[0] : null;

        // // if there's a history, use its text; if not, this is a new file, so "before" is an empty string
        // const beforeCodeText = lastHistoricalEvent ? lastHistoricalEvent.code_text : '';

        // Determine the "before" state properly
        let beforeCodeText = '';
        const eventsForFile = this.allPastEvents[filename] || [];
        const clusterStart = this.clusterStartTime[filename];

        // Find events that occurred BEFORE the current cluster started
        const eventsBeforeCluster = eventsForFile.filter(evt => evt.time < clusterStart);
        if (eventsBeforeCluster.length > 0) {
            // Use the last event before this cluster as the "before" state
            beforeCodeText = eventsBeforeCluster[eventsBeforeCluster.length - 1].code_text;
            console.log(`Using previous event as before state for ${filename}`);
        } else {
            // No events before this cluster, so this is initial work - compare against empty
            beforeCodeText = '';
            console.log(`First commit for ${filename} - comparing against empty file`);
        }

        const afterCodeText = endCodeEvent.code_text;

        // only form a subgoal if there is an actual change
        if (beforeCodeText === afterCodeText) {
            console.log(`FinalizeGroup: No meaningful change for ${filename}, skipping subgoal.`);
            // clean up the events for this file as they don't form a valid diff
            this.strayEvents = this.strayEvents.filter(event => event.file !== filename);
            // delete this.initialSaves[filename];
            this.initialSaves[filename] = { file: filename, time: endCodeEvent.time, code_text: afterCodeText };
            return;
        }

        console.log('Finalizing group:', filename, startCodeEvent, endCodeEvent);

        let codeActivity = {
            type: "code",
            id: (++this.idCounter).toString(),
            file: filename,
            startTime: this.clusterStartTime[filename],
            endTime: endCodeEvent.time,
            before_code: beforeCodeText, // use the historically accurate "before" state
            after_code: afterCodeText,   // use the latest "after" state
        };
        
        codeActivity.title = await this.generateSubGoalTitle(codeActivity);

        // grab only the web events from the stray events that has time before the endCodeEvent
        let webEvents = this.strayEvents.filter(event => event.type !== "code" && event.time <= endCodeEvent.time);

        // Initialize an empty array to hold structured web events
        let structureWebEvents = [];

        // Temporary storage for the current search event being structured
        let currentSearchEvent = null;


        // sort stray events by time to ensure chronological order
        const sortedWebEvents = webEvents.sort((a, b) => a.time - b.time);

        for (const event of sortedWebEvents) {
            if (event.type === "search") {
                //If there was a previous search event, finalize it
                if (currentSearchEvent) {
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
                if (!currentSearchEvent) {
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

        // make sure that currentGroup is initialized
        if (!this.currentGroup) {
            this.startNewGroup();
        }

        // Combine code and structured non-code events into the group
        this.currentGroup.actions = [codeActivity, ...sortedWebEvents];

        // Sort the currentGroup actions by time
        this.currentGroup.actions.sort((a, b) => a.time - b.time);

        console.log('Finalized group:', this.currentGroup);

        // ASSIGN BATCH ID HERE, at finalization time
        this.currentGroup.batchId = this.currentBatchId;

        // Set the title and add the group to display
        // this.currentGroup.title = this.generateSubGoalTitle(this.currentGroup);
        this.currentGroup.title = codeActivity.title;
        this.displayForGroupedEvents.push(this.currentGroup);

        // Clear the items that have been grouped in the currentGroup from strayEvents
        this.strayEvents = this.strayEvents.filter(event => event.file !== filename);

        // Remove the events from webEvents from this.strayEvents
        this.strayEvents = this.strayEvents.filter(event => !sortedWebEvents.includes(event));
        console.log('Stray events after finalizing group:', this.strayEvents);

        // Once the stray events have been processed, reset the currentGroup
        this.currentGroup = null;

        // Clean up the initial save tracker now that this work has been grouped
        // delete this.initialSaves[filename];
        this.initialSaves[filename] = { file: filename, time: endCodeEvent.time, code_text: afterCodeText };
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

            // console.log('Prompt:', prompt);

            const completions = await this.openai.chat.completions.create({
                model: 'gpt-4o-mini',
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
            // console.log('Summary:', summary);

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

    async generateNLResponse(question, subgoal, most_relevant) {
        try {

            if (!question.trim()) {
                return "no question";
            }

            let prompt = `
You are given 3 things:
1. A user question: ${question}
2. An overall goal for this section: ${subgoal}
3. A detailed edit made toward the goal: ${JSON.stringify(most_relevant)}

Your job is to summarize what is happening — what the user is asking, what their coding goal is, and how this edit connects to that goal.

- If the code change clearly relates to the question, describe how.
- If the change doesn’t answer or connect to the question, just summarize the edit and the subgoal it supports. Don’t mention the question.
- Avoid praise, exaggeration, or cheerleading.
- Don’t mention backend IDs.
- Be concise and neutral.
- This is not a conversation; don’t say things like “feel free to ask.”
            `;

            const completions = await this.openai.chat.completions.create({
                model: "gpt-4o-mini",
                max_tokens: 500,
                messages: [
                    {
                        role: "system",
                        content: `You are a code history comprehension helpter. you will be given 3 different informations: 
                        1. a question asked by the user, 
                        2. overall goal for this smaller code change, and 
                        3. the specific change happened in the code that partially contribute to the overall goal, it will also have a smaller subgoal here, the overall goal was breaked into smaller subgoal such as the one provided here. 
                        It is your job to summarize what the user asked, what the user's goal is here, and what they edited in the code to work toward that overall goal. It has to clearly convey what the user serached for and it is also an opportunity to demonstrate that the user question is being processed by a LLM and is a hint that natural language can be understanderstood here, meaning users are able to treat the search function as a chat with a LLM. If the user asked a definition question, provide the definite also in the response. Please also describe the information with short and easy to understand language and like also a small piece of "story" that contribute to the overall goal.`
                    },
                    { role: "user", content: prompt }
                ]
            });

            let summary = completions?.choices?.[0]?.message?.content || "Summary not available";

            return `${summary}`;


        } catch (error) {
            console.error("Error generating answer:", error.message);
            return "response generation failed";
        }
    }

    async generateStoryResponse(question, parallelled_array) {
        try {

            console.log("generateStoryResponse parallel array: ", parallelled_array)

            if (!question.trim()) {
                return "no question";
            }

let prompt = `You are a technical summarization assistant. Given a chronological array of coding events:"${JSON.stringify(parallelled_array)}", answering the question: "${question}", rewrite each event as a concise, HTML-formatted summary.

Requirements:
- Don't repeat what the user is asking or inquiring about.
- The number of output items must exactly match the input array length. For each input entry, generate one corresponding summary.
- Keep the array length and order exactly the same.
- Start each entry with a short bolded label in HTML, like "<strong>a small phrase that describes the edits:</strong>".
- Then include a <ul style="padding-top: 0px;list-style: circle;margin-left: 40px;"> with each key point wrapped in an <li> tag.
- Focus on what was implemented, changed, or fixed. Mention key functions or elements.
- Instead of putting quotation around objects from the code, put <code> tag.
- Avoid filler language, compliments, or repetition.
- Combine minor or low-value steps into one line when needed.
- Use clear, direct language.
- Output only the revised array as valid array ready to parse (do not wrap in extra text).`;


            const completions = await this.openai.chat.completions.create({
                model: "gpt-4o-mini",
                max_completion_tokens: null,
                max_tokens: null,
                messages: [
                    {
                        role: "system",
                        content: `You are a code summarization assistant. Given a chronological array of user changes and a guiding question, rewrite the array to improve clarity, story flow, and structure. Keep the same length and order, and return only the updated array as valid JSON. Avoid repetitive phrasing and focus on how each step contributes to the goal.`
                    },
                    { role: "user", content: prompt }
                ]
            });
            console.log("generateStoryResponse: ", completions);
            let summary = completions?.choices?.[0]?.message?.content || "Summary not available";
            // summary = summary.trim().replace(/^```json/, "").replace(/^```/, "").replace(/```$/, "").trim();

            // console.log("generateStoryResponse: ", summary);
            return `${summary}`;


        } catch (error) {
            console.error("Error generating answer:", error.message);
            return "response generation failed";
        }
    }

    async generateSummary(question, parallelled_array) {
        try {

            if (!question.trim()) {
                return "no question";
            }

//             let prompt = `You are given a user question and a chronological sequence of summarized coding events. These events represent the user's step-by-step progress toward a specific coding goal.

// Your job is to answer the question based on the coding events.

// Instructions:
// - Begin with a direct, one-sentence answer to the question. besure to put <strong> tag around it
// - Then include a <ul style="padding-top: 0px;list-style: circle;margin-left: 40px;"> with each key point wrapped in an <li> tag.
// - Be precise, specific, and technical where appropriate.
// - Avoid general summaries or vague commentary.
// - IMPORTANT! put <code> tag around ANY object your are quoting from the code, DO NOT use quatation marks. 
// - Do not compliment or praise the user.
// - Do not repeat the question in your answer.
// - Output only the final answer, no preamble or list formatting.

// Question: ${question}

// Chronological coding steps:
// ${JSON.stringify(parallelled_array)}`;
let prompt = `You are given a user question and a chronological sequence of summarized coding events. These events represent the user's step-by-step progress toward a specific coding goal.

Your task is to answer the question based solely on these coding events.

FORMAT REQUIREMENTS (STRICTLY FOLLOW):
1. Start with a single-sentence direct answer wrapped in <strong> tags.
2. Then include a <ul style="padding-top: 0px;list-style: circle;margin-left: 40px;">.
3. Each key point must be in an <li> tag.
4. Use <code> tags ONLY for **all references to code elements** — this includes variable names, functions, file names, keywords, code snippets, and anything the user wrote in code.
5. DO NOT use quotation marks around code references — use ONLY <code>.
6. Be specific and technical; do NOT include any general praise or restate the question.

FAILURE TO FOLLOW THE FORMAT IS AN ERROR.

Question: ${question}

Chronological coding steps:
${JSON.stringify(parallelled_array)}`;


            const completions = await this.openai.chat.completions.create({
                model: "gpt-4o-mini",
                max_tokens: 1000,
                messages: [
                    {
                        role: "system",
                        content: `You are a question answerer. You are given a user question and a list of events done by the user. Try to answer the question using the events given to you. `
                    },
                    { role: "user", content: prompt }
                ]
            });
            console.log("generateSummary: ", completions);
            let summary = completions?.choices?.[0]?.message?.content || "Summary not available";
            // console.log("generateStoryResponse: ", summary);

            // summary = summary.trim().replace(/^```json/, "").replace(/^```/, "").replace(/```$/, "").trim();

            return `${summary}`;


        } catch (error) {
            console.error("Error generating answer:", error.message);
            return "response generation failed";
        }
    }

    findActivities (codeList, targets) {
        const memoization = new Map();
        for (const item of codeList) { 
            memoization.set(String(item.id), item.codeChanges);
        }
        let result = [];

        for(const target of targets) {
            const key = String(target.id);
            const codeChanges = memoization.get(key); 

            if(Array.isArray(codeChanges)) {
                for(const change of codeChanges) {
                    result.push({
                        id: change.id, 
                        title: change.title
                    });
                }
            }
        }

        return result;
    }

    async generateRelevantInfo(question, relevant_info) {
        try {

            if (!question.trim()) {
                return "no question";
            }

            let prompt = `Here is the user question: ${question}, and here is the filtered code change information: ${JSON.stringify(relevant_info)}. Please use the given question and information provided to find the most relevant piece of information, the rest are background information that might not seem important but it is still relevant.`;

            const completions = await this.openai.chat.completions.create({
                model: "gpt-4o-mini",
                max_tokens: 500,
                messages: [
                    {
                        role: "system",
                        content: `You are a code history reviewer. You will be provided with a user question and a list of already sorted out information about code changes. These information is grouped together with a larger overall goal therefore it is why some information listed does not seem relevant to the user question. 
                        Return me an array of most relevant {id: entry.id} based on the question asked by the user, you can include as many as possible.
                        There will be instances where all information seem relevant, if so, send everthing. 
                        The array you have returned to me should not have extra formatting and should be ready to parse. `
                    },
                    { role: "user", content: prompt }
                ]
            });

            let summary = completions?.choices?.[0]?.message?.content || "Summary not available";
            // console.log('In generateRelevantInfo, filtered API Response:', completions);

            // summary = summary.trim().replace(/^```json/, "").replace(/^```/, "").replace(/```$/, "").trim();

            return `${summary}`;


        } catch (error) {
            console.error("Error generating answer:", error.message);
            return "response generation failed";
        }
    }

    async isHistoryOrResource(question) {
        try {

            if (!question.trim()) {
                return "no question";
            }

            let prompt = 'Here is the question: "' + question + '". Please help me determine whether the quesion needs user accessed resource list or user code editing list. If the question focues on the resources, just simply say "resources"; if the question focuses on the history of the code, just simply say "history". ';
            
            const completions = await this.openai.chat.completions.create({
                model: "gpt-4o-mini",
                max_tokens: 50,
                messages: [
                    {
                        role: "system",
                        content: "you are here to help determine whether the given question is focusing on the code or online resources. please do as the prompt says."
                    },
                    { role: "user", content: prompt }
                ]
            });

            let summary = completions?.choices?.[0]?.message?.content || "Summary not available";
            // console.log("in isHistoryOrResource: ", summary)
            return summary.trim().toLowerCase();

        } catch (error) {
            console.error("Error generating questions:", error.message);
            return `response generation failed`;
        }

    }

    async checkQuestionRepeat(question) {
        try {

            if (!question.trim()) {
                return "no question";
            }

            let prompt = `New question: "${question}".
Cached questions: ${Array.from(this.questionCache.keys()).join(", ")}`

            const completions = await this.openai.chat.completions.create({
                model: "gpt-4o-mini",
                max_tokens: 500,
                messages: [
                    {
                        role: "system",
                        content: `You are a duplicate question detector. 
Always respond with a strict JSON array and nothing else.

Rules:
- Compare the new question against the cached questions.
- If the new question is a duplicate (even if rephrased, synonyms, or word order changes), return [true, "exact_cached_question_string"]. 
  IMPORTANT: The second element must be copied exactly from the cached questions list, never the new question.
- If no duplicate is found, or the cache is empty, return [false].`
                    },
                    { role: "user", content: prompt }
                ]
            });

            let summary = completions?.choices?.[0]?.message?.content || "Summary not available";
            console.log("checkQuestionRepeat: ", summary)

            // this.chatGPTInvoked = true;
            // return summary;
            try {
                return JSON.parse(summary);
            } catch {
                return [false]; // fallback if parsing fails
            }


        } catch (error) {
            console.error("Error generating answer:", error.message);
            return "response generation failed";
        }
    }


    async *generateAnswerStream(question, whichOne, codeEvents, uniqueVisits) {

        // console.log("in generateAnswerStream, code events: ", codeEvents);
        // console.log("in generateAnswerStream, unique visits: ", uniqueVisits);

        try {
            // console.log("User Question:", question);

            if (!question.trim()) {
                yield "no question";
                return;
            }

            let prompt = whichOne === "history"
                ? `The user will ask you to filter the database based on the context of this code history I provided: "${JSON.stringify(codeEvents)}", and here is the question: "${question}". If the user question is just "", simply say no question.`
                : `The user will ask you to filter the database based on the history the user has accessed: "${JSON.stringify(uniqueVisits)}", and here is the question: "${question}". If the user question is just "", simply say no question.`;

            // console.log("in generateAnswerStream, prompt: ", prompt);
            const stream = await this.openai.chat.completions.create({
                model: "gpt-4o-mini",
                max_tokens: 1000,
                stream: true, // Enable streaming
                messages: [
                    {
                        role: "system",
                        content: `You are a code history reviewer. The user will provide JSON-like info and expects you to find information based on it.
                        A JSON object entry should either have keys: 'id', 'title', and 'codeChanges' or 'id', 'title', and 'webTitles. 
                        Under 'codeChanges', there should be 'id' and 'title'.
                        Under 'webTitles', there should be a list of webTitles.
                        Return me an array of at most 5 most relevant {id: entry.id} based on the question asked by the user. if you cannot find 5, just return however many you found. 
                        The array you have returned to me should not have extra formatting and should be ready to parse. `
                    },
                    { role: "user", content: prompt }
                ]
            });

            let responseText = "";

            for await (const chunk of stream) {
                const content = chunk.choices[0]?.delta?.content || "";
                responseText += content;
                // console.log("response text here: ", responseText);
                yield content;
            }

        } catch (error) {
            console.error("Error generating answer:", error.message);
            yield "response generation failed";
        }
    }

    async *generatePastAnswerStream(question, whichOne) {
        // const startTime = performance.now();

        try {
            // console.log("User Question:", question);

            if (!question.trim()) {
                yield "no question";
                return;
            }

            const filteredArray = this.codeActivities.map(({ id, title, codeChanges }) => ({
                id,
                title,
                codeChanges: codeChanges.map(({ title }) => ({ title }))
            }));
            // console.log("FILTERED ARRAY: ", filteredArray);

            const filteredArrayResources = this.codeResources.map(({ id, title, resources }) => ({
                id,
                title,
                webTitles: resources.flatMap(resource =>
                    (resource.actions || [])
                        .filter(action => action.webTitle)
                        .map(action => action.webTitle)
                )
            }));

            let prompt = whichOne === "history"
                ? `The user will ask you to filter the database based on the context of this code history I provided: "${JSON.stringify(filteredArray)}", and here is the question: "${question}". If the user question is just "", simply say no question.`
                : `The user will ask you to filter the database based on the history the user has accessed: "${JSON.stringify(filteredArrayResources)}", and here is the question: "${question}". If the user question is just "", simply say no question.`;

            // console.log("in generatePastAnswerStream, prompt: ", prompt);
            const stream = await this.openai.chat.completions.create({
                model: "gpt-4o-mini",
                max_tokens: 1000,
                stream: true, // Enable streaming
                messages: [
                    {
                        role: "system",
                        content: `You are a code history reviewer. The user will provide JSON-like info and expects you to find information based on it.
                        A JSON object entry should either have keys: 'id', 'title', and 'codeChanges' or 'id', 'title', and 'webTitles. 
                        Under 'codeChanges', there should be 'id' and 'title'.
                        Under 'webTitles', there should be a list of webTitles.
                        Return me an array of at most 5 most relevant {id: entry.id} based on the question asked by the user. if you cannot find 5, just return however many you found. 
                        The array you have returned to me should not have extra formatting and should be ready to parse. `
                    },
                    { role: "user", content: prompt }
                ]
            });

            let responseText = "";

            for await (const chunk of stream) {
                const content = chunk.choices[0]?.delta?.content || "";
                responseText += content;
                // console.log("response text here: ", responseText);
                yield content;
            }

            // const endTime = performance.now();
            // console.log(`Call to generatePastAnswerStream() took ${endTime - startTime} milliseconds`);

            // this.chatGPTInvoked = true;

        } catch (error) {
            console.error("Error generating answer:", error.message);
            yield "response generation failed";
        }
    }

    async updateWebPanel(question) {

        const startTime = performance.now()

        let groupedEventsHTML;

        // If a chat response exists in our state, use it. Otherwise, generate the default view.
        if (this.chatResponseHTML) {
            console.log("Using existing chat response HTML");
            groupedEventsHTML = this.chatResponseHTML;
        } else {
            // This is the default view when no chat is active.
            console.log("Generating default grouped events HTML");
            groupedEventsHTML = await this.generateFullHistoryHTML();
        }

        const strayEventsHTML = await this.generateStrayEventsHTML();

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
                <div class="upper_header">
                    <div>
                        <h2>Recent Development Highlights </h2>
                    </div>
                    <div class="forms">
                        <h4><em>Ordered from least recent to most recent</em></h4>
                        <form id="chat-form" class="form-container">
                            <div class="question-area">
                                <label style="font-weight: bold; margin: auto; margin-right: 5px;">Search within your history: </label>
                                <input type="text" id="question" name="user_question" placeholder="Where did I..." value="${this.userQuestion || ''}">
                                <button type="submit" class="btn">Submit</button>
                                <button type="button" id="reset-button" class="btn">Reset</button>
                            </div>
                            
                        </form>
                    </div>
                    <div class="view-controls">
                        <div class="view-buttons">
                            <button id="toggle-view">Switch to ${this.currentDiffView === 'line-by-line' ? 'Side-by-Side' : 'Line-by-Line'} View</button>
                        </div>
                        <p class="description">Click line numbers to jump to code</p>
                    </div>
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
                    // Check if the listener has already been added to prevent duplicates
                    if (button.dataset.listenerAttached) return;

                    button.addEventListener('click', function () {
                        this.classList.toggle('active');
                        const content = this.parentElement.nextElementSibling;
                        // console.log('clicked!!!!!!');
                        if (content) {
                            content.style.display = content.style.display === 'flex' ? 'none' : 'flex';
                            this.textContent = this.textContent === '+' ? '-' : '+';
                        }
                    });

                    button.dataset.listenerAttached = 'true'; // Mark the button so we don't add the listener again
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
            const responseArea = document.getElementById("grouped-events");
            const questionInput = document.getElementById("question");
            const chatForm = document.getElementById("chat-form");
            const strayEvents = document.getElementById("stray-events");


            // Only add chat form listener if the form exists
            if (chatForm) {
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
            }

            window.addEventListener("message", (event) => {
                console.log("Received message:", event.data);
                if (event.data.command === "updateChatResponse") {
                    const response = event.data.response;
                    responseArea.innerHTML = response; // Update the response
                    attachCollapsibleListeners(); // Reattach listeners to new content

                    // After updating the content, restore the collapsible state
                    const collapsibleState = getCollapsibleState();
                    restoreCollapsibleState(collapsibleState);
                }
                
                if (event.data.command === 'updateStrayEvents') {
                    const response = event.data.response;
                    strayEvents.innerHTML = response;
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

            const resetButton = document.getElementById("reset-button");
            if (resetButton) {
                resetButton.addEventListener("click", function () {
                    vscode.postMessage({
                        command: "resetPanel"
                    });
                });
            }
                    
        })();
    </script>
            </body>
            </html>
        `;

        this.webviewPanel.webview.onDidReceiveMessage(async (message) => {
            if (message.command === 'navigateToLine') {
                await this.navigateToLine(message.fileName, message.line);
            }
        });

        const endTime = performance.now()

        console.log(`Call to updateWebPanel took ${endTime - startTime} milliseconds`)

    }


    async handleChatGPTRequest(question) {
        if (!this.webviewPanel || !this.webviewPanel.webview) {
            console.error("Webview panel is not initialized!");
            return;
        }

        try {
            const response = await this.generateChatGPTResponseHTML(question);
            const historyResponse = await this.generateHistoryChatGPTResponseHTML(question);

            const newContentHTML= response + historyResponse;

            // 1. Update the persistent state
            this.chatResponseHTML = newContentHTML;

            // 2. Once the HTML content is injected, update the webview
            this.webviewPanel.webview.postMessage({
                command: "updateChatResponse",
                response: newContentHTML
            });
        } catch (error) {
            console.error("Error generating response:", error);
            this.webviewPanel.webview.postMessage({
                command: "updateChatResponse",
                response: '<p style="color:red;">Error: Could not generate response</p>'
            });
        }
    }
    
    async navigateToLine(fileName, lineNumber) {
        // console.log(fileName);

        let fileUri;
        if (path.isAbsolute(fileName)) {
            fileUri = vscode.Uri.file(fileName);
        } else {
            // resolve the filename relative to the workspace
            const workspaceFolder = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
            if (workspaceFolder) {
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

        for (let groupKey = 0; groupKey < this.codeActivities.length; groupKey++) {
            const group = this.codeActivities[groupKey];
            console.log(group)
            const links = this.codeResources[groupKey];

            let count = 0;
            for (let subgoalKey = 0; subgoalKey < group.codeChanges.length; subgoalKey++) {
                const subgoal = group.codeChanges[subgoalKey];
                console.log("here is the subgoal for debug purpose: ", subgoal);

                const diffHTML = this.generateDiffHTMLGroup(subgoal);

                if (links.resources.length != 0 && count < links.resources.length) {
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
                    // console.log(link.actions.length);
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
                        for (let i = 0; i < link.actions.length; i++) {
                            const eachLink = links.resources[count].actions[i];
                            html += `   
                                        <div class="tooltip">
                                            <a href="${eachLink.webpage}">${eachLink.webTitle}</a><br>
                                            
                                            <br>
                                        </div>
                                        <br>
                                    `
                        }
                        //  </ul> 
                        // <span class="tooltiptext"  style="scale: 2"><img class="thumbnail" src="${eachLink.img}" alt="Thumbnail"></span>
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

                count++;

                html += `
                        </li>
                    `;
            }
        }
        return html;
    }

    async generateGroupedEventsHTML() {
        // this.displayForGroupedEvents is an array of objects, each object is a group
        // each group has a title and an array containing code and web activity
        let html = '';

        // console.log('In generateGroupedEventsHTML', this.displayForGroupedEvents);
        if (this.displayForGroupedEvents.length === 0) {
            return '';
        }

        let previousBatchId = null;

        for (const [groupKey, group] of this.displayForGroupedEvents.entries()) {
            // Check if this subgoal is from a different batch than the previous one
            const isNewBatch = previousBatchId !== null && group.batchId !== previousBatchId;
            
            // Get color for this batch
            const batchColor = this.getBatchColor(group.batchId);

            // // Add a visual separator between different batches
            // if (isNewBatch) {
            //     html += `
            //         <div class="batch-separator" style="margin: 20px 0;">
            //             <hr style="border: 0; border-top: 2px dashed #ccc;">
            //         </div>
            //     `;
            // }

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
                            webTitle: extractText(resource.webTitle, "visit:", ";")
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
                        <li data-eventid="${index}" style="border-left: 4px solid ${batchColor}; padding-left: 8px;">
                            <div class="li-header">
                                <button type="button" class="collapsible" id="plusbtn-${groupKey}-${index}">+</button>
                                <input class="editable-title" id="code-title-${groupKey}-${index}" 
                                    value="${title}" 
                                    onchange="updateCodeTitle('${groupKey}', '${index}')" 
                                    size="50">
                                <button type="button" class="btn btn-secondary" id="button-${groupKey}-${index}" style="margin-left: 8px;">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-pencil-square" viewBox="0 0 16 16">
                                        <path d="M15.502 1.94a.5.5 0 0 1 0 .706L14.459 3.69l-2-2L13.502.646a.5.5 0 0 1 .707 0l1.293 1.293zm-1.75 2.456-2-2L4.939 9.21a.5.5 0 0 0-.121.196l-.805 2.414a.25.25 0 0 0 .316.316l2.414-.805a.5.5 0 0 0 .196-.12l6.813-6.814z"></path>
                                        <path fill-rule="evenodd" d="M1 13.5A1.5 1.5 0 0 0 2.5 15h11a1.5 1.5 0 0 0 1.5-1.5v-6a.5.5 0 0 0-1 0v6a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5v-11a.5.5 0 0 1 .5-.5H9a.5.5 0 0 0 0-1H2.5A1.5 1.5 0 0 0 1 2.5z"></path>
                                    </svg>
                                </button>
                                <b style="margin-left: 8px;">in ${event.file}</b>
                                <div style="flex-grow: 1;"></div>
                                ${resourcesExist ? `
                                <div class="container" style="margin-left: 8px;">
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

            previousBatchId = group.batchId;
        }

        return html;
    }

    async generateStrayEventsHTMLTest() {
        return '<li>Your future changes goes here.</li>';
    }

    // This happens after a "save" occurrence (comparing two versions of file save)
    async generateDiffHtmlSave(filename) {
        try {
            // console.log(`Generating diff for file: ${filename}`);
            // console.log(this.allSaves[filename]);

            const allSavesForFile = this.allSaves[filename] || [];
            const latestSave = allSavesForFile[allSavesForFile.length - 1];

            // If there are no saves recorded for this file, do nothing.
            if (!latestSave) {
                return '';
            }

            // Check if we have an initial save baseline for comparison
            const initialSave = this.initialSaves[filename];
            
            // If no initial save exists, it means we haven't established a baseline yet
            // This happens right after finalization before the next save
            if (!initialSave) {
                return ''; // No diff to show yet
            }

            const initialContent = initialSave.code_text || '';
            const latestContent = latestSave.code_text || '';

            // If the content hasn't changed since the baseline, don't show a diff
            if (initialContent === latestContent) {
                return '';
            }

            const diffString = Diff.createTwoFilesPatch(
                'Initial Save',
                'Latest Save',
                initialContent,
                latestContent,
                filename,
                filename,
                { ignoreWhitespace: true } // Ignore whitespace-only changes
            );

            const diffHtml = diff2html.html(diffString, {
                outputFormat: this.currentDiffView,
                drawFileList: false,
                colorScheme: 'light',
                showFiles: false,
            });

            let modifiedHtml = '';

            if (this.currentDiffView === 'line-by-line') {
                modifiedHtml = diffHtml.replace(/<div class="line-num2">(.*?)<\/div>/g, (match) => {
                    const lineNumber = match.match(/<div class="line-num2">(.*?)<\/div>/)[1];
                    return `<div class="line-num2" data-linenumber="${lineNumber - 1}" data-filename="${filename}">${lineNumber}</div>`;
                });
            }

            if (this.currentDiffView === 'side-by-side') {
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

        // Track unique web visits and searches
        const uniqueVisits = new Set();
        const uniqueSearches = new Set();

        for (const event of this.strayEvents) {
            if (event.type === "search") {
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

        // Object to store diffs for each file
        const fileDiffs = {};

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

        if (html.trim() === '') {
            html = '<li>Your future changes go here.</li>';
        }

        return html;  // Return the generated HTML
    }

    async generateChatGPTResponseHTML(question) {

        const startTime = performance.now();

        try {
            const filteredArray = [];
            const filteredArrayResources = [];

            for (const group of this.displayForGroupedEvents) {
                const groupId = group.id;
                const groupTitle = group.title;

                // Filter code events (you can adjust to push all instead of just the first)
                const codeEvent = group.actions.find(action => action.type === 'code');
                if (codeEvent) {
                    filteredArray.push({
                        id: groupId,
                        title: codeEvent.title,
                        file: codeEvent.file
                    });
                }

                // Collect web resources
                const uniqueVisitsSet = new Set();

                for (const action of group.actions) {
                    if (action.type && action.type.includes('visit') && !action.webTitle?.toLowerCase().includes("search")) {
                        uniqueVisitsSet.add(JSON.stringify({
                            webpage: action.webpage,
                            webTitle: extractText(action.webTitle, "visit:", ";")
                        }));
                    }
                }

                const visitResources = Array.from(uniqueVisitsSet).map(item => JSON.parse(item));

                if (visitResources.length > 0) {
                    filteredArrayResources.push({
                        id: groupId,
                        title: groupTitle,
                        resources: visitResources
                    });
                }
            }

            // console.log("filtered array code events: ", filteredArray);
            // console.log("filtered array resources", filteredArrayResources);

            const reduceLoad = await this.isHistoryOrResource(question);
            // console.log("history or resources? ", reduceLoad);

            // const natural_language_indicator = await this.generateNLResponse(question);
            // console.log("natural_language_indicator: ", natural_language_indicator);

            const generator = this.generateAnswerStream(question, reduceLoad, filteredArray, filteredArrayResources);
            let streamedResponse = "";

            for await (const chunk of generator) {
                let chunkStr = typeof chunk === "string" ? chunk : JSON.stringify(chunk);
                streamedResponse += chunkStr;
            }

            if (streamedResponse.trim() === "no question") {
                return ``;
            }

            console.log("generateChatGPTResponseHTML RESPONSE: ", streamedResponse);

            let parsed = JSON.parse(streamedResponse);
            console.log("generateChatGPTResponseHTML PARSED: ", parsed);

            parsed = parsed.map(entry => ({
                ...entry,
                id: parseInt(entry.id, 10) // or: id: +entry.id
            }));
            console.log("generateChatGPTResponseHTML PARSED: ", parsed);
            let html = '';

            if (!this.codeResources || this.codeResources.length === 0) {
                console.error("codeResources is undefined or empty");
                return '<li>No resources for you :(.</li>';
            }

            console.log("generateChatGPTResponseHTML: ", this.displayForGroupedEvents);
            for (const [groupKey, group] of this.displayForGroupedEvents.entries()) {

                // const group = this.codeActivities[groupKey];
                // const links = this.codeResources[groupKey];
                let contains = parsed.some(entry => entry.id == group.id);
                console.log(group.id);

                console.log(contains);
                if (!contains) {
                    continue;
                }
                else {
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
            }
            this.webviewPanel.webview.postMessage({
                command: 'updateChatResponse',
                response: html
            });

            return html;
        } catch (err) {
            console.error("Error generating response:", err);
            return `<p style="color:red;">Error: ${err.message}</p>`;
        }
    }

    async generateHistoryChatGPTResponseHTML(question) {
        if (!question || question === "undefined") return "";

        //check if the question has been asked before: 
        //if true (repeated), return the answer from cache, otherwise proceed to the next step
        // if (checkRepeat[0]) {
        //     console.log("CHECK REPEATS: ", this.questionCache.get(checkRepeat[1]));
        // }

        try {
            const startTime = performance.now();
            const reduceLoad = await this.isHistoryOrResource(question);
            const generator = this.generatePastAnswerStream(question, reduceLoad);
            const checkRepeat = await this.checkQuestionRepeat(question);
            console.log("checkRepeat: ", checkRepeat);
            if (checkRepeat[0]) {
                // console.log("CHECK REPEATS: ", this.questionCache.get(checkRepeat[1]));
                let html = this.questionCache.get(checkRepeat[1]);
                this.webviewPanel.webview.postMessage({ command: "updateChatResponse", response: html });
                return html;
            }
            else {
                let streamedResponse = "";
                for await (const chunk of generator) {
                    streamedResponse += typeof chunk === "string" ? chunk : JSON.stringify(chunk);
                }

                if (streamedResponse.trim() === "no question") {
                    return `<p>No question detected.</p>`;
                }

                let rawJson = streamedResponse.trim();
            
                // Remove markdown code fences (e.g., ```json or ```)
                rawJson = rawJson.replace(/^```json\s*/i, '').replace(/\s*```$/, '');
                
                // Safely parse the JSON with a try-catch block
                let parsed;
                try {
                    parsed = JSON.parse(rawJson);
                } catch (error) {
                    console.error("Error parsing JSON from generatePastAnswerStream:", error, rawJson.substring(0, 200) + '...');
                    return `<p style="color:red;">Error: AI returned invalid JSON format for filtering. Please try rephrasing your question.</p>`;
                }

                parsed = parsed.map(entry => ({
                    ...entry,
                    id: +entry.id
                }));

                // let parsed = JSON.parse(streamedResponse).map(entry => ({
                //     ...entry,
                //     id: +entry.id
                // }));

                const extraFilter = await this.generateRelevantInfo(
                    question,
                    this.findActivities(this.codeActivities, parsed)
                );
                
                let parsedExtra;
                try {
                    parsedExtra = JSON.parse(extraFilter); // Ensure extraFilter is clean JSON
                } catch (error) {
                    console.error("Error parsing JSON from generateRelevantInfo:", error, extraFilter.substring(0, 200) + '...');
                    // Handle the error (e.g., skip filtering or use a default)
                    parsedExtra = []; 
                }
                // const parsedExtra = JSON.parse(extraFilter);

                const targetIDs = new Set(parsedExtra.map(t => String(t.id)));

                // Build subgoal jobs
                const arrayForParallel = this.codeActivities.flatMap((group, groupKey) =>
                    parsed.some(entry => entry.id == group.id)
                        ? group.codeChanges.map(subgoal =>
                            JSON.stringify({ ...subgoal, groupTitle: group.title })
                        )
                        : []
                );

                const results = await Promise.all(
                    arrayForParallel.map(async jsonStr => {
                        const parsed = JSON.parse(jsonStr);
                        return this.generateNLResponse(question, parsed.title, parsed);
                    })
                );

                const responses = results.map(r => r[0]);
                console.log("HERE IS THE PARALLELISM RESULT FOR RESPONSE:", responses);

                const [storyResult, summary] = await Promise.all([
                    this.generateStoryResponse(question, results),
                    this.generateSummary(question, results)
                ]);

                let story;
                try {
                    console.log("STORY RESULT BEFORE PARSING:", storyResult);
                    story = JSON.parse(storyResult);
                } catch (error) {
                    console.error("Error parsing story JSON:", error);
                }

                // const story = JSON.parse(storyResult);
                console.log("HERE IS THE STORY:", story);

                let html = `
            <h2>Summary: </h2>
            <p>${summary}</p>
            <hr>
            <h2>Your process: </h2>
        `;

                let index = 1;
                for (let groupKey = 0; groupKey < this.codeActivities.length; groupKey++) {
                    const group = this.codeActivities[groupKey];
                    const links = this.codeResources[groupKey];
                    if (!parsed.some(entry => entry.id == group.id)) continue;

                    let count = 0;
                    for (let subgoalKey = 0; subgoalKey < group.codeChanges.length; subgoalKey++) {
                        const subgoal = group.codeChanges[subgoalKey];
                        const diffHTML = this.generateDiffHTMLGroup(subgoal);

                        html += `
                    <div class="stories">
                        <p><strong>${index}:</strong> ${story[index - 1]}</p>
                    </div>
                `;
                        index++;

                        const hasLinks = links.resources?.length > 0 && count < links.resources.length;
                        const linkBlock = hasLinks
                            ? `
                        <div class="container">
                            <i class="bi bi-bookmark"></i>
                            <div class="centered">${links.resources[count].actions.length}</div>
                        </div>
                    `
                            : `<div class="placeholder"></div>`;

                        const resourceLinks = hasLinks
                            ? links.resources[count].actions
                                .map(
                                    eachLink => `
                                <div class="tooltip">
                                    <a href="${eachLink.webpage}">${eachLink.webTitle}</a><br><br>
                                </div>
                              `
                                )
                                .join("")
                            : "";

                        html += `
                    <li data-eventid="${subgoalKey}">
                        <div class="li-header">
                            <button type="button" class="collapsible" id="plusbtn-${groupKey}-${subgoalKey}">+</button>
                            <input class="editable-title" id="code-title-${groupKey}-${subgoalKey}" 
                                   value="${subgoal.title}" 
                                   onchange="updateCodeTitle('${groupKey}', '${subgoalKey}')" size="50">
                            <button type="button" class="btn btn-secondary" id="button-${groupKey}-${subgoalKey}">
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" 
                                     fill="currentColor" class="bi bi-pencil-square" viewBox="0 0 16 16">
                                    <path d="M15.502 1.94a.5.5 0 0 1 0 .706L14.459 3.69l-2-2L13.502.646a.5.5 0 0 1 .707 0l1.293 1.293z"/>
                                    <path fill-rule="evenodd" 
                                          d="M1 13.5A1.5 1.5 0 0 0 2.5 15h11a1.5 1.5 0 0 0 1.5-1.5v-6a.5.5 
                                          0 0 1-1 0v6a.5.5 0 0 1-.5.5h-11a.5.5 
                                          0 0 1-.5-.5v-11a.5.5 0 0 1 .5-.5H9a.5.5 
                                          0 0 0 0-1H2.5A1.5 1.5 0 0 0 1 2.5z"/>
                                </svg>
                            </button>
                            <b>in ${subgoal.file}</b>
                            ${linkBlock}
                        </div>
                        <div class="content">
                            <div class="${hasLinks ? "left-container" : "full-container"}">
                                ${diffHTML}
                            </div>
                            ${hasLinks ? `<div class="resources">${resourceLinks}</div>` : ""}
                        </div>
                    </li>
                    <hr>
                `;
                        count++;
                    }
                }

                console.log(`THE ENTIRE HISTORY HTML GENERATING took ${performance.now() - startTime} ms`);
                this.webviewPanel.webview.postMessage({ command: "updateChatResponse", response: html });

                //store it in the cache map: 
                this.questionCache.set(question, html);

                return html;

            }

        } catch (err) {
            console.error("Error generating response:", err);
            return `<p style="color:red;">Error: ${err.message}</p>`;
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

        if (this.currentDiffView === 'line-by-line') {
            modifiedHtml = diffHtml.replace(/<div class="line-num2">(.*?)<\/div>/g, (match) => {
                const lineNumber = match.match(/<div class="line-num2">(.*?)<\/div>/)[1];
                return `<div class="line-num2" data-linenumber="${lineNumber - 1}" data-filename="${codeActivity.file}">${lineNumber}</div>`;
            });
        }

        if (this.currentDiffView === 'side-by-side') {
            modifiedHtml = diffHtml.replace(/<td class="d2h-code-side-linenumber(?: [\w-]+)*">\s*(\d+)\s*<\/td>/g, (match) => {
                const lineNumber = match.match(/<td class="d2h-code-side-linenumber(?: [\w-]+)*">\s*(\d+)\s*<\/td>/)[1];
                return `<td class="d2h-code-side-linenumber clickable-line" data-linenumber="${lineNumber - 1}" data-filename="${codeActivity.file}">${lineNumber}</td>`;
            });
        }

        return modifiedHtml;
    }

    async updateTitle(groupKey, title) {
        console.log("ERROR IN UPDATETITLE!")
        this.displayForGroupedEvents[groupKey].title = title;
        await this.updateWebPanel();
    }

    async updateCodeTitle(groupKey, eventId, title) {
        console.log("ERROR IN UPDATECODETITLE!")
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
    
    async generateFullHistoryHTML() {
        // if not using test,  just call generateGroupedEventsHTML
        // if using test, call both generateGroupedEventsHTMLTest and generateGroupedEventsHTML
        if (typeof this.codeResources !== 'undefined') {
            return await this.generateGroupedEventsHTMLTest() + await this.generateGroupedEventsHTML();
        } else {
            return await this.generateGroupedEventsHTML();
        }
    }
}

module.exports = ClusterManager;
