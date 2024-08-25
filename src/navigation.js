const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { debounceTimers, getCurrentDir, user, hostname, removeBackspaces } = require('./helpers');

let previousDocument = null;
let navigationHistory = [];

function handleVisibleRangeChange(editor) {
    if (!editor) return;

    const document = editor.document;
    const visibleRangesInfo = editor.visibleRanges.map(range => {
        // Calculate surrounding lines' indices, ensuring they are within document bounds
        const startLineIndex = Math.max(range.start.line - 2, 0); // 2 lines above the first visible, or document start
        const endLineIndex = Math.min(range.end.line + 2, document.lineCount - 1); // 2 lines below the last visible, or document end

        // Extract text for the surrounding lines
        const linesText = [];
        
		// Capture lines before the start of the visible range and the visible range itself
		for (let i = startLineIndex; i <= range.end.line; i++) {
			linesText.push(document.lineAt(i).text);
		}

        // Insert ellipsis if there's a gap indicating omitted content
        if (range.start.line - startLineIndex > 0 || endLineIndex - range.end.line > 0) {
            linesText.push("...");
        }

        // Capture lines at the end of the visible range and after it
		for (let i = range.end.line; i <= endLineIndex; i++) {
			linesText.push(document.lineAt(i).text);
		}

        let documentPath = document.uri.fsPath;

        // trim the user and hostname from the document
        if (user && hostname) {
            let userRegex = new RegExp("\\b" + user + "\\b", "g");
            let hostnameRegex = new RegExp("\\b" + hostname + "\\b", "g");
            documentPath = documentPath.replace(userRegex, "user").replace(hostnameRegex, "hostname");
        }

        const entry = {
            surroundingLines: linesText,
            range: [range.start.line + 1, range.end.line + 1],
            document: documentPath,
            time: Math.floor(Date.now() / 1000),
        };

        appendNavigationEntryToFile(entry, editor);

        return entry;
    });

	// Store each visible range change in navigation history
	// Uncomment the following lines to view the visible ranges info in the console
    // navigationHistory.push(...visibleRangesInfo);
    // console.log('Navigation History Updated:', navigationHistory);
}

function handleActiveTextEditorChange(editor) {
	// This checks for actual editor changes, including document switches and split view adjustments
    if (editor) {
        let currentDocument = editor.document.uri.fsPath;
        if (previousDocument && currentDocument !== previousDocument) {
			// trim the user and hostname from the document
			if (user && hostname) {
				let userRegex = new RegExp("\\b" + user + "\\b", "g");
				let hostnameRegex = new RegExp("\\b" + hostname + "\\b", "g");
				currentDocument = currentDocument.replace(userRegex, "user").replace(hostnameRegex, "hostname");
				previousDocument = previousDocument.replace(userRegex, "user").replace(hostnameRegex, "hostname");
			}

			// Store the navigation history entry for the document switch
			let entry = {
				document: currentDocument,
				prevDocument: previousDocument,
				time: Math.floor(Date.now() / 1000),
				transition: true, // Indicates this record is about transitioning between documents
			};

			// appendNavigationEntryToFile(entry, editor);

			// Uncomment the following lines to view the navigation history in the console
			// navigationHistory.push(entry);
			// console.log('Navigation History Updated:', navigationHistory);
        }
        previousDocument = currentDocument; // Update for future comparisons
    }
	updateVisibleEditors();
}

function updateVisibleEditors() {
    vscode.window.visibleTextEditors.forEach(editor => {
        // Directly call handleVisibleRangeChange for each visible editor
        // Note: No need to debounce here as this is called from a debounced context or controlled events
        handleVisibleRangeChange(editor);
    });
}

function appendNavigationEntryToFile(entry, editor) {
	const currentDir = getCurrentDir();
    const filePath = path.join(currentDir, 'CH_cfg_and_logs', 'CH_navigation_history.ndjson');
	const currentDocumentPath = editor.document.uri.fsPath;

	// Skip appending if the current document is the navigation history file
    if (currentDocumentPath === filePath) {
        return;
    }

    // Append the entry to the NDJSON file
	const ndjsonString = JSON.stringify(entry) + '\n';
    fs.appendFile(filePath, ndjsonString, (err) => {
        if (err) {
            console.error('Error appending navigation entry to file:', err);
            vscode.window.showErrorMessage('Failed to append navigation entry to file.');
        }
    });
}

module.exports = {
    handleVisibleRangeChange,
    handleActiveTextEditorChange,
    updateVisibleEditors
};
