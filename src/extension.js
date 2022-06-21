// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const vscode = require('vscode');
const simpleGit = require('simple-git');
const gitTracker = require('./git-tracker');
var os = require('os');
var tracker = null;
var iter = 0;
var eventData = new Object();

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "codeHistories" is now active!');

	if(process.platform === 'win32'){
		// regex to match windows dir
		var regex_dir = /^[\s\S]*:((\\|\/)[a-z0-9\s_@\-^!.#$%&+={}\[\]]+)+>+.*$/i;
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

		// on did write to terminal
		vscode.window.onDidWriteTerminalData(event => {
			activeTerminal = vscode.window.activeTerminal;
			if (activeTerminal == event.terminal) {
				if(event.terminal.name == "Python"){
					let terminalData = event.data.replace(
						/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
					iter += 1;
					eventData[iter] = terminalData;

					if(regex_dir.test(eventData[iter].trim()) && iter > 1){
						let output = eventData[iter];
						
						for(let i = iter-1; i > 0; i--){
							let temp = eventData[i];
							if(temp.match(regex_dir)){
								break;
							}
							output = temp + output;
						}

						if(countOccurrences(output, "Windows PowerShell") == 0){
							// grab everything between last and second to last occurence of curDir + ">"
							let	secondToLastIndexOfCurDir = output.lastIndexOf(curDir+">", output.lastIndexOf(curDir+">")-1);
							let	lastIndexOfCurDir = output.lastIndexOf(curDir+">");
							// check if a few position before the last occurence of curDir + ">" contains "PS"
							if(output.substring(lastIndexOfCurDir-3, lastIndexOfCurDir) == "PS "){
								lastIndexOfCurDir = output.lastIndexOf(curDir+">") - 3;
							}

							let	finalOutput = output.substring(secondToLastIndexOfCurDir, lastIndexOfCurDir);
							let updated = tracker.updateOutput(finalOutput);
							if(updated){
								console.log(finalOutput);
								tracker.checkWebData();
							}
						}

						iter = 0;
						eventData = new Object();	
					}
				}
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
					let terminalData= event.data.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '')
					// .replace(/(\r\n|\n|\r)/gm, "");
					
					iter += 1;
					eventData[iter] = terminalData;

					if(mac_regex_dir.test(eventData[iter].trim())){
						// get the string between mac_regex_dir and previous index of mac_regex_dir
						let output = eventData[iter];

						for(let i = iter-1; i > 0; i--){
							let temp = eventData[i];
							let tempRegex = new RegExp(user + "@" + hostname + '[^\\\\/?%*:|"<>\.]+');
		
							// check if temp contains "mac_regex_dir"
							if(temp.match(tempRegex)){
								break
							}
							output = temp + output;
						}

						// make sure output contains at most 1 occurence of mac_regex_dir
						if(countOccurrences(output, user + "@" + hostname) <= 1){
							// find the last occurence of "%" and second to last occurence of "%"
							let secondToLastIndexOfPercent = output.lastIndexOf("%", output.lastIndexOf("%")-1);
							if(secondToLastIndexOfPercent > 0){
								output = output.substring(0, secondToLastIndexOfPercent);
							}
							let updated = tracker.updateOutput(output);	
							if(updated){
								tracker.checkWebData();
								console.log(output);
							}
						}

						iter = 0;
						eventData = new Object();
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

// this method is called when your extension is deactivated
function deactivate() {
	console.log('Thank you for trying out "codeHistories"!');
}

module.exports = {
	activate,
	deactivate
}
