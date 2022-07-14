// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const vscode = require('vscode');
const simpleGit = require('simple-git');
const gitTracker = require('./git-tracker');
const os = require('os');

var tracker = null;
var iter = 0;
var eventData = new Object();
var globalStr = "";
var terminalDimChanged = false;

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {

	// https://stackoverflow.com/questions/13697500/character-limit-of-a-javascript-string-variable
	for (var startPow2 = 1; startPow2 < 9007199254740992; startPow2 *= 2) {
		try {" ".repeat(startPow2);} catch(e) {
			break;
		}
	}

	var floor = Math.floor, mask = floor(startPow2 / 2);
	while (startPow2 = floor(startPow2 / 2)) {
		try {
			" ".repeat(mask + startPow2);
			mask += startPow2; // the previous statement succeeded
		} catch(e) {}
	}

	var maxStrLength = mask;

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "codeHistories" is now active!');

	if(process.platform === 'win32'){
		// regex to match windows dir
		var regex_dir = /[\s\S]*:(\\[a-z0-9\s_@\-^!.#$%&+={}\[\]]+)+>+.*/gi;
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

		var repeatedDir = currentDir.charAt(0).toUpperCase() + currentDir.slice(1);
		// grab "C:\\Users\\username\\"
		repeatedDir = repeatedDir.split('\\')[0] + "\\" + repeatedDir.split('\\')[1] + "\\" + repeatedDir.split('\\')[2] + "\\";

		// on did write to terminal
		vscode.window.onDidWriteTerminalData(event => {
			activeTerminal = vscode.window.activeTerminal;
			if (activeTerminal == event.terminal) {
				if(event.terminal.name == "Python"){
					if(!terminalDimChanged){
						let terminalData = event.data.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
						if(!terminalData.includes("Windows PowerShell")){
							iter += 1;
							eventData[iter] = terminalData;

							if(eventData[1].includes(repeatedDir)){
								if(!globalStr.includes(repeatedDir)){
									globalStr = globalStr + eventData[1];
								} else {
									if(Object.keys(eventData).length > 1){
										if(similarity(eventData[1], eventData[2]) < 0.7){
											globalStr = globalStr + eventData[iter];
										}
									}
								}
							} else {
								if(eventData[2] == ''){
									eventData[2] = repeatedDir;
								}
								globalStr = globalStr + eventData[iter];
							}

							// console.log(globalStr);
							// console.log(eventData);

							if(regex_dir.test(eventData[iter].trim())){
								iter = 0;
								eventData = new Object();	
							}

							if(countOccurrences(globalStr, repeatedDir) >= 2){
								// grab everything between last and second to last occurence of curDir
								let output = globalStr;
								let lastIndexOfCurDir = output.lastIndexOf(repeatedDir);
								let secondToLastIndexOfCurDir = output.lastIndexOf(repeatedDir, lastIndexOfCurDir-1);

								if(secondToLastIndexOfCurDir >= 0){
									output = output.substring(secondToLastIndexOfCurDir, lastIndexOfCurDir);

									// console.log(output);
									// console.log(eventData);
									if(JSON.stringify(eventData) === '{}'){
										output = removeBackspaces(output);
										// console.log(output);

										let edgeCases = ["clear", "cd", "Activate", "activate"];
										let test = edgeCases.some(el => output.includes(el));
										
										if(!test){
											let updated = tracker.updateOutput(output);
											if(updated){
												console.log(output);
											}
										}

										if(globalStr.length > maxStrLength*0.95){
											console.log(globalStr.length);
											globalStr = repeatedDir;
										}
									}
								}
							}
						}
					} else {
						terminalDimChanged = false;
					}
				}
			}
		});

		vscode.window.onDidChangeTerminalDimensions(event => {
			if(countOccurrences(globalStr, repeatedDir) >= 2){
				terminalDimChanged = true;
			}
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

		// split vothientripham from /Users/vothientripham/Desktop/test-web
		var user = currentDir.split("/")[2];
		var hostname = os.hostname();

		// grab the hostname before the first occurence of "."
		if(hostname.indexOf(".") > 0){
			hostname = hostname.substring(0, hostname.indexOf("."));
		}

		// check if mac_regex_dir matches "vothientripham@1350-AL-05044 test-web %"
		// regex for validating folder name
		var mac_regex_dir = new RegExp(user + "@" + hostname + '[^\\\\/?%*:|"<>\.]+' + "%.*$");

		tracker = new gitTracker(currentDir);
		tracker.isGitInitialized();

		// on did write to terminal
		vscode.window.onDidWriteTerminalData(event => {
			activeTerminal = vscode.window.activeTerminal;
			if (activeTerminal == event.terminal) {
				if(event.terminal.name == "Python"){
					let terminalData= event.data.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
					iter += 1;
					eventData[iter] = terminalData;
					globalStr = globalStr + String(terminalData);

					if(mac_regex_dir.test(eventData[iter].trim())){
						// get the string between mac_regex_dir and previous index of mac_regex_dir
						// let output = eventData[iter];

						// for(let i = iter-1; i > 0; i--){
						// 	let temp = eventData[i];
						// 	let tempRegex = new RegExp(user + "@" + hostname + '[^\\\\/?%*:|"<>\.]+');
		
						// 	// check if temp contains "mac_regex_dir"
						// 	if(temp.match(tempRegex)){
						// 		break
						// 	}
						// 	output = temp + output;
						// }

						// // make sure output contains at most 1 occurence of mac_regex_dir
						// if(countOccurrences(output, user + "@" + hostname) <= 1){
						// 	// find the last occurence of "%" and second to last occurence of "%"
						// 	let secondToLastIndexOfPercent = output.lastIndexOf("%", output.lastIndexOf("%")-1);
						// 	if(secondToLastIndexOfPercent > 0){
						// 		output = output.substring(0, secondToLastIndexOfPercent);
						// 	}
						// 	let updated = tracker.updateOutput(output);	
						// 	if(updated){
						// 		// tracker.checkWebData();
						// 		// console.log(output);
						// 	}
						// }

						iter = 0;
						eventData = new Object();
					}

					// if user is using virtual environment
					if(globalStr.includes("activate")){
						if(countOccurrences(globalStr, user + "@" + hostname) >= 3){
							// grab everything between last and second to last occurence of user@hostname
							let output = globalStr;
							let lastIndexOfUserHostname = globalStr.lastIndexOf(user + "@" + hostname);
							let secondToLastIndexOfUserHostname = globalStr.lastIndexOf(user + "@" + hostname, lastIndexOfUserHostname-1);
							if(secondToLastIndexOfUserHostname > 0){
								output = output.substring(secondToLastIndexOfUserHostname, lastIndexOfUserHostname);
								let temp = new RegExp(user + "@" + hostname + '(.*?)%');
								let cwd = output.match(temp)[0];
	
								// if eventData is empty
								// wait until all data are completely written out in the terminal
								if(JSON.stringify(eventData) === '{}'){
									output = removeBackspaces(output);

									// console.log(output.replaceAll(' ',''));
									// console.log(cwd.replaceAll(' ',''));
									// console.log(similarity(output.replaceAll(' ',''), cwd.replaceAll(' ','')));

									// if similarity score is above 0.7
									// the user is changing the terminal dimension
									// or simply interacting with terminal using cmd such as cd
									// it is advised that user limits their typing directly into the terminal
									if(similarity(output.replaceAll(' ',''), cwd.replaceAll(' ','')) < 0.7){
										let updated = tracker.updateOutput(output);
										if(updated){
											tracker.checkWebData();
										}
									}

									// if globalStr length is within 5% of max length
									if(globalStr.length > maxStrLength*0.95){
										console.log(globalStr.length);
										globalStr = cwd;
									}
								}
							}
						}
					} else {
						if(countOccurrences(globalStr, user + "@" + hostname) >= 2){
							// grab everything between last and second to last occurence of user@hostname
							let output = globalStr;
							let lastIndexOfUserHostname = globalStr.lastIndexOf(user + "@" + hostname);
							let secondToLastIndexOfUserHostname = globalStr.lastIndexOf(user + "@" + hostname, lastIndexOfUserHostname-1);
							if(secondToLastIndexOfUserHostname > 0){
								output = output.substring(secondToLastIndexOfUserHostname, lastIndexOfUserHostname);
								let temp = new RegExp(user + "@" + hostname + '(.*?)%');
								let cwd = output.match(temp)[0];

								if(JSON.stringify(eventData) === '{}'){
									output = removeBackspaces(output);

									// console.log(output.replaceAll(' ',''));
									// console.log(cwd.replaceAll(' ',''));
									// console.log(similarity(output.replaceAll(' ',''), cwd.replaceAll(' ','')));

									if(similarity(output.replaceAll(' ',''), cwd.replaceAll(' ','')) < 0.7){
										let updated = tracker.updateOutput(output);
										if(updated){
											tracker.checkWebData();
										}
									}

									if(globalStr.length > maxStrLength*0.95){
										console.log(globalStr.length);
										globalStr = cwd;
									}
								}
							}
						}
					}
				}
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

	context.subscriptions.push(disposable);
}

function countOccurrences(string, word) {
	return string.split(word).length - 1;
 }

// https://stackoverflow.com/questions/10473745/compare-strings-javascript-return-of-likely
function similarity(s1, s2) {
	var longer = s1;
	var shorter = s2;
	if (s1.length < s2.length) {
		longer = s2;
		shorter = s1;
	}
	var longerLength = longer.length;
	if (longerLength == 0) {
		return 1.0;
	}
	return (longerLength - editDistance(longer, shorter)) / parseFloat(longerLength);
}

function editDistance(s1, s2) {
	s1 = s1.toLowerCase();
	s2 = s2.toLowerCase();

	var costs = new Array();
	for (var i = 0; i <= s1.length; i++) {
		var lastValue = i;
		for (var j = 0; j <= s2.length; j++) {
		if (i == 0)
			costs[j] = j;
		else {
			if (j > 0) {
			var newValue = costs[j - 1];
			if (s1.charAt(i - 1) != s2.charAt(j - 1))
				newValue = Math.min(Math.min(newValue, lastValue),
				costs[j]) + 1;
			costs[j - 1] = lastValue;
			lastValue = newValue;
			}
		}
		}
		if (i > 0)
		costs[s2.length] = lastValue;
	}
	return costs[s2.length];
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
