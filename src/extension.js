// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const vscode = require('vscode');
const simpleGit = require('simple-git');
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
var checkThenCommit = null;
var terminalName = "Code Histories";
var allTerminalsData = new Object();
var allTerminalsDirCount = new Object();
var cmdPrompt = `source ~/.bash_profile`;
var previousAppName = '';
var timeSwitchedToChrome = 0;
var timeSwitchedToCode = 0;
var gitActionsPerformed = false;
var extensionActivated = false;
var rationaleInfoRequest = false;

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
	console.log('Congratulations, your extension "codeHistories" is now active!');

	if(!vscode.workspace.workspaceFolders){
		message = "Working folder not found, please open a folder first." ;
		vscode.window.showErrorMessage(message);
		return;
	}

	// check git init status
	// simpleGit().clean(simpleGit.CleanOptions.FORCE);
	var currentDir = vscode.workspace.workspaceFolders[0].uri.fsPath;
	tracker = new gitTracker(currentDir);
	tracker.createGitFolders();

	// get user and hostname for regex matching
	var user = os.userInfo().username;
	var hostname = os.hostname();
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

	// make a regex that match everything between \033]0; and \007
	var very_special_regex = new RegExp("\033]0;(.*)\007", "g");

	if(process.platform === 'win32'){
		// make sure to have Git for Windows installed to use Git Bash as default cmd
		// e.g. tri@DESKTOP-XXXXXXX MINGW64 ~/Desktop/test-folder (master)
		var win_regex_dir = new RegExp(user + "@" + hostname + "(\(.*\))?", "g");
		
		// on did write to terminal
		vscode.window.onDidWriteTerminalData(async event => {
			activeTerminal = vscode.window.activeTerminal;
			if (activeTerminal == event.terminal) {
				if(event.terminal.name == terminalName){
					const pid = await event.terminal.processId;
					
					var terminalData = event.data.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
					// console.log('terminalData: ', terminalData);

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

					// if(checkThenCommit){
						console.log('There are %s matched regex dir for pid %s', allTerminalsDirCount[pid], pid);

						// if counter is >= 2, then we should have enough information to trim and find the output
						if(allTerminalsDirCount[pid] >= 2){
							// grab everything between second to last occurence of win_regex_dir and the last occurence of win_regex_dir
							let secondToLastOccurence = allTerminalsData[pid].lastIndexOf(matched[matched.length - 1], allTerminalsData[pid].lastIndexOf(matched[matched.length - 1]) - 1);
							let lastOccurence = allTerminalsData[pid].lastIndexOf(matched[matched.length - 1]);

							// find the first occurrence of "\r\n" after the second to last occurence of win_regex_dir
							// let firstOccurenceOfNewLine = allTerminalsData[pid].indexOf("\r\n", secondToLastOccurence);

							let output = allTerminalsData[pid].substring(secondToLastOccurence, lastOccurence);

							output = output.trim();
							output = removeBackspaces(output);

							// console.log('output: ', output);
							
							try{
								await tracker.gitAdd();
								
								let outputUpdated = await tracker.updateOutput(output);	
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
					// }
					
				}
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

		// \rhostname:directory_name user$
		var returned_mac_regex_dir = new RegExp("\\r" + "(\(.*\))?" + hostname + ".*" + user + "\\${1}", "g");
		
		// on did write to terminal
		vscode.window.onDidWriteTerminalData(async event => {
			activeTerminal = vscode.window.activeTerminal;
			if (activeTerminal == event.terminal) {
				if(event.terminal.name == terminalName){
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

					// see if terminalData contains mac_regex_dir
					if(mac_regex_dir.test(terminalData) && !returned_mac_regex_dir.test(terminalData)){
						// get the matched string
						var matched = terminalData.match(mac_regex_dir);
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

					// if(checkThenCommit){
						console.log('There are %s matched regex dir for pid %s', allTerminalsDirCount[pid], pid);

						// if counter is >= 2, then we should have enough information to trim and find the output
						if(allTerminalsDirCount[pid] >= 2){

							if(returned_mac_regex_dir.test(allTerminalsData[pid])){
								// happens when the terminal is interacted with without necessarily writing out new data
								let carriage_return_dir = allTerminalsData[pid].match(returned_mac_regex_dir);
								// console.log('carriage_return_dir: ', carriage_return_dir);

								// remove the matched string from allTerminalsData[pid]
								allTerminalsData[pid] = allTerminalsData[pid].replace(carriage_return_dir, "");
							}

							// grab everything between second to last occurence of mac_regex_dir and the last occurence of mac_regex_dir
							let secondToLastOccurence = allTerminalsData[pid].lastIndexOf(matched[matched.length - 1], allTerminalsData[pid].lastIndexOf(matched[matched.length - 1]) - 1);
							let lastOccurence = allTerminalsData[pid].lastIndexOf(matched[matched.length - 1]);

							// find the first occurrence of "\r\n" after the second to last occurence of mac_regex_dir
							// let firstOccurenceOfNewLine = allTerminalsData[pid].indexOf("\r\n", secondToLastOccurence);

							let output = allTerminalsData[pid].substring(secondToLastOccurence, lastOccurence);

							// clear residual \033]0; and \007 (ESC]0; and BEL)
							output = output.replace(/\\033]0; | \\007/g, "");
							output = output.trim();
							output = removeBackspaces(output);
					
							// console.log('output: ', output);
							
							try{
								await tracker.gitAdd();
								
								let outputUpdated = await tracker.updateOutput(output);	
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
					// }
					
				}
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

	if(process.platform === 'linux'){
		// linux defaut bash e.g. tri@tri-VirtualBox:~/Desktop/test$
		var linux_regex_dir = new RegExp("(\(.*\))?" + user + "@" + hostname + ".*\\${1}", "g");
		
		// \rtri@tri-VirtualBox:~/Desktop/test$
		var returned_linux_regex_dir = new RegExp("\\r" + "(\(.*\))?" + user + "@" + hostname + ".*\\${1}", "g");
		
		// on did write to terminal
		vscode.window.onDidWriteTerminalData(async event => {
			activeTerminal = vscode.window.activeTerminal;
			if (activeTerminal == event.terminal) {
				if(event.terminal.name == terminalName){
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

					// see if terminalData contains linux_regex_dir
					if(linux_regex_dir.test(terminalData) && !returned_linux_regex_dir.test(terminalData)){
						// get the matched string
						var matched = terminalData.match(linux_regex_dir);
						// console.log('matched: ', matched);
						
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
					// console.log('globalStr of %s: ', pid, allTerminalsData[pid]);

					// if(checkThenCommit){
						console.log('There are %s matched regex dir for pid %s', allTerminalsDirCount[pid], pid);

						// if counter is >= 2, then we should have enough information to trim and find the output
						if(allTerminalsDirCount[pid] >= 2){

							if(returned_linux_regex_dir.test(allTerminalsData[pid])){
								// happens when the terminal is interacted with without necessarily writing out new data
								let carriage_return_dir = allTerminalsData[pid].match(returned_linux_regex_dir);
								// console.log('carriage_return_dir: ', carriage_return_dir);

								// remove the matched string from allTerminalsData[pid]
								allTerminalsData[pid] = allTerminalsData[pid].replace(carriage_return_dir, "");
							}

							// grab everything between second to last occurence of linux_regex_dir and the last occurence of linux_regex_dir
							let secondToLastOccurence = allTerminalsData[pid].lastIndexOf(matched[matched.length - 1], allTerminalsData[pid].lastIndexOf(matched[matched.length - 1]) - 1);
							let lastOccurence = allTerminalsData[pid].lastIndexOf(matched[matched.length - 1]);

							// find the first occurrence of "\r\n" after the second to last occurence of linux_regex_dir
							// let firstOccurenceOfNewLine = allTerminalsData[pid].indexOf("\r\n", secondToLastOccurence);

							let output = allTerminalsData[pid].substring(secondToLastOccurence, lastOccurence);

							// clear residual \033]0; and \007 (ESC]0; and BEL)
							output = output.replace(/\\033]0; | \\007/g, "");
							output = output.trim();
							output = removeBackspaces(output);

							// console.log('output: ', output);

							try{
								await tracker.gitAdd();
								
								let outputUpdated = await tracker.updateOutput(output);	
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
					// }

				}
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
			"terminal.integrated.profiles.windows": {
				"Git Bash": {
					"source": "Git Bash"
				}
			},
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

		// make a file .env.development in the current workspace
		let envPath = path.join(workspacePath, ".env.development");
		// add BROWSER=chrome to .env.development
		if(!fs.existsSync(envPath)){
			fs.writeFileSync(envPath, "BROWSER=chrome");
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

				if(terminalName == "Code Histories"){
					// get all existing terminal instances
					var terminals = vscode.window.terminals;

					// check if there are any existing terminals with the desired name
					var existingTerminal = terminals.find(t => t.name === 'Code Histories');

					// create a new terminal instance only if there are no existing terminals with the desired name
					if (!existingTerminal) {
						// create a new terminal instance with name terminalName
						var codeHistoriesTerminal = new Terminal(terminalName, currentDir);
						codeHistoriesTerminal.checkBashProfilePath();
						codeHistoriesTerminal.show();
						codeHistoriesTerminal.sendText(`source ~/.bash_profile`);
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
			if(!tracker){
				vscode.window.showErrorMessage('Code histories not activated. Ctrl(or Cmd)+Shift+P -> Code Histories');
			} else {
				tracker.presentGitRepos();
			}
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

	context.subscriptions.push(activateCodeHistories);
	context.subscriptions.push(executeCode);
	context.subscriptions.push(selectGitRepo);
	context.subscriptions.push(setNewCmd);
	context.subscriptions.push(undoCommit);

	// codehistories npm start | while IFS= read -r line; do echo "[$(date '+%m/%d/%Y, %I:%M:%S %p')] $line"; done | tee -a server.log
	// this command will run npm start and pipe the output to a file server.log in user's working project directory (.e.g. /home/tri/Desktop/react-app)
	/* E.g. 
		[05/23/2023, 01:32:29 PM]
		[05/23/2023, 01:32:29 PM] > my-app@0.1.0 start
		[05/23/2023, 01:32:29 PM] > react-scripts start
		[05/23/2023, 01:32:29 PM]
		...
		[05/23/2023, 01:32:31 PM] Compiled successfully!
	*/

	// if user also has another server running, we can have a separate external terminal which runs that server and pipe the output to a file server2.log in user's working project directory
	// npm start -- --port 3000| while IFS= read -r line; do echo "[$(date '+%m/%d/%Y, %I:%M:%S %p')] $line"; done | tee -a /home/tri/Desktop/react-app/server2.log
	// python -u -m http.server 8000 2>&1 | tee >(awk '{ print $0; fflush(); }' >> server2.log)

	// check the interval the user is gone from vs code to visit chrome
	// and if they visit localhost to test their program (require that they do reload the page so that it is recorded as an event in webData)

	var intervalId;

	const checkAppSwitch = async () => {
		try {
		const activeApp = await activeWindow();
		// console.log(activeApp);
	
		if (activeApp && activeApp.owner && activeApp.owner.name) {
			const currentAppName = activeApp.owner.name.toLowerCase();
			console.log(currentAppName);

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
				// await tracker.gitCommit();
				let currentTime = Math.floor(Date.now() / 1000);
				console.log('currentTime: ', currentTime);
			}
		}
		} catch (error) {
			console.log('Error performing Git actions:', error);
		}
	};

	// Start the first interval
	intervalId = setTimeout(checkAppSwitch, 500);

	let rationaleInfo = vscode.commands.registerCommand('codeHistories.rationaleInfo', function () {
		const panel = vscode.window.createWebviewPanel(
			'rationaleInfo',
			'Rationale Description',
			vscode.ViewColumn.One,
			{
				enableScripts: true
			}
		);

		panel.webview.html = getWebviewContent();

		let savedRationaleInfo = '';

		// Handle messages from the webview
		panel.webview.onDidReceiveMessage(
			message => {
				switch (message.command) {
					case 'saveRationaleInfo':
						savedRationaleInfo = message.text;
						// console.log('savedRationaleInfo: ', savedRationaleInfo);

						// Write the rationale info to a file
						let timestamp = new Date().toLocaleString();
						// check if the file exists
						if (fs.existsSync(path.join(currentDir, 'rationaleInfo.txt'))) {
							// if it exists, append to it
							fs.appendFileSync(path.join(currentDir, 'rationaleInfo.txt'), '\n' + timestamp + '\n' + savedRationaleInfo + '\n');
						} else {
							// if it doesn't exist, create it
							fs.writeFileSync(path.join(currentDir, 'rationaleInfo.txt'), timestamp + '\n' + savedRationaleInfo + '\n');
						}
						return;
					case 'noRationaleInfo':
						vscode.window.showWarningMessage('Please enter some text in the rationale description box.');
						return;
				}
			},
			undefined,
			context.subscriptions
		);

		panel.onDidDispose(
			() => {
				rationaleInfoRequest = false;
			},
			null,
			context.subscriptions
		);
	});

	context.subscriptions.push(rationaleInfo);

	// trigger rationaleInfo every 15 minutes
	setInterval(() => {
		if(!rationaleInfoRequest){
			rationaleInfoRequest = true;
			vscode.commands.executeCommand('codeHistories.rationaleInfo');
		}
	}, 900000);

}

function removeBackspaces(str) {
	var pattern = /[\u0000]|[\u0001]|[\u0002]|[\u0003]|[\u0004]|[\u0005]|[\u0006]|[\u0007]|[\u0008]|[\u000b]|[\u000c]|[\u000d]|[\u000e]|[\u000f]|[\u0010]|[\u0011]|[\u0012]|[\u0013]|[\u0014]|[\u0015]|[\u0016]|[\u0017]|[\u0018]|[\u0019]|[\u001a]|[\u001b]|[\u001c]|[\u001d]|[\u001e]|[\u001f]|[\u001c]|[\u007f]|[\u0040]/gm;
    while (str.indexOf("\b") != -1) {
        str = str.replace(/.?\x08/, ""); // 0x08 is the ASCII code for \b
    }
	str = str.replace(pattern, "");	
	return str;
}

function deactivate() {
	console.log('Thank you for trying out "codeHistories"!');

	// clear data
	allTerminalsData = new Object();
	allTerminalsDirCount = new Object();
	terminalDimChanged = new Object();
	terminalOpenedFirstTime = new Object();
}

function getWebviewContent() {
	return `<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<title>Cat Coding</title>
				<style>
					textarea {
						width: 100%;
						height: 200px;
						resize: vertical;
						font-family: Arial, sans-serif;
						font-size: 14px;
						line-height: 1.5;
					}

					#submitButton {
						background-color: #4CAF50;
						color: white;
						padding: 12px 20px;
						border: none;
						border-radius: 4px;
						cursor: pointer;
					}

					#submitButton:hover {
						background-color: #45a049;
					}

					#clearButton {
						background-color: #f44336;
						color: white;
						padding: 12px 20px;
						border: none;
						border-radius: 4px;
						cursor: pointer;
					}

					#clearButton:hover {
						background-color: #da190b;
					}

				</style>
			</head>
			<body align="center">
				<form>
					<h1>Briefly enter what you have been working on in the last 15 minutes:</h1>
					<br>
					<textarea id="inputTextarea"></textarea>
					<br>
					<button id="submitButton">Submit</button>
					<button id="clearButton">Clear</button>
				</form>

				<script>
					const vscode = acquireVsCodeApi();
					const textarea = document.getElementById('inputTextarea');

					// Check if we have an old state to restore from
					const previousState = vscode.getState();
					const inputValue = previousState ? previousState.inputValue : '';
					textarea.value = inputValue;

					const submitButton = document.getElementById('submitButton');
					submitButton.addEventListener('click', function(event){
						event.preventDefault();
						const inputValue = textarea.value;

						if (inputValue === '') {
							vscode.postMessage({ command: 'noRationaleInfo' });
							return;
						}

						const description = {
							command: 'saveRationaleInfo',
							text: inputValue
						}

						vscode.postMessage(description);
					});

					const clearButton = document.getElementById('clearButton');
					clearButton.addEventListener('click', function(event){
						event.preventDefault();
						textarea.value = '';
						vscode.setState({ inputValue: '' });
					});

					// Update the saved state when the textarea input changes
					textarea.addEventListener('input', () => {
						const inputValue = textarea.value;
						vscode.setState({ inputValue });
					});
				</script>

			</body>
			</html>`;
}

module.exports = {
	activate,
	deactivate
}
