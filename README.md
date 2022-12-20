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

## Extension Settings

Clone this reprository and run "npm i" to install all dependencies. The default **terminalName** in *extension.js* is set to "Code" assuming Code Runner extension is installed. This variable would need to be changed to another name if other semi-auto code execution extension is used (e.g. to "Python" if Python extension is installed and preferred). 

Once you start running debugging (or F5), you will work with the newly created VS Code Window named "[Extension Development Host]." In this new window, select the your working directory. Once ready, you can open up the Command Palette using Ctrl + Shift + P on Windows or CMD + Shift + P on Mac, and look for "Code Histories." Once you click on it, you should see an information pop-up saying the extension is activated.

There should also be a newly created folder called *.vscode* in your working directory. Inside this folder will be a *settings.json* containing the following information for converging extension behavior.

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

There is a chance there might be more than two run buttons, so make sure you right click on the "Run Code" button and hide it. The custom "Code Histories commit" ensures that the terminal data are captured only when that button is clicked. 

For directly typed executions in the terminal, you still could use the run "Code Histories commit" button the first time to enter "Code" terminal and select "No" in the pop-up to not commit. An example of starting up localserver by html file extension is included. Please make sure to use keyboard interrupt (Ctrl + C) for exit to trigger output.txt update.

The intial VS Code window will run in the background to capture the code state and output.

## Release Notes

### V1

Initial release of codeHistories. Basic output capture of installed Python extension when the user uses "run" button option. Can utilize "gitk" to view the code state and output.

### V1.x

Added Mac support and revamped Windows support. It is recommended that user avoid directly interacting with VS Code terminal as some cases (such as "cd" or "ls") might lead to incorrect/unnecessary git commit. Output captured might contain a few additional path strings.

### V2

Avoid resizing VS Code window when the code is executing as that might impact the terminal write data event. V2 can arguably support other languages besides Python. The user can change that settings in extension.js where event.terminal.name == "Code" instead of "Python". Note that Code Runner extension should be installed in the debugging window for this to work.

### V2.x

Added support for Linux. A custom "Code Histories commit" button is added to enforce correct output capture behavior (i.e. only when the user clicks on this button). For directly typed executions in the terminal, there has not been a better solution than asking the user to reconfirm valid output.txt via yes/no commit pop-up.

## Contact

Feel free to let me know if there is any suggestions, comments, feedbacks, etc. at p.tri@wustl.edu

**Thanks and enjoy!**
