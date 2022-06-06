const simpleGit = require('simple-git');
const fs = require('fs');

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

    commit() {
        // commit with time stamp
        var timeStamp = this.timestamp();
        var conversion = new Date(timeStamp).toLocaleString('en-US');
        var commitMessage = `[Commit time: ${conversion}]`;
        this.git.add('./*').commit(commitMessage);
    }

    updateOutput(output){
        // store output of current terminal to a new file
        // if file already exists, append to it

        // avoid gitk or cd in commits
        if(output.length <= 1){
            return false;
        }

        if (fs.existsSync(this._currentDir + '/output.txt')) {
            // if file is empty
            if (fs.statSync(this._currentDir + '/output.txt').size == 0) {
                fs.appendFileSync(this._currentDir + '/output.txt', output, function (err) {
                    if (err) {
                        console.log(err);
                        return false;
                    }
                });
            }
            else{
                // delete everything in the file
                fs.truncateSync(this._currentDir + '/output.txt', 0);
                fs.appendFileSync(this._currentDir + '/output.txt', output, function (err) {
                    if (err) {
                        console.log(err);
                        return false;
                    }
                });
            }
        }
        // if file does not exist, create and write output to it
        else {
            fs.writeFileSync(this._currentDir + '/output.txt', output, function (err) {
                if (err) {
                    console.log(err);
                    return false;
                }
            });   
        }
        return true;
    }
}