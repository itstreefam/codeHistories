const simpleGit = require('simple-git');
const vscode = require('vscode');

module.exports = class gitTracker {
    constructor(currentDir) {
        this._currentDir = currentDir;
        this.isDirty = [];
        this.allFilesSavedTime = [];
    }

    timestamp() {
        var time = Date.now || function() {
            return +new Date;
        };
        return time();
    }

    initializeGit(git){
        console.log("Initializing git...");
        return git.init();
    }

    isGitInitialized() {
        this.git = simpleGit(this._currentDir);
        return this.git.checkIsRepo()
            .then(isRepo => !isRepo && this.initializeGit(this.git))
            .then(() => this.git.fetch());
    }

    startTracking() {
        // check if terminal is open
        var terminal = vscode.window.activeTerminal;
        if (!terminal) {
            vscode.window.showInformationMessage('No terminal is open. Please open a terminal and try again.');
            return;
        }
    }

    // commit function
    commit() {
        // commit with time stamp
        var timeStamp = this.timestamp();
        var commitMessage = `[Commit at ${timeStamp}]`;
        this.git.add('./*')
            .then(() => this.git.commit(commitMessage)) 
    }

    // get status of the current directory
    getStatus() {
        var statusSummary = null;
        try {
            statusSummary = this.git.status();
        }
        catch (e) {
            // handle the error
            console.log(e);
        }
        return statusSummary;
    }
}