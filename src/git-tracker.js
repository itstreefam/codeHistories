const vscode = require('vscode');
const simpleGit = require('simple-git');
const fs = require('fs');
const cp = require('child_process');
const path = require('path');

module.exports = class gitTracker {
    constructor(currentDir) {
        this._currentDir = currentDir;
        this._initialWorkspaceDir = currentDir;
        this.git = null;
        this.codeHistoriesGit = null;
        this.isUsingCodeHistoriesGit = true;
        this.initGitingore();
    }

    timestamp() {
        var time = Date.now || function() {
            return +new Date;
        };
        return time();
    }

    initGitingore() {
        // create .gitignore file
        if(!fs.existsSync(this._currentDir + '/.gitignore')) {
            fs.writeFileSync(this._currentDir + '/.gitignore', 'codeHistories.git');
        } else {
            // check if codeHistories.git is in .gitignore
            var data = fs.readFileSync(this._currentDir + '/.gitignore', 'utf8');
            if(!data.includes('codeHistories.git')) {
                fs.appendFileSync(this._currentDir + '/.gitignore', 'codeHistories.git');
            }
        }
    }

    listGitRepos() {
        var gitReposInCurrentDir = ['./.git'];
        if(process.platform === 'win32') {
            gitReposInCurrentDir = cp.execSync('Get-ChildItem . -Attributes Directory,Hidden -ErrorAction SilentlyContinue -Filter *.git -Recurse | % { Write-Host $_.FullName }', {cwd: this._initialWorkspaceDir, shell: "PowerShell"});
        }
        else if(process.platform === 'darwin') {
            gitReposInCurrentDir = cp.execSync('find ~+ -type d -name "*.git"', {cwd: this._initialWorkspaceDir, shell: "bash"});
        }

        // console.log(gitRepoInCurrentDir.toString());
        // get individual lines of output
        var gitRepos = gitReposInCurrentDir.toString().split('\n');

        // eliminate empty lines
        gitRepos = gitRepos.filter(function (el) {
            return el != "";
        });

        console.log(gitRepos);
        return gitRepos;
    }

    presentGitRepos() {
        var gitRepos = this.listGitRepos();
        if(gitRepos.length > 0) {
            var items = [];

            if(this.isUsingCodeHistoriesGit){
                // if current directory is in gitRepos, add it to the top of the list
                if(gitRepos.includes(this._currentDir + '\\codeHistories.git') || gitRepos.includes(this._currentDir + '/codeHistories.git')) {
                    items.push({ label: this._currentDir + '\\codeHistories.git', description: "Current repo" });
                }
                // add all other git repos to the list
                for(var i = 0; i < gitRepos.length; i++) {
                    if(gitRepos[i] != this._currentDir + '\\codeHistories.git' && gitRepos[i] != this._currentDir + '/codeHistories.git') {
                        items.push({ label: gitRepos[i].toString(), description: '' });
                    }
                }
            } else {
                if(gitRepos.includes(this._currentDir + '\\.git') || gitRepos.includes(this._currentDir + '/.git')) {
                    items.push({ label: this._currentDir + '\\.git', description: "Current repo" });
                }
                for(var i = 0; i < gitRepos.length; i++) {
                    if(gitRepos[i] != this._currentDir + '\\.git' && gitRepos[i] != this._currentDir + '/.git') {
                        items.push({ label: gitRepos[i].toString(), description: '' });
                    }
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
                    this._currentDir = path.join(selectedRepo.label,'../');
                    // omit last \\ or / from path
                    this._currentDir = this._currentDir.substring(0, this._currentDir.length - 1);
                    if(selectedRepo.label.includes('codeHistories.git')) {
                        this.isUsingCodeHistoriesGit = true;
                    } else {
                        this.isUsingCodeHistoriesGit = false;
                    }
                    this.initGitingore();
                    this.createGitFolders();
                }
            });
        }
    }

    initializeGit(git){
        console.log("Initializing git...");
        return git.init();
    }

    isGitInitialized(git) {
        return git.checkIsRepo()
            .then(isRepo => !isRepo && this.initializeGit(git))
            .then(() => git.fetch());
    }

    checkGitFolders() {
        if(!fs.existsSync(this._currentDir + '/.git') && !fs.existsSync(this._currentDir + '/codeHistories.git')){
            return "case 1"
        }
        if(!fs.existsSync(this._currentDir + '/.git') && fs.existsSync(this._currentDir + '/codeHistories.git')){
            return "case 2"
        }
        if(fs.existsSync(this._currentDir + '/.git') && !fs.existsSync(this._currentDir + '/codeHistories.git')){
            return "case 3"
        }
        if(fs.existsSync(this._currentDir + '/.git') && fs.existsSync(this._currentDir + '/codeHistories.git')){
            return "case 4"
        }
    }

    // case 1: both .git and codeHistories.git folders do not exist
    // case 2: .git folder does not exist
    // case 3: codeHistories.git folder does not exist
    // case 4: both .git and codeHistories.git folders exist
    createGitFolders() {
        switch(this.checkGitFolders()) {
            case "case 1":
                vscode.window.showInformationMessage('No git repos found in this workspace. Initializing .git and codeHistories.git (default). Use Ctrl+Shift+G to switch to .git if needed.');
                console.log("both .git and codeHistories.git folders do not exist");
                this.git = simpleGit(this._currentDir);
                this.isGitInitialized(this.git);
                this.codeHistoriesGit = simpleGit(this._currentDir).env({ 'GIT_DIR': this._currentDir + '/codeHistories.git', 'GIT_WORK_TREE': this._currentDir });
                this.isGitInitialized(this.codeHistoriesGit);
                break;
            case "case 2":
                // keep using codeHistories.git as default repo unless the user selects .git via the quick pick (presentGitRepos)
                console.log(".git folder does not exist");
                this.git = simpleGit(this._currentDir);
                this.isGitInitialized(this.git);
                this.codeHistoriesGit = simpleGit(this._currentDir).env({ 'GIT_DIR': this._currentDir + '/codeHistories.git', 'GIT_WORK_TREE': this._currentDir });
                this.isGitInitialized(this.codeHistoriesGit);
                break;
            case "case 3":
                console.log("codeHistories.git folder does not exist");
                this.git = simpleGit(this._currentDir);
                this.isGitInitialized(this.git);

                // run git log
                // if output is empty, create codeHistories.git and set it to be default repo
                // if output is not empty, copy .git to codeHistories.git
                this.git.log((err, log) => {
                    if(err) {
                        console.log(err);
                    }
                    else {
                        if(log.total == 0) {
                            // create codeHistories.git
                            this.codeHistoriesGit = simpleGit(this._currentDir).env({ 'GIT_DIR': this._currentDir + '/codeHistories.git' , 'GIT_WORK_TREE': this._currentDir });
                            this.initializeGit(this.codeHistoriesGit);
                        }
                        else {
                            // retrieve hash of commits that have [Commit time:.*] in the commit message
                            var hashes = [];
                            for(var i = 0; i < log.total; i++) {
                                if(log.all[i].message.includes("[Commit time:")) {
                                    hashes.push(log.all[i].hash);
                                }
                            }

                            // create codeHistories.git
                            this.codeHistoriesGit = simpleGit(this._currentDir).env({ 'GIT_DIR': this._currentDir + '/codeHistories.git', 'GIT_WORK_TREE': this._currentDir });
                            this.initializeGit(this.codeHistoriesGit);

                            // copy .git to codeHistories.git
                            fs.cpSync(this._currentDir + '/.git', this._currentDir + '/codeHistories.git', {recursive: true});

                            // remove all commits that have [Commit time:.*] in the commit message
                            // for(var i = 0; i < hashes.length; i++) {
                            //     this.git.reset(['--soft', hashes[i]]);
                            // }
                        }
                    }
                });
                break;
            case "case 4":
                console.log("both .git and codeHistories.git folders exist");
                this.git = simpleGit(this._currentDir);
                this.isGitInitialized(this.git);
                this.codeHistoriesGit = simpleGit(this._currentDir).env({ 'GIT_DIR': this._currentDir + '/codeHistories.git', 'GIT_WORK_TREE': this._currentDir });
                this.isGitInitialized(this.codeHistoriesGit);
                break;
        }
    }

    gitAdd(){
        // add all files
        // this happens as soon as the user clicks on the checkAndCommit button
        // to avoid situation where user maybe changing files while committing (the commit will be based on the files at the time of clicking the button)
        if(this.isUsingCodeHistoriesGit) {
            this.codeHistoriesGit.add('./*');
        } else {
            this.git.add('./*');
        }
    }

    gitCommit() {
        // commit with time stamp
        var timeStamp = this.timestamp();
        var conversion = new Date(timeStamp).toLocaleString('en-US');
        var commitMessage = `[Commit time: ${conversion}]`;
        if(this.isUsingCodeHistoriesGit) {
            this.codeHistoriesGit.commit(commitMessage);
        } else {
            this.git.commit(commitMessage);
        }
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
            if(this.isUsingCodeHistoriesGit) {
                this.codeHistoriesGit.add('webData');
            } else {
                this.git.add('webData');
            }
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
            if(this.isUsingCodeHistoriesGit) {
                this.codeHistoriesGit.reset(['HEAD~1']);
            } else {
                this.git.reset(['HEAD~1']);
            }
        }
    }

    updateOutput(output){
        // store output of current terminal to a new file
        // if file already exists, append to it
        if(!this.checkEdgeCases(output)){
            console.log("Edge case detected!", output);
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

        if(this.isUsingCodeHistoriesGit) {
            this.codeHistoriesGit.add('output.txt');
        } else {
            this.git.add('output.txt');
        }
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