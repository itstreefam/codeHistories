// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const vscode = require('vscode');
const activitiesTracker = require('./activities-tracker');
const simpleGit = require('simple-git');
const gitTracker = require('./git-tracker');
var tracker = null;
var iter = 0;
var contentArr = [];
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

	var currentDir;

	if(!vscode.workspace.workspaceFolders){
		message = "Working folder not found, please open a folder first." ;
		vscode.window.showErrorMessage(message);
		return;
	}

	currentDir = vscode.workspace.workspaceFolders[0].uri.fsPath;
	// message = `Current working folder: ${currentDir}`;
	// vscode.window.showInformationMessage(message);
	tracker = new gitTracker(currentDir);
	tracker.isGitInitialized();
	tracker.startTracking();

	vscode.workspace.onDidChangeTextDocument(function(e) {
		// if the file being changed is not in the tracked files
		if (!tracker.isDirty.includes(e.document.uri.path)) {
			tracker.isDirty.push(e.document.uri.path);
		}
		// console.log(tracker.isDirty);
		var terminals = vscode.window.terminals;
		if (terminals) {
			terminals.forEach(terminal => {
				terminal.state.isInteractedWith = false;
			});
		}
	});
	
	vscode.workspace.onDidSaveTextDocument(function(e) {
		// find the file in the tracked files and remove it
		const index = tracker.isDirty.indexOf(e.uri.path);
		if (index > -1) {
			tracker.isDirty.splice(index, 1);
		}
		if (tracker.isDirty.length == 0) {
			tracker.allFilesSavedTime.push(tracker.timestamp());
		}
	});

	// on did open terminal
	vscode.window.onDidOpenTerminal(terminal => {
		// check if terminal is already in terminalData
		terminal.processId.then(terminalId => {
			if (!tracker.terminalData[terminalId]) {
				tracker.terminalData[terminalId] = [{"output": "start " + terminal.name + " terminal tracking...", "time": new Date(tracker.timestamp()).toLocaleString('en-US')}];
			}
		});
	});

	// on did close terminal
	vscode.window.onDidCloseTerminal(terminal => {
		// check if terminal is already in terminalData
		terminal.processId.then(terminalId => {
			tracker.terminalData[terminalId].push({"output": "stop " + terminal.name + " terminal tracking...", "time": new Date(tracker.timestamp()).toLocaleString('en-US')});
		});
	});

	// on did write to terminal
	vscode.window.onDidWriteTerminalData(event => {
		activeTerminal = vscode.window.activeTerminal;
		if (activeTerminal == event.terminal) {
			if(event.terminal.name == "Python"){
				iter += 1;
				eventData[iter] = event.data;
				console.log(eventData)

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
						console.log(i)
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

						var updated = tracker.updateOutput(output);
						if(updated){
							tracker.commit();
						}

						iter = 1;
						eventData = {"1": eventData[Object.keys(eventData).length]};
					}
				}
			}

			if(event.terminal.name == "cmd"){
				if(tracker.isDirty.length == 0 && tracker.allFilesSavedTime.length > 0){
					// console.log(event.data);
					contentArr.push(event.data);
					// console.log(contentArr[contentArr.length-1])

					// console.log(regex_dir.test(contentArr[contentArr.length-1].trim()))
					// console.log(contentArr)

					// this supposedly means that sth is executed and the current directory is shown in terminal again
					// will be different for different kind of terminal
					curDir = contentArr[contentArr.length-1].trim().match(regex_dir)[0];
					
					if(curDir.search(">")){
						// get the string betwween ":" and ">"
						// console.log(curDir)
						curDir = curDir.substring(curDir.indexOf(":\\")-1, curDir.indexOf(">")+1);
					}

					if(contentArr[contentArr.length-1].includes(curDir)){
						for(var i=0; i<contentArr.length; i++){
							if(contentArr[i].charAt(0) == "\r" && contentArr[i].charAt(1) == "\n"){
								var terminalInteractTime = tracker.timestamp();
								var outputString = "";
								for(var j=i; j<contentArr.length; j++){
									outputString = outputString + contentArr[j].trim();
								}
								outputString = outputString.replace(curDir, '');
								contentArr.splice(0,contentArr.length);
								// get the difference between saved and terminal interact
								var timeDiff = Math.abs(terminalInteractTime - tracker.allFilesSavedTime[tracker.allFilesSavedTime.length - 1]);
								var minute = 1000 * 60 * 5;
								if (timeDiff < minute) {
									// tracker.commit();
									console.log('Commit!');
									tracker.updateOutput(outputString);
									vscode.window.activeTerminal.processId.then(pid => {
										tracker.terminalData[pid].push({"output": outputString, "time": new Date(terminalInteractTime).toLocaleString('en-US')});
									});
								}	
								break;
							}
						}
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
	// similar to closing vs code => can be used to export tracking data
	tracker.stopTracking();
	tracker.storeTerminalData();
}

module.exports = {
	activate,
	deactivate
}
