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
