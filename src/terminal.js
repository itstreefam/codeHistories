const vscode = require('vscode');
const os = require('os');
const fs = require('fs');
const path = require('path');

class Terminal {
  constructor(name, cwd) {
    this.name = name;
    this.cwd = cwd;

    let wslPath = 'C:\\Windows\\System32\\wsl.exe';
    let gitBashPath = 'C:\\Program Files\\Git\\bin\\bash.exe';
    if (fs.existsSync(wslPath)) {
      this.terminalShellPath = os.platform() === 'win32' ? wslPath : '/bin/bash';
    } else {
      this.terminalShellPath = os.platform() === 'win32' ? gitBashPath : '/bin/bash';
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
    if (os.platform() === 'darwin') {
      // when open up a new terminal, bash-3.2$ was shown
      // change this to hostname:current_directory username$
      promptCommand = "export PS1='\\h:\\W \\u\\$ '";
    }

    return promptCommand;
  }

  checkBashProfilePath(){
    const bashProfilePath = `${this.cwd}/.bash_profile`;
    const content = `
codehistories() {
  if [ "$#" -eq 0 ]; then
    echo "Usage: codehistories <command> [args]"
    return
  fi
  cmd="$1"
  shift
  eval "$cmd" "$@"
}`;
    if (!fs.existsSync(bashProfilePath)) {
      // create the file and add these lines
      fs.writeFileSync(bashProfilePath, content);
      console.log('Created .bash_profile and added codehistories.');
    } else {
      // check if the lines are already there
      const fileContent = fs.readFileSync(bashProfilePath, 'utf8');
      if (!fileContent.includes('codehistories()')) {
        fs.appendFileSync(bashProfilePath, content);
        console.log('Added codehistories to .bash_profile.');
      }
    }
  }
}

module.exports = Terminal;