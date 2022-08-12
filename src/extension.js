// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const vscode = require('vscode');
const simpleGit = require('simple-git');
const gitTracker = require('./git-tracker');
const os = require('os');

var tracker = null;
var iter = 0;
var eventData = new Object();
var terminalDimChanged = false;
var terminalOpenedFirstTime = false;

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
	console.log('Congratulations, your extension "codeHistories" is now active!');

	if(process.platform === 'win32'){
		// regex to match windows dir
		var regex_dir = /[\s\S]*:((\\|\/)[a-z0-9\s_@\-^!.#$%&+={}\[\]]+)+[\s\S][\r\n]{1}/gi
		// /[\s\S]*:((\\|\/)[a-z0-9\s_@\-^!.#$%&+={}\[\]]+)+[\s\S]*/gi
		// /[\s\S]*:(\\[a-z0-9\s_@\-^!.#$%&+={}\[\]]+)+>+.*/gi;
		// /^[\s\S]*:(\\[a-z0-9\s_@\-^!.#$%&+={}\[\]]+)+>+.*$/i;
		// /[\s\S]*:((\\|\/)[a-z0-9\s_@\-^!.#$%&+={}\[\]]+)+>{1}/gi;
		// /^[a-zA-Z]:\\[\\\S|*\S]?.*$/g

		var curDir = vscode.workspace.workspaceFolders[0].uri.fsPath;
		// capitalize the first letter of the directory
		curDir = curDir.charAt(0).toUpperCase() + curDir.slice(1);

		simpleGit().clean(simpleGit.CleanOptions.FORCE);

		if(!vscode.workspace.workspaceFolders){
			message = "Working folder not found, please open a folder first." ;
			vscode.window.showErrorMessage(message);
			return;
		}

		var currentDir = vscode.workspace.workspaceFolders[0].uri.fsPath;
		tracker = new gitTracker(currentDir);
		tracker.isGitInitialized();

		var user = os.userInfo().username;
		var hostname = os.hostname();

		// grab the hostname before the first occurence of "."
		if(hostname.indexOf(".") > 0){
			hostname = hostname.substring(0, hostname.indexOf("."));
		}

		// make sure to have Git for Windows installed to use Git Bash as default cmd
		var test_regex_dir = new RegExp(user + "@" + hostname + '[\s\S]*');

		// on did write to terminal
		vscode.window.onDidWriteTerminalData(event => {
			activeTerminal = vscode.window.activeTerminal;
			if (activeTerminal == event.terminal) {
				if(event.terminal.name == "Python"){
					let terminalData = event.data.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');	
					iter += 1;
					eventData[iter] = terminalData;
					if(!terminalDimChanged){
						console.log(eventData);

						if(test_regex_dir.test(eventData[iter].trim())){
							let output = eventData[iter].trim();
							for(let i = iter-1; i > 0; i--){
								let temp = eventData[i];
								if(temp.match(test_regex_dir)){
									break
								}
								output = temp + output;
							}

							if(Object.keys(eventData).length >= 2){
								let secondToLastIndexOfTemp = output.lastIndexOf(user + "@" + hostname, output.lastIndexOf(user + "@" + hostname)-1);
								let temp = output.lastIndexOf(user + "@" + hostname);
								if(secondToLastIndexOfTemp > 0){
									output = output.substring(secondToLastIndexOfTemp, temp-1);
								} else {
									output = output.substring(0, temp-1);
								}

								// console.log(output);
								console.log(output.match(regex_dir));

								if(terminalOpenedFirstTime){
									console.log('ayo')
									if(countOccurrences(output, user + "@" + hostname) == 0){
										output = output.replace(output.match(regex_dir), '');
										output = removeBackspaces(output);
										let updated = tracker.updateOutput(output);	
										if(updated){
											// tracker.checkWebData();
											// console.log(output);
											vscode.window.showInformationMessage('output.txt updated!');
										}
									}
									terminalOpenedFirstTime = false;
								} else {
									console.log('here')
									if(countOccurrences(output, user + "@" + hostname) == 0 && regex_dir.test(output)){
										output = output.replace(output.match(regex_dir), '');
										output = removeBackspaces(output);
										let updated = tracker.updateOutput(output);	
										if(updated){
											// tracker.checkWebData();
											// console.log(output);
											vscode.window.showInformationMessage('output.txt updated!');
										}
									}
								}		
							}

							iter = 0;
							eventData = new Object();
						}
					} else {
						terminalDimChanged = false;
						if(terminalOpenedFirstTime){
							iter = 0;
							eventData = new Object();
						} else {
							eventData[iter] = '';
						}
					}
				}
			}
		});

		vscode.window.onDidChangeTerminalDimensions(event => {
			// console.log(event);
			terminalDimChanged = true;
		});

		vscode.window.onDidOpenTerminal(event => {
			terminalOpenedFirstTime = true;
		});
	}

	if(process.platform === "darwin"){
		simpleGit().clean(simpleGit.CleanOptions.FORCE);

		if(!vscode.workspace.workspaceFolders){
			message = "Working folder not found, please open a folder first." ;
			vscode.window.showErrorMessage(message);
			return;
		}

		var currentDir = vscode.workspace.workspaceFolders[0].uri.fsPath;
		tracker = new gitTracker(currentDir);
		tracker.isGitInitialized();

		var user = os.userInfo().username;
		var hostname = os.hostname();

		// grab the hostname before the first occurence of "."
		if(hostname.indexOf(".") > 0){
			hostname = hostname.substring(0, hostname.indexOf("."));
		}

		// use zsh as default terminal cmd
		var mac_regex_dir = new RegExp(user + "@" + hostname + '[\s\S]*');

		// regex to match mac absolute path
		regex_dir = /((\\|\/)[a-z0-9\s_@\-^!.#$%&+={}\[\]]+)+[\s\S]{1}/gi

		// on did write to terminal
		vscode.window.onDidWriteTerminalData(event => {
			activeTerminal = vscode.window.activeTerminal;
			if (activeTerminal == event.terminal) {
				if(event.terminal.name == "Python"){
					let terminalData = event.data.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');					
					iter += 1;
					eventData[iter] = terminalData;
					if(!terminalDimChanged){
						console.log(eventData);

						if(mac_regex_dir.test(eventData[iter].trim())){
							let output = eventData[iter].trim();
							for(let i = iter-1; i > 0; i--){
								let temp = eventData[i];
								if(temp.match(mac_regex_dir)){
									break
								}
								output = temp + output;
							}

							if(Object.keys(eventData).length >= 2){
								let secondToLastIndexOfTemp = output.lastIndexOf(user + "@" + hostname, output.lastIndexOf(user + "@" + hostname)-1);
								let temp = output.lastIndexOf(user + "@" + hostname);
								if(secondToLastIndexOfTemp > 0){
									output = output.substring(secondToLastIndexOfTemp, temp-1);
								} else {
									output = output.substring(0, temp-1);
								}

								// console.log(output.match(regex_dir));
								// console.log(output);
								
								if(terminalOpenedFirstTime){
									console.log('ayo')
									if(countOccurrences(output, user + "@" + hostname) == 0){
										if(output.match(regex_dir).length > 1){
											let tempIdx = output.lastIndexOf(output.match(regex_dir)[0]);
											let lastIndexOfPercent = output.lastIndexOf("%");
											output = output.substring(tempIdx, lastIndexOfPercent);
											output = output.replace(output.match(regex_dir)[0], '');
										} else {
											output = output.replace(output.match(regex_dir)[0], '');
										}

										output = removeBackspaces(output);
										let updated = tracker.updateOutput(output);	
										if(updated){
											// tracker.checkWebData();
											// console.log(output);
											vscode.window.showInformationMessage('output.txt updated!');
										}
									}
									terminalOpenedFirstTime = false;
								} else {
									console.log('here')
									if(countOccurrences(output, user + "@" + hostname) == 0 && regex_dir.test(output)){
										if(output.match(regex_dir).length > 1){
											let tempIdx = output.lastIndexOf(output.match(regex_dir)[0]);
											let lastIndexOfPercent = output.lastIndexOf("%");
											output = output.substring(tempIdx, lastIndexOfPercent);
											output = output.replace(output.match(regex_dir)[0], '');
										} else {
											output = output.replace(output.match(regex_dir)[0], '');
										}

										output = removeBackspaces(output);
										let updated = tracker.updateOutput(output);	
										if(updated){
											// tracker.checkWebData();
											// console.log(output);
											vscode.window.showInformationMessage('output.txt updated!');
										}
									}
								}		
							}

							iter = 0;
							eventData = new Object();
						}
					} else {
						terminalDimChanged = false;
						if(terminalOpenedFirstTime){
							iter = 0;
							eventData = new Object();
						} else {
							eventData[iter] = '';
						}
					}
				}
			}
		});

		vscode.window.onDidChangeTerminalDimensions(event => {
			// console.log(event);
			terminalDimChanged = true;
		});

		vscode.window.onDidOpenTerminal(event => {
			terminalOpenedFirstTime = true;
		});
	}

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with  registerCommand
	// The commandId parameter must match the command field in package.json
	let disposable = vscode.commands.registerCommand('codeHistories.codeHistories', function () {
		// The code you place here will be executed every time your command is executed
		// Display a message box to the user
		vscode.window.showInformationMessage('Code histories activated!');
	});

	let executeCode = vscode.commands.registerCommand('codeHistories.checkAndCommit', function () {
		// tracker.checkWebData();
		console.log('call checkwebdata');
	});

	context.subscriptions.push(disposable);
	context.subscriptions.push(executeCode);
}

function countOccurrences(string, word) {
	return string.split(word).length - 1;
}

// https://stackoverflow.com/questions/11891653/javascript-concat-string-with-backspace
function removeBackspaces(str) {
    while (str.indexOf("\b") != -1) {
        str = str.replace(/.?\x08/, ""); // 0x08 is the ASCII code for \b
    }
    return str;
}

// this method is called when your extension is deactivated
function deactivate() {
	console.log('Thank you for trying out "codeHistories"!');
}

module.exports = {
	activate,
	deactivate
}
