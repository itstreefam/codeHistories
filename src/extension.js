// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const vscode = require('vscode');
const simpleGit = require('simple-git');
const gitTracker = require('./git-tracker');
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
				iter += 1;
				eventData[iter] = event.data;
				curDir = eventData[Object.keys(eventData).length].trim().match(regex_dir)[0];
					
				if(curDir.search(">")){
					// get the string betwween ":" and ">"
					// console.log(curDir)
					curDir = curDir.substring(curDir.indexOf(":\\")-1, curDir.indexOf(">")+1);
				}
				
				// go backward to the most recent occured curDir
				for(var i = Object.keys(eventData).length-1; i >= 0; i--){
					// ansi code 
					// hide_cursor() "[?25l"
					// show_cursor() "[?25h"
					if(eventData[i-1].includes(curDir) && eventData[i] === "[?25l" && (Object.keys(eventData).length-1)-i > 1){
						// grab every output from i to back to the end
						var output = "";

						for(var j = Object.keys(eventData).length; j > i; j--){
							var temp = eventData[j];
							var	secondToLastIndexOfCurDir = temp.lastIndexOf(":\\", temp.lastIndexOf(":\\")-1);
							var	lastIndexOfCurDir = temp.lastIndexOf(":\\");
							if((secondToLastIndexOfCurDir > 0 || lastIndexOfCurDir > 0) && j < Object.keys(eventData).length){
								break;
							}
							if(j == Object.keys(eventData).length){
								// grab from the last index of curDir to beginning
								temp = temp.substring(0, temp.lastIndexOf("\n"));
							}

							output = temp + output;
						}

						var	lastIndexOfShowCursor = output.lastIndexOf("[?25h");
						if(lastIndexOfShowCursor > 0){
							output = output.substring(lastIndexOfShowCursor+6, output.length-1);
						}

						// removing remaining ansi escape code
						var updated = tracker.updateOutput(output.replace(
							/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, ''));
						if(updated){
							// tracker.commit();
						}

						iter = 1;
						eventData = {"1": eventData[Object.keys(eventData).length]};
					}
				}
			}
		}
	});

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

// this method is called when your extension is deactivated
function deactivate() {
	console.log('Thank you for trying out "codeHistories"!');
}

module.exports = {
	activate,
	deactivate
}
