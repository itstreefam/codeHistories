// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const vscode = require('vscode');
const simpleGit = require('simple-git');
const gitTracker = require('./git-tracker');
const os = require('os');
const fs = require('fs');
const path = require('path');
const Terminal = require('./terminal');

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
		vscode.window.onDidWriteTerminalData(event => {
			activeTerminal = vscode.window.activeTerminal;
			if (activeTerminal == event.terminal) {
				if(event.terminal.name == terminalName){
					event.terminal.processId.then(pid => {
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
								
								let outputUpdated = tracker.updateOutput(output);	
								console.log('output.txt updated?', outputUpdated);

								if(outputUpdated){
									tracker.gitAddOutput();
									tracker.checkWebData();
								} else {
									// if output.txt is not updated, then we should revert the git add
									tracker.gitReset();
								}

								// console.log('globalStr of %s before reset: ', pid, allTerminalsData[pid]);
								
								// reset globalStr of pid to contain only the matched dir string
								allTerminalsData[pid] = allTerminalsData[pid].substring(lastOccurence);
								// console.log('globalStr of %s after reset: ', pid, allTerminalsData[pid]);
								
								allTerminalsDirCount[pid] = 1;
								checkThenCommit = false;
							}
						// }
					});
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
		vscode.window.onDidWriteTerminalData(event => {
			activeTerminal = vscode.window.activeTerminal;
			if (activeTerminal == event.terminal) {
				if(event.terminal.name == terminalName){
					event.terminal.processId.then(pid => {
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
								
								let outputUpdated = tracker.updateOutput(output);	
								console.log('output.txt updated?', outputUpdated);

								if(outputUpdated){
									tracker.gitAddOutput();
									tracker.checkWebData();
								} else {
									// if output.txt is not updated, then we should revert the git add
									tracker.gitReset();
								}

								// console.log('globalStr of %s before reset: ', pid, allTerminalsData[pid]);
								
								// reset globalStr of pid to contain only the matched dir string
								allTerminalsData[pid] = allTerminalsData[pid].substring(lastOccurence);
								// console.log('globalStr of %s after reset: ', pid, allTerminalsData[pid]);
								
								allTerminalsDirCount[pid] = 1;
								checkThenCommit = false;
							}
						// }
					});
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
		vscode.window.onDidWriteTerminalData(event => {
			activeTerminal = vscode.window.activeTerminal;
			if (activeTerminal == event.terminal) {
				if(event.terminal.name == terminalName){
					event.terminal.processId.then(pid => {
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
								
								let outputUpdated = tracker.updateOutput(output);	
								console.log('output.txt updated?', outputUpdated);

								if(outputUpdated){
									tracker.gitAddOutput();
									tracker.checkWebData();
								} else {
									// if output.txt is not updated, then we should revert the git add
									tracker.gitReset();
								}

								// console.log('globalStr of %s before reset: ', pid, allTerminalsData[pid]);
								
								// reset globalStr of pid to contain only the matched dir string
								allTerminalsData[pid] = allTerminalsData[pid].substring(lastOccurence);
								// console.log('globalStr of %s after reset: ', pid, allTerminalsData[pid]);
								
								allTerminalsDirCount[pid] = 1;
								checkThenCommit = false;
							}
						// }
					});
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

	let webDevFileExtensions = ['.html', '.htm', '.css', '.scss', '.sass', '.less', '.js', '.mjs', '.json', '.ts', '.yml', '.yaml', '.xml'];

	const saveDisposable = vscode.workspace.onDidSaveTextDocument((document) => {
		try {
			// get timestamp in seconds
			let timeStamp = Math.floor(Date.now() / 1000);
			// console.log(`timestamp of ${document.fileName}: ${timeStamp}`);

			// if document is a web dev file and document is not inside node_modules
			if(!webDevFileExtensions.includes(path.extname(document.fileName)) || document.fileName.includes('node_modules')){
				return;
			}

			// look for server.log in the current workspace
			/*let workspacePath = vscode.workspace.workspaceFolders[0].uri.fsPath;
			let serverLogs = findServerLogs(workspacePath, timeStamp);

			setTimeout(() => {
			if (Object.keys(serverLogs).length > 1) {
				// get content of all server.log files
				let serverLogsContent = new Array();
				for (let key of Object.keys(serverLogs)) {
					let content = fs.readFileSync(key, 'utf8');
					serverLogsContent.push(content);
				}
				// combine all server.log files
				let combinedServerLogs = serverLogsContent.join('\n## end of a log ##\n');
				let filePath = document.fileName;
				let fileContent = document.getText();
				tracker.updateWebDevOutput(filePath, timeStamp, fileContent, combinedServerLogs);
				console.log('combined server logs', serverLogs);
			} else if (fs.existsSync(Object.keys(serverLogs)[0])) {
				// read server.log
				let output = fs.readFileSync(Object.keys(serverLogs)[0], 'utf8');
				let filePath = document.fileName;
				let fileContent = document.getText();
				tracker.updateWebDevOutput(filePath, timeStamp, fileContent, output);
				console.log('single server log', serverLogs);
			} else {
				// if server.log does not exist
				let filePath = document.fileName;
				let fileContent = document.getText();
				tracker.updateWebDevOutput(filePath, timeStamp, fileContent, '');
				console.log('no server log');
			}
			}, 3000);*/

			// check data of current active terminal
			let activeTerminal = vscode.window.activeTerminal;
			if(activeTerminal){
				if(activeTerminal.name == terminalName){
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
							// console.log('webDevOutput: ', output);

							let filePath = document.fileName;
							let fileContent = document.getText();
							tracker.updateWebDevOutput(filePath, timeStamp, fileContent, output);
						}, 3000);
					});
				} else {
					let filePath = document.fileName;
					let fileContent = document.getText();
					tracker.updateWebDevOutput(filePath, timeStamp, fileContent, '');
				}
			}
		} catch (error) {
			console.error('Error occurred while processing the onDidSaveTextDocument event:', error);
		}
	});
	
	// Don't forget to dispose the listener when it's no longer needed
	context.subscriptions.push(saveDisposable);
}

function removeBackspaces(str) {
	var pattern = /[\u0000]|[\u0001]|[\u0002]|[\u0003]|[\u0004]|[\u0005]|[\u0006]|[\u0007]|[\u0008]|[\u000b]|[\u000c]|[\u000d]|[\u000e]|[\u000f]|[\u0010]|[\u0011]|[\u0012]|[\u0013]|[\u0014]|[\u0015]|[\u0016]|[\u0017]|[\u0018]|[\u0019]|[\u001a]|[\u001b]|[\u001c]|[\u001d]|[\u001e]|[\u001f]|[\u001c]|[\u007f]|[\u0040]/gm;
    while (str.indexOf("\b") != -1) {
        str = str.replace(/.?\x08/, ""); // 0x08 is the ASCII code for \b
    }
	str = str.replace(pattern, "");	
	return str;
}

function findServerLogs(dir, timeStamp) {
	try{
		let logs = {};
		const files = fs.readdirSync(dir);
	
		for (const file of files) {
			const filePath = path.join(dir, file);
			const stat = fs.statSync(filePath);
		
			if (stat.isDirectory() && file !== 'node_modules') {
				Object.assign(logs, findServerLogs(filePath, timeStamp));
			} else if (file === 'server.log') {
				let modifiedTime = stat.mtime.getTime() / 1000;
				// console.log(`modified time of ${filePath}: ${modifiedTime}`);
				if (modifiedTime >= timeStamp - 5 && modifiedTime <= timeStamp + 5) {
					// console.log(`found server.log: ${filePath}`);
					logs[filePath] = modifiedTime;
				}
			}
		}
	
		return logs;
	} catch (error) {
		return {};
	}
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
