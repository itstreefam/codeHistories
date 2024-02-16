// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const vscode = require('vscode');
const gitTracker = require('./git-tracker');
const os = require('os');
const fs = require('fs');
const path = require('path');
const Terminal = require('./terminal');
const activeWindow = require('active-win');

var tracker = null;
var iter = 0;
var eventData = new Object();
var terminalDimChanged = new Object();
var terminalOpenedFirstTime = new Object();
var terminalName = "bash";
var allTerminalsData = new Object();
var allTerminalsDirCount = new Object();
var cmdPrompt = `source .bash_profile`;
var previousAppName = '';
var timeSwitchedToChrome = 0;
var timeSwitchedToCode = 0;
var gitActionsPerformed = false;
var extensionActivated = false;
// make a regex that match everything between \033]0; and \007
var very_special_regex = new RegExp("\\033]0;(.*)\\007", "g");
let previousDocument = null;
let navigationHistory = [];
var user;
var hostname;
var currentDir;
const debounceTimers = new Map(); // For debouncing per document

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
	console.log('Congratulations, your extension "codeHistories" is now active!');

	if(!vscode.workspace.workspaceFolders){
		var message = "Working folder not found, please open a folder first." ;
		vscode.window.showErrorMessage(message);
		return;
	}

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

	// check git init status
	currentDir = vscode.workspace.workspaceFolders[0].uri.fsPath;
	tracker = new gitTracker(currentDir);
	tracker.createGitFolders();

	// get user and hostname for regex matching
	user = os.userInfo().username;
	hostname = os.hostname();
	if(hostname.indexOf(".") > 0){
		hostname = hostname.substring(0, hostname.indexOf("."));
	}

	// check if current terminals have more than one terminal instance where name is terminalName
	var terminalList = vscode.window.terminals;
	var terminalInstance = 0;
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
		// e.g. tri@DESKTOP-XXXXXXX MINGW64 ~/Desktop/test-folder (master)
		var win_regex_dir = new RegExp(user + "@" + hostname + "(\(.*\))?", "g");
		
		// on did write to terminal
		vscode.window.onDidWriteTerminalData(async event => {
			if(event.terminal.name !== terminalName) return;

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
			if(event.name == terminalName){
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
			if(event.name == terminalName){
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
			if(event.terminal.name == terminalName){
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
		unixLikeTerminalProcess(linux_regex_dir);
	}

	let activateCodeHistories = vscode.commands.registerCommand('codeHistories.codeHistories', function () {
		vscode.window.showInformationMessage('Code histories activated!');

		// clear data
		allTerminalsData = new Object();
		allTerminalsDirCount = new Object();

		// make a folder .vscode in the current workspace
		let workspacePath = vscode.workspace.workspaceFolders[0].uri.fsPath;
		let vscodePath = path.join(workspacePath, ".vscode");
		let settingsPath = path.join(vscodePath, "settings.json");
		let settings = JSON.stringify({
			"terminal.integrated.defaultProfile.windows": "Git Bash",
			"terminal.integrated.defaultProfile.osx": "bash",
			"terminal.integrated.defaultProfile.linux": "bash",
			"terminal.integrated.shellIntegration.enabled": false,
			"python.terminal.activateEnvironment": false
		}, null, 4);

		if(!fs.existsSync(vscodePath)){
			fs.mkdirSync(vscodePath);
			fs.writeFileSync(settingsPath, settings);
		}

		// make .bash_profile in the current workspace
		let bashProfilePath = path.join(workspacePath, ".bash_profile");
		let bashProfileContent = `
codehistories() {
	if [ "$#" -eq 0 ]; then
		echo "Usage: codehistories <command> [args]"
		return
	fi
	cmd="$*"
	
	# Get current date and time in the format [M/D/YYYY, HH:MM:SS AM/PM]
	timestamp=$(date +"[%-m/%-d/%Y, %I:%M:%S %p]")
	
	# Print a newline and the timestamp to output.txt
	echo -e "\nExecution Time: $timestamp" | tee -a output.txt
	
	# Execute the command and append the output
	eval "$cmd" 2>&1 | tee -a output.txt
}`;

		if(!fs.existsSync(bashProfilePath)){
			fs.writeFileSync(bashProfilePath, bashProfileContent);
		}

		// Store a flag in the extension context to indicate activation
		extensionActivated = true;
	});

	let executeCode = vscode.commands.registerCommand('codeHistories.checkAndCommit', function () {
		if(!extensionActivated){
			vscode.window.showErrorMessage('Code histories not activated. Ctrl(or Cmd)+Shift+P -> Code Histories');
		} else {
			// save all files
			vscode.commands.executeCommand("workbench.action.files.saveAll").then(() => {
				// add all files to git
				tracker.gitAdd();

				if(terminalName == "bash"){
					// get all existing terminal instances
					var terminals = vscode.window.terminals;

					// check if there are any existing terminals with the desired name
					var existingTerminal = terminals.find(t => t.name === "bash");

					// create a new terminal instance only if there are no existing terminals with the desired name
					if (!existingTerminal) {
						// create a new terminal instance with name terminalName
						var codeHistoriesTerminal = new Terminal(terminalName, currentDir);
						codeHistoriesTerminal.checkBashProfilePath();
						codeHistoriesTerminal.show();
						codeHistoriesTerminal.sendText(`source .bash_profile`);
					} else {
						existingTerminal.show();
						existingTerminal.sendText(cmdPrompt);
					}
				}

				checkThenCommit = true;
			});
		}
	});

	let selectGitRepo = vscode.commands.registerCommand('codeHistories.selectGitRepo', function () {
		if(!extensionActivated){
			vscode.window.showErrorMessage('Code histories not activated. Ctrl(or Cmd)+Shift+P -> Code Histories');
		} else {
			tracker.presentGitRepos();
		}
	});

	let setNewCmd = vscode.commands.registerCommand('codeHistories.setNewCmd', function () {
		if(!extensionActivated){
			vscode.window.showErrorMessage('Code histories not activated. Ctrl(or Cmd)+Shift+P -> Code Histories');
		} else {
			vscode.window.showInputBox({
				prompt: "Enter the new command",
				placeHolder: "<command> [args]"
			}).then(newCmd => {
				if(newCmd){
					cmdPrompt = "codehistories " + newCmd;
				}
			});
		}
	});

	let undoCommit = vscode.commands.registerCommand('codeHistories.undoCommit', function () {
		if (!extensionActivated) {
			vscode.window.showErrorMessage('Code histories not activated. Ctrl(or Cmd)+Shift+P -> Code Histories');
		} else {
			if(!tracker){
				vscode.window.showErrorMessage('Code histories not activated. Ctrl(or Cmd)+Shift+P -> Code Histories');
			} else {
				tracker.undoCommit();
			}
		}
	});

	let enterGoal = vscode.commands.registerCommand('codeHistories.enterGoal', async () => {
		const goal = await vscode.window.showInputBox({
						placeHolder: 'Enter your goal or subgoal',
						prompt: 'Please enter the text for your goal or subgoal',
					});
		
		if(goal){
			// Write the goal to a file
			let timestamp = new Date().toLocaleString();
			// check if the file exists
			if (fs.existsSync(path.join(currentDir, 'goals.txt'))) {
				// if it exists, append to it
				fs.appendFileSync(path.join(currentDir, 'goals.txt'), '\n' + timestamp + '\n' + goal + '\n');
			} else {
				// if it doesn't exist, create it
				fs.writeFileSync(path.join(currentDir, 'goals.txt'), timestamp + '\n' + goal + '\n');
			}
		}
	});

	let quickAutoCommit = vscode.commands.registerCommand('codeHistories.quickAutoCommit', async () => {
		if (!extensionActivated) {
			vscode.window.showErrorMessage('Code histories not activated. Ctrl(or Cmd)+Shift+P -> Code Histories');
		} else {
			await tracker.gitAdd();
			await tracker.checkWebData();
			await tracker.gitCommit();	
		}
	});

	context.subscriptions.push(activateCodeHistories);
	context.subscriptions.push(executeCode);
	context.subscriptions.push(selectGitRepo);
	context.subscriptions.push(setNewCmd);
	context.subscriptions.push(undoCommit);
	context.subscriptions.push(enterGoal);
	context.subscriptions.push(quickAutoCommit);

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
				let webDataArrayFilteredContainsLocalhost = webDataArrayFiltered.filter(obj => obj.curUrl.includes('localhost') || obj.curUrl.includes('127.0.0.1'));
				
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

function removeBackspaces(str) {
	var pattern = /[\u0000]|[\u0001]|[\u0002]|[\u0003]|[\u0004]|[\u0005]|[\u0006]|[\u0007]|[\u0008]|[\u000b]|[\u000c]|[\u000d]|[\u000e]|[\u000f]|[\u0010]|[\u0011]|[\u0012]|[\u0013]|[\u0014]|[\u0015]|[\u0016]|[\u0017]|[\u0018]|[\u0019]|[\u001a]|[\u001b]|[\u001c]|[\u001d]|[\u001e]|[\u001f]|[\u001c]|[\u007f]|[\u0040]/gm;
    while (str.indexOf("\b") != -1) {
        str = str.replace(/.?\x08/, ""); // 0x08 is the ASCII code for \b
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
        // Extract the first and last line of the range
        const firstLine = document.lineAt(range.start.line).text;
        const lastLine = document.lineAt(range.end.line).text;
		let documentPath = document.uri.fsPath;

		// trim the user and hostname from the document
		if(user && hostname){
			let userRegex = new RegExp("\\b" + user + "\\b", "g");
			let hostnameRegex = new RegExp("\\b" + hostname + "\\b", "g");
			documentPath = document.uri.fsPath.replace(userRegex, "user").replace(hostnameRegex, "hostname");
		}
		const entry = {
			firstLine: firstLine,
			lastLine: lastLine,
			range: [range.start.line+1, range.end.line+1],
			document: documentPath,
			timestamp: new Date().toISOString(),
		}

		// Optionally, append the entry to a file
		appendNavigationEntryToFile(entry, editor);

		return entry;
	});

    // Store each visible range change in navigation history
    navigationHistory.push(...visibleRangesInfo);
    console.log('Navigation History Updated:', navigationHistory);
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
        const currentDocument = editor.document.uri.fsPath;
        if (previousDocument && currentDocument !== previousDocument) {
			// Store the navigation history entry for the document switch
			let entry = {
				document: currentDocument,
				prevDocument: previousDocument,
				timestamp: new Date().toISOString(),
				transition: true, // Indicates this record is about transitioning between documents
			};

			// Store the entry in the navigation history
			navigationHistory.push(entry);

			// Optionally, append the entry to a file
			appendNavigationEntryToFile(entry, editor);

			console.log('Navigation History Updated:', navigationHistory);
        }
        previousDocument = currentDocument; // Update for future comparisons
    }
	updateVisibleEditors();
}

function appendNavigationEntryToFile(entry, editor) {
    const filePath = path.join(currentDir, 'CH_navigationHistory');
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
        } else {
            console.log(`Navigation entry successfully appended to ${filePath}`);
            // Optionally, show a confirmation message or log this action silently
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