// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const vscode = require('vscode');
const gitTracker = require('./git-tracker');
const os = require('os');
const fs = require('fs');
const path = require('path');
const Terminal = require('./terminal');
const activeWindow = require('active-win');
const { checkBashProfilePath, checkPowerShellProfilePath } = require('./profileHelpers');
const { debounce, getCurrentDir } = require('./helpers');
const navigation = require('./navigation');
const selection = require('./selection');
const save = require('./save');
const helpers = require('./helpers');
const GitHistory = require('./dynamic_history_gen/git_history');
const ClusterManager = require('./clusterManager');
const { processWebData } = require('./dynamic_history_gen/processLiveWeb');
const myCustomEmitter = require('./eventEmitter'); // Use the shared emitter
const ContentTimelineManager = require('./contentTimelineManager');

var tracker = null;
var iter = 0;
var eventData = new Object();
var terminalDimChanged = new Object();
var terminalOpenedFirstTime = new Object();
var terminalName = process.platform === 'win32' ? "pwsh" : "bash";
var allTerminalsData = new Object();
var allTerminalsDirCount = new Object();
var cmdPrompt = process.platform === 'win32' ? ". .\\CH_cfg_and_logs\\CH_PowerShell_profile.ps1" : "source ./CH_cfg_and_logs/.CH_bash_profile";
var previousAppName = '';
var timeSwitchedToChrome = 0;
var timeSwitchedToCode = 0;
var gitActionsPerformed = false;
var extensionActivated = false;
var checkThenCommit = false;
// make a regex that match everything between \033]0; and \007
var very_special_regex = new RegExp("\\033]0;(.*)\\007", "g");
var user = os.userInfo().username;
var hostname = os.hostname();
var terminalList;
var terminalInstance;
var eventEntry = {};
var usingHistoryView = true;
var usingContentTimelineView = false;
var clusterManager = null;
var contentTimelineManager = null;

// this controls whether one wants to always show webview (even if it is closed) or not
var persist = true;

