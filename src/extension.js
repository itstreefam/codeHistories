// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const vscode = require('vscode');
const activitiesTracker = require('./activities-tracker');
const simpleGit = require('simple-git');
const gitTracker = require('./git-tracker');

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "codeHistories" is now active!');

	var contentArr = [];

	var regex_dir = /^[a-z]:((\\|\/)[a-z0-9\s_@\-^!#$%&+={}\[\]]+)+>$/i;

	var curDir = vscode.workspace.workspaceFolders[0].uri.fsPath;
	// capitalize the first letter of the directory
	curDir = curDir.charAt(0).toUpperCase() + curDir.slice(1);

	simpleGit().clean(simpleGit.CleanOptions.FORCE);

	var currentDir;

	if(!vscode.workspace.workspaceFolders){
		message = "Working folder not found, please open a folder first." ;
		vscode.window.showErrorMessage(message);

		// wait until a folder is selected
		vscode.window.showOpenDialog({
			canSelectFiles: false,
			canSelectFolders: true,
			canSelectMany: false,
		}).then(folder => {
			if(folder){
				currentDir = folder[0].fsPath;
				vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(currentDir));
				return currentDir;
			}
		}).then(currentDir => {
			var tracker = new gitTracker(currentDir);
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
	
			// on did change terminal's state
			vscode.window.onDidChangeTerminalState((terminal) => {
				terminal.state.isInteractedWith = false;
				if(tracker.isDirty.length == 0 && tracker.allFilesSavedTime.length > 0){
					var terminalInteractTime = tracker.timestamp();
					// get the difference between saved and terminal interact
					var timeDiff = Math.abs(terminalInteractTime - tracker.allFilesSavedTime[tracker.allFilesSavedTime.length - 1]);
					console.log(timeDiff);
					var minute = 1000 * 60;
					if (timeDiff < minute) {
						// tracker.commit();
						console.log('Commit!');
						terminal.state.isInteractedWith = true;
					}			
				}
			});
		}).catch((err) => console.error('failed: ', err));
	}

	else{
		currentDir = vscode.workspace.workspaceFolders[0].uri.fsPath;
		// message = `Current working folder: ${currentDir}`;
		// vscode.window.showInformationMessage(message);
		var tracker = new gitTracker(currentDir);
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
					tracker.terminalData[terminalId] = [{"name": terminal.name, "output": "starting terminal tracking...", "time": new Date(tracker.timestamp()).toLocaleString('en-US')}];
				}
			});
		});

		//close terminal
		vscode.window.onDidCloseTerminal(event => {
			// console.log(filteredOutput);
			console.log(tracker.terminalData);
		});

		// on did write to terminal
		vscode.window.onDidWriteTerminalData(event => {
			if(tracker.isDirty.length == 0 && tracker.allFilesSavedTime.length > 0){
				// console.log(event.data.trim());
				contentArr.push(event.data);
				// console.log(regex_dir.test(contentArr[contentArr.length-1].trim()))

				// this supposedly means that sth is executed and the current directory is shown in terminal again
				// will be different for different kind of terminal
				if(contentArr[contentArr.length-1].includes(curDir + ">")){
					// console.log(contentArr[contentArr.length-2].length)
					// console.log(contentArr)
					for(var i=0; i<contentArr.length; i++){
						if(contentArr[i].charAt(0) == "\r" && contentArr[i].charAt(1) == "\n"){
							// get timestamp
							var terminalInteractTime = tracker.timestamp();
							var outputString = "";
							for(var j=i; j<contentArr.length; j++){
								outputString = outputString + contentArr[j].trim();
							}
							outputString = outputString.replace(curDir + ">", '');
							contentArr.splice(0,contentArr.length);
							vscode.window.activeTerminal.processId.then(pid => {
								tracker.terminalData[pid].push({"name": event.terminal.name, "output": outputString, "time": terminalInteractTime});
							});
							break;
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

// this method is called when your extension is deactivated
function deactivate() {
	// similar to closing vs code => can be used to export tracking data
}

module.exports = {
	activate,
	deactivate
}
