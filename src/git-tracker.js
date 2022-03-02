const simpleGit = require('simple-git');
const vscode = require('vscode');
const fs = require('fs');

module.exports = class gitTracker {
    constructor(currentDir) {
        this._currentDir = currentDir;
        this.isDirty = [];
        this.allFilesSavedTime = [];
        this.terminalData = {};
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
        vscode.window.terminals.forEach(terminal => {
            terminal.processId.then(terminalId => {
                this.terminalData[terminalId] = [{"output": "start " + terminal.name + " terminal tracking...", "time": new Date(this.timestamp()).toLocaleString('en-US')}];
            });
        });
    }

    stopTracking() {
        vscode.window.terminals.forEach(terminal => {
            terminal.processId.then(terminalId => {
                // check if output already does not contain "stop"
                if (this.terminalData[terminalId][this.terminalData[terminalId].length - 1].output.indexOf("stop") == -1) {
                    this.terminalData[terminalId].push({"output": "stop " + terminal.name + " terminal tracking...", "time": new Date(this.timestamp()).toLocaleString('en-US')});
                }
            });
        });
    }

    commit() {
        // commit with time stamp
        var timeStamp = this.timestamp();
        var conversion = new Date(timeStamp).toLocaleString('en-US');
        var commitMessage = `[Commit time: ${conversion}]`;
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

    // store terminal data into a new file
    storeTerminalData() {
        var terminalData = this.terminalData;
        var terminalDataString = JSON.stringify(terminalData);
        
        // if file already exists, append to it
        if (fs.existsSync(this._currentDir + '/terminalData.json')) {
            // if file is empty, add "[data]" to it
            if (fs.statSync(this._currentDir + '/terminalData.json').size == 0) {
                fs.appendFileSync(this._currentDir + '/terminalData.json', "[" + terminalDataString + "]", function (err) {
                    if (err) return console.error(err);
                });
            }
            else{
                // remove last character "]" of the file and add ", data]" to it
                fs.truncateSync(this._currentDir + '/terminalData.json', fs.statSync(this._currentDir + '/terminalData.json').size - 1); 
                fs.appendFileSync(this._currentDir + '/terminalData.json', ",\r\n" + terminalDataString + "]", function (err) {
                    if (err) return console.error(err);
                });
            }
        }
        // if file does not exist, create and write "[data]" to it
        else {
            fs.writeFileSync(this._currentDir + '/terminalData.json', "[" + terminalDataString + "]", function (err) {
                if (err) return console.error(err);
            });
        }
    }

    updateOutput(output){
        // store output of current terminal to a new file
        // if file already exists, append to it
        if (fs.existsSync(this._currentDir + '/output.txt')) {
            // if file is empty
            if (fs.statSync(this._currentDir + '/output.txt').size == 0) {
                fs.appendFileSync(this._currentDir + '/output.txt', output, function (err) {
                    if (err) return console.error(err);
                });
            }
            else{
                // delete everything in the file
                fs.truncateSync(this._currentDir + '/output.txt', 0);
                fs.appendFileSync(this._currentDir + '/output.txt', output, function (err) {
                    if (err) return console.error(err);
                });
            }
        }
        // if file does not exist, create and write output to it
        else {
            fs.writeFileSync(this._currentDir + '/output.txt', output, function (err) {
                if (err) return console.error(err);
            });
        }
    }
}