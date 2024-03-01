const vscode = require('vscode');
const os = require('os');
const path = require('path');
const { checkBashProfilePath, checkPowerShellProfilePath } = require('./profileHelpers');

class Terminal {
  constructor(name, cwd) {
    this.name = name;
    this.cwd = cwd;
    // if system is windows, use powershell
    // if system is mac or linux, use bash
    this.terminalShellPath = os.platform() === 'win32' ? 'powershell.exe' : 'bash';

    const profilePath = os.platform() === 'win32' ? 
      path.join(cwd, 'CH_cfg_and_logs', 'CH_PowerShell_profile.ps1') : 
      path.join(cwd, 'CH_cfg_and_logs', '.CH_bash_profile');

    this.terminal = vscode.window.createTerminal({
      name: this.name,
      cwd: this.cwd,
      shellPath: this.terminalShellPath,
      shellArgs: [],
    });

    // Check and possibly create/update the profile files
    if (os.platform() === 'win32') {
      checkPowerShellProfilePath(this.cwd);
    } else {
      checkBashProfilePath(this.cwd);
    }

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
    if (os.platform() === 'darwin') {
      // when open up a new terminal, bash-3.2$ was shown
      // change this to hostname:current_directory username$
      promptCommand = "export PS1='\\h:\\W \\u\\$ '";
    }

    return promptCommand;
  }
}

module.exports = Terminal;