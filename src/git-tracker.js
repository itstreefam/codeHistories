const vscode = require('vscode');
const simpleGit = require('simple-git');
const fs = require('fs');
const cp = require('child_process');
const path = require('path');
const util = require('util');
const exec = util.promisify(cp.exec);

class gitTracker {
    constructor(currentDir) {
        this._currentDir = currentDir;
        this._initialWorkspaceDir = currentDir;
        this.git = null;
        this.codeHistoriesGit = null;
        this.isUsingCodeHistoriesGit = true;
    }

    async initGitignore() {
        const gitignorePath = `${this._currentDir}/.gitignore`;
        try {
            let data = await fs.promises.readFile(gitignorePath, 'utf8').catch(() => '');
            const itemsToAdd = ['codeHistories.git', '.vscode', 'venv', 'node_modules', 'CH_cfg_and_logs', 'screencaptures', '.venv', '__pycache__'];
            for(const item of itemsToAdd){
                if(!data.includes(item)){
                    await fs.promises.appendFile(gitignorePath, `${item}\n`);
                }
            }
            console.log('Updated .gitignore');
        } catch (error) {
            console.error('Error updating .gitignore:', error);
        }
    }

    async listGitRepos() {
        try {
            const command = process.platform === 'win32' ? 
                'Get-ChildItem . -Attributes Directory,Hidden -ErrorAction SilentlyContinue -Filter *.git -Recurse | % { Write-Host $_.FullName }' :
                'find ~+ -type d -name "*.git"';
            const shell = process.platform === 'win32' ? "PowerShell" : "bash";
            const { stdout } = await exec(command, { cwd: this._initialWorkspaceDir, shell });
            
            let gitRepos = stdout.split('\n').filter(line => line).map(line => line.charAt(0).toLowerCase() + line.slice(1));
            console.log(gitRepos);
            return gitRepos;
        } catch (error) {
            console.error('Failed to list Git repos:', error);
            return [];
        }
    }

    async presentGitRepos() {
        let gitRepos = await this.listGitRepos();
        if (gitRepos.length > 0) {
            let items = gitRepos.map(repo => ({
                label: path.normalize(repo),
                description: repo.includes('codeHistories.git') ? "Current repo" : ""
            }));
    
            const selectedRepo = await vscode.window.showQuickPick(items, {
                canPickMany: false,
                placeHolder: 'Select a git repo to track',
                ignoreFocusOut: true,
                matchOnDescription: true,
                matchOnDetail: true,
            });
    
            if (selectedRepo) {
                this._currentDir = path.join(selectedRepo.label, '../').slice(0, -1);
                this.isUsingCodeHistoriesGit = selectedRepo.label.includes('codeHistories.git');
                await this.initGitignore();
                await this.createGitFolders();
            }
        }
    }

    async initializeGit(git){
        console.log("Initializing git...");
        await git.init();
    }

    async isGitInitialized(git) {
        try {
            const isRepo = await git.checkIsRepo();
            if (!isRepo) {
                await this.initializeGit(git);
            }
            await git.fetch();
            console.log("Fetched");
        } catch (error) {
            console.log("Failed to fetch:", error);
        }
    }

    async checkGitFolders() {
        try {
            const gitExists = await fs.promises.access(`${this._currentDir}/.git`).then(() => true).catch(() => false);
            const codeHistoriesExists = await fs.promises.access(`${this._currentDir}/codeHistories.git`).then(() => true).catch(() => false);
    
            if (!gitExists && !codeHistoriesExists) return "case 1";
            if (!gitExists && codeHistoriesExists) return "case 2";
            if (gitExists && !codeHistoriesExists) return "case 3";
            if (gitExists && codeHistoriesExists) return "case 4";
        } catch (error) {
            console.error('Error checking Git folders:', error);
            return null;
        }
    }

