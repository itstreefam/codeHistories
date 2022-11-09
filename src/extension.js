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
var checkThenCommit = null;
var terminalName = "Code";

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
	console.log('Congratulations, your extension "codeHistories" is now active!');

	// make a regex that match everything between \033]0; and \007
	var very_special_regex = new RegExp("\033]0;(.*)\007", "g");

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
				if(event.terminal.name == terminalName){
					let terminalData = event.data.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
					
					// test if very_special_regex matches
					if(very_special_regex.test(terminalData)){
						// get the matched string
						var matched = terminalData.match(very_special_regex);
						// remove the matched from the terminalData
						terminalData = terminalData.replace(matched, "");
					}
					
					iter += 1;
					eventData[iter] = terminalData;

					if(!terminalDimChanged){
						console.log(eventData);
						console.log('break here before next check');

						if(test_regex_dir.test(eventData[iter].trim())){
							let output = eventData[iter].trim();
							for(let i = iter-1; i > 0; i--){
								let temp = eventData[i];
								if(temp.match(test_regex_dir)){
									break
								}
								output = temp + output;
							}

							console.log(output);
							// console.log(output.lastIndexOf("\/Users\/" + user + '\/') )
							// console.log(output.indexOf(user + "@" + hostname));

							// do not commit source, activate, ]0;MINGW64, etc.
							let avoidInitialTerminalLoad = (output.lastIndexOf("\/Users\/" + user + '\/') >= output.indexOf(user + "@" + hostname));
							if(avoidInitialTerminalLoad){
								// console.log(eventData);
								iter = 0;
								eventData = new Object();
							} else {
								if(Object.keys(eventData).length >= 2){
									// console.log(output);
									let secondToLastIndexOfTemp = output.lastIndexOf(user + "@" + hostname, output.lastIndexOf(user + "@" + hostname)-1);
									let temp = output.lastIndexOf(user + "@" + hostname);
									if(secondToLastIndexOfTemp > 0){
										output = output.substring(secondToLastIndexOfTemp, temp-1);
									} else {
										output = output.substring(0, temp-1);
									}
	
									// console.log(output);
									// console.log(output.match(regex_dir));	

									if(output.length > 1){
										output = output.replaceAll('$', '');
										output = removeBackspaces(output);
										output = output.trim();
										if(checkThenCommit){
											// console.log(output);
											let outputUpdated = tracker.updateOutput(output);	
											console.log('output.txt updated?', outputUpdated);
											if(outputUpdated){
												tracker.checkWebData();
											}
											checkThenCommit = false;
										}
									}

									iter = 0;
									eventData = new Object();
								}
							}
						}
					} else {
						terminalDimChanged = false;
						eventData[iter] = '';
					}
				}
			}
		});

		vscode.window.onDidChangeTerminalDimensions(event => {
			// console.log(event);
			terminalDimChanged = true;
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
				if(event.terminal.name == terminalName){
					let terminalData = event.data.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
					
					// test if very_special_regex matches
					if(very_special_regex.test(terminalData)){
						// get the matched string
						var matched = terminalData.match(very_special_regex);
						// remove the matched from the terminalData
						terminalData = terminalData.replace(matched, "");
					}

					iter += 1;
					eventData[iter] = terminalData;
					if(!terminalDimChanged){
						console.log(eventData);
						console.log('break here before next check');

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

								console.log(output.match(regex_dir));
								console.log(output);
								
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

										// let updated = tracker.updateOutput(output);	
										// if(updated){
										// 	tracker.checkWebData();
										// 	// console.log(output);
										// 	// vscode.window.showInformationMessage('output.txt updated!');
										// }
										if(checkThenCommit){
											// console.log(output);
											let outputUpdated = tracker.updateOutput(output);	
											console.log('output.txt updated?', outputUpdated);
											if(outputUpdated){
												tracker.checkWebData();
											}
											checkThenCommit = false;
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
										// let updated = tracker.updateOutput(output);	
										// if(updated){
										// 	tracker.checkWebData();
										// 	// console.log(output);
										// 	// vscode.window.showInformationMessage('output.txt updated!');
										// }
										if(checkThenCommit){
											// console.log(output);
											let outputUpdated = tracker.updateOutput(output);	
											console.log('output.txt updated?', outputUpdated);
											if(outputUpdated){
												tracker.checkWebData();
											}
											checkThenCommit = false;
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

	if(process.platform === 'linux'){
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

		// linux defaut bash e.g. tri@tri-VirtualBox:~/Desktop/test$
		var linux_regex_dir = new RegExp(user + "@" + hostname + ".*\\${1}", "g");
		// var linux_regex_dir = new RegExp(user + "@" + hostname + '[\s\S]*');

		var globalStr = '';
		var counterMatchedDir = 0;
		
		// on did write to terminal
		vscode.window.onDidWriteTerminalData(event => {
			activeTerminal = vscode.window.activeTerminal;
			if (activeTerminal == event.terminal) {
				if(event.terminal.name == terminalName){
					var terminalData = event.data.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
					
					// test if very_special_regex matches
					if(very_special_regex.test(terminalData)){
						// get the matched string
						var matched = terminalData.match(very_special_regex);
						// remove the matched from the terminalData
						terminalData = terminalData.replace(matched, "");
					}

					// see if terminalData contains linux_regex_dir
					if(linux_regex_dir.test(terminalData)){
						// get the matched string
						var matched = terminalData.match(linux_regex_dir);
						console.log('matched: ', matched);
						
						// add length of matched array to counterMatchedDir
						counterMatchedDir += matched.length;
					}

					iter += 1;
					eventData[iter] = terminalData;

					globalStr += terminalData;

					if(checkThenCommit){
						// combine all the strings in eventData
						// console.log('globalStr: ', globalStr);
						console.log('eventData: ', eventData);
						// console.log('counterMatchedDir: ', counterMatchedDir);

						// if counter is >= 2, then we should have enough information to trim and find the output
						if(counterMatchedDir >= 2){
							// grab everything between second to last occurence of linux_regex_dir and the last occurence of linux_regex_dir
							let secondToLastOccurence = globalStr.lastIndexOf(matched[matched.length - 1], globalStr.lastIndexOf(matched[matched.length - 1]) - 1);
							let lastOccurence = globalStr.lastIndexOf(matched[matched.length - 1]);

							// find the first occurrence of "\r\n" after the second to last occurence of linux_regex_dir
							let firstOccurenceOfNewLine = globalStr.indexOf("\r\n", secondToLastOccurence);

							let output = globalStr.substring(firstOccurenceOfNewLine, lastOccurence);

							// clear residual \033]0; and \007 (ESC]0; and BEL)
							output = output.replace(/\033]0; | \007/g, "");
							output = output.trim();
							console.log('output: ', output);
							
							// reset globalStr to contain only the last line
							globalStr = globalStr.substring(lastOccurence);
							console.log('globalStr: ', globalStr);
							
							
							counterMatchedDir = 1;
							checkThenCommit = false;
							eventData = new Object();
						}
					}
				}
			}
		});

		// vs code onDidCloseTerminal
		vscode.window.onDidCloseTerminal(event => {
			if(event.name == terminalName){
				console.log('closed terminal');
				counterMatchedDir = 0;
				globalStr = '';
				checkThenCommit = false;
				eventData = new Object();
			}
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
		// console.log('call checkwebdata');
		// vscode.commands.executeCommand("workbench.action.terminal.clear");
		checkThenCommit = true;

		// save all files
		vscode.commands.executeCommand("workbench.action.files.saveAll");

		// add all files to git
		tracker.gitAdd();

		if(terminalName == "Python"){
			vscode.commands.executeCommand('python.execInTerminal');
		} else if(terminalName == "Code"){
			vscode.commands.executeCommand('code-runner.run');
		}
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
