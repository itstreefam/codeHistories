// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const vscode = require('vscode');

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed


// async function getDiagnostics(doc){
// 	const text = doc.getText();

// 	console.log(text);

// 	const diagnostics = new Array();

// 	let packageJson;
// 	try {
// 		packageJson = JSON.parse(text);
// 	} catch(e) {
// 		return diagnostics;
// 	}
// 	return diagnostics;
// }


/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "codeHistories" is now active!');

	// make a function that checks for content changes
	// and then calls the function to get the diagnostics
	const checkForChanges = vscode.workspace.onDidChangeTextDocument(event => {
		console.log(event.contentChanges);
		const doc = event.document;
		const diagnostics = getDiagnostics(doc);
		// console.log(diagnostics);
		vscode.languages.setDiagnostics(doc.uri, diagnostics);
	});


	const handler = async (doc) => {
		// if(!doc.fileName.endsWith('package.json')) {
		// 	return;
		// }
	
		// const diagnostics = await getDiagnostics(doc);
		// console.log(diagnostics);
		const text = doc.getText();
		console.log(text);
	};

	// check if the active editor has a document
	if (vscode.window.activeTextEditor && vscode.window.activeTextEditor.document) {
		// get the file name
		const doc = vscode.window.activeTextEditor.document;
		handler(doc);
	}

	// check if active editor has changed
	vscode.window.onDidChangeActiveTextEditor(editor => {
		if (editor) {
			// get the file name
			const fileName = editor.document.fileName;
			console.log(fileName);
		}
	});

	// check if an event is triggered
	vscode.workspace.onDidChangeTextDocument(event => {
		// get the file name
		const fileName = event.document.fileName;
		console.log(fileName);
	});

	const didOpen = vscode.workspace.onDidOpenTextDocument(doc => handler(doc));
	// const didChange = vscode.workspace.onDidChangeTextDocument(e => handler(e.document));

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with  registerCommand
	// The commandId parameter must match the command field in package.json
	let disposable = vscode.commands.registerCommand('codeHistories.codeHistories', function () {
		// The code you place here will be executed every time your command is executed

		// Display a message box to the user
		vscode.window.showInformationMessage('Hello World from code-histories!');
	});

	context.subscriptions.push(disposable);
}

// this method is called when your extension is deactivated
function deactivate() {}

module.exports = {
	activate,
	deactivate
}