function updateContextKeys() {
    vscode.commands.executeCommand('setContext', 'codeHistories.usingContentTimelineView', usingContentTimelineView);
    vscode.commands.executeCommand('setContext', 'codeHistories.usingHistoryWebview', usingHistoryView);
}

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
	console.log('Congratulations, your extension "codeHistories" is now active!');
	const currentDir = getCurrentDir();
	if (!currentDir) return;

	// Listen for changes in the visible ranges of any text editor
	context.subscriptions.push(vscode.window.onDidChangeTextEditorVisibleRanges(event => {
        // Generate a unique key for the editor, e.g., using its document URI
        const key = event.textEditor.document.uri.fsPath;
        // Apply debouncing per editor
        const debouncedHandleVisibleRangeChange = debounce(navigation.handleVisibleRangeChange, 500, key);
        debouncedHandleVisibleRangeChange(event.textEditor); // Pass the editor instance directly
    }));

    // Listen for document changes to track navigation between documents
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(navigation.handleActiveTextEditorChange));

	// Listen for selection changes with debounced handling
	context.subscriptions.push(vscode.window.onDidChangeTextEditorSelection(event => {
		const key = event.textEditor.document.uri.fsPath;
		const debouncedSelectionChangeHandler = debounce(selection.handleTextEditorSelectionChange, 800, key);
		// console.log('Selection event:', event);
		debouncedSelectionChangeHandler(event.textEditor);
	}));

	// Listen for save events in files
	context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(save.handleFileSave));

	// check git init status
	tracker = new gitTracker(currentDir);
	tracker.createGitFolders();

	// get user and hostname for regex matching
	user = os.userInfo().username;
	hostname = os.hostname();
	if(hostname.indexOf(".") > 0){
		hostname = hostname.substring(0, hostname.indexOf("."));
	}

	// check if current terminals have more than one terminal instance where name is terminalName
	terminalList = vscode.window.terminals;
	terminalInstance = 0;
	for(let i = 0; i < terminalList.length; i++){
		if(terminalList[i].name == terminalName){
			terminalInstance++;
		}
	}

	// close all terminal instances with name terminalName
	if(terminalInstance >= 1){
		for(let i = 0; i < terminalList.length; i++){
			if(terminalList[i].name == terminalName){
				terminalList[i].dispose();
			}
		}
	}

	clusterManager = new ClusterManager(context, tracker, persist);
	clusterManager.initializeClusterManager();

	contentTimelineManager = new ContentTimelineManager(context, tracker, persist);
	contentTimelineManager.initializeContentTimelineManager();

	vscode.window.onDidStartTerminalShellExecution(async event => {
		await onDidExecuteShellCommandHelper(event, clusterManager, contentTimelineManager);
	});

	myCustomEmitter.on('save', async (entry) => {
		eventEntry = entry; // for history view, just need to save and send this entry to clusterManager later after execution
		// console.log('eventEntry:', eventEntry);

		if(usingContentTimelineView){
			await contentTimelineManager.processEvent(entry); // for content timeline view, process the event immediately
		}

		if(usingHistoryView){
			await clusterManager.handleSaveEvent(entry);
		}
	});

	if(usingContentTimelineView){
		myCustomEmitter.on('selection', async (entry) => {
			// console.log('selection:', entry);
			await contentTimelineManager.processEvent(entry);
		});
	}

	// vscode.window.onDidEndTerminalShellExecution(async event => {
	// 	console.log('event: ', event);
	// });

	let activateCodeHistories = vscode.commands.registerCommand('codeHistories.codeHistories', activateCodeHistoriesHelper);
	let executeCheckAndCommit = vscode.commands.registerCommand('codeHistories.checkAndCommit', executeCheckAndCommitHelper);
	let selectGitRepo = vscode.commands.registerCommand('codeHistories.selectGitRepo', selectGitRepoHelper);
	let setNewCmd = vscode.commands.registerCommand('codeHistories.setNewCmd', setNewCmdHelper);
	let undoCommit = vscode.commands.registerCommand('codeHistories.undoCommit', undoCommitHelper);
	let enterGoal = vscode.commands.registerCommand('codeHistories.enterGoal', enterGoalHelper);
	let quickAutoCommit = vscode.commands.registerCommand('codeHistories.quickAutoCommit', quickAutoCommitHelper);
	let selectTerminalProfile = vscode.commands.registerCommand('codeHistories.selectTerminalProfile', showTerminalProfileQuickPick);
	let testRunPythonScript = vscode.commands.registerCommand('codeHistories.testRunPythonScript', testRunPythonScriptHelper);
	let testDBConstructor = vscode.commands.registerCommand('codeHistories.testDBConstructor', testDBConstructorHelper);
	let historyWebview = vscode.commands.registerCommand('codeHistories.historyWebview', function () {
		clusterManager.isPanelClosed = !clusterManager.isPanelClosed;
		if(persist === true){
			if(clusterManager.isPanelClosed){
				clusterManager.initializeWebview();
			} else {
				clusterManager.disposeWebview(); // close but still remember contents
			}
		} else {
			clusterManager.initializeWebview();
		}
    });

	let contentTimelineWebview = vscode.commands.registerCommand('codeHistories.contentTimelineWebview', function () {
		contentTimelineManager.isPanelClosed = !contentTimelineManager.isPanelClosed;
		if(persist === true){
			if(contentTimelineManager.isPanelClosed){
				contentTimelineManager.initializeWebview();
			} else {
				contentTimelineManager.disposeWebview(); //same here (just a convenient way to toggle on and off instead of having to click x)
			}
		} else {
			contentTimelineManager.initializeWebview();
		}
	});	

	context.subscriptions.push(activateCodeHistories);
	context.subscriptions.push(executeCheckAndCommit);
	context.subscriptions.push(selectGitRepo);
	context.subscriptions.push(setNewCmd);
	context.subscriptions.push(undoCommit);
	context.subscriptions.push(enterGoal);
	context.subscriptions.push(quickAutoCommit);
	context.subscriptions.push(selectTerminalProfile);
	context.subscriptions.push(testRunPythonScript);
	context.subscriptions.push(testDBConstructor);

	if(usingHistoryView){
		context.subscriptions.push(historyWebview);
		updateContextKeys();
	}

	if(usingContentTimelineView){
		context.subscriptions.push(contentTimelineWebview);
		updateContextKeys();
	}

	// this is for web dev heuristics
	// if user saves a file in the workspace, then they visit chrome to test their program on localhost (require that they do reload the page so that it is recorded as an event in webData)
	// an automatic commit should be made when they return to vscode

	// no need to have codehistories prefix, can run command in an external terminal
	// change directory to the workspace directory (.e.g. /home/tri/Desktop/react-app)
	// npm start | while IFS= read -r line; do echo "[$(date '+%m/%d/%Y, %I:%M:%S %p')] $line"; done | tee -a server.txt
	// this command will run npm start and pipe the output to a file server.txt in user's working project directory 
	/* E.g. 
		[05/23/2023, 01:32:29 PM]
		[05/23/2023, 01:32:29 PM] > my-app@0.1.0 start
		[05/23/2023, 01:32:29 PM] > react-scripts start
		[05/23/2023, 01:32:29 PM]
		...
		[05/23/2023, 01:32:31 PM] Compiled successfully!
	*/

	// if user also has another server running, we can have a separate external terminal which runs that server and pipe the output to a file server2.txt in user's working project directory
	// change directory to the workspace directory
	// npm start -- --port 3000| while IFS= read -r line; do echo "[$(date '+%m/%d/%Y, %I:%M:%S %p')] $line"; done | tee -a server2.txt
	// python -u -m http.server 8000 2>&1 | tee >(awk '{ print $0; fflush(); }' >> server2.txt)

	var intervalId;

	const checkAppSwitch = async () => {
		try {
		const activeApp = await activeWindow();
		// console.log(activeApp);
	
		if (activeApp && activeApp.owner && activeApp.owner.name) {
			const currentAppName = activeApp.owner.name.toLowerCase();
			// console.log(currentAppName);

			if(currentAppName !== "windows explorer"){ // special case for windows
				if (previousAppName.includes('code') && currentAppName.includes('chrome')) {
					console.log('Switched to from VS Code to Chrome');
					timeSwitchedToChrome = Math.floor(Date.now() / 1000);
					console.log('timeSwitchedToChrome: ', timeSwitchedToChrome);

					// Reset the flag when switching to Chrome
					gitActionsPerformed = false;
				} else if (previousAppName.includes('chrome') && currentAppName.includes('code')) {
					console.log('Switched to from Chrome to VS Code');
					timeSwitchedToCode = Math.floor(Date.now() / 1000);
					console.log('timeSwitchedToCode: ', timeSwitchedToCode);

					// Check if git actions have already been performed
					if (!gitActionsPerformed) {
						await performGitActions();
						gitActionsPerformed = true;
					}
				}
				previousAppName = currentAppName;
			}
		}

		// Set the next interval after processing the current one
		intervalId = setTimeout(checkAppSwitch, 500);
		} catch (error) {
			console.error('Error occurred while checking for app switch:', error);
			intervalId = setTimeout(checkAppSwitch, 500);
		}
	};

	const performGitActions = async () => {
		try {
			// search between timeSwitchedToChrome and timeSwitchedToCode in webData
			await new Promise(resolve => setTimeout(resolve, 1000));
			let webData = fs.readFileSync(path.join(currentDir, 'webData'), 'utf8');
			
			let webDataArray = JSON.parse(webData);

			let webDataArrayFiltered = [];
			let nonLocalWebEntries = []; // Collect only non-local URLs for history view
			let startTime = timeSwitchedToChrome;
			let endTime = timeSwitchedToCode;

			if(startTime > 0 && endTime > 0){
				// Traverse the array backwards
				for (let i = webDataArray.length - 1; i >= 0; i--) {
					let entry = webDataArray[i];
					if (entry.time >= startTime && entry.time <= endTime) {
						webDataArrayFiltered.unshift(entry); // Prepend to maintain order

						// Collect only non-local URLs for history view
						if (!helpers.isLocalUrl(entry.curUrl)) {
							nonLocalWebEntries.unshift(entry);
						}

					} else if (entry.time < startTime) {
						break; // Early exit, no need to check earlier entries
					}
				}
			} else {
				if(startTime <= 0){
					console.error('Invalid startTime:', startTime);
				}
				if(endTime <= 0){
					console.error('Invalid endTime:', endTime);
				}
			}

			// console.log('webDataArrayFiltered:', webDataArrayFiltered);
			if(webDataArrayFiltered.length > 0){
				console.log('webDataArrayFiltered: ', webDataArrayFiltered);

				if(usingHistoryView && nonLocalWebEntries.length > 0){
					let webEntriesForHistory = processWebData(nonLocalWebEntries);
					console.log('webEntriesForHistory: ', webEntriesForHistory);
					await clusterManager.processWebEvents(webEntriesForHistory);
				}

				// check if webDataArrayFiltered contains a visit to localhost or 127.0.0.1
				let webDataArrayFilteredContainsLocalhost = webDataArrayFiltered.some(entry => helpers.isLocalUrl(entry.curUrl));
				
				if(webDataArrayFilteredContainsLocalhost){
					await tracker.gitAdd();
					await tracker.checkWebData();
					await tracker.gitCommit();
					if(usingHistoryView){
						let entriesForClusterManager = await tracker.grabLatestCommitFiles();
						let codeEntries = [...entriesForClusterManager]; // Collect code events
						await clusterManager.processCodeEvents(codeEntries);
					}
					// let currentTime = Math.floor(Date.now() / 1000);
					// console.log('currentTime: ', currentTime);
				}
			}
		} catch (error) {
			console.log('Error performing Git actions:', error);
		}
	};

	// Start the first interval
	intervalId = setTimeout(checkAppSwitch, 500);

	// call activateCodeHistoriesHelper on startup
	activateCodeHistoriesHelper();
}

