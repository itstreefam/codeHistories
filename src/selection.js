const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { getCurrentDir, user, hostname } = require('./helpers');
let selectionHistory = [];
const myCustomEmitter = require('./eventEmitter'); // Use the shared emitter

function handleTextEditorSelectionChange(editor) {
    // Ensure there is a valid selection
    if (!editor || !editor.selection || editor.selection.isEmpty) {
        return; // Exit if no editor, no selection, or the selection is empty
    }

    const document = editor.document;
    const selection = editor.selection;

    // console.log('Selection:', selection);

    const selectedText = document.getText(selection);
    // console.log('Selected Text:', selectedText);

    const visibleRanges = editor.visibleRanges.map(range => {
        return [range.start.line + 1, range.end.line + 1];
    });
    
    const startChar = selection.start.character;
    const endChar = selection.end.character;

    // Define the range for capturing text around the selection
    const startLineIndex = selection.start.line;
    // Ensure we do not go beyond the document's start and end
    const endLineIndex = selection.end.line;
    const documentLineCount = document.lineCount;

    // Calculate indices to capture additional context
    // Next two lines after the start line, ensuring not to exceed document bounds
    const afterStartLineEndIndex = Math.min(startLineIndex + 2, documentLineCount - 1);
    // Two lines before the end line, ensuring not to go before the start line
    const beforeEndLineStartIndex = Math.max(endLineIndex - 2, startLineIndex, 0);

    // Initialize an array to hold the lines of text
    const linesText = [];

    // Capture from the start line to the specified end index after the start
    for (let i = startLineIndex; i <= afterStartLineEndIndex; i++) {
        linesText.push(document.lineAt(i).text);
    }

    // If there's a gap between the sections to capture, add ellipsis to indicate omitted lines
    if (beforeEndLineStartIndex > afterStartLineEndIndex + 1) {
        linesText.push("..."); // Indicative of omitted lines
    }

    // Capture from the specified start index before the end to the end line
    for (let i = beforeEndLineStartIndex; i <= endLineIndex; i++) {
        // Avoid duplicating lines if the start and end ranges overlap
        if (i > afterStartLineEndIndex) {
            linesText.push(document.lineAt(i).text);
        }
    }

    let documentPath = document.uri.fsPath;

	// trim the user and hostname from the document
	if (user && hostname) {
		let userRegex = new RegExp("\\b" + user + "\\b", "g");
		let hostnameRegex = new RegExp("\\b" + hostname + "\\b", "g");
		documentPath = documentPath.replace(userRegex, "user").replace(hostnameRegex, "hostname");
	}

    const entry = {
        type: 'selection',
        selectedText: selectedText,
        selectedLinesText: linesText, // Capture the lines of text around the selection
        range: [selection.start.line + 1, selection.end.line + 1],
		document: documentPath,
        allText: document.getText(),
        visibleRanges: visibleRanges,
        charRange: [startChar, endChar],
        time: Math.floor(Date.now() / 1000),
    };

    // Emit the selection event
    myCustomEmitter.emit('selection', entry);

    // Log the execution info to JSON file
	const currentDir = getCurrentDir();
	const ndjsonString = JSON.stringify(entry) + '\n'; // Convert to JSON string and add newline
	const outputPath = path.join(currentDir, 'CH_cfg_and_logs', 'CH_selection_history.ndjson');
	fs.appendFile(outputPath, ndjsonString, (err) => {
		if (err) {
			console.error('Error appending selection entry to file:', err);
			vscode.window.showErrorMessage('Failed to append selection entry to file.');
		}
	}); 
	
	// Uncomment the following lines to view the selection history in the console 
	// selectionHistory.push(entry);
	// console.log('Selection History Updated:', selectionHistory);
}

module.exports = {
    handleTextEditorSelectionChange
};
