const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { getCurrentDir, user, hostname } = require('./helpers');

function handleFileSave(document) {
	const currentDir = getCurrentDir();
	let documentPath = document.uri.fsPath;

	// trim the user and hostname from the document
	if (user && hostname) {
		let userRegex = new RegExp("\\b" + user + "\\b", "g");
		let hostnameRegex = new RegExp("\\b" + hostname + "\\b", "g");
		documentPath = documentPath.replace(userRegex, "user").replace(hostnameRegex, "hostname");
	}

	const entry = {
		document: documentPath,
		time: Math.floor(Date.now() / 1000),
	};
	
	// check if save_log.ndjson exists
	const saveLogPath = path.join(currentDir, 'CH_cfg_and_logs', 'CH_save_log.ndjson');
	if (!fs.existsSync(saveLogPath)) {
		fs.writeFileSync(saveLogPath, '');
	}

	// Append the entry to the NDJSON file
	const ndjsonString = JSON.stringify(entry) + '\n';
	fs.appendFile(saveLogPath, ndjsonString, (err) => {
		if (err) {
			console.error('Error appending save entry to file:', err);
			vscode.window.showErrorMessage('Failed to append save entry to file.');
		}
	});
}

module.exports = {
    handleFileSave,
};