async function testRunPythonScriptHelper() {
	const scriptPath = path.join(__dirname, 'dynamic_history_gen', 'generate_events_from_git.py');
	const webDataPath = path.join(getCurrentDir(), 'webData');
	const preprocessedWebData = helpers.runPythonScript(scriptPath, [webDataPath], console.log);
}

async function testDBConstructorHelper() {
	const scriptPath = path.join(__dirname, 'dynamic_history_gen', 'generate_events_from_git.py');
	const webDataPath = path.join(getCurrentDir(), 'webData');
	try {
        const preprocessedWebData = await helpers.runPythonScript(scriptPath, [webDataPath]);

        if (preprocessedWebData && preprocessedWebData.trim()) {
            let gitDB = new GitHistory(getCurrentDir(), preprocessedWebData);
            console.log('GitHistory instance created successfully');
        } else {
            console.error('Error: Preprocessed web data is empty or invalid.');
            throw new Error('Preprocessed web data is empty. Unable to construct GitHistory instance.');
        }
    } catch (error) {
        console.error('Failed to run the Python script:', error.message);
    }
}

// https://stackoverflow.com/questions/25245716/remove-all-ansi-colors-styles-from-strings
function removeANSIcodesHelper(txt) {
	const processedTxt = txt.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
	return processedTxt;
}

