# codeHistories

A VS Code extension that aims to capture the information needed to generate usable code histories (capturing code state and output). This work remains a prototype as the tool is utilizing VS Code Proposed APIs.

## Setup demo

https://user-images.githubusercontent.com/44308446/219846324-bd156916-f2e0-4cd0-92b9-0481ced5a7f5.mp4

## Requirements

* VS Code Insiders version (https://code.visualstudio.com/insiders/) to use their proposed API
* Node JS + simple-git (https://github.com/steveukx/git-js) to incorporate git in the output tracking process
* active-win (https://github.com/sindresorhus/active-win) to detect application switch between VS Code and Chrome
* Git Bash for Windows user

## Extension Setup

1.  Clone this repository.
2.  Download the Insiders version of VSCode: https://code.visualstudio.com/insiders/
3.  Open VSCode. You can determine whether you’ve gotten Insiders based on the icon color, which should be jade green for Insiders (rather than blue).
4.  Open the code histories repository folder in VSCode.
5.  From the main directory of the code histories repository, run ```npm i``` to install all dependencies.
6.  Back in VSCode, press f5 (fn + F5 for Mac) to enter debug mode. This will open a new VScode window which has "[Extension Development Host]" in its name. This is where you should set up the code that you want to be tracked.
7.  Open the repository or folder that you want to work in using VSCode.
8.  CTRL-SHIFT-P should start the extension (CMD-SHIFT-P for Mac). That will bring up a menu of options. Look for and choose "Code Histories". Note: When this runs, it should automatically create the settings that are needed for the extension. But, if that fails to happen (which would manifest as an error on CTRL-SHIFT-P) you can do the following:
    -   Open the directory in a file browser

    -   Make .vscode directory

    -   Within that .vscode directory, make a settings.json file that contains the following information.

        ```
        {
            "terminal.integrated.defaultProfile.windows": "Git Bash",
            "terminal.integrated.defaultProfile.osx": "bash",
            "terminal.integrated.defaultProfile.linux": "bash",
            "terminal.integrated.shellIntegration.enabled": false,
            "python.terminal.activateEnvironment": false
        }
        ```

9.  You should see a “Code Histories activated.” message on the bottom right of the screen when it is running.

10. Press on the multi-play button (which says “Code Histories commit” if you hover over it) the first time to enter Code Histories terminal; .bash_profile should be automatically created and loaded so that you can use "codehistories" prefix to trigger auto-commit mechanism. 

## Important notes

1. When the extension starts, it will automatically create .bash_profile in your project's folder and add the following information:
    
    ```
    codehistories() {
    if [ "$#" -eq 0 ]; then
        echo "Usage: codehistories <command> [args]"
        return
    fi
    cmd="$*"

    # Get current date and time in the format [M/D/YYYY, HH:MM:SS AM/PM]
    timestamp=$(date +"[%-m/%-d/%Y, %I:%M:%S %p]")

    # Print a newline to output.txt
    echo "\n" | tee -a output.txt
    
    # Print the timestamp to output.txt
    echo "Execution Time: $timestamp" | tee -a output.txt

    # Execute the command and append the output
    eval "$cmd" 2>&1 | tee -a output.txt
    }
    ```
    This is to make sure that when you run ```codehistories <cmd> [args]```, the bash terminal can understand and capture the execution's output. You need to always run your code with ```codehistories``` as prefix since it is an important keyword for the tool to capture both the output and the code state.

2. In case you don't want to type out full execution command every time, you use Ctrl + Shift + C (or CMD + Shift + C on Mac) to update the command for the subsequent executions. Then you can press the multi-play button to run the updated execution. For e.g. if you want to run a python file, you set the command to ```python main.py```. Note that this command will be updated for all future executions until you change it again.

3. Please don’t make changes while the code is running, as these may not be captured correctly. Also, if you feel that a commit was incorrectly triggered, there is the "Undo Code Histories commit" button that looks like a clock with back arrow to the left of the multi-play button so you can undo and go back to the previous commit.

4. When starting up codeHistories extension, codeHistories.git will be created and set as default. The intention here is to have a git repo solely for codeHistories commits which would not interfere with the commonly known .git repo (that might contain more meaningful, containing larger changes commits, especially if user starts out with repos cloned online).The user can switch back and forth between .git and codeHistories.git using Ctrl + Shift + G (or CMD + Shift + G on Mac) or searching for Code Histories: Select git repo (from VS Code View tab -> Command Palette.. option).

5. To use git commands that are related to codeHistories.git, you need to add ```--git-dir=codeHistories.git --work-tree=.``` between ```git``` and the command. For e.g. ```git --git-dir=codeHistories.git --work-tree=. log --pretty=oneline``` to view the codeHistories commits. Occasionally checking this would be a good idea since the files color change only corresponds to normal .git repo.

6. For complex web project example, refer to line 353-373 in src/extension.js. In general, for execution run, add ```codehistories``` prefix to the command. For web dev run, no need to really use ```codehistories``` prefix. Instead, make use of tee command to log output continuously while the capturing mechanism happens when user moves away from VS Code to Chrome to (re)load localhost. E.g. ```npm start | while IFS= read -r line; do echo "[$(date '+%m/%d/%Y, %I:%M:%S %p')] $line"; done | tee -a server2.txt```, ```python -u -m http.server 8000 2>&1 | tee >(awk '{ print $0; fflush(); }' >> server2.txt)```

## Release Notes

### V1

Initial release of codeHistories. Basic output capture of installed Python extension when the user uses "run" button option. Can utilize "gitk" to view the code state and output.

### V1.x

Added Mac support and revamped Windows support. It is recommended that user avoid directly interacting with VS Code terminal as some cases (such as "cd" or "ls") might lead to incorrect/unnecessary git commit. Output captured might contain a few additional path strings.

### V2

Avoid resizing VS Code window when the code is executing as that might impact the terminal write data event. V2 can arguably support other languages besides Python. The user can change that settings in extension.js where event.terminal.name == "Code" instead of "Python". Note that Code Runner extension should be installed in the debugging window for this to work.

### V2.x

Added support for Linux. A custom "Code Histories commit" button is added to enforce correct output capture behavior (i.e. only when the user clicks on this button). For directly typed executions in the terminal, there has not been a better solution than asking the user to revert a commit if it was triggered wrong. Comment out ```if(checkThenCommit)``` statement in extension.js to enable direct terminal execution capture.

### V3

Removed the need for code-runner extension. Using ```codehistories``` as a prefix in commands serves as a important keyword trigger for the tool to capture the code state and output. Currently safe to interact directly with the "Code Histories" terminal. Similar to code-runner, the user can use a run button to execute the code, but they would need to update the command using Ctrl + Shift + C (or CMD + Shift + C on Mac) before pressing the run button (Code Histories commit). The added pseudogit feature allows the user to keep various small commits related to codeHistories separate from .git.

### V3.x

Added application switch checking to help with web dev heuristic when user is gone from vs code to visit chrome and if they load localhost to test their program. Added right click option to context menu for user to quickly write down their goals/subgoals for record. Undo commit button is now a standalone button placed to the left of the commit button. ```codehistories```prefix is now combined with tee in Unix-like environment to optimize piping result to output.txt.

## Contact

Feel free to let me know if there is any suggestions, comments, feedbacks, etc. at p.tri@wustl.edu

**Thanks and enjoy!**
