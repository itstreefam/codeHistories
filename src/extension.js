// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const vscode = require('vscode');
const activitiesTracker = require('./activities-tracker');

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "codeHistories" is now active!');

	var workspaceDocs = vscode.workspace.textDocuments;

	// make a dictionary of all the documents in the workspace
	var workspaceDocsDict = {};

	try{
		for(var i = 0; i < workspaceDocs.length; i++){
			var doc = workspaceDocs[i];
			// var tracker = new activitiesTracker(doc);
			// tracker.startTracking();
			// workspaceDocsDict[doc.uri.path] = tracker;
		}
	}
	catch(e){
		console.log('No document are currently in the workspace.');
		// console.error(e);
	}

	// check if active editor has changed
	// also covering the case where the active editor is a new open document
	vscode.window.onDidChangeActiveTextEditor(editor => {
		if (editor) {
			// get the document
			var doc = editor.document;
			console.log('active editor changed to: ' + doc.uri.path);
			// check if the document is in the workspace
			if(workspaceDocsDict[doc.uri.path]){
				// get the tracker
				// var tracker = workspaceDocsDict[doc.uri.path];
				// continue tracking
			}
			else{
				// create a new tracker
				// var tracker = new activitiesTracker(doc);
				// tracker.startTracking();
				// add the tracker to the workspace dictionary
				// workspaceDocsDict[doc.uri.path] = tracker;
			}
		}
	});

	const capture = new activitiesTracker().captureTextChange();

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
