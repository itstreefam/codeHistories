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

	let disposable = vscode.commands.registerCommand('codeHistories.codeHistories', function () {
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
	});

	let executeCode = vscode.commands.registerCommand('codeHistories.checkAndCommit', function () {
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
	});

	let selectGitRepo = vscode.commands.registerCommand('codeHistories.selectGitRepo', function () {
		if(!tracker){
			vscode.window.showErrorMessage('Code histories is not activated!');
		} else {
			tracker.presentGitRepos();
		}
	});

	let setNewCmd = vscode.commands.registerCommand('codeHistories.setNewCmd', function () {
		vscode.window.showInputBox({
			prompt: "Enter the new command",
			placeHolder: "<command> [args]"
		}).then(newCmd => {
			if(newCmd){
				cmdPrompt = "codehistories " + newCmd;
			}
		});
	});

	context.subscriptions.push(disposable);
	context.subscriptions.push(executeCode);
	context.subscriptions.push(selectGitRepo);
	context.subscriptions.push(setNewCmd);

	let webDevFileExtensions = ['.html', '.htm', '.css', '.scss', '.sass', '.less', '.js', '.jsx', '.mjs', '.json', '.ts', '.yml', '.yaml', '.xml', '.php'];

	const saveDisposable = vscode.workspace.onDidSaveTextDocument((document) => {
		try {
			// get timestamp in seconds
			let timeStamp = Math.floor(Date.now() / 1000);
			timeWebDevFileSaved = timeStamp;

			// console.log(`timestamp of ${document.fileName}: ${timeStamp}`);

			// if document is a web dev file and document is not inside node_modules
			if(!webDevFileExtensions.includes(path.extname(document.fileName)) || document.fileName.includes('node_modules')){
				return;
			}

			// check data of current active terminal
			let activeTerminal = vscode.window.activeTerminal;

			if(!activeTerminal || activeTerminal.name !== terminalName){
				let filePath = document.fileName;
				let fileContent = document.getText();
				tracker.updateWebDevOutput(filePath, timeStamp, fileContent, '');
				tracker.updateDirtyChanges(filePath, timeStamp, fileContent, 'Saved');
				return;
			}

			activeTerminal.processId.then(pid => {
				let matched = allTerminalsData[pid].match(mac_regex_dir) || allTerminalsData[pid].match(returned_mac_regex_dir);

				if(process.platform == 'win32'){
					matched = allTerminalsData[pid].match(win_regex_dir);
				}

				if(process.platform == 'linux'){
					matched = allTerminalsData[pid].match(linux_regex_dir) || allTerminalsData[pid].match(returned_linux_regex_dir);
				}

				// grab the last occurrence of the current directory
				let lastOccurence = allTerminalsData[pid].lastIndexOf(matched[matched.length - 1]);

				// wait for a few seconds to make sure output is most updated
				setTimeout(() => {
					let output = allTerminalsData[pid].substring(lastOccurence);
					console.log('webDevOutput: ', output);

					let filePath = document.fileName;
					let fileContent = document.getText();
					tracker.updateWebDevOutput(filePath, timeStamp, fileContent, output);
					tracker.updateDirtyChanges(filePath, timeStamp, fileContent, 'Saved');
				}, 3000);
			});
		} catch (error) {
			console.error('Error occurred while processing the onDidSaveTextDocument event:', error);
		}
	});

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
	// npm start -- --port 8000| while IFS= read -r line; do echo "[$(date '+%m/%d/%Y, %I:%M:%S %p')] $line"; done | tee -a /home/tri/Desktop/react-app/server2.log
	// python -m http.server 8000 | while IFS= read -r line; do echo "[$(date '+%m/%d/%Y, %I:%M:%S %p')] $line"; done | tee -a /home/tri/Desktop/react-app/server2.log

	// check the interval the user is gone from vs code to visit chrome
	// and if they visit localhost to test their program (require that they do reload the page so that it is recorded as an event in webData)
	try{
		let intervalId;

		const checkAppSwitch = async () => {
			const activeApp = await activeWindow();
			// console.log(activeApp);
		
			if (activeApp && activeApp.owner && activeApp.owner.name) {
				const currentAppName = activeApp.owner.name.toLowerCase();
				// console.log(currentAppName);

				if (previousAppName.includes('code') && currentAppName.includes('chrome')) {
					console.log('Switched to from VS Code to Chrome');
					timeSwitchedToChrome = Math.floor(Date.now() / 1000);
					// console.log('timeSwitchedToChrome: ', timeSwitchedToChrome);

					// Reset the flag when switching to Chrome
					gitActionsPerformed = false;
				} else if (previousAppName.includes('chrome') && currentAppName.includes('code')) {
					console.log('Switched to from Chrome to VS Code');
					timeSwitchedToCode = Math.floor(Date.now() / 1000);

					// Check if git actions have already been performed
					if (!gitActionsPerformed) {
						// search between timeSwitchedToChrome and timeSwitchedToCode in webData
						let webData = fs.readFileSync(path.join(currentDir, 'webData'), 'utf8');
						let webDataArray = JSON.parse(webData);

						let webDataArrayFiltered = webDataArray.filter(obj => obj.time >= timeSwitchedToChrome && obj.time <= timeSwitchedToCode);
						
						if(webDataArrayFiltered.length > 0){
							// check if webDataArrayFiltered contains a visit to localhost or 127.0.0.1
							let webDataArrayFilteredContainsLocalhost = webDataArrayFiltered.filter(obj => obj.curUrl.includes('localhost') || obj.curUrl.includes('127.0.0.1'));
							
							if(webDataArrayFilteredContainsLocalhost.length > 0){
								await tracker.gitAdd();
								await tracker.checkWebData();
								await tracker.gitCommit();
								// let curTime = Math.floor(Date.now() / 1000);
								// console.log('Commit at ', curTime);
								gitActionsPerformed = true;
							}
						}
						// console.log('timeSwitchedToCode: ', timeSwitchedToCode);
						// console.log('webDataArrayFiltered: ', webDataArrayFiltered);
					}
				}

				previousAppName = currentAppName;
			}

			// Set the next interval after processing the current one
			intervalId = setTimeout(checkAppSwitch, 1000);
		};

		// Start the first interval
		intervalId = setTimeout(checkAppSwitch, 1000);
	} catch(err){
		console.log("Error in checking app switch: ", err);
	}

	/*let excludeList = ['node_modules', '.git', '.vscode', '.idea', '.env.development', 'venv', 'output.txt', 'webData', 'webDevOutput.txt', 'dirtyChanges.txt'];
	var dirtyDocumentChanges = new Object();

	const changeDisposable = vscode.workspace.onDidChangeTextDocument((event) => {
		try{
			let filePath = event.document.fileName;
			let timeStamp = Math.floor(Date.now() / 1000);

			// if event.document.fileName is in excludeList
			for(let i = 0; i < excludeList.length; i++){
				if(filePath.includes(excludeList[i])){
					return;	
				}
			}
			
			// Check if the dirtyDocumentChanges object already has an array of changes for this document
			if(!dirtyDocumentChanges.hasOwnProperty(filePath)){
				// If not, create an array of changes for this document
				dirtyDocumentChanges[filePath] = new Object();
				dirtyDocumentChanges[filePath]["timeStamp"] = timeStamp;
				dirtyDocumentChanges[filePath]["changes"] = new Array();
			} else {
				// update the timestamp
				dirtyDocumentChanges[filePath]["timeStamp"] = timeStamp;
			}
		
			// Get the array of changes for this document
			let documentChanges = dirtyDocumentChanges[filePath]["changes"];
		
			// Add the changes from this event to the array of changes for this document
			for(let change of event.contentChanges){
				let dirtyChange = JSON.stringify(change.text);
				documentChanges.push(dirtyChange);
			}
		} catch (error) {
			return;
		}
	});

	// Keep track of the dirty changes every 20 seconds
	// Instead of every time a change is made
	setInterval(() => {
		// Get an array of all currently opened documents in the workspace
		let documents = vscode.workspace.textDocuments;

		// Iterate over the documents array to check if any documents are dirty
		for (let document of documents) {
			if (document.isDirty) {
				let filePath = document.fileName;
				let fileContent = document.getText();
				if(dirtyDocumentChanges[filePath]["changes"].length > 0){
					tracker.updateDirtyChanges(filePath, dirtyDocumentChanges[filePath]["timeStamp"], fileContent, dirtyDocumentChanges[filePath]["changes"]);
					dirtyDocumentChanges[filePath]["changes"] = new Array();
				}
			}
		}
	}, 20000);*/
	
	// Don't forget to dispose the listener when it's no longer needed
	context.subscriptions.push(saveDisposable);
	// context.subscriptions.push(changeDisposable);
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

module.exports = {
	activate,
	deactivate
}
