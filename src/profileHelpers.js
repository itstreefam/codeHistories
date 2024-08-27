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
  
  # Print a newline and the timestamp
  echo -e "\nExecution Time: $timestamp"
  
  # Execute the command
  eval "$cmd" 2>&1
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
    const tempSigned = `
# SIG # Begin signature block
# MIIFqgYJKoZIhvcNAQcCoIIFmzCCBZcCAQExDzANBglghkgBZQMEAgEFADB5Bgor
# BgEEAYI3AgEEoGswaTA0BgorBgEEAYI3AgEeMCYCAwEAAAQQH8w7YFlLCE63JNLG
# KX7zUQIBAAIBAAIBAAIBAAIBADAxMA0GCWCGSAFlAwQCAQUABCAW75OMye//aZnD
# sPxn5N4yYjjXT8cVfh25S1jPpjA8VKCCAxgwggMUMIIB/KADAgECAhBif5lmmdhw
# lkycdk5V+pESMA0GCSqGSIb3DQEBBQUAMCIxIDAeBgNVBAMMF1Bvd2VyU2hlbGwg
# Q29kZSBTaWduaW5nMB4XDTI0MDgxOTIwMjMwNloXDTI1MDgxOTIwNDMwNlowIjEg
# MB4GA1UEAwwXUG93ZXJTaGVsbCBDb2RlIFNpZ25pbmcwggEiMA0GCSqGSIb3DQEB
# AQUAA4IBDwAwggEKAoIBAQDGsZiimTzJZwh+snr9shyF9u3d9uNNEGK7l1rTla0+
# 0K5nM/nKNEVr9W7JyfjqKYhf7cLS45Fdvn3G3QrjkFA13Hl/tnXf2X13ajrsmexP
# 67HtBdFfNq5jaba25TFxPYNKuNhFnH4CPSxfSEAAp516cZFh/gL1NthQxfBnQdHr
# Zqjo9d+h4uYXNeypnsMVZyEFHl8RkBIrowoGeoClICOiYQ3k8oPYyY3yM2xhKrRy
# WwuZ3BjqvuoHg9BZFk9Y6740DMNKtx9YYfkJ2gs38NkZWx4XEN10pXkVWTBboQIB
# U2rFW2hPZwaTwAxRFOFK3uZyxcu7SLkTkctH12kJciWNAgMBAAGjRjBEMA4GA1Ud
# DwEB/wQEAwIHgDATBgNVHSUEDDAKBggrBgEFBQcDAzAdBgNVHQ4EFgQUCbFJZ93n
# 5XQPvYBrnMJPDrCZXoEwDQYJKoZIhvcNAQEFBQADggEBADm8Se+go3MevyVu8TBU
# LT8SArNb8U5jvNhQqrdAfvYncFWoxEZ7hv2MmK06RhPEWjmfQfTcSdvcCqsvtb+Z
# nKw5KTVfV9sEF4eHWGrD9jd9XmQUCOdMWvdEp4etexQuAMwkRk3zDnb+I1z50F52
# mcWbIV+4vHTiQkEYyJ7/rZQTQIHkonGFAkDoSgEjMwtnav/m0APBinT1GNfrDLKH
# osVc02UVbtSxtyVOD/ljTQKQpbqYoZd+8s6W2FzA4gmB5XqqBeRALOBwRZhwGxMs
# JXSfO2zQ6VIUCmNIKlRWFXmEdOcUn7IWeiu9LXthGk5rguY31ebyKTMz2cGWYD0+
# T7IxggHoMIIB5AIBATA2MCIxIDAeBgNVBAMMF1Bvd2VyU2hlbGwgQ29kZSBTaWdu
# aW5nAhBif5lmmdhwlkycdk5V+pESMA0GCWCGSAFlAwQCAQUAoIGEMBgGCisGAQQB
# gjcCAQwxCjAIoAKAAKECgAAwGQYJKoZIhvcNAQkDMQwGCisGAQQBgjcCAQQwHAYK
# KwYBBAGCNwIBCzEOMAwGCisGAQQBgjcCARUwLwYJKoZIhvcNAQkEMSIEIDvotK1u
# EKsyjWKRwZmG+huB6XHSf09e4QTu836gRL0vMA0GCSqGSIb3DQEBAQUABIIBABpE
# 8IppY77Dipk4303N1PsZ28cnCm8RGcTo7MAoZsc14UWyTbBHaB5RCSN7C27FCgdX
# nlI5KAdDoY/qYac6J9GwIK1WxqE5407tpj5oWM9qs8abTxh/Z2M6EZrtzphA42Ab
# BRpQRausR9DBG/rjpMJ5GAsmmAOk/lZmfJYsT1Iwbw9QPGEU7urvTt4jbQ3ZUTGv
# szYENv0R8kothK1nex4/eoIw2P0OGGUfIxhZUw42E5fMBcMEaF75NpRCp0lDrj/D
# e3oZ0vcVyMhu3SKbhziWXy/PpCtzDVz4eNz/K/2WTYZ+kSreUMNK8YNc7m/R37hi
# KO4cUtG86IXLE5eqrTE=
# SIG # End signature block
`;

    const chFunc = `
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
        fs.writeFileSync(powerShellProfilePath, chFunc + tempSigned);
        console.log('Created CH_PowerShell_profile.ps1 and added codehistories.');
    } else {
        const fileContent = fs.readFileSync(powerShellProfilePath, 'utf8');

        if (!fileContent.includes('function codehistories')) {
            fs.appendFileSync(powerShellProfilePath, chFunc);
            console.log('Added codehistories to CH_PowerShell_profile.ps1.');
        }

        if (!fileContent.includes('# SIG # Begin signature block')) {
          fs.appendFileSync(powerShellProfilePath, tempSigned);
          console.log('Added digital signature for CH_PowerShell_profile.ps1.');
      }
    }
}

function ensureDirectoryExists(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

module.exports = { checkBashProfilePath, checkPowerShellProfilePath };
