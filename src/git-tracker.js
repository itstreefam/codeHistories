const simpleGit = require('simple-git');

module.exports = class gitTracker {
    constructor(currentDir) {
        this._currentDir = currentDir;
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