// https://stackoverflow.com/questions/20856197/remove-non-ascii-character-in-string
function removeNonASCIICharsHelper(txt) {
	const processedTxt = txt.replace(/[\x00-\x08\x0E-\x1F\x7F-\uFFFF]/g, '');
	return processedTxt;
}

async function onDidExecuteShellCommandHelper(event, clusterManager, contentTimelineManager) {
	try {
		// console.log('event.terminal', event.terminal);
		// console.log('event.shellIntegration', event.shellIntegration);
		// console.log('event.execution', event.execution);
		if(event.execution.commandLine){
			let time = Math.floor(Date.now() / 1000);
			let outputStream = event.execution.read();
			let output = '';
			for await (let data of outputStream) {
				data = data.toString();
				data = removeANSIcodesHelper(data);
				data = removeNonASCIICharsHelper(data);
				// console.log('data:', data);
				output += data;
			}
			// console.log('rawOutput:', output);

			// Regex pattern to replace \x5c with \
			const weirdRegex = /\\x5c/g;
			
			if(terminalName === "pwsh" || terminalName === "powershell"){
				output = output.replace(weirdRegex, '\\');
			}

			// Regex to grab between ]633;C and ]633;D including multiple lines (in the case of errors)
			const outputRegex = /\]633;C([\s\S]*?)\]633;D/g;
			let outputMatch = output.match(outputRegex);
			let finalOutput = '';
			if(outputMatch){
				// console.log("outputMatch:", outputMatch);
				finalOutput = outputMatch[0];
				finalOutput = finalOutput.replace(']633;C', '').replace(']633;D', '');
				// console.log('finalOutputMatch:', finalOutput);
			}

			// For current pwsh case in Mac
			if(os.platform() === 'darwin' && terminalName === "pwsh"){
				const pwshDarwinOutputRegex = /\]633;C([\s\S]*)/g;
				outputMatch = output.match(pwshDarwinOutputRegex);
				finalOutput = '';
				if(outputMatch){
					finalOutput = outputMatch[0];
					finalOutput = finalOutput.replace(']633;C', '').replace(']0;', '');
				}
			}

			// Regex to check exit code
			const exitCodeRegex = /\]633;D(?:;(\d+))?/g;
			let exitCodeMatch = output.match(exitCodeRegex);
			let exitCode = '';
			if(exitCodeMatch){
				exitCode = exitCodeMatch[0];
				exitCode = exitCode.replace(']633;D;', '');
				// console.log('exitCodeMatch:', exitCode);
			}

			// grab cwd from shellIntegration event
			let cwd = '';
			if(event.shellIntegration.cwd && event.shellIntegration.cwd.path){
				cwd = event.shellIntegration.cwd.path;
				if(cwd.substring(0, 1) === '/'){
					cwd = cwd.substring(1);
				}
			}

			// Regex to match cmd executed
			const execCmdRegex = /\]633;E;(.*?);/g;
			let execCmdMatch = output.match(execCmdRegex);
			let command = '';
			if(execCmdMatch){
				command = execCmdMatch[0];
				command = command.replace(']633;E;', '');
				command = command.replace(';', '');
				// console.log('execCmdMatch:', command);
			}

			if (user && hostname) {
				// Define regular expressions with word boundaries
				let userRegex = new RegExp("\\b" + user + "\\b", "g");
				let hostnameRegex = new RegExp("\\b" + hostname + "\\b", "g");
	
				// trim user and hostname from command, cwd, and output
				if (command) {
					command = command.replace(hostnameRegex, 'hostname');
					command = command.replace(userRegex, 'user');
				}
				if (cwd) {
					cwd = cwd.replace(hostnameRegex, 'hostname');
					cwd = cwd.replace(userRegex, 'user');
				}
				if(finalOutput){
					finalOutput = finalOutput.replace(hostnameRegex, 'hostname');
					finalOutput = finalOutput.replace(userRegex, 'user');
				}
			}
	
			// console.log('command:', command);
			// console.log('output:', finalOutput);
			// console.log('cwd:', cwd);
			// console.log('exitCode:', exitCode);

			let executionInfo = {
				type: 'execution',
				command: command,
				output: finalOutput,
				exitCode: exitCode,
				cwd: cwd,
				time: time
			};

			console.log('executionInfo:', executionInfo);
	
			// Log the execution info to JSON file
			const currentDir = getCurrentDir();
			const ndjsonString = JSON.stringify(executionInfo) + '\n'; // Convert to JSON string and add newline
			const outputPath = path.join(currentDir, 'CH_cfg_and_logs', 'CH_terminal_data.ndjson');
			await fs.promises.appendFile(outputPath, ndjsonString);

			await tracker.gitAdd();
	
			// if command contains "codehistories" then we should commit
			if (command.includes("codehistories")) {
				const outputTxtFilePath = path.join(currentDir, 'output.txt');
				await fs.promises.appendFile(outputTxtFilePath, `${finalOutput}\n`);
				await tracker.gitAddOutput();
				await tracker.checkWebData();
				if(usingHistoryView) {
					await tracker.gitCommit();
					let codeEntries = await tracker.grabLatestCommitFiles();
					await clusterManager.processCodeEvents(codeEntries);
				} else if(usingContentTimelineView) {
					// await tracker.gitCommit();
					await contentTimelineManager.processEvent(executionInfo);
				} else {
					await tracker.gitCommit();
				}
				// vscode.window.showInformationMessage('Commit supposedly executed successfully!');
			} else {
				await tracker.gitReset();
			}
		}
	} catch (error) {
		console.log("Error occurred:", error);
		await tracker.gitReset();
		await vscode.window.showInformationMessage('Error committing to git. Please wait a few seconds and try again.');
	}
}