    // case 1: both .git and codeHistories.git folders do not exist
    // case 2: .git folder does not exist
    // case 3: codeHistories.git folder does not exist
    // case 4: both .git and codeHistories.git folders exist
    async createGitFolders() {
        const caseType = await this.checkGitFolders();
        switch (caseType) {
            case "case 1":
                vscode.window.showInformationMessage('No git repos found in this workspace. Initializing .git and codeHistories.git (default). Use Ctrl+Shift+G to switch to .git if needed.');
                console.log("both .git and codeHistories.git folders do not exist");
                this.git = simpleGit(this._currentDir);
                await this.isGitInitialized(this.git);
                await this.initGitignore();
                this.codeHistoriesGit = simpleGit(this._currentDir).env({ 'GIT_DIR': `${this._currentDir}/codeHistories.git`, 'GIT_WORK_TREE': this._currentDir });
                await this.isGitInitialized(this.codeHistoriesGit);
                await this.copyGitIgnore();
                break;
            case "case 2":
                console.log(".git folder does not exist");
                this.git = simpleGit(this._currentDir);
                await this.isGitInitialized(this.git);
                await this.initGitignore();
                this.codeHistoriesGit = simpleGit(this._currentDir).env({ 'GIT_DIR': `${this._currentDir}/codeHistories.git`, 'GIT_WORK_TREE': this._currentDir });
                await this.isGitInitialized(this.codeHistoriesGit);
                await this.copyGitIgnore();
                break;
            case "case 3":
                console.log("codeHistories.git folder does not exist");
                this.git = simpleGit(this._currentDir);
                await this.isGitInitialized(this.git);
                await this.initGitignore();
                // Create or copy to codeHistories.git based on .git latest commit
                const log = await this.git.log().catch(() => ({ total: 0 }));
                if (log.total > 0) {
                    const latestCommitHash = log.latest.hash;
                    console.log(`Checking out files from the latest commit (${latestCommitHash}) in .git`);
            
                    // Checkout the files from the latest commit in .git (not the whole history)
                    await this.git.checkout(latestCommitHash, ['--', '.']);
            
                    // Initialize codeHistories.git and stage the current files
                    this.codeHistoriesGit = simpleGit(this._currentDir).env({ 'GIT_DIR': `${this._currentDir}/codeHistories.git`, 'GIT_WORK_TREE': this._currentDir });
                    await this.isGitInitialized(this.codeHistoriesGit);
                    
                    // Stage the current files (which are now at the state of the latest commit in .git)
                    await this.codeHistoriesGit.add('./*');
                    await this.codeHistoriesGit.commit('Initial commit based on the latest commit of .git');
                    
                    console.log("codeHistories.git initialized with the staged files from the latest commit of .git");            
                } else {
                    this.codeHistoriesGit = simpleGit(this._currentDir).env({ 'GIT_DIR': `${this._currentDir}/codeHistories.git`, 'GIT_WORK_TREE': this._currentDir });
                    await this.isGitInitialized(this.codeHistoriesGit);
                }
                await this.copyGitIgnore();
                break;
            case "case 4":
                console.log("both .git and codeHistories.git folders exist");
                this.git = simpleGit(this._currentDir);
                await this.isGitInitialized(this.git);
                await this.initGitignore();
                this.codeHistoriesGit = simpleGit(this._currentDir).env({ 'GIT_DIR': `${this._currentDir}/codeHistories.git`, 'GIT_WORK_TREE': this._currentDir });
                await this.isGitInitialized(this.codeHistoriesGit);
                await this.copyGitIgnore();
                break;
        }
    }

    // link .gitingore to codeHistories.git
    async copyGitIgnore() {
        const gitignorePath = `${this._currentDir}/.gitignore`;
        const codeHistoriesGitignorePath = `${this._currentDir}/codeHistories.git/.gitignore`;
        try {
            await fs.promises.copyFile(gitignorePath, codeHistoriesGitignorePath);
            console.log('Linked .gitignore to codeHistories.git');
        } catch (error) {
            console.error('Error linking .gitignore to codeHistories.git:', error);
        }
    }

    async gitAdd(){
        // add all files
        // this happens as soon as the user clicks on the checkAndCommit button
        // to avoid situation where user maybe changing files while committing 
        // (the commit will be based on the files at the time of clicking the button)
        try {
            if (this.isUsingCodeHistoriesGit) {
                const gitDir = path.join(this._currentDir, 'codeHistories.git');
                const workTree = this._currentDir;
                const addCmd = `git --git-dir="${gitDir}" --work-tree="${workTree}" add .`;
                await exec(addCmd, { cwd: workTree });
                console.log(`Added all files to codeHistories.git`);
            } else {
                await this.git.add('./*');
                console.log(`Added all files to .git`);
            }
        } catch (err) {
            console.error(`Error adding files: ${err}`);
        }
    }

    async gitReset(){
        // reset all files
        // this happens as soon as output.txt not updated
        try {
            if (this.isUsingCodeHistoriesGit) {
                const gitDir = path.join(this._currentDir, 'codeHistories.git');
                const workTree = this._currentDir;
                const resetCmd = `git --git-dir="${gitDir}" --work-tree="${workTree}" reset HEAD -- .`;
                await exec(resetCmd, { cwd: workTree });
                console.log(`Successfully reset all files in codeHistories.git`);
            } else {
                const resetCmd = `git reset HEAD -- .`;
                await exec(resetCmd, { cwd: this._currentDir });
                console.log(`Successfully reset all files in .git`);
            }
        } catch (err) {
            console.error(`Error resetting files: ${err}`);
        }
    }

