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

Clone this reprository and run "npm i" to install all dependencies. The default **terminalName** in *extension.js* is set to "Code" assuming Code Runner extension is installed. This variable would need to be changed to another name if other semi-auto code execution extension is used (e.g. to "Python" if Python extension is installed and preferred). Once you start running debugging (or F5), you will almost always work with "[Extension Development Host]" VS Code window, so make sure to create a new folder called *.vscode* in this "[Extension Development Host]" window. Inside this folder, add *settings.json* containing the following information.

```
{
    "terminal.integrated.profiles.windows": {
        "Git Bash": {
            "source": "Git Bash"
        }
    },
    "terminal.integrated.defaultProfile.windows": "Git Bash",
    "terminal.integrated.defaultProfile.osx": "zsh",
    "terminal.integrated.defaultProfile.linux": "bash",
    "code-runner.runInTerminal" : true,
    "terminal.integrated.shellIntegration.enabled": false
}
```

As mentioned above, the "[Extension Development Host]" window will be where you start working on your project. There is a chance there might be more than two run buttons, so make sure you right click on the "Run Code" button and hide it. The custom "Code Histories commit" ensures that the terminal data are captured only when that button is clicked. The intial VS Code will run in the background to capture the code state and output.

## Release Notes

### V1

Initial release of codeHistories. Basic output capture of installed Python extension when the user uses "run" button option. Can utilize "gitk" to view the code state and output.

### V1.x

Added Mac support and revamped Windows support. It is recommended that user avoid directly interacting with VS Code terminal as some cases (such as "cd" or "ls") might lead to incorrect/unnecessary git commit. Output captured might contain a few additional path strings.

### V2

Avoid resizing VS Code window when the code is executing as that might impact the terminal write data event. V2 can arguably support other languages besides Python. The user can change that settings in extension.js where event.terminal.name == "Code" instead of "Python". Note that Code Runner extension should be installed in the debugging window for this to work.

### V2.x

Added support for Linux. A custom "Code Histories commit" button is added to enforce correct output capture behavior (i.e. only when the user clicks on this button). Any direct interactions with the "Code" terminal (cd, ls, pip install/uninstall, using up/down arrow key up to access next/previous execution, etc.) is ignored and will not trigger a git commit.

## Contact

Feel free to let me know if there is any suggestions, comments, feedbacks, etc. at p.tri@wustl.edu

**Thanks and enjoy!**
