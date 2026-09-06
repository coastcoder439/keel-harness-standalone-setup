import { existsSync, lstatSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { win32 } from "node:path";

const ACL_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$target = [Environment]::GetEnvironmentVariable('UNLAZY_ACL_TARGET', 'Process')
if ([string]::IsNullOrWhiteSpace($target)) { throw 'missing ACL target' }
$item = Get-Item -LiteralPath $target -Force
if (-not $item.PSIsContainer) { throw 'ACL target is not a directory' }
$acl = [System.IO.Directory]::GetAccessControl($item.FullName)
$current = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$owner = $acl.GetOwner([System.Security.Principal.SecurityIdentifier])
$trusted = @($current.Value, 'S-1-5-18', 'S-1-5-32-544', 'S-1-3-0')
$writeMask = [int]([System.Security.AccessControl.FileSystemRights]::Write -bor
  [System.Security.AccessControl.FileSystemRights]::Modify -bor
  [System.Security.AccessControl.FileSystemRights]::FullControl -bor
  [System.Security.AccessControl.FileSystemRights]::Delete -bor
  [System.Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor
  [System.Security.AccessControl.FileSystemRights]::ChangePermissions -bor
  [System.Security.AccessControl.FileSystemRights]::TakeOwnership)
$writableBy = @()
foreach ($rule in $acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier])) {
  if ($rule.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Allow -and
      (([int]$rule.FileSystemRights -band $writeMask) -ne 0) -and
      ($trusted -notcontains $rule.IdentityReference.Value)) {
    $writableBy += $rule.IdentityReference.Value
  }
}
[pscustomobject]@{
  ok = (($owner.Value -eq $current.Value) -and ($writableBy.Count -eq 0))
  ownerSid = $owner.Value
  currentSid = $current.Value
  writableBy = @($writableBy | Sort-Object -Unique)
  protected = $acl.AreAccessRulesProtected
} | ConvertTo-Json -Compress
`;

const HARDEN_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$target = [Environment]::GetEnvironmentVariable('UNLAZY_ACL_TARGET', 'Process')
if ([string]::IsNullOrWhiteSpace($target)) { throw 'missing ACL target' }
$item = Get-Item -LiteralPath $target -Force
if (-not $item.PSIsContainer) { throw 'ACL target is not a directory' }
$current = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$acl = [System.IO.Directory]::GetAccessControl($item.FullName)
$acl.SetAccessRuleProtection($true, $false)
$acl.Access | ForEach-Object { [void]$acl.RemoveAccessRuleSpecific($_) }
$inherit = [System.Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
$propagate = [System.Security.AccessControl.PropagationFlags]::None
$allow = [System.Security.AccessControl.AccessControlType]::Allow
foreach ($sidValue in @($current.Value, 'S-1-5-18', 'S-1-5-32-544')) {
  $sid = New-Object System.Security.Principal.SecurityIdentifier($sidValue)
  $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
    $sid, [System.Security.AccessControl.FileSystemRights]::FullControl,
    $inherit, $propagate, $allow)
  [void]$acl.AddAccessRule($rule)
}
[System.IO.Directory]::SetAccessControl($item.FullName, $acl)
`;

function normalizeRoot(value) {
  return String(value || "").replaceAll("/", "\\").replace(/\\+$/, "");
}

export function windowsPowerShellPath(env = process.env) {
  const systemRoot = normalizeRoot(env.SystemRoot);
  // Headless Windows launchers sometimes omit the historical WINDIR alias.
  // One trusted root is sufficient; when both aliases exist they must still
  // agree exactly so an injected environment cannot redirect the helper.
  const windir = normalizeRoot(env.WINDIR || env.SystemRoot);
  const systemDrive = String(env.SystemDrive || "").replace(/[\\/]+$/, "").toUpperCase();
  const trustedRoot = /^[A-Za-z]:\\Windows$/i;
  if (!trustedRoot.test(systemRoot) || !trustedRoot.test(windir) ||
      systemRoot.toLowerCase() !== windir.toLowerCase() ||
      systemDrive !== systemRoot.slice(0, 2).toUpperCase()) return null;
  return win32.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}

export function verifyWindowsPrivateDirectory(directory, options = {}) {
  const platform = options.platform || process.platform;
  if (platform !== "win32") return { ok: true, platform, skipped: true };
  const env = options.env || process.env;
  const helper = options.helper || windowsPowerShellPath(env);
  if (!helper) throw new Error("trusted Windows PowerShell path is unavailable");
  if (!existsSync(helper)) throw new Error("trusted Windows PowerShell helper does not exist: " + helper);
  const helperInfo = lstatSync(helper);
  if (helperInfo.isSymbolicLink() || !helperInfo.isFile()) {
    throw new Error("trusted Windows PowerShell helper is not a regular file: " + helper);
  }
  const spawn = options.spawnSyncImpl || spawnSync;
  const result = spawn(helper, [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy", "Bypass",
    "-Command", ACL_SCRIPT,
  ], {
    cwd: win32.dirname(helper),
    encoding: "utf8",
    windowsHide: true,
    timeout: options.timeoutMs || 5000,
    env: { ...env, UNLAZY_ACL_TARGET: directory },
  });
  if (result.error) throw new Error("Windows ACL helper failed: " + (result.error.code || result.error.message));
  if (result.status !== 0) {
    throw new Error("Windows ACL helper exited " + result.status + ": " + String(result.stderr || "").trim().slice(0, 500));
  }
  let value;
  try { value = JSON.parse(String(result.stdout || "").trim()); }
  catch { throw new Error("Windows ACL helper returned invalid JSON"); }
  if (!value || typeof value.ok !== "boolean" || !Array.isArray(value.writableBy)) {
    throw new Error("Windows ACL helper returned an invalid result shape");
  }
  if (!value.ok) {
    if (value.ownerSid !== value.currentSid) {
      throw new Error("approval directory owner is not the current Windows user");
    }
    throw new Error("approval directory grants write-capable access to untrusted SID(s): " + (value.writableBy.join(", ") || "unknown"));
  }
  return value;
}

export function hardenWindowsPrivateDirectory(directory, options = {}) {
  const platform = options.platform || process.platform;
  if (platform !== "win32") return { ok: true, platform, skipped: true };
  const env = options.env || process.env;
  const helper = options.helper || windowsPowerShellPath(env);
  if (!helper) throw new Error("trusted Windows PowerShell path is unavailable");
  if (!existsSync(helper)) throw new Error("trusted Windows PowerShell helper does not exist: " + helper);
  const helperInfo = lstatSync(helper);
  if (helperInfo.isSymbolicLink() || !helperInfo.isFile()) {
    throw new Error("trusted Windows PowerShell helper is not a regular file: " + helper);
  }
  const spawn = options.spawnSyncImpl || spawnSync;
  const result = spawn(helper, [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy", "Bypass",
    "-Command", HARDEN_SCRIPT,
  ], {
    cwd: win32.dirname(helper),
    encoding: "utf8",
    windowsHide: true,
    timeout: options.timeoutMs || 5000,
    env: { ...env, UNLAZY_ACL_TARGET: directory },
  });
  if (result.error) throw new Error("Windows ACL hardening helper failed: " + (result.error.code || result.error.message));
  if (result.status !== 0) {
    throw new Error("Windows ACL hardening helper exited " + result.status + ": " + String(result.stderr || "").trim().slice(0, 500));
  }
  return verifyWindowsPrivateDirectory(directory, options);
}