    async gitCommit() {
        // commit with time stamp
        const timeStamp = new Date().toLocaleString('en-US');
        const commitMessage = `[Commit time: ${timeStamp}]`;

        try {
            if (this.isUsingCodeHistoriesGit) {
                const gitDir = path.join(this._currentDir, 'codeHistories.git');
                const workTree = this._currentDir;
                const commitCmd = `git --git-dir="${gitDir}" --work-tree="${workTree}" commit -m "${commitMessage}"`;
                await exec(commitCmd, { cwd: workTree });
                console.log(`Committed to codeHistories.git`);
            } else {
                await this.git.commit(commitMessage);
                console.log(`Committed to .git`);
            }

            // Visual feedback via VS Code's notification area
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "COMMITTED!",
                cancellable: false
            }, async (progress) => {
                progress.report({ increment: 0 });
                await new Promise(resolve => setTimeout(resolve, 4000)); // Wait for 4 seconds
            });
        } catch (err) {
            console.error(`Commit error: ${err}`);
            vscode.window.showErrorMessage(`Commit failed! Please try again.`);
        }
    }

    async checkWebData(){
        // check if web data is being tracked
        const webDataPath = path.join(this._currentDir, 'webData');
        if (!await fs.promises.access(webDataPath).then(() => true).catch(() => false)) {
            vscode.window.showInformationMessage('Web data does not exist! Make sure to also use webActivities.');
            return;
        }

        // Notify user of committing process
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Committing! Hang tight!",
            cancellable: false
        }, async (progress) => {
            progress.report({ increment: 0 });
            await new Promise(resolve => setTimeout(resolve, 3000)); // Wait for 3 seconds
        });

        try {
            if (this.isUsingCodeHistoriesGit) {
                const gitDir = path.join(this._currentDir, 'codeHistories.git');
                const workTree = this._currentDir;
                const addWebDataCmd = `git --git-dir="${gitDir}" --work-tree="${workTree}" add -f webData`;
                await exec(addWebDataCmd, { cwd: workTree });
                console.log(`Added webData to codeHistories.git`);
            } else {
                await this.git.add('webData', ['-f']);
                console.log(`Added webData to .git`);
            }
        } catch (err) {
            console.error(`Error adding webData to git: ${err}`);
            vscode.window.showErrorMessage(`Error adding webData! Please try again.`);
        }
    }

    async undoCommit(){
        try {
            if (this.isUsingCodeHistoriesGit) {
                const gitDir = path.join(this._currentDir, 'codeHistories.git');
                const workTree = this._currentDir;
                const undoCmd = `git --git-dir="${gitDir}" --work-tree="${workTree}" reset HEAD~1`;
                await exec(undoCmd, { cwd: workTree });
                console.log(`Successfully undone commit for codeHistories.git`);
            } else {
                await this.git.reset(['HEAD~1']);
                console.log(`Successfully undone commit for .git`);
            }

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "Reverted to previous commit!",
                cancellable: false
            }, async (progress) => {
                progress.report({ increment: 0 });
                await new Promise(resolve => setTimeout(resolve, 4000));
            });
        } catch (err) {
            console.error(`Error undoing last commit: ${err}`);
            vscode.window.showErrorMessage(`Error undoing last commit! Please try again.`);
        }
    }

    async gitAddOutput(){
        try {
            if (this.isUsingCodeHistoriesGit) {
                const gitDir = path.join(this._currentDir, 'codeHistories.git');
                const workTree = this._currentDir;
                const addOutputCmd = `git --git-dir="${gitDir}" --work-tree="${workTree}" add -f output.txt`;
                await exec(addOutputCmd, { cwd: workTree });
                console.log(`Added output.txt to codeHistories.git`);
            } else {
                await this.git.add('output.txt', ['-f']);
                console.log(`Added output.txt to .git`);
            }
        } catch (err) {
            console.error(`Error adding output.txt to git: ${err}`);
        }
    }

    async isOutputModified(){
        try {
            // if output.txt doesn't exist, create it async
            if(!fs.promises.access(`${this._currentDir}/output.txt`).then(() => true).catch(() => false)){
                fs.writeFile(`${this._currentDir}/output.txt`, '', function (err) {
                    if (err) {
                        console.log(err);
                        return false;
                    }
                });
            }

            // check if output.txt is recently modified async
            const outputFilePath = `${this._currentDir}/output.txt`;
            const stats = await fs.promises.stat(outputFilePath);
            const mtime = new Date(util.inspect(stats.mtime));
            const now = new Date();
            const diff = now - mtime;
            const diffInMinutes = Math.floor(diff / 60000);
            if(diffInMinutes > 1){
                return false;
            }
            return true;
        } catch (err) {
            console.error(`Error checking if output.txt is modified: ${err}`);
        }
    }
}

module.exports = gitTracker;
