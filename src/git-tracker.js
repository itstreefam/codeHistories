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
        else if(process.platform === 'darwin' || process.platform === 'linux') {
            gitReposInCurrentDir = cp.execSync('find ~+ -type d -name "*.git"', {cwd: this._initialWorkspaceDir, shell: "bash"});
        }

        // console.log(gitRepoInCurrentDir.toString());
        // get individual lines of output
        var gitRepos = gitReposInCurrentDir.toString().split('\n');

        // eliminate empty lines
        gitRepos = gitRepos.filter(function (el) {
            return el != "";
        });

        // make first letter of each line lowercase
        gitRepos = gitRepos.map(function (el) {
            return el.charAt(0).toLowerCase() + el.slice(1);
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
                if(gitRepos.includes(this._currentDir + '\\codeHistories.git')){
                    items.push({ label: this._currentDir + '\\codeHistories.git', description: "Current repo" });
                } else if(gitRepos.includes(this._currentDir + '/codeHistories.git')){
                    items.push({ label: this._currentDir + '/codeHistories.git', description: "Current repo" });
                }
                // add all other git repos to the list
                for(var i = 0; i < gitRepos.length; i++) {
                    if(gitRepos[i] != this._currentDir + '\\codeHistories.git' && gitRepos[i] != this._currentDir + '/codeHistories.git') {
                        items.push({ label: gitRepos[i].toString(), description: '' });
                    }
                }
            } else {
                if(gitRepos.includes(this._currentDir + '\\.git')){
                    items.push({ label: this._currentDir + '\\.git', description: "Current repo" });
                } else if(gitRepos.includes(this._currentDir + '/.git')){
                    items.push({ label: this._currentDir + '/.git', description: "Current repo" });
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
            .then(() => {
                git.fetch().then((success) => {
                    console.log("Fetched");
                }
                , (failure) => {
                    console.log("Failed to fetch");
                });
            });
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
                        // create codeHistories.git
                        this.codeHistoriesGit = simpleGit(this._currentDir).env({ 'GIT_DIR': this._currentDir + '/codeHistories.git' , 'GIT_WORK_TREE': this._currentDir });
                        this.isGitInitialized(this.codeHistoriesGit);
                    }
                    else {
                        if(log.total == 0) {
                            // create codeHistories.git
                            this.codeHistoriesGit = simpleGit(this._currentDir).env({ 'GIT_DIR': this._currentDir + '/codeHistories.git' , 'GIT_WORK_TREE': this._currentDir });
                            this.isGitInitialized(this.codeHistoriesGit);
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
                            this.isGitInitialized(this.codeHistoriesGit);

                            // copy .git to codeHistories.git
                            fs.cpSync(this._currentDir + '/.git', this._currentDir + '/codeHistories.git', {recursive: true});
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
            let gitDir = path.join(this._currentDir, 'codeHistories.git');
            let workTree = path.join(this._currentDir);
            let addCmd = `git --git-dir="${gitDir}" --work-tree="${workTree}" add .`;
            cp.exec(addCmd, {cwd: this._currentDir}, (err, stdout, stderr) => {
                if(err) {
                    console.log('Error adding all files to codeHistories.git');
                    console.log(err);
                    return;
                }
                console.log('Added all files to codeHistories.git');
            });
        } else {
            this.git.add('./*').then((success) => {
                console.log('Added all files to .git');
            }, (err) => {
                console.log('Error adding all files to .git');
                console.log(err);
            });
        }
    }

    gitReset(){
        // reset all files
        // this happens as soon as output.txt not updated
        if(this.isUsingCodeHistoriesGit) {
            let gitDir = path.join(this._currentDir, 'codeHistories.git');
            let workTree = path.join(this._currentDir);
            let resetCmd = `git --git-dir="${gitDir}" --work-tree="${workTree}" reset`;
            cp.exec(resetCmd, {cwd: this._currentDir}, (err, stdout, stderr) => {
                if(err) {
                    console.log('Error resetting all files in codeHistories.git');
                    console.log(err);
                    return;
                }
                console.log('Successfully reset all files in codeHistories.git');
            });
        } else {
            this.git.reset(['./*']).then((success) => {
                console.log('Successfully reset all files in .git');
            }, (err) => {
                console.log('Error resetting all files in .git');
                console.log(err);
            });
        }
    }

    async gitCommit() {
        // commit with time stamp
        var timeStamp = this.timestamp();
        var conversion = new Date(timeStamp).toLocaleString('en-US');
        var commitMessage = `[Commit time: ${conversion}]`;
        if(this.isUsingCodeHistoriesGit) {
            let gitDir = path.join(this._currentDir, 'codeHistories.git');
            let workTree = path.join(this._currentDir);
            let commitCmd = `git --git-dir="${gitDir}" --work-tree="${workTree}" commit -m "${commitMessage}"`;
            try {
                await new Promise((resolve, reject) => {
                    cp.exec(commitCmd, {cwd: this._currentDir}, (error, stdout, stderr) => {
                        if (error) {
                            console.error(`exec error: ${error}`);
                            reject(error);
                        } else {
                            console.log('Committed to codeHistories.git');
                            resolve();
                        }
                    });
                });
                this.keepOrUndoCommit();
            } catch (error) {
                vscode.window.showErrorMessage('Commit failed! Please try again.');
            }
        } else {
            this.git.commit(commitMessage)
                    .then(() => {
                        console.log('Committed to .git');
                        this.keepOrUndoCommit();
                    })
                    .catch((err) => {
                        console.log(err);
                        vscode.window.showErrorMessage('Commit failed! Please try again.');
                    });
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
                let gitDir = path.join(this._currentDir, 'codeHistories.git');
                let workTree = path.join(this._currentDir);
                let addWebDataCmd = `git --git-dir="${gitDir}" --work-tree="${workTree}" add webData`;
                cp.exec(addWebDataCmd, {cwd: this._currentDir}, (err, stdout, stderr) => {
                    if(err) {
                        console.log('Error adding webData to codeHistories.git');
                        console.log(err);
                        return;
                    }
                    console.log('Added webData to codeHistories.git');
                });
            } else {
                this.git.add('webData').then((success) => {
                    console.log('Added webData to .git');
                }, (err) => {
                    console.log('Error adding webData to .git');
                    console.log(err);
                });
            }
            this.gitCommit();
        }); 
    }

    async keepOrUndoCommit(){
        const choice = await vscode.window.showWarningMessage('Recently committed! Do you want to keep or undo?', 'Keep commit', 'Undo commit');
        if (choice === 'Keep commit') {
            // do nothing, message dismissed
        }
        else if (choice === 'Undo commit') {
            if(this.isUsingCodeHistoriesGit) {
                let gitDir = path.join(this._currentDir, 'codeHistories.git');
                let workTree = path.join(this._currentDir);
                let undoCmd = `git --git-dir="${gitDir}" --work-tree="${workTree}" reset HEAD~1`;
                cp.exec(undoCmd, {cwd: this._currentDir}, (err, stdout, stderr) => {
                    if(err) {
                        console.log('Error undoing last commit for codeHistories.git');
                        console.log(err);
                        return;
                    }
                    console.log('Successfully undone commit for codeHistories.git');
                });
            } else {
                console.log("undoing commit for .git");
                this.git.reset(['HEAD~1']).then((success) => {
                    console.log("Successfully undone commit for .git");
                }, (err) => {
                    console.log('Error undoing commit for .git');
                    console.log(err);
                });
            }
        }
    }

    updateOutput(output){
        // stage everything before updating output.txt
        this.gitAdd();

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
            let gitDir = path.join(this._currentDir, 'codeHistories.git');
            let workTree = path.join(this._currentDir);
            let addOutputCmd = `git --git-dir="${gitDir}" --work-tree="${workTree}" add output.txt`;
            cp.exec(addOutputCmd, {cwd: this._currentDir}, (err, stdout, stderr) => {
                if(err) {
                    console.log('Error adding output.txt to codeHistories.git');
                    console.log(err);
                    return;
                }
                console.log('Added output.txt to codeHistories.git');
            });
        } else {
            this.git.add('output.txt').then((success) => {
                console.log('Added output.txt to .git');
            }, (err) => {
                console.log('Error adding output.txt to .git');
                console.log(err);
            });
        }
        return true;
    }

    checkEdgeCases(str){
        // if vs code terminal name is not codeHistories, return false
        if(vscode.window.activeTerminal.name === "Code Histories"){
            // only returns true if str contains codehistories
            if(str.includes("codehistories") && this.countOccurrences(str, "codehistories") == 1){
                return true;
            }
            return false;
        } else {
            let edgeCasesRegex = /(clear|gitk)[\s]*|(pwd|ls|cd|mkdir|touch|cp|rm|nano|cat|echo|apt|pip|git)[\s]+/g;
            if(edgeCasesRegex.test(str)){
                // console.log("Encounter edge case", str.match(edgeCasesRegex));
                return false;
            }
            return true;
        }
    }

    countOccurrences(string, word) {
        return string.split(word).length - 1;
    }
}