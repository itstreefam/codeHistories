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
var allTerminalsData = new Object();
var allTerminalsDirCount = new Object();

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
	console.log('Congratulations, your extension "codeHistories" is now active!');

	// make a regex that match everything between \033]0; and \007
	var very_special_regex = new RegExp("\033]0;(.*)\007", "g");

	if(process.platform === 'win32'){
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
		// var win_regex_dir = new RegExp(user + "@" + hostname + ".*\\){1}", "g");
		var win_regex_dir = new RegExp(user + "@" + hostname + '[\s\S]*');

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
		
		// on did write to terminal
		vscode.window.onDidWriteTerminalData(event => {
			activeTerminal = vscode.window.activeTerminal;
			if (activeTerminal == event.terminal) {
				if(event.terminal.name == terminalName){
					event.terminal.processId.then(pid => {
						var terminalData = event.data.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
						
						// test if very_special_regex matches
						if(very_special_regex.test(terminalData)){
							// get the matched string
							var matched = terminalData.match(very_special_regex);
							// remove the matched from the terminalData
							terminalData = terminalData.replace(matched, "");
						}

						// see if terminalData contains win_regex_dir
						if(win_regex_dir.test(terminalData)){
							terminalData = terminalData.trim();
							// get the matched string
							var matched = terminalData.match(win_regex_dir);
							// console.log('matched: ', matched);
							
							// add length of matched array to counterMatchedDir
							allTerminalsDirCount[pid] += matched.length;
						}

						iter += 1;
						eventData[iter] = terminalData;
						console.log(eventData);

						// allTerminalsData[pid] = globalStr of the terminal instance with pid
						allTerminalsData[pid] += terminalData;

						if(checkThenCommit){
							console.log('There are %s matched regex dir for pid %s', allTerminalsDirCount[pid], pid);

							// if counter is >= 2, then we should have enough information to trim and find the output
							if(allTerminalsDirCount[pid] >= 2){
								// grab everything between second to last occurence of win_regex_dir and the last occurence of win_regex_dir
								let secondToLastOccurence = allTerminalsData[pid].lastIndexOf(matched[matched.length - 1], allTerminalsData[pid].lastIndexOf(matched[matched.length - 1]) - 1);
								let lastOccurence = allTerminalsData[pid].lastIndexOf(matched[matched.length - 1]);

								// find the first occurrence of "\r\n" after the second to last occurence of win_regex_dir
								let firstOccurenceOfNewLine = allTerminalsData[pid].indexOf("\r\n", secondToLastOccurence);

								let output = allTerminalsData[pid].substring(firstOccurenceOfNewLine, lastOccurence);

								// clear consecutive new lines
								output = removeConsecutiveOccurrences(output, "\r\n");

								// remove $ and the first ocurrence of \r\n
								if(/\$.*[\r\n]{1}/g.test(output)){
									// get the matched string
									var matched = output.match(/\$.*[\r\n]{1}/g);
									// remove the matched from the terminalData
									output = output.replace(matched, "");
								}

								output = output.trim();

								// console.log('output: ', output);
								
								let outputUpdated = tracker.updateOutput(output);	
								console.log('output.txt updated?', outputUpdated);

								if(outputUpdated){
									tracker.checkWebData();
								}

								// console.log('globalStr of %s before reset: ', pid, allTerminalsData[pid]);
								
								// reset globalStr of pid to contain only the matched dir string
								allTerminalsData[pid] = allTerminalsData[pid].substring(lastOccurence);
								// console.log('globalStr of %s after reset: ', pid, allTerminalsData[pid]);
								
								allTerminalsDirCount[pid] = 1;
								checkThenCommit = false;
							}
						}
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

		// on did change terminal size
		// vscode.window.onDidChangeTerminalDimensions(event => {
		// 	if(event.terminal.name == terminalName){
		// 		event.terminal.processId.then(pid => {
		// 			allTerminalsData[pid] = matched[matched.length - 1];
		// 			allTerminalsDirCount[pid] = 0;
		// 		});
		// 	}
		// });
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

		// console.log('user: ' + user);
		// console.log('hostname: ' + hostname);

		// use bash as default terminal cmd 
		// pattern hostname:directory_name user$
		// var mac_regex_dir = new RegExp(user + "@" + hostname + '[\s\S]*');
		var mac_regex_dir = new RegExp("(\(.*\))?" + hostname + ".*" + user + "\\${1}", "g");

		var returned_mac_regex_dir = new RegExp("\\r" + "(\(.*\))?" + hostname + ".*" + user + "\\${1}", "g");

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
		
		// on did write to terminal
		vscode.window.onDidWriteTerminalData(event => {
			activeTerminal = vscode.window.activeTerminal;
			if (activeTerminal == event.terminal) {
				if(event.terminal.name == terminalName){
					event.terminal.processId.then(pid => {
						var terminalData = event.data.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
						
						// test if very_special_regex matches
						if(very_special_regex.test(terminalData)){
							// get the matched string
							var matched = terminalData.match(very_special_regex);
							// remove the matched from the terminalData
							terminalData = terminalData.replace(matched, "");
						}

						// see if terminalData contains linux_regex_dir
						if(mac_regex_dir.test(terminalData) && !returned_mac_regex_dir.test(terminalData)){
							// get the matched string
							var matched = terminalData.match(mac_regex_dir);
							// console.log('matched: ', matched);
							
							// add length of matched array to counterMatchedDir
							allTerminalsDirCount[pid] += matched.length;
						}

						// iter += 1;
						// eventData[iter] = terminalData;
						// console.log(eventData);

						// allTerminalsData[pid] = globalStr of the terminal instance with pid
						allTerminalsData[pid] += terminalData;

						if(checkThenCommit){
							console.log('There are %s matched regex dir for pid %s', allTerminalsDirCount[pid], pid);

							// if counter is >= 2, then we should have enough information to trim and find the output
							if(allTerminalsDirCount[pid] >= 2){

								if(returned_mac_regex_dir.test(allTerminalsData[pid])){
									// get matched string with returned_linux_regex_dir (e.g. \rtri@tri-VirtualBox:~/Desktop/test$)
									// happens when the terminal is interacted with without necessarily writing out new data
									let carriage_return_dir = allTerminalsData[pid].match(returned_mac_regex_dir);
									// console.log('carriage_return_dir: ', carriage_return_dir);

									// remove the matched string from allTerminalsData[pid]
									allTerminalsData[pid] = allTerminalsData[pid].replace(carriage_return_dir, "");
								}

								// grab everything between second to last occurence of linux_regex_dir and the last occurence of linux_regex_dir
								let secondToLastOccurence = allTerminalsData[pid].lastIndexOf(matched[matched.length - 1], allTerminalsData[pid].lastIndexOf(matched[matched.length - 1]) - 1);
								let lastOccurence = allTerminalsData[pid].lastIndexOf(matched[matched.length - 1]);

								// find the first occurrence of "\r\n" after the second to last occurence of linux_regex_dir
								let firstOccurenceOfNewLine = allTerminalsData[pid].indexOf("\r\n", secondToLastOccurence);

								let output = allTerminalsData[pid].substring(firstOccurenceOfNewLine, lastOccurence);

								// clear residual \033]0; and \007 (ESC]0; and BEL)
								output = output.replace(/\\033]0; | \\007/g, "");
								output = output.trim();
								
								let outputUpdated = tracker.updateOutput(output);	
								console.log('output.txt updated?', outputUpdated);

								if(outputUpdated){
									tracker.checkWebData();
								}

								// console.log('globalStr of %s before reset: ', pid, allTerminalsData[pid]);
								
								// reset globalStr of pid to contain only the matched dir string
								allTerminalsData[pid] = allTerminalsData[pid].substring(lastOccurence);
								// console.log('globalStr of %s after reset: ', pid, allTerminalsData[pid]);
								
								allTerminalsDirCount[pid] = 1;
								checkThenCommit = false;
							}
						}
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

		var returned_linux_regex_dir = new RegExp("\\r" + user + "@" + hostname + ".*\\${1}", "g");

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
		
		// on did write to terminal
		vscode.window.onDidWriteTerminalData(event => {
			activeTerminal = vscode.window.activeTerminal;
			if (activeTerminal == event.terminal) {
				if(event.terminal.name == terminalName){
					event.terminal.processId.then(pid => {
						var terminalData = event.data.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
						
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
							
							// add length of matched array to counterMatchedDir
							allTerminalsDirCount[pid] += matched.length;
						}

						// allTerminalsData[pid] = globalStr of the terminal instance with pid
						allTerminalsData[pid] += terminalData;

						if(checkThenCommit){
							console.log('There are %s matched regex dir for pid %s', allTerminalsDirCount[pid], pid);

							// if counter is >= 2, then we should have enough information to trim and find the output
							if(allTerminalsDirCount[pid] >= 2){

								if(returned_linux_regex_dir.test(allTerminalsData[pid])){
									// get matched string with returned_linux_regex_dir (e.g. \rtri@tri-VirtualBox:~/Desktop/test$)
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
								let firstOccurenceOfNewLine = allTerminalsData[pid].indexOf("\r\n", secondToLastOccurence);

								let output = allTerminalsData[pid].substring(firstOccurenceOfNewLine, lastOccurence);

								// clear residual \033]0; and \007 (ESC]0; and BEL)
								output = output.replace(/\\033]0; | \\007/g, "");
								output = output.trim();
								
								let outputUpdated = tracker.updateOutput(output);	
								console.log('output.txt updated?', outputUpdated);

								if(outputUpdated){
									tracker.checkWebData();
								}

								// console.log('globalStr of %s before reset: ', pid, allTerminalsData[pid]);
								
								// reset globalStr of pid to contain only the matched dir string
								allTerminalsData[pid] = allTerminalsData[pid].substring(lastOccurence);
								// console.log('globalStr of %s after reset: ', pid, allTerminalsData[pid]);
								
								allTerminalsDirCount[pid] = 1;
								checkThenCommit = false;
							}
						}
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
	});

	let executeCode = vscode.commands.registerCommand('codeHistories.checkAndCommit', function () {
		// save all files
		vscode.commands.executeCommand("workbench.action.files.saveAll").then(() => {
			// add all files to git
			tracker.gitAdd();

			if(terminalName == "Python"){
				vscode.commands.executeCommand('python.execInTerminal');
			} else if(terminalName == "Code"){
				vscode.commands.executeCommand('code-runner.run');
			}

			checkThenCommit = true;
		});
	});

	context.subscriptions.push(disposable);
	context.subscriptions.push(executeCode);
}

function countOccurrences(string, word) {
	return string.split(word).length - 1;
}

function removeConsecutiveOccurrences(string, word) {
	let temp = string.split(word);

	// remove empty strings
	// and recombine the array into a string
	temp = temp.filter(function (el) {
		return el != "";
	}).join(word);

	// return
	return temp;
}

// https://stackoverflow.com/questions/11891653/javascript-concat-string-with-backspace
function removeBackspaces(str) {
    while (str.indexOf("\b") != -1) {
        str = str.replace(/.?\x08/, ""); // 0x08 is the ASCII code for \b
    }
    return str;
}

function deactivate() {
	console.log('Thank you for trying out "codeHistories"!');

	// clear data
	allTerminalsData = new Object();
	allTerminalsDirCount = new Object();
}

module.exports = {
	activate,
	deactivate
}
