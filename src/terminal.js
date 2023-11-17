const vscode = require('vscode');
const os = require('os');
const fs = require('fs');
const path = require('path');

class Terminal {
  constructor(name, cwd) {
    this.name = name;
    this.cwd = cwd;

    let gitBashPath = 'C:\\Program Files\\Git\\bin\\bash.exe';
    this.terminalShellPath = os.platform() === 'win32' ? gitBashPath : '/bin/bash';

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
  cmd="$*"
  
  # Get current date and time in the format [M/D/YYYY, HH:MM:SS AM/PM]
  timestamp=$(date +"[%-m/%-d/%Y, %I:%M:%S %p]")
  
  # Print a newline and the timestamp to output.txt
  echo -e "\nExecution Time: $timestamp" | tee -a output.txt
  
  # Execute the command and append the output
  eval "$cmd" 2>&1 | tee -a output.txt
}

log_command_completion() {
  # Get the last command from the current session's history
  last_command=$(fc -ln -1 | sed 's/^[[:space:]]*//') # Remove leading whitespace
  # timestamp=$(date +"[%-m/%-d/%Y, %I:%M:%S %p]")
  # echo "$timestamp: $last_command" >> commands.txt
  # Check if the last command executed successfully
  if [ $? -eq 0 ]; then
    timestamp=$(date +"[%-m/%-d/%Y, %I:%M:%S %p]")
    # append the command to the file
    echo "$timestamp: $last_command" >> commands.txt
  else
    timestamp=$(date +"[%-m/%-d/%Y, %I:%M:%S %p]")
    # append the command to the file with a note that it failed
    echo "$timestamp: $last_command # FAILED" >> commands.txt
  fi
}
PROMPT_COMMAND=log_command_completion

`;

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