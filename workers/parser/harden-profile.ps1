param([Parameter(Mandatory=$true)][string]$ProfileDirectory,[Parameter(Mandatory=$true)][string]$Sid)
$ErrorActionPreference='Stop'
$name='fetchcv.parser.m5.20260922'
$folder=[IO.Path]::GetFullPath($ProfileDirectory)
if ([IO.Path]::GetFileName($folder) -ne 'AC' -or [IO.Path]::GetFileName([IO.Path]::GetDirectoryName($folder)) -ne $name -or $Sid -notmatch '^S-1-15-2-(\d+-){6}\d+$') { throw 'Unexpected dedicated parser profile' }
$root=[IO.Path]::GetDirectoryName($folder)
if ((Get-Item -LiteralPath $root).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Reparse profile rejected' }
# Only this new, user-authorized profile. Keep host/SYSTEM/admin access. Merely
# adding a deny ACE did NOT block this profile's critical package allow ACE.
$hostSid=[Security.Principal.WindowsIdentity]::GetCurrent().User
$owners=@($hostSid,(New-Object Security.Principal.SecurityIdentifier('S-1-5-18')),(New-Object Security.Principal.SecurityIdentifier('S-1-5-32-544')))
$files=@((Get-Item -LiteralPath $root))+@(Get-ChildItem -LiteralPath $root -Recurse -Force -ErrorAction Stop)
foreach ($item in $files) {
  if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Profile child reparse point rejected' }
  if ($item.PSIsContainer) { $acl=New-Object Security.AccessControl.DirectorySecurity; $inherit='ContainerInherit, ObjectInherit' }
  else { $acl=New-Object Security.AccessControl.FileSecurity; $inherit='None' }
  $acl.SetAccessRuleProtection($true,$false)
  foreach ($owner in $owners) {
    $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($owner,'FullControl',$inherit,'None','Allow')))
  }
  if ($item.PSIsContainer) { [IO.Directory]::SetAccessControl($item.FullName,$acl) }
  else { [IO.File]::SetAccessControl($item.FullName,$acl) }
}
$key="Software\Classes\Local Settings\Software\Microsoft\Windows\CurrentVersion\AppContainer\Storage\$name"
function Deny-ProfileRegistry([Microsoft.Win32.RegistryKey]$target) {
  $acl=New-Object Security.AccessControl.RegistrySecurity
  $acl.SetAccessRuleProtection($true,$false)
  foreach ($owner in $owners) { $acl.AddAccessRule((New-Object Security.AccessControl.RegistryAccessRule($owner,'FullControl','ContainerInherit','None','Allow'))) }
  $target.SetAccessControl($acl)
  foreach ($childName in $target.GetSubKeyNames()) {
    $child=$target.OpenSubKey($childName,[Microsoft.Win32.RegistryKeyPermissionCheck]::ReadWriteSubTree,[Security.AccessControl.RegistryRights]::FullControl)
    if ($null -eq $child) { throw 'Profile child registry ACL unavailable' }
    try { Deny-ProfileRegistry $child } finally { $child.Dispose() }
  }
}
$target=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($key,[Microsoft.Win32.RegistryKeyPermissionCheck]::ReadWriteSubTree,[Security.AccessControl.RegistryRights]::FullControl)
if ($null -eq $target) { throw 'Dedicated profile registry unavailable' }
try { Deny-ProfileRegistry $target } finally { $target.Dispose() }
Write-Output 'PROFILE_PERSISTENCE_DENIED'