/* Activate the extension */
async function activateCodeHistoriesHelper() {
	vscode.window.showInformationMessage('Code histories activated!');
	const currentDir = getCurrentDir();
	await createVsCodeSettings(currentDir);
	await createProfileScripts(currentDir);
	// call selectTerminalProfile to open the terminal
	await vscode.commands.executeCommand('codeHistories.selectTerminalProfile');
	extensionActivated = true;
}

async function createVsCodeSettings(cwd) {
    const vscodePath = path.join(cwd, ".vscode");
    const settingsPath = path.join(vscodePath, "settings.json");
    const settings = JSON.stringify({
        "terminal.integrated.defaultProfile.windows": "PowerShell",
        "terminal.integrated.defaultProfile.osx": "bash",
        "terminal.integrated.defaultProfile.linux": "bash",
        "terminal.integrated.shellIntegration.enabled": true,
        "python.terminal.activateEnvironment": false
    }, null, 4);

    try {
        if (!fs.existsSync(vscodePath)) {
            fs.mkdirSync(vscodePath);
        }

        // Read existing settings file
        let existingSettings = {};
        if (fs.existsSync(settingsPath)) {
            try {
                const data = fs.readFileSync(settingsPath, 'utf8');
                existingSettings = JSON.parse(data);
            } catch (error) {
                console.error("Error parsing existing settings:", error);
            }
        }

        // Merge new settings with existing settings
        let combinedSettings = { ...existingSettings, ...JSON.parse(settings) };

        // Remove any duplicate keys
        let uniqueSettings = {};
        for (let key in combinedSettings) {
            if (!uniqueSettings.hasOwnProperty(key)) {
                uniqueSettings[key] = combinedSettings[key];
            }
        }

        // Write the settings
        fs.writeFileSync(settingsPath, JSON.stringify(uniqueSettings, null, 4));

    } catch (error) {
        vscode.window.showErrorMessage(`Error creating VSCode settings: ${error}`);
    }
}

