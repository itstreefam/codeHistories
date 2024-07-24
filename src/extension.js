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
var previousDocument = null;
var navigationHistory = [];
var selectionHistory = [];
const debounceTimers = new Map(); // For debouncing per document

function getCurrentDir() {
	if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
		return vscode.workspace.workspaceFolders[0].uri.fsPath;
	} else {
		vscode.window.showErrorMessage("Working folder not found, open a folder and try again.");
		return null; // No directory found
	}
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
        const debouncedHandleVisibleRangeChange = debounce(handleVisibleRangeChange, 500, key);
        debouncedHandleVisibleRangeChange(event.textEditor); // Pass the editor instance directly
    }));

    // Listen for document changes to track navigation between documents
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(handleActiveTextEditorChange));

	// Listen for selection changes with debounced handling
	context.subscriptions.push(vscode.window.onDidChangeTextEditorSelection(event => {
		const key = event.textEditor.document.uri.fsPath;
		const debouncedSelectionChangeHandler = debounce(handleTextEditorSelectionChange, 500, key);
		debouncedSelectionChangeHandler(event.textEditor);
	}));

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

	if(process.platform === 'win32'){
		vscode.window.onDidExecuteTerminalCommand(async event => {
			// if(event.terminal.name !== "pwsh" && event.terminal.name !== "powershell") return;
			await onDidExecuteTerminalCommandHelper(event);
		});

		/*
		// e.g. tri@DESKTOP-XXXXXXX MINGW64 ~/Desktop/test-folder (master)
		var win_regex_dir = new RegExp(user + "@" + hostname + "(\(.*\))?", "g");
		
		// on did write to terminal
		vscode.window.onDidWriteTerminalData(async event => {
			if(event.terminal.name !== "bash") return;

			const pid = await event.terminal.processId;

			var terminalData = event.data.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');

			if(terminalDimChanged[pid]){
				terminalData = "";
				terminalDimChanged[pid] = false;
			}

			if(typeof allTerminalsData[pid] === 'undefined'){
				allTerminalsData[pid] = "";
			}

			if(typeof allTerminalsDirCount[pid] === 'undefined'){
				allTerminalsDirCount[pid] = 0;
			}
			
			// test if very_special_regex matches
			if(very_special_regex.test(terminalData)){
				// get the matched string
				var specialMatched = terminalData.match(very_special_regex);
				// remove the matched from the terminalData
				terminalData = terminalData.replace(specialMatched, "");
			}

			// see if terminalData contains win_regex_dir
			if(win_regex_dir.test(terminalData.trim())){
				// get the matched string
				var matched = terminalData.match(win_regex_dir);
				console.log('matched: ', matched);

				//if matched.length is a number
				if(matched.length){
					// add length of matched array to counterMatchedDir
					allTerminalsDirCount[pid] += matched.length;
				}
			}

			// iter += 1;
			// eventData[iter] = terminalData;
			// console.log(eventData);

			// allTerminalsData[pid] = globalStr of the terminal instance with pid
			allTerminalsData[pid] += terminalData;
			// console.log('allTerminalsData: ', allTerminalsData[pid]);

			console.log('There are %s matched regex dir for pid %s', allTerminalsDirCount[pid], pid);

			// if counter is >= 2, then we should have enough information to trim and find the output
			if(allTerminalsDirCount[pid] >= 2){
				if(typeof matched === 'undefined') return;
				let lastOccurence = allTerminalsData[pid].lastIndexOf(matched[matched.length - 1]);

				// check if allTerminalsData[pid] contains codehistories
				let hasCodehistories = removeBackspaces(allTerminalsData[pid]).includes("codehistories");
				if(!hasCodehistories) return;

				try{
					await tracker.gitAdd();
					
					let outputUpdated = await tracker.isOutputModified();	
					console.log('output.txt updated?', outputUpdated);

					if(outputUpdated){
						await tracker.gitAddOutput();
						await tracker.checkWebData();
						await tracker.gitCommit();
					} else {
						// if output.txt is not updated, then we should revert the git add
						await tracker.gitReset();
					}
				} catch(error){
					console.log("Error occurred:", error);
					await tracker.gitReset();
					await vscode.window.showInformationMessage('Error committing to git. Please wait a few seconds and try again.');
				}

				// console.log('globalStr of %s before reset: ', pid, allTerminalsData[pid]);
				
				// reset globalStr of pid to contain only the matched dir string
				allTerminalsData[pid] = allTerminalsData[pid].substring(lastOccurence);
				// console.log('globalStr of %s after reset: ', pid, allTerminalsData[pid]);
				
				allTerminalsDirCount[pid] = 1;
			}
		});

		// on did open terminal
		vscode.window.onDidOpenTerminal(event => {
			if(event.name == "bash"){
				event.processId.then(pid => {
					allTerminalsData[pid] = "";
					allTerminalsDirCount[pid] = 0;
					terminalDimChanged[pid] = false;
					terminalOpenedFirstTime[pid] = true;
				});
			}
		});

		// on did close terminal
		vscode.window.onDidCloseTerminal(event => {
			if(event.name == "bash"){
				event.processId.then(pid => {
					delete allTerminalsData[pid];
					delete allTerminalsDirCount[pid];
					delete terminalDimChanged[pid];
					delete terminalOpenedFirstTime[pid];
				});
			}
		});

		// on did change terminal size
		vscode.window.onDidChangeTerminalDimensions(event => {
			if(event.terminal.name == "bash"){
				event.terminal.processId.then(pid => {
					if(terminalOpenedFirstTime[pid]){
						terminalDimChanged[pid] = false;
						terminalOpenedFirstTime[pid] = false;
					}else if(allTerminalsData[pid]){
						terminalDimChanged[pid] = true;
					}
				});
			}
		});
		*/
	}

	if(process.platform === "darwin"){
		// use bash as default terminal cmd 
		// hostname:directory_name user$
		var mac_regex_dir = new RegExp("(\(.*\))?" + hostname + ".*" + user + "\\${1}", "g");
		unixLikeTerminalProcess(mac_regex_dir);
	}

	if(process.platform === 'linux'){
		// linux defaut bash e.g. tri@tri-VirtualBox:~/Desktop/test$
		var linux_regex_dir = new RegExp("(\(.*\))?" + user + "@" + hostname + ".*\\${1}", "g");
		// unixLikeTerminalProcess(linux_regex_dir);
		vscode.window.onDidExecuteTerminalCommand(async event => {
			await onDidExecuteTerminalCommandHelper(event);
		});
	}

	let activateCodeHistories = vscode.commands.registerCommand('codeHistories.codeHistories', activateCodeHistoriesHelper);
	let executeCheckAndCommit = vscode.commands.registerCommand('codeHistories.checkAndCommit', executeCheckAndCommitHelper);
	let selectGitRepo = vscode.commands.registerCommand('codeHistories.selectGitRepo', selectGitRepoHelper);
	let setNewCmd = vscode.commands.registerCommand('codeHistories.setNewCmd', setNewCmdHelper);
	let undoCommit = vscode.commands.registerCommand('codeHistories.undoCommit', undoCommitHelper);
	let enterGoal = vscode.commands.registerCommand('codeHistories.enterGoal', enterGoalHelper);
	let quickAutoCommit = vscode.commands.registerCommand('codeHistories.quickAutoCommit', quickAutoCommitHelper);
	let selectTerminalProfile = vscode.commands.registerCommand('codeHistories.selectTerminalProfile', showTerminalProfileQuickPick);

	context.subscriptions.push(activateCodeHistories);
	context.subscriptions.push(executeCheckAndCommit);
	context.subscriptions.push(selectGitRepo);
	context.subscriptions.push(setNewCmd);
	context.subscriptions.push(undoCommit);
	context.subscriptions.push(enterGoal);
	context.subscriptions.push(quickAutoCommit);
	context.subscriptions.push(selectTerminalProfile);

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
			let webData = fs.readFileSync(path.join(currentDir, 'webData'), 'utf8');
			let webDataArray = JSON.parse(webData);

			let webDataArrayFiltered = [];
			let startTime = timeSwitchedToChrome;
			let endTime = timeSwitchedToCode;

			for (let i = webDataArray.length - 1; i >= 0; i--) {
				let obj = webDataArray[i];
				if(obj.time < startTime){
					break;
				}
				if (obj.time >= startTime && obj.time <= endTime) {
					webDataArrayFiltered.unshift(obj);
				}
			}

			// console.log('webDataArrayFiltered: ', webDataArrayFiltered);
			if(webDataArrayFiltered.length > 0){
				// check if webDataArrayFiltered contains a visit to localhost or 127.0.0.1
				let webDataArrayFilteredContainsLocalhost = webDataArrayFiltered.filter(obj => obj.curUrl.includes('localhost') || containsIPAddresses(obj.curUrl));
				
				if(webDataArrayFilteredContainsLocalhost.length > 0){
					await tracker.gitAdd();
					await tracker.checkWebData();
					await tracker.gitCommit();
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
}

async function onDidExecuteTerminalCommandHelper(event) {
	try {
		let time = Math.floor(Date.now() / 1000);
		let command = event.commandLine;
		let cwd = event.cwd;
		let exitCode = event.exitCode;
		let output = event.output;

		// console.log('command: ', command);
		// console.log('cwd: ', cwd);
		// console.log('exitCode: ', exitCode);
		// console.log('output: ', output);

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
			if (output) {
				// Instead of grabbing the entire output with cwd
				// Just grab the line that starting from Execution Time
				// Then append the command before it
				let outputFromExecLine = output.substring(output.indexOf('Execution Time:'));
				if (outputFromExecLine && (terminalName === "pwsh" || terminalName === "powershell")) {
					output = '\n' + outputFromExecLine;
				} else {
					output = outputFromExecLine;
				}
				output = output.replace(hostnameRegex, 'hostname');
				output = output.replace(userRegex, 'user');
			}
		}

		let executionInfo = {
			command: command,
			cwd: cwd,
			exitCode: exitCode,
			output: output,
			time: time
		};

		// Log the execution info to JSON file
		const currentDir = getCurrentDir();
		const ndjsonString = JSON.stringify(executionInfo) + '\n'; // Convert to JSON string and add newline
		const outputPath = path.join(currentDir, 'CH_cfg_and_logs', 'CH_terminal_data.ndjson');
		await fs.promises.appendFile(outputPath, ndjsonString);

		await tracker.gitAdd();

		// if command contains "codehistories" then we should commit
		if (command.includes("codehistories")) {
			if(event.terminal.name === "pwsh" || event.terminal.name === "powershell"){
				// Write to output to output.txt only for windows since powershell couldn't redirect output well
				// The setup bash profile redirects solid output, we don't need to do it again
				const outputTxtFilePath = path.join(currentDir, 'output.txt');
				await fs.promises.appendFile(outputTxtFilePath, `${output}\n`);
			}
			await tracker.gitAddOutput();
			await tracker.checkWebData();
			await tracker.gitCommit();
		} else {
			await tracker.gitReset();
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

		profileName = selectedProfile.name;

		if (!profileName) {
			vscode.window.showErrorMessage("No terminal profile selected. Selecting the default terminal profile.");
			return;
		}

		if (profileName === "bash" && process.platform === "win32") {
			// update the vscode settings.json to use Git Bash as the default terminal
			const vscodePath = path.join(currentDir, ".vscode");
			const settingsPath = path.join(vscodePath, "settings.json");
			// find the terminal.integrated.defaultProfile.windows key and set it to Git Bash
			const settings = JSON.stringify({
				"terminal.integrated.defaultProfile.windows": "Git Bash",
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

					// Write the settings
					fs.writeFileSync(settingsPath, JSON.stringify(uniqueSettings, null, 4));
				}

			} catch (error) {
				vscode.window.showErrorMessage(`Error creating VSCode settings: ${error}`);
			}
		}

		terminalName = profileName;
		if(terminalName === "pwsh" || terminalName === "powershell"){
			cmdPrompt = ". .\\CH_cfg_and_logs\\CH_PowerShell_profile.ps1";
		}
		if(terminalName === "bash"){
			cmdPrompt = "source ./CH_cfg_and_logs/.CH_bash_profile";
		}

		await handleTerminal(terminalName, currentDir);
	} catch (error) {
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
}

async function checkExtensionActivation() {
	if(!extensionActivated){
		vscode.window.showErrorMessage('Code histories not activated. Ctrl(or Cmd)+Shift+P -> Code Histories');
		return false;
	}
	return true;
}

function unixLikeTerminalProcess(platform_regex_dir) {
	// use bash as default terminal cmd
	let returned_regex_dir = new RegExp("\\r" + platform_regex_dir.source, platform_regex_dir.flags);
	
	// on did write to terminal
	vscode.window.onDidWriteTerminalData(async event => {
		if(event.terminal.name !== terminalName) return;

		const pid = await event.terminal.processId;

		var terminalData = event.data.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');

		if(typeof allTerminalsData[pid] === 'undefined'){
			allTerminalsData[pid] = "";
		}

		if(typeof allTerminalsDirCount[pid] === 'undefined'){
			allTerminalsDirCount[pid] = 0;
		}

		// test if very_special_regex matches
		if(very_special_regex.test(terminalData)){
			// get the matched string
			var matched = terminalData.match(very_special_regex);
			// remove the matched from the terminalData
			terminalData = terminalData.replace(matched, "");
		}

		// see if terminalData contains regex_dir
		if(platform_regex_dir.test(terminalData) && !returned_regex_dir.test(terminalData)){
			// get the matched string
			var matched = terminalData.match(platform_regex_dir);
			console.log('matched: ', matched);
			
			//if matched.length is a number
			if(matched.length){
				// add length of matched array to counterMatchedDir
				allTerminalsDirCount[pid] += matched.length;
			}
		}

		// iter += 1;
		// eventData[iter] = terminalData;
		// console.log(eventData);

		// allTerminalsData[pid] = globalStr of the terminal instance with pid
		allTerminalsData[pid] += terminalData;
		// console.log('allTerminalsData: ', pid, allTerminalsData[pid]);

		console.log('There are %s matched regex dir for pid %s', allTerminalsDirCount[pid], pid);

		// if counter is >= 2, then we should have enough information to trim and find the output
		if(allTerminalsDirCount[pid] >= 2){

			if(returned_regex_dir.test(allTerminalsData[pid])){
				// happens when the terminal is interacted with without necessarily writing out new data
				let carriage_return_dir = allTerminalsData[pid].match(returned_regex_dir);
				// console.log('carriage_return_dir: ', carriage_return_dir);

				// remove the matched string from allTerminalsData[pid]
				allTerminalsData[pid] = allTerminalsData[pid].replace(carriage_return_dir, "");
			}

			if(typeof matched === 'undefined') return;
			let lastOccurence = allTerminalsData[pid].lastIndexOf(matched[matched.length - 1]);

			// check if allTerminalsData[pid] contains codehistories
			let hasCodehistories = removeBackspaces(allTerminalsData[pid]).includes("codehistories");
			if(!hasCodehistories) return;

			try{
				await tracker.gitAdd();
				
				let outputUpdated = await tracker.isOutputModified();	
				console.log('output.txt updated?', outputUpdated);

				if(outputUpdated){
					await tracker.gitAddOutput();
					await tracker.checkWebData();
					await tracker.gitCommit();
				} else {
					// if output.txt is not updated, then we should revert the git add
					await tracker.gitReset();
				}
			} catch(error){
				console.log("Error occurred:", error);
				await tracker.gitReset();
				await vscode.window.showInformationMessage('Error committing to git. Please wait a few seconds and try again.');
			}

			// console.log('globalStr of %s before reset: ', pid, allTerminalsData[pid]);
			
			// reset globalStr of pid to contain only the matched dir string
			allTerminalsData[pid] = allTerminalsData[pid].substring(lastOccurence);
			// console.log('globalStr of %s after reset: ', pid, allTerminalsData[pid]);
			
			allTerminalsDirCount[pid] = 1;
			checkThenCommit = false;
		}
	});

	// on did open terminal
	vscode.window.onDidOpenTerminal(event => {
		if(event.name == terminalName){
			event.processId.then(pid => {
				allTerminalsData[pid] = "";
				allTerminalsDirCount[pid] = 0;
			});
		}
	});

	// on did close terminal
	vscode.window.onDidCloseTerminal(event => {
		if(event.name == terminalName){
			event.processId.then(pid => {
				delete allTerminalsData[pid];
				delete allTerminalsDirCount[pid];
			});
		}
	});
}

function containsIPAddresses(url) {
	// Define regex patterns for matching IPv4 and IPv6 addresses
	const ipv4Pattern = /\b(?:\d{1,3}\.){3}\d{1,3}\b/;
	const ipv6Pattern = /\b(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}\b/;

	// Use the regex `test` method to check if the URL contains an IPv4 or IPv6 address
	return ipv4Pattern.test(url) || ipv6Pattern.test(url);
}

function removeBackspaces(str) {
	var patternString = (
        "[\\u0000]|[\\u0001]|[\\u0002]|[\\u0003]|[\\u0004]|" +
        "[\\u0005]|[\\u0006]|[\\u0007]|[\\u0008]|[\\u000b]|" +
        "[\\u000c]|[\\u000d]|[\\u000e]|[\\u000f]|[\\u0010]|" +
        "[\\u0011]|[\\u0012]|[\\u0013]|[\\u0014]|[\\u0015]|" +
        "[\\u0016]|[\\u0017]|[\\u0018]|[\\u0019]|[\\u001a]|" +
        "[\\u001b]|[\\u001c]|[\\u001d]|[\\u001e]|[\\u001f]|" +
        "[\\u007f]|[\\u0040]"
    );
    var pattern = new RegExp(patternString, "gm");
    while (str.indexOf("\b") !== -1) {
        str = str.replace(/.?\x08/g, ""); // 0x08 is the ASCII code for \b
    }
    str = str.replace(pattern, "");  
    return str;
}

// Debounce function improved to handle debouncing per unique key (document URI)
function debounce(func, wait, key) {
    return function(...args) {
        if (!debounceTimers.has(key)) {
            debounceTimers.set(key, null);
        }
        clearTimeout(debounceTimers.get(key));
        debounceTimers.set(key, setTimeout(() => {
            func.apply(this, args);
        }, wait));
    };
}

function handleVisibleRangeChange(editor) {
    if (!editor) return;

    const document = editor.document;
    const visibleRangesInfo = editor.visibleRanges.map(range => {
        // Calculate surrounding lines' indices, ensuring they are within document bounds
        const startLineIndex = Math.max(range.start.line - 2, 0); // 2 lines above the first visible, or document start
        const endLineIndex = Math.min(range.end.line + 2, document.lineCount - 1); // 2 lines below the last visible, or document end

        // Extract text for the surrounding lines
        const linesText = [];
        
		// Capture lines before the start of the visible range and the visible range itself
		for (let i = startLineIndex; i <= range.end.line; i++) {
			linesText.push(document.lineAt(i).text);
		}

        // Insert ellipsis if there's a gap indicating omitted content
        if (range.start.line - startLineIndex > 0 || endLineIndex - range.end.line > 0) {
            linesText.push("...");
        }

        // Capture lines at the end of the visible range and after it
		for (let i = range.end.line; i <= endLineIndex; i++) {
			linesText.push(document.lineAt(i).text);
		}

        let documentPath = document.uri.fsPath;

        // trim the user and hostname from the document
        if (user && hostname) {
            let userRegex = new RegExp("\\b" + user + "\\b", "g");
            let hostnameRegex = new RegExp("\\b" + hostname + "\\b", "g");
            documentPath = documentPath.replace(userRegex, "user").replace(hostnameRegex, "hostname");
        }

        const entry = {
            surroundingLines: linesText,
            range: [range.start.line + 1, range.end.line + 1],
            document: documentPath,
            time: Math.floor(Date.now() / 1000),
        };

        appendNavigationEntryToFile(entry, editor);

        return entry;
    });

	// Store each visible range change in navigation history
	// Uncomment the following lines to view the visible ranges info in the console
    // navigationHistory.push(...visibleRangesInfo);
    // console.log('Navigation History Updated:', navigationHistory);
}

function updateVisibleEditors() {
    vscode.window.visibleTextEditors.forEach(editor => {
        // Directly call handleVisibleRangeChange for each visible editor
        // Note: No need to debounce here as this is called from a debounced context or controlled events
        handleVisibleRangeChange(editor);
    });
}


function handleActiveTextEditorChange(editor) {
	// This checks for actual editor changes, including document switches and split view adjustments
    if (editor) {
        let currentDocument = editor.document.uri.fsPath;
        if (previousDocument && currentDocument !== previousDocument) {
			// trim the user and hostname from the document
			if (user && hostname) {
				let userRegex = new RegExp("\\b" + user + "\\b", "g");
				let hostnameRegex = new RegExp("\\b" + hostname + "\\b", "g");
				currentDocument = currentDocument.replace(userRegex, "user").replace(hostnameRegex, "hostname");
				previousDocument = previousDocument.replace(userRegex, "user").replace(hostnameRegex, "hostname");
			}

			// Store the navigation history entry for the document switch
			let entry = {
				document: currentDocument,
				prevDocument: previousDocument,
				time: Math.floor(Date.now() / 1000),
				transition: true, // Indicates this record is about transitioning between documents
			};

			// appendNavigationEntryToFile(entry, editor);

			// Uncomment the following lines to view the navigation history in the console
			// navigationHistory.push(entry);
			// console.log('Navigation History Updated:', navigationHistory);
        }
        previousDocument = currentDocument; // Update for future comparisons
    }
	updateVisibleEditors();
}

function handleTextEditorSelectionChange(editor) {
    // Ensure there is a valid selection
    if (!editor || !editor.selection || editor.selection.isEmpty) {
        return; // Exit if no editor, no selection, or the selection is empty
    }

    const document = editor.document;
    const selection = editor.selection;

    // Define the range for capturing text around the selection
    const startLineIndex = selection.start.line;
    // Ensure we do not go beyond the document's start and end
    const endLineIndex = selection.end.line;
    const documentLineCount = document.lineCount;

    // Calculate indices to capture additional context
    // Next two lines after the start line, ensuring not to exceed document bounds
    const afterStartLineEndIndex = Math.min(startLineIndex + 2, documentLineCount - 1);
    // Two lines before the end line, ensuring not to go before the start line
    const beforeEndLineStartIndex = Math.max(endLineIndex - 2, startLineIndex, 0);

    // Initialize an array to hold the lines of text
    const linesText = [];

    // Capture from the start line to the specified end index after the start
    for (let i = startLineIndex; i <= afterStartLineEndIndex; i++) {
        linesText.push(document.lineAt(i).text);
    }

    // If there's a gap between the sections to capture, add ellipsis to indicate omitted lines
    if (beforeEndLineStartIndex > afterStartLineEndIndex + 1) {
        linesText.push("..."); // Indicative of omitted lines
    }

    // Capture from the specified start index before the end to the end line
    for (let i = beforeEndLineStartIndex; i <= endLineIndex; i++) {
        // Avoid duplicating lines if the start and end ranges overlap
        if (i > afterStartLineEndIndex) {
            linesText.push(document.lineAt(i).text);
        }
    }

    let documentPath = document.uri.fsPath;

	// trim the user and hostname from the document
	if (user && hostname) {
		let userRegex = new RegExp("\\b" + user + "\\b", "g");
		let hostnameRegex = new RegExp("\\b" + hostname + "\\b", "g");
		documentPath = documentPath.replace(userRegex, "user").replace(hostnameRegex, "hostname");
	}

    const entry = {
        selectedLinesText: linesText,
        range: [selection.start.line + 1, selection.end.line + 1],
		document: documentPath,
        time: Math.floor(Date.now() / 1000),
    };

    // Log the execution info to JSON file
	const currentDir = getCurrentDir();
	const ndjsonString = JSON.stringify(entry) + '\n'; // Convert to JSON string and add newline
	const outputPath = path.join(currentDir, 'CH_cfg_and_logs', 'CH_selection_history.ndjson');
	fs.appendFile(outputPath, ndjsonString, (err) => {
		if (err) {
			console.error('Error appending selection entry to file:', err);
			vscode.window.showErrorMessage('Failed to append selection entry to file.');
		}
	}); 
	
	// Uncomment the following lines to view the selection history in the console 
	// selectionHistory.push(entry);
	// console.log('Selection History Updated:', selectionHistory);
}

function appendNavigationEntryToFile(entry, editor) {
	const currentDir = getCurrentDir();
    const filePath = path.join(currentDir, 'CH_cfg_and_logs', 'CH_navigation_history.ndjson');
	const currentDocumentPath = editor.document.uri.fsPath;

	// Skip appending if the current document is the navigation history file
    if (currentDocumentPath === filePath) {
        return;
    }

    // Append the entry to the NDJSON file
	const ndjsonString = JSON.stringify(entry) + '\n';
    fs.appendFile(filePath, ndjsonString, (err) => {
        if (err) {
            console.error('Error appending navigation entry to file:', err);
            vscode.window.showErrorMessage('Failed to append navigation entry to file.');
        }
    });
}

function deactivate() {
	console.log('Thank you for trying out "codeHistories"!');

	// clear data
	allTerminalsData = new Object();
	allTerminalsDirCount = new Object();
	terminalDimChanged = new Object();
	terminalOpenedFirstTime = new Object();
	previousDocument = null;
}

module.exports = {
	activate,
	deactivate
}