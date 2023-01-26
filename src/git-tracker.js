const vscode = require('vscode');
const simpleGit = require('simple-git');
const fs = require('fs');
const cp = require('child_process');

module.exports = class gitTracker {
    constructor(currentDir) {
        this._currentDir = currentDir;
        this._initialWorkspaceDir = currentDir;
    }

    timestamp() {
        var time = Date.now || function() {
            return +new Date;
        };
        return time();
    }

    listGitRepos() {
        if(process.platform === 'win32') {
            var gitReposInCurrentDir = cp.execSync('Get-ChildItem . -Attributes Directory+Hidden -ErrorAction SilentlyContinue -Filter ".git" -Recurse | % { Write-Host $_.FullName }', {cwd: this._initialWorkspaceDir, shell: "PowerShell"});
            // console.log(gitRepoInCurrentDir.toString());
            // get individual lines of output
            var gitRepos = gitReposInCurrentDir.toString().split('\n');
            // console.log(gitRepos);

            // eliminate empty lines
            gitRepos = gitRepos.filter(function (el) {
                return el != "";
            });

            // remove .git from the end of each line
            var gitReposFiltered = gitRepos.map(function (el) {
                el = el.substring(0, el.length - 5);
                // make first letter of each line lowercase
                el = el.charAt(0).toLowerCase() + el.slice(1);
                return el;
            });

            console.log(gitReposFiltered);
            return gitReposFiltered;
        }
    }

    presentGitRepos() {
        var gitRepos = this.listGitRepos();
        if(gitRepos.length == 0) {
            vscode.window.showInformationMessage('No git repos found in current directory! Initializing git in current directory...');
            // initialize git in current directory
            this.git = simpleGit(this._currentDir);
            this.initializeGit(this.git);
        }
        else {
            var items = [];
            // if current directory is in gitRepos, add it to the top of the list
            if(gitRepos.includes(this._currentDir)) {
                items.push({ label: this._currentDir.toString(), description: "Current directory" });
            }
            // add all other git repos to the list
            for(var i = 0; i < gitRepos.length; i++) {
                if(gitRepos[i] != this._currentDir) {
                    items.push({ label: gitRepos[i].toString(), description: '' });
                }
            }

            vscode.window.showQuickPick(items, {
                canPickMany: false, 
                placeHolder: 'Select a git repo to track', 
                ignoreFocusOut: true,
                matchOnDescription: true,
                matchOnDetail: true,
            }).then((selectedRepo) => {
                if(selectedRepo) {
                    this._currentDir = selectedRepo.label;
                    this.git = simpleGit(this._currentDir);
                }
            });
        }
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
        // commit in .pseudogit folder
        // this.git.commit(commitMessage, { '--git-dir': this._currentDir + '/.pseudogit' });

        // console.log(commitMessage);
    }

    checkWebData(){
        // check if web data is being tracked
        if(!fs.existsSync(this._currentDir + '/webData')){
            vscode.window.showInformationMessage('Web data does not exist! Make sure to also use webActivities.');
        }

        // set timeout to make sure that webData is most updated
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
            this.keepOrUndoCommit();
        }); 
    }

    async keepOrUndoCommit(){
        const choice = await vscode.window.showWarningMessage('Recently committed! Do you want to keep or undo?', 'Keep commit', 'Undo commit');
        if (choice === 'Keep commit') {
            // do nothing, message dismissed
        }
        else if (choice === 'Undo commit') {
            this.git.reset(['HEAD~1']);
        }
    }

    updateOutput(output){
        // store output of current terminal to a new file
        // if file already exists, append to it
        if(!this.checkEdgeCases(output)){
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
        this.git.add('output.txt');
        return true;
    }

    checkEdgeCases(str){
        // console.log(str);
        let edgeCasesRegex = /(clear|gitk)[\s]*|(pwd|ls|cd|mkdir|touch|cp|rm|nano|cat|echo|apt|pip|git)[\s]+/g;
        if(edgeCasesRegex.test(str)){
            console.log("Encounter edge case", str.match(edgeCasesRegex));
            return false;
        }
        return true;
    }
}