async function createProfileScripts(cwd) {
	checkPowerShellProfilePath(cwd);
	checkBashProfilePath(cwd);
}
/* End of Activate the extension */

/* Execute the check and commit command */
async function executeCheckAndCommitHelper() {
	let isExtensionActivated = await checkExtensionActivation();
	if(!isExtensionActivated) return;
	await vscode.commands.executeCommand("workbench.action.files.saveAll");
	await tracker.gitAdd();
	const currentDir = getCurrentDir();
	await handleTerminal(terminalName, currentDir);
	checkThenCommit = true;
}

async function showTerminalProfileQuickPick() {
	const currentDir = getCurrentDir();

	const profiles = [
		{ label: "Bash or Git Bash", name: "bash"},
		{ label: "PowerShell", name: "pwsh"},
	];

	try{
		const selectedProfile = await vscode.window.showQuickPick(profiles, {
			placeHolder: "Select the terminal profile to open (shortcut: Ctrl/Cmd+Shift+T)",
		});

		let profileName = selectedProfile.name;

		if (!selectedProfile || !profileName) {
			vscode.window.showErrorMessage("No terminal profile selected. Selecting the default terminal profile.");
			return;
		}

		const vscodePath = path.join(currentDir, ".vscode");
		const settingsPath = path.join(vscodePath, "settings.json");
		let settings;
		
		if (profileName === "bash") {
			if(process.platform === "win32"){
				settings = JSON.stringify({
					"terminal.integrated.defaultProfile.windows": "Git Bash",
				}, null, 4);
			}
			if(process.platform === "darwin"){
				settings = JSON.stringify({
					"terminal.integrated.defaultProfile.osx": profileName,
				}, null, 4);
			}
			if(process.platform === "linux"){
				settings = JSON.stringify({
					"terminal.integrated.defaultProfile.linux": profileName,
				}, null, 4);
			}
		}

		if (profileName === "pwsh") {
			if(process.platform === "win32"){
				settings = JSON.stringify({
					"terminal.integrated.defaultProfile.windows": "PowerShell",
				}, null, 4);
			}
			if(process.platform === "darwin"){
				settings = JSON.stringify({
					"terminal.integrated.defaultProfile.osx": profileName,
				}, null, 4);
			}
			if(process.platform === "linux"){
				settings = JSON.stringify({
					"terminal.integrated.defaultProfile.linux": profileName,
				}, null, 4);
			}
		}

		try {
			if (!fs.existsSync(vscodePath)) {
				fs.mkdirSync(vscodePath);
			}

			// Read existing settings file
			let existingSettings = {};
			if (fs.existsSync(settingsPath)) {
				try {
					const data = fs.readFileSync(settingsPath, 'utf8');
					existingSettings = JSON.parse(data);
				} catch (error) {
					console.error("Error parsing existing settings:", error);
				}
			}

			// Merge new settings with existing settings
			let combinedSettings = { ...existingSettings, ...JSON.parse(settings) };

			// Remove any duplicate keys
			let uniqueSettings = {};
			for (let key in combinedSettings) {
				if (!uniqueSettings.hasOwnProperty(key)) {
					uniqueSettings[key] = combinedSettings[key];
				}

				// Write the settings
				fs.writeFileSync(settingsPath, JSON.stringify(uniqueSettings, null, 4));
			}

		} catch (error) {
			vscode.window.showErrorMessage(`Error creating VSCode settings: ${error}`);
		}

		terminalName = profileName;
		if(terminalName === "pwsh" || terminalName === "powershell"){
			if(process.platform === "win32") {
				cmdPrompt = ". .\\CH_cfg_and_logs\\CH_PowerShell_profile.ps1";
			} else {
				cmdPrompt = ". ./CH_cfg_and_logs/CH_PowerShell_profile.ps1";
			}
		}
		if(terminalName === "bash"){
			cmdPrompt = "source ./CH_cfg_and_logs/.CH_bash_profile";
		}

		await handleTerminal(terminalName, currentDir);
	} catch (error) {
		console.error('Error selecting terminal profile:', error);
		vscode.window.showErrorMessage("No terminal profile selected. Selecting the default terminal profile.");
		return;
	}
}

