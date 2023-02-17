# codeHistories

A VS Code extension that aims to capture the information needed to generate usable code histories (capturing code state and output). This work remains a prototype for research purposes.

## Demo

https://user-images.githubusercontent.com/44308446/158084110-06305b2c-af13-4664-8041-ec044a58efff.mp4

## Requirements

* VS Code Insiders version (https://code.visualstudio.com/insiders/) to use their proposed API
* Node JS + simple-git (https://github.com/steveukx/git-js) to incorporate git in the output tracking process
* Git Bash installed for Windows user

## Extension Setup

1.  Clone this repository.
2.  Download the Insiders version of VSCode: https://code.visualstudio.com/insiders/
3.  Open VSCode. You can determine whether you’ve gotten Insiders based on the icon color, which should be jade green for Insiders (rather than blue).
4.  Install the Code Runner Extension. You should be able to search for it from the extensions tab on the left hand side of the screen (looks like little blocks).
5.  Open the code histories repository folder in VSCode.
6.  From the main directory of the code histories repository, run ```npm i``` to install all dependencies.
7.  Back in VSCode, press f5 (fn + F5 for Mac) to enter debug mode. This will open a new VScode window which has "[Extension Development Host]" in its name. This is where you should set up the code that you want to be tracked.
8.  Open the repository or folder that you want to work in using VSCode.
9.  CTRL-SHIFT-P should start the extension (CMD-SHIFT-P for Mac). That will bring up a menu of options. Look for and choose Code Histories. Note: When this runs, it should automatically create the settings that are needed for the extension. But, if that fails to happen (which would manifest as an error on CTRL-SHIFT-P) you can do the following:
    -   Open the directory in a file browser

    -   Make .vscode directory

    -   Within that .vscode directory, make a settings.json file that contains the following information.

        ```
        {
            "terminal.integrated.profiles.windows": {
                "Git Bash": {
                    "source": "Git Bash"
                }
            },
            "terminal.integrated.defaultProfile.windows": "Git Bash",
            "terminal.integrated.defaultProfile.osx": "bash",
            "terminal.integrated.defaultProfile.linux": "bash",
            "terminal.integrated.shellIntegration.enabled": false,
            "python.terminal.activateEnvironment": false
        }
        ```

10.  You should see a “Code Histories activated.” message on the bottom right of the screen when it is running.

## Important notes

1. When the extension starts, it will create .bash_profile in your root folder (~) and add this information to it:
    
    ```
    codehistories() {
        if [ "$#" -eq 0 ]; then
            echo "Usage: codehistories <command> [args]"
            return
        fi
        cmd="$1"
        shift
        eval "$cmd" "$@"
    }
    ```
    This is to make sure that when you run ```codehistories <cmd> [args]```, the bash terminal can understand and capture the execution's output. You need to always run your code with ```codehistories``` as prefix since it is an important keyword for the tool to capture the code state and output.
    
2. Press on the multi-play button (which says “Code Histories commit” if you hover over it) the first time to load in the bash_profile.

3. In case you don't want to type out full execution command every time, you use Ctrl + Shift + C (or CMD + Shift + C on Mac) to update the command for the subsequent executions. Then you can press the multi-play button to run the updated execution. For e.g. if you want to run an http server, you set the command to ```python -m http.server 8080```. Note that this command will be updated for all future executions until you change it again.

4. Please don’t make changes while the code is running, as these may not be captured correctly. Also, if you do not want to commit changes because an execution was detected incorrectly, there is a confirmation box on the lower right of the screen that will appear after the codes were committed so you can undo and go back to the previous commit. In the case where the box has already disappeared, you can do ```git reset HEAD~1``` in the terminal to revert back to the previous correct commit.

5. When starting up codeHistories extension, codeHistories.git will be created and set as default. The intention here is to have a git repo solely for codeHistories commits which would not interfere with the commonly known .git repo (that might contain more meaningful, containing larger changes commits, especially if user starts out with repos cloned online).The user can switch back and forth between .git and codeHistories.git using Ctrl + Shift + G (or CMD + Shift + G on Mac) or searching for Code Histories: Select git repo (from VS Code View tab -> Command Palette.. option).

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

## Contact

Feel free to let me know if there is any suggestions, comments, feedbacks, etc. at p.tri@wustl.edu

**Thanks and enjoy!**
