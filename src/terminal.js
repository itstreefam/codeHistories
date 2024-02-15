const vscode = require('vscode');
const os = require('os');
const fs = require('fs');
const path = require('path');

class Terminal {
  constructor(name, cwd) {
    this.name = name;
    this.cwd = cwd;
    // if system is windows, use powershell
    // if system is mac or linux, use bash
    this.terminalShellPath = os.platform() === 'win32' ? 'powershell.exe' : 'bash';

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

  checkBashProfilePath(cwd){
    const bashProfilePath = `${cwd}/.CH_bash_profile`;
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

  checkPowerShellProfilePath(cwd){
    const powerShellProfilePath = `${cwd}/CH_PowerShell_profile.ps1`;
    const content = `
function codehistories {
  param(
    [Parameter(Position = 0, Mandatory = $false, ValueFromRemainingArguments = $true)]
    [string[]]$CommandArgs
  )

  # Check if any command arguments are provided
  if ($CommandArgs.Count -eq 0) {
    Write-Host "Usage: codehistories <command> [args]"
  } else {
    # Join the command arguments into a single command string
    $cmd = $CommandArgs -join ' '

    # Get current date and time in the format [M/D/YYYY, HH:MM:SS AM/PM]
    $timestamp = Get-Date -Format "[M/d/yyyy, hh:mm:ss tt]"

    # Log the execution time and
    Write-Host "Execution Time: $timestamp"

    # Execute the command
    try {
      Invoke-Expression $cmd
    } catch {
      Write-Error "An error occurred executing the command: $_"
    }
  }
}`;

    if (!fs.existsSync(powerShellProfilePath)) {
      // create the file and add these lines
      fs.writeFileSync(powerShellProfilePath, content);
      console.log('Created CH_PowerShell_profile.ps1 and added codehistories.');
    } else {
      // check if the lines are already there
      const fileContent = fs.readFileSync(powerShellProfilePath, 'utf8');
      if (!fileContent.includes('codehistories')) {
        fs.appendFileSync(powerShellProfilePath, content);
        console.log('Added codehistories to CH_PowerShell_profile.ps1.');
      }
    }
  }
}

module.exports = Terminal;