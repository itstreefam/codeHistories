const vscode = require('vscode');
const os = require('os');
const path = require('path');
const { checkBashProfilePath, checkPowerShellProfilePath } = require('./profileHelpers');

class Terminal {
  constructor(name, cwd) {
    this.name = name;
    this.cwd = cwd;
    // if system is windows, depends on name, use Git Bash or PowerShell
    // if system is mac or linux, use bash
    if (os.platform() === 'win32') {
      if (name === 'bash') {
        this.terminalShellPath = 'C:\\Program Files\\Git\\bin\\bash.exe';
      } else {
        this.terminalShellPath = 'C:\\Program Files\\PowerShell\\7\\pwsh.exe';
      }
    } else {
      if (name === 'pwsh') {
        this.terminalShellPath = 'pwsh';
      } else {
        this.terminalShellPath = '/bin/bash';
      }
    }

    this.terminal = vscode.window.createTerminal({
      name: this.name,
      cwd: this.cwd,
      shellPath: this.terminalShellPath,
      shellArgs: [],
    });

    let promptCommand = this.getPromptCommand();
    if (promptCommand) {
      this.terminal.sendText(promptCommand);
    }
  }

  show() {
    this.terminal.show();
  }

  sendText(text) {
    this.terminal.sendText(text);
  }

  getPromptCommand() {
    let promptCommand = '';
    if (os.platform() === 'darwin' && this.name.includes("bash")) {
      // when open up a new terminal, bash-3.2$ was shown
      // change this to hostname:current_directory username$
      promptCommand = "export PS1='\\h:\\W \\u\\$ '";
    }

    return promptCommand;
  }
}

module.exports = Terminal;