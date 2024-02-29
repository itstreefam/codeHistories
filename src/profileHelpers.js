const fs = require('fs');
const path = require('path');

function checkBashProfilePath(cwd) {
    const dirPath = path.join(cwd, 'CH_cfg_and_logs');
    const bashProfilePath = path.join(dirPath, '.CH_bash_profile');
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

    ensureDirectoryExists(dirPath);

    if (!fs.existsSync(bashProfilePath)) {
        fs.writeFileSync(bashProfilePath, content);
        console.log('Created .CH_bash_profile and added codehistories.');
    } else {
        const fileContent = fs.readFileSync(bashProfilePath, 'utf8');
        if (!fileContent.includes('codehistories()')) {
            fs.appendFileSync(bashProfilePath, content);
            console.log('Added codehistories to .CH_bash_profile.');
        }
    }
}

function checkPowerShellProfilePath(cwd) {
    const dirPath = path.join(cwd, 'CH_cfg_and_logs');
    const powerShellProfilePath = path.join(dirPath, 'CH_PowerShell_profile.ps1');
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

    ensureDirectoryExists(dirPath);

    if (!fs.existsSync(powerShellProfilePath)) {
        fs.writeFileSync(powerShellProfilePath, content);
        console.log('Created CH_PowerShell_profile.ps1 and added codehistories.');
    } else {
        const fileContent = fs.readFileSync(powerShellProfilePath, 'utf8');
        if (!fileContent.includes('function codehistories')) {
            fs.appendFileSync(powerShellProfilePath, content);
            console.log('Added codehistories to CH_PowerShell_profile.ps1.');
        }
    }
}

function ensureDirectoryExists(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

module.exports = { checkBashProfilePath, checkPowerShellProfilePath };