async function handleTerminal(name, workspacePath) {
	const terminal = await findOrCreateTerminal(name, workspacePath);
	// console.log('Terminal:', terminal);
    if (terminal) {
        terminal.show();
        terminal.sendText(cmdPrompt);
    }
}

async function findOrCreateTerminal(name, workspacePath) {
	let existingTerminal = vscode.window.terminals.find(t => t.name === name);
    if (!existingTerminal) {
		// console.log('workspacePath:', workspacePath);
        let codeHistoriesTerminal = new Terminal(name, workspacePath);

        // Depending on the terminal name, check and create the profile scripts
        if (name === "bash" || name === "Git Bash") {
            await checkBashProfilePath(workspacePath);
        } else if (name === "pwsh" || name === "powershell") {
            await checkPowerShellProfilePath(workspacePath);
        }

        // After setting up the profiles, return the new terminal instance
        return codeHistoriesTerminal;
    }
    return existingTerminal;
}
/* End of Execute the check and commit command */

async function selectGitRepoHelper() {
	let isExtensionActivated = await checkExtensionActivation();
	if(!isExtensionActivated) return;
	tracker.presentGitRepos();
}

async function setNewCmdHelper() {
	let isExtensionActivated = await checkExtensionActivation();
	if(!isExtensionActivated) return;

	let newCmd = await vscode.window.showInputBox({
		prompt: "Enter the new command",
		placeHolder: "<command> [args]"
	});
	if(newCmd) cmdPrompt = `codehistories ${newCmd}`;
}

async function undoCommitHelper() {
	let isExtensionActivated = await checkExtensionActivation();
	if(!isExtensionActivated) return;
	await tracker.undoCommit();
}

async function enterGoalHelper() {
	let isExtensionActivated = await checkExtensionActivation();
	if(!isExtensionActivated) return;
	const goal = await vscode.window.showInputBox({
					placeHolder: 'Enter your goal or subgoal',
					prompt: 'Please enter the text for your goal or subgoal',
				});
	
	if(goal){
		// Write the goal to a file
		let time = Math.floor(Date.now() / 1000);
		let goalInfo = {
			goal: goal,
			time: time
		};

		// Log the goal info to JSON file
		const currentDir = getCurrentDir();
		const ndjsonString = JSON.stringify(goalInfo) + '\n'; // Convert to JSON string and add newline
		const outputPath = path.join(currentDir, 'CH_cfg_and_logs', 'CH_goals.ndjson');
		await fs.promises.appendFile(outputPath, ndjsonString);
	}
}

async function quickAutoCommitHelper() {
	let isExtensionActivated = await checkExtensionActivation();
	if(!isExtensionActivated) return;
	await tracker.gitAdd();
	await tracker.checkWebData();
	await tracker.gitCommit();
	if(usingHistoryView){
		let codeEntries = await tracker.grabLatestCommitFiles();
		await clusterManager.processCodeEvents(codeEntries);
	}

	if(usingContentTimelineView){
		await contentTimelineManager.processEvent(eventEntry);
	}
}

async function checkExtensionActivation() {
	if(!extensionActivated){
		vscode.window.showErrorMessage('Code histories not activated. Ctrl(or Cmd)+Shift+P -> Code Histories');
		return false;
	}
	return true;
}

function deactivate() {
	console.log('Thank you for trying out "codeHistories"!');

	// clear data
	allTerminalsData = new Object();
	allTerminalsDirCount = new Object();
	terminalDimChanged = new Object();
	terminalOpenedFirstTime = new Object();

	try{
		if(usingHistoryView){
			// save webview inside CH_cfg_and_logs
			const currentDir = getCurrentDir();

			let date = new Date();
			let dateStr = date.toISOString().split('T')[0];
			let epochTimeInSeconds = Math.floor(date.getTime() / 1000);  // Get the current time in seconds

			const webviewPath = path.join(currentDir, 'CH_cfg_and_logs', `history_webview_${dateStr}_${epochTimeInSeconds}.html`);
			// console.log('webviewPath:', webviewPath);

			let webviewContent = clusterManager.getWebviewContent();
			// webviewContent = clusterManager.commentOutVSCodeApi(webviewContent); // Comment out the VS Code API script so html can run as standalone in browser
			// // console.log('webviewContent:', webviewContent);

			fs.writeFileSync(webviewPath, webviewContent);			
		} 
		
		if(usingContentTimelineView){
			// save webview inside CH_cfg_and_logs
			const currentDir = getCurrentDir();

			let date = new Date();
			let dateStr = date.toISOString().split('T')[0];
			let epochTimeInSeconds = Math.floor(date.getTime() / 1000);  // Get the current time in seconds

			const webviewPath = path.join(currentDir, 'CH_cfg_and_logs', `content_timeline_webview_${dateStr}_${epochTimeInSeconds}.html`);
			// console.log('webviewPath:', webviewPath);

			let webviewContent = contentTimelineManager.getWebviewContent();

			fs.writeFileSync(webviewPath, webviewContent);
		}
	} catch (error) {
		console.error('Error saving webview:', error);
	}
}

module.exports = {
	activate,
	deactivate
}