const vscode = require('vscode');
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

    gitAdd(){
        // add all files
        // this happens as soon as the user clicks on the checkAndCommit button
        // to avoid situation where user maybe changing files while committing (the commit will be based on the files at the time of clicking the button)
        this.git.add('./*');
    }

    gitCommit() {
        // commit with time stamp
        var timeStamp = this.timestamp();
        var conversion = new Date(timeStamp).toLocaleString('en-US');
        var commitMessage = `[Commit time: ${conversion}]`;
        this.git.commit(commitMessage);
        // console.log(commitMessage);
    }

    checkWebData(){
        // check if web data is being tracked
        if(!fs.existsSync(this._currentDir + '/webData')){
            vscode.window.showInformationMessage('Web data does not exist! Make sure to also use webActivities.');
        }

        // set timeout for 5 seconds to make sure that data is most updated
        vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Committing! Hang tight!",
            cancellable: false
        }, (progress, token) => {
            return new Promise((resolve, reject) => {
                setTimeout(() => {
                    resolve(); 
                }, 4000);
            });
        }).then(() => {
            this.git.add('webData');
            this.gitCommit();
            vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "Committed! Please continue!",
                cancellable: false
            }, (progress, token) => {
                return new Promise((resolve, reject) => {
                    setTimeout(() => {
                        resolve();
                    }, 1000);
                });
            });
        });
    }

    updateOutput(output){
        // store output of current terminal to a new file
        // if file already exists, append to it

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
        this.git.add('output.txt');
        return true;
    }
}