# codeHistories

A VS Code extension that aims to capture the information needed to generate usable code histories (capturing code state and output). This work remains a prototype for research purposes.

## Demo

https://user-images.githubusercontent.com/44308446/158084110-06305b2c-af13-4664-8041-ec044a58efff.mp4

## Requirements

* VS Code Insiders version (https://code.visualstudio.com/insiders/) to use their proposed API
* Node JS + simple-git (https://github.com/steveukx/git-js) to incorporate git in the output tracking process
* Git Bash installed for Windows user
* Code Runner extension (https://github.com/formulahendry/vscode-code-runner) to utilize multiple language execution support
* Default Python extension for VS Code (https://github.com/Microsoft/vscode-python) is also an option for Python file execution

## Extension Setup

1.  Clone this repository.
2.  Download the Insiders version of VSCode: https://code.visualstudio.com/insiders/
3.  Open VSCode. You can determine whether you’ve gotten Insiders based on the icon color, which should be jade green for Insiders (rather than blue).
4.  Install the Code Runner Extension. You should be able to search for it from the extensions tab on the left hand side of the screen (looks like little blocks).
5.  Open the code histories repository folder in VSCode.
6.  From the main directory of the code histories repository, run ```npm i``` to install all dependencies.
7.  Back in VSCode, press f5 to enter debug mode. This will open a new VScode window which has "[Extension Development Host]" in its name. This is where you should set up the code that you want to be tracked.
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
            "code-runner.runInTerminal": true,
            "code-runner.ignoreSelection": true,
            "code-runner.clearPreviousOutput": false,
            "terminal.integrated.shellIntegration.enabled": false,
            "python.terminal.activateEnvironment": false,
            "code-runner.executorMap": {
                "html": "\"$pythonPath\" -m http.server 8080 --directory \"$workspaceRoot\"",
                "python": "\"$pythonPath\" -u \"$fullFileName\"",
            }
        }
        ```

10.  You should see a “Code Histories activated.” message on the bottom right of the screen when it is running.
11. Press the multi-play button (which says “Code Histories commit” if you hover over it) to run your project. If it’s a web project using a localhost server, start from an html page. Then you’ll need to open localhost:8080 in a browser. 
You can change to a different port by updating the number in settings.json.
You can refer to https://github.com/formulahendry/vscode-code-runner for more execution configurations and update the settings.json. For e.g. if you are using Python <3.7 there would be no ```--directory \"$workspaceRoot\""```
12. When you are done testing, press CRTL-C in the vscode console to stop the execution. This will trigger capturing the current code. (Note: please don’t make changes while the code is running, as these may not be captured correctly. Also, if you do not want to commit changes because an execution was detected incorrectly, there is a confirmation box on the lower right of the screen that will appear when you press CTRL-C and you can cancel the commit. In the case where the message has already disappeared, you can do ```git reset HEAD~1``` in the terminal to revert back to the previous correct commit.)

## Release Notes

### V1

Initial release of codeHistories. Basic output capture of installed Python extension when the user uses "run" button option. Can utilize "gitk" to view the code state and output.

### V1.x

Added Mac support and revamped Windows support. It is recommended that user avoid directly interacting with VS Code terminal as some cases (such as "cd" or "ls") might lead to incorrect/unnecessary git commit. Output captured might contain a few additional path strings.

### V2

Avoid resizing VS Code window when the code is executing as that might impact the terminal write data event. V2 can arguably support other languages besides Python. The user can change that settings in extension.js where event.terminal.name == "Code" instead of "Python". Note that Code Runner extension should be installed in the debugging window for this to work.

### V2.x

Added support for Linux. A custom "Code Histories commit" button is added to enforce correct output capture behavior (i.e. only when the user clicks on this button). For directly typed executions in the terminal, there has not been a better solution than asking the user to revert a commit if it was triggered wrong. Comment out ```if(checkThenCommit)``` statement in extension.js to enable direct terminal execution capture.

## Contact

Feel free to let me know if there is any suggestions, comments, feedbacks, etc. at p.tri@wustl.edu

**Thanks and enjoy!**
