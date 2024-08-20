const vscode = require('vscode');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const debounceTimers = new Map(); // For debouncing per document
const user = os.userInfo().username;
const hostname = os.hostname();

function getCurrentDir() {
	if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
		return vscode.workspace.workspaceFolders[0].uri.fsPath;
	} else {
		vscode.window.showErrorMessage("Working folder not found, open a folder and try again.");
		return null; // No directory found
	}
}

// Debounce function improved to handle debouncing per unique key (document URI)
function debounce(func, wait, key) {
    return function(...args) {
        if (!debounceTimers.has(key)) {
            debounceTimers.set(key, null);
        }
        clearTimeout(debounceTimers.get(key));
        debounceTimers.set(key, setTimeout(() => {
            func.apply(this, args);
        }, wait));
    };
}

function removeBackspaces(str) {
	var patternString = (
        "[\\u0000]|[\\u0001]|[\\u0002]|[\\u0003]|[\\u0004]|" +
        "[\\u0005]|[\\u0006]|[\\u0007]|[\\u0008]|[\\u000b]|" +
        "[\\u000c]|[\\u000d]|[\\u000e]|[\\u000f]|[\\u0010]|" +
        "[\\u0011]|[\\u0012]|[\\u0013]|[\\u0014]|[\\u0015]|" +
        "[\\u0016]|[\\u0017]|[\\u0018]|[\\u0019]|[\\u001a]|" +
        "[\\u001b]|[\\u001c]|[\\u001d]|[\\u001e]|[\\u001f]|" +
        "[\\u007f]|[\\u0040]"
    );
    var pattern = new RegExp(patternString, "gm");
    while (str.indexOf("\b") !== -1) {
        str = str.replace(/.?\x08/g, ""); // 0x08 is the ASCII code for \b
    }
    str = str.replace(pattern, "");  
    return str;
}

function runPythonScript(scriptPath, args, callback) {
    let pythonPath = vscode.workspace.getConfiguration("python").get("pythonPath");
    if (!pythonPath) {
        pythonPath = "python";
    }
    let options = {
        cwd: path.dirname(scriptPath)
    };
    let process = spawn(pythonPath, [scriptPath, ...args], options);
    let result = "";
    process.stdout.on('data', function(data) {
        result += data.toString();
    });
    process.stderr.on('data', function(data) {
        console.error(data.toString());
    });
    process.on('exit', function(code) {
        if (code !== 0) {
            console.error("Error running Python script:", code);
            return;
        }
        callback(result);
    });
}

module.exports = {
    getCurrentDir,
    debounce,
    debounceTimers,
    removeBackspaces,
    user,
    hostname,
    runPythonScript
};
