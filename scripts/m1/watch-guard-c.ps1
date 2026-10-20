<#
================================================================================
 FetchCV M1 —— 方案 C 监视器 helper（**候选；本文件尚未接入 scripts\m1**）
 目标位置（正式接入时）：scripts\m1\watch-guard-c.ps1
 revision: watch-guard-c-candidate-1
================================================================================
 它是什么
   把 run-guarded-node.mjs 里“Node fs.watch 递归监视 + 任何非许可事件即杀子进程”
   那一段，换成已验证的 .NET FileSystemWatcher 过滤组合：

       FileName | DirectoryName | Size | LastWrite | Attributes | CreationTime | Security
       （**排除 LastAccess**）

   证据（本轮不重跑）：r7 真实 watcher 探针
     D:\hesan\Desktop\VSCODES\FetchCV_M1_work\20260910-235136\w12a-watcher-fix-c-r7-20260916-230733
   53 条通知全部按对象引用消费、3 次编号碰撞分别保留、0 消费失败、无 Error 事件；
   S1（陈旧 atime 只读）A_with_lastaccess=1 / B_without_lastaccess=0，
   S2（新鲜 atime 只读）0/0，S3–S7（写/写后恢复/创建/重命名/属性）两侧均收到变更通知。
   => 排除 LastAccess 后只读不再产生通知，而真实变更仍然产生通知。

 它不是什么
   不是把 r7 的七场景探针整套搬过来：这里**没有**场景矩阵、A/B 对照 watcher、
   meta 文件、哈希用例、operations.jsonl。只保留“监视所需逻辑”：
   两个递归 watcher + 就绪握手 + 精确消费 + 原始审计 + 有界收尾。

 权限语义（与正式 runner 逐条一致；不扩大、不缩窄、不按文件名豁免）
   project 根：相对路径 == '.m1-evidence' 或以 '.m1-evidence\' 开头 -> permitted
               相对路径 == '.m1-work'     或以 '.m1-work\'     开头 -> permitted
   approved 根：路径等于 tempRoot 或位于 tempRoot 之下             -> permitted
   其余（包括“项目根本身”这一条）                                 -> permitted = false
   判定对象是**通知路径**；本 helper 自己创建的两个就绪文件、自己的追加审计，
   都不会改变允许集合（它们本来就在允许区内）。

 重命名
   旧路径与新路径**都要判定**：任一侧越界即 permitted=false，并在审计里同时保留
   path（新）、old_path（旧）、permitted_new、permitted_old。

 消费（沿用 r5/r6/r7 的结论，不恢复任何按编号批量移除的写法）
   按**对象引用**在 $Host.Runspace.Events.ReceivedEvents 中定位并 RemoveAt，
   全程只用公开 SDK 接口（Count / SyncRoot / get_Item / RemoveAt），无私有反射；
   **绝不调用 Remove-Event**；EventIdentifier 只是诊断字段，可以重复，绝不用于
   批量移除、去重或豁免。record_seq 是记录身份；一次消费失败 => 写审计、写协议、
   立即停止，不重试、不忽略、不清理。

 失败即停（绝不“继续并报告成功”）
   就绪失败 / 队列处理失败 / watcher Error（溢出等）/ 审计写失败 / 父进程消失
   => 记录并退出非零；runner 见不到干净的 stopped 就会杀掉受测子进程并以 86 结束。

 协议（stdout，每行一个 JSON 对象；本 helper 绝不用 Write-Host，避免污染协议）
   {"type":"precondition",...}  启动自检（参数、根、审计、能力检查、过滤项）
   {"type":"ready",...}         两个 watcher 各自观测到自己的就绪文件
   {"type":"heartbeat",...}     运行期心跳（让 runner 能发现“卡死”）
   {"type":"violation",...}     越界通知（runner 收到即 child.kill()）
   {"type":"error",...}         失败原因（非零退出前）
   {"type":"stopped",...}       干净收尾（有界收尾 + 审计刷新都成功）
   {"type":"failed",...}        非零收尾的汇总（不表示成功）

 退出码
   0 = 观测到停止哨兵，且有界收尾 + 审计刷新全部成功
   2 = 前置/启动失败（参数、根目录、审计文件、能力检查、就绪文件创建）
   3 = 运行期失败（精确消费失败 / 队列处理错误 / watcher Error 溢出 / 审计写失败 / 收尾失败）
   4 = 就绪握手失败（限期内没能各自观测到自己的就绪文件）
   5 = 未预期的内部异常（就绪之后）
   6 = 父进程（runner）已消失

 前置条件
   * 宿主必须能执行本地 .ps1（与现有 .m1-evidence\*\*.ps1 launcher 相同前提）。
   * **不使用 ExecutionPolicy Bypass**；不提权；不改任何全局配置；不安装任何东西。
   * 审计文件必须由 runner 先用 wx 建好：本 helper 只追加，不创建、不覆盖、不清空。
   * 本 helper 只创建两个就绪文件（CreateNew：已存在即拒绝）并向审计追加；
     不删除、不移动、不改任何被监视内容；不清理、不回滚。
 写出者纪律
   审计文件（-fswatch.jsonl）由**本 helper 独占追加**，runner 不再写它；
   协议文件与 helper stderr 由 runner 写。若两者都由同一进程写会互相放大通知。
================================================================================
#>
[CmdletBinding()]
param(
  [string]$ProjectRoot = '',
  [string]$ApprovedRoot = '',
  [string]$TempRoot = '',
  [string]$AuditPath = '',
  [string]$ReadinessProjectPath = '',
  [string]$ReadinessApprovedPath = '',
  [string]$StopSentinelPath = '',
  [int]$ParentPid = 0,
  [int]$PollMs = 50,
  [int]$ReadinessMs = 15000,
  [int]$FinalDrainMs = 800,
  [int]$HeartbeatMs = 1000
)

$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------- 固定期望
$script:HelperRevision = 'watch-guard-c-candidate-1'
$script:NotifyFilters = [System.IO.NotifyFilters]::FileName -bor [System.IO.NotifyFilters]::DirectoryName -bor [System.IO.NotifyFilters]::Size -bor [System.IO.NotifyFilters]::LastWrite -bor [System.IO.NotifyFilters]::Attributes -bor [System.IO.NotifyFilters]::CreationTime -bor [System.IO.NotifyFilters]::Security
$script:EventKinds = @('Created', 'Changed', 'Renamed', 'Deleted', 'Error')
$script:InternalBufferSize = 65536
$script:Utf8 = [System.Text.UTF8Encoding]::new($false)

# ---------------------------------------------------------------- 状态
$script:Stage = 'startup'
$script:ExitCode = 0
$script:Ready = $false
$script:StopRequest = $null
$script:StopReason = 'not-stopped'
$script:Audit = $null
$script:AuditLines = 0
$script:AuxRecords = 0
$script:NotificationRecords = 0
$script:DeferredSelfRecords = New-Object System.Collections.ArrayList
$script:SelfReferenceCount = 0
$script:SubMap = @{}
$script:Subs = @()
$script:Watchers = New-Object System.Collections.ArrayList
$script:RecordSeq = 0
$script:ObservedIds = @{}
$script:IdentifierCollisions = New-Object System.Collections.ArrayList
$script:ViolationCount = 0
$script:HandledTotal = 0
$script:HandledFinal = 0
$script:ConsumptionFailures = 0
$script:AuditIntegrityLost = $false
$script:ReadinessProjectSeen = $false
$script:ReadinessApprovedSeen = $false
$script:ReadinessElapsedMs = $null
$script:TeardownSteps = New-Object System.Collections.ArrayList
$script:TeardownFailures = New-Object System.Collections.ArrayList
$script:ReceivedEvents = $null
$script:ConsumptionCapability = $null
$script:Summary = $null
$script:Failure = $null
$script:ProtocolSeq = 0
$script:AuditFlushOk = $null
$script:AuditBytesFinal = $null
$script:StoppedCleanly = $false

# ================================================================ helpers
function Write-Protocol($Message) {
  $script:ProtocolSeq++
  $record = [ordered]@{ seq = $script:ProtocolSeq; at_utc = [DateTime]::UtcNow.ToString('o') }
  foreach ($key in $Message.Keys) { $record[$key] = $Message[$key] }
  $line = $record | ConvertTo-Json -Depth 8 -Compress
  [Console]::Out.WriteLine($line)
  [Console]::Out.Flush()
}
function New-ProtocolMessage([string]$Type, $Source) {
  $message = [ordered]@{ type = $Type }
  if ($null -ne $Source) { foreach ($key in $Source.Keys) { if ($key -ne 'type') { $message[$key] = $Source[$key] } } }
  return $message
}
function Write-HelperError([string]$Text) {
  try { [Console]::Error.WriteLine($Text) } catch { }
}
function Request-Stop([int]$ExitCode, [string]$Stage, [string]$Reason, [string]$Message) {
  $script:StopRequest = @{ exit_code = $ExitCode; stage = $Stage; reason = $Reason; message = $Message }
  throw [System.Exception]::new($Message)
}
function Add-TeardownStep([string]$Step, [string]$Target, [bool]$Ok, [string]$ErrorText) {
  $record = [ordered]@{ step = $Step; target = $Target; ok = $Ok; error = $ErrorText; at_utc = [DateTime]::UtcNow.ToString('o') }
  [void]$script:TeardownSteps.Add($record)
  if (-not $Ok) { [void]$script:TeardownFailures.Add($record) }
}
function Get-FilterNames([System.IO.NotifyFilters]$Filter) {
  return @([System.IO.NotifyFilters].GetEnumNames() | Where-Object { $Filter.HasFlag([System.IO.NotifyFilters]$_) })
}
function Open-AuditStream([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { throw "the audit file does not exist (the runner must create it with wx before the helper starts): $Path" }
  $stream = [System.IO.FileStream]::new($Path, [System.IO.FileMode]::Append, [System.IO.FileAccess]::Write, [System.IO.FileShare]::Read)
  $writer = [System.IO.StreamWriter]::new($stream, $script:Utf8)
  $writer.AutoFlush = $true
  return @{ stream = $stream; writer = $writer }
}
function Write-AuditRecord($Record) {
  $line = $Record | ConvertTo-Json -Depth 8 -Compress
  try {
    $script:Audit.writer.WriteLine($line)
  } catch {
    # 审计写失败 => 证据完整性已破坏：标记并向上抛（调用方据此以非零码停止，绝不继续）
    $script:AuditIntegrityLost = $true
    throw
  }
  $script:AuditLines++
  if ($Record.Contains('type') -and $Record['type'] -eq 'notification') { } else { $script:AuxRecords++ }
}
# 相对路径（只用公开 API；.NET Framework/PS 5.1 没有 Path.GetRelativePath）
#   返回 ''            => 等于 base
#   返回 'sub\x'       => 位于 base 之内
#   返回 '..'          => 位于 base 之外（判定只需要“在外面”这一事实，绝对路径另存）
function Get-RelativePathSafe([string]$Base, [string]$Target) {
  if ([string]::IsNullOrWhiteSpace($Base) -or [string]::IsNullOrWhiteSpace($Target)) { return '..' }
  $b = [System.IO.Path]::GetFullPath($Base).TrimEnd('\')
  $t = [System.IO.Path]::GetFullPath($Target).TrimEnd('\')
  if ($b.StartsWith('\\?\')) { $b = $b.Substring(4) }
  if ($t.StartsWith('\\?\')) { $t = $t.Substring(4) }
  if ($b -ieq $t) { return '' }
  if ($t.ToLowerInvariant().StartsWith($b.ToLowerInvariant() + '\')) { return $t.Substring($b.Length + 1) }
  return '..'
}
function Test-SamePath([string]$Left, [string]$Right) {
  if ([string]::IsNullOrWhiteSpace($Left) -or [string]::IsNullOrWhiteSpace($Right)) { return $false }
  return ([System.IO.Path]::GetFullPath($Left).TrimEnd('\') -ieq [System.IO.Path]::GetFullPath($Right).TrimEnd('\'))
}
function Get-PathVerdict([string]$RootKind, [string]$Changed) {
  $projectRelative = Get-RelativePathSafe $ProjectRoot $Changed
  $tempRelative = Get-RelativePathSafe $TempRoot $Changed
  $inEvidence = ($projectRelative -ieq '.m1-evidence') -or $projectRelative.StartsWith('.m1-evidence\', [System.StringComparison]::OrdinalIgnoreCase)
  $inWork = ($projectRelative -ieq '.m1-work') -or $projectRelative.StartsWith('.m1-work\', [System.StringComparison]::OrdinalIgnoreCase)
  $outsideTemp = ($tempRelative -eq '..') -or $tempRelative.StartsWith('..\', [System.StringComparison]::OrdinalIgnoreCase)
  $inTemp = -not $outsideTemp
  if ($RootKind -eq 'project') { $permitted = ($inEvidence -or $inWork) } else { $permitted = $inTemp }
  return @{ permitted = [bool]$permitted; project_relative = $projectRelative; temp_relative = $tempRelative
            in_evidence = [bool]$inEvidence; in_work = [bool]$inWork; in_temp = [bool]$inTemp }
}
function Get-EventPath([string]$Root, [string]$Name) {
  if ([string]::IsNullOrEmpty($Name)) { return [System.IO.Path]::GetFullPath($Root) }
  return [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($Root, $Name))
}
function Test-ProcessAlive([int]$ProcessId) {
  if ($ProcessId -le 0) { return $false }
  try { $process = Get-Process -Id $ProcessId -ErrorAction Stop; return ($null -ne $process) } catch { return $false }
}
function New-FreshFile([string]$Path, [string]$What) {
  if (Test-Path -LiteralPath $Path) { throw "$What already exists; this helper never overwrites an existing file: $Path" }
  $stream = [System.IO.FileStream]::new($Path, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::Read)
  $stream.Dispose()
  if (-not (Test-Path -LiteralPath $Path)) { throw "$What could not be created: $Path" }
}
# ---- r7 能力检查：PS 5.1 的索引器是 PSObject.Methods 里的 get_Item（Properties 里没有 Item）----
function Get-ConsumptionCapability($Collection) {
  $capability = @{ reachable = $false
                   has_count = $false; has_sync_root = $false; has_remove_at = $false; has_indexer = $false
                   method_names = @(); property_names = @()
                   indexer_evidence = @{ get_Item_method = $false; Item_property = $false
                                         note = 'Windows PowerShell 5.1 exposes an indexer as the get_Item method on PSObject.Methods; Item is not listed in PSObject.Properties' }
                   queue_count_at_start = $null }
  if ($null -eq $Collection) { return $capability }
  $capability.reachable = $true
  $methodNames = @($Collection.PSObject.Methods | ForEach-Object { $_.Name })
  $propertyNames = @($Collection.PSObject.Properties | ForEach-Object { $_.Name })
  $capability.method_names = $methodNames
  $capability.property_names = $propertyNames
  $capability.has_count = ($propertyNames -contains 'Count')
  $capability.has_sync_root = ($propertyNames -contains 'SyncRoot')
  $capability.has_remove_at = ($methodNames -contains 'RemoveAt')
  $getItemMethod = ($methodNames -contains 'get_Item')
  $itemProperty = ($propertyNames -contains 'Item')
  $capability.indexer_evidence = @{ get_Item_method = $getItemMethod; Item_property = $itemProperty
                                    note = 'Windows PowerShell 5.1 exposes an indexer as the get_Item method on PSObject.Methods; Item is not listed in PSObject.Properties' }
  $capability.has_indexer = ($getItemMethod -or $itemProperty)
  try { $capability.queue_count_at_start = [int]$Collection.Count } catch { $capability.queue_count_at_start = $null }
  return $capability
}
# ---- 精确消费：按对象引用定位 + 复核槽位 + RemoveAt（公开接口；函数本身不产生管道输出）----
function Remove-NotificationByReference($Ev) {
  $collection = $script:ReceivedEvents
  $result = @{ removal_method = 'Runspace.Events.ReceivedEvents.RemoveAt(index found by object reference) under SyncRoot'
               removal_attempted = $true; found_by_reference = $false; index = $null
               index_reverified_by_reference = $false; count_before = $null; count_after = $null; delta = $null
               ok = $false; error_message = $null }
  $entered = $false
  try {
    [System.Threading.Monitor]::Enter($collection.SyncRoot)
    $entered = $true
    $result.count_before = [int]$collection.Count
    $index = -1
    for ($i = 0; $i -lt $collection.Count; $i++) {
      if ([object]::ReferenceEquals($collection[$i], $Ev)) { $index = $i; break }
    }
    if ($index -lt 0) {
      $result.error_message = 'the notification object is no longer present in ReceivedEvents (nothing was removed)'
      $result.count_after = [int]$collection.Count
      $result.delta = $result.count_before - $result.count_after
      return $result
    }
    $result.found_by_reference = $true
    $result.index = $index
    # 复核：该下标此刻确实还是我们的那个对象（“移除未报错”本身不构成“消费了正确通知”的证明）
    $result.index_reverified_by_reference = [object]::ReferenceEquals($collection[$index], $Ev)
    if (-not $result.index_reverified_by_reference) {
      $result.error_message = 'the slot at the found index no longer holds this notification object'
      $result.count_after = [int]$collection.Count
      $result.delta = $result.count_before - $result.count_after
      return $result
    }
    $collection.RemoveAt($index)
    $result.count_after = [int]$collection.Count
    $result.delta = $result.count_before - $result.count_after
    $result.ok = $true
    return $result
  } catch {
    $result.error_message = [string]$_.Exception.Message
    return $result
  } finally {
    if ($entered) { [System.Threading.Monitor]::Exit($collection.SyncRoot) }
  }
}
function Get-QueueSnapshot {
  $snapshot = @()
  foreach ($e in @(Get-Event -ErrorAction SilentlyContinue)) {
    if ($script:SubMap.ContainsKey($e.SourceIdentifier)) {
      $snapshot += @{ event_identifier = [int]$e.EventIdentifier; source_identifier = [string]$e.SourceIdentifier
                      kind = $script:SubMap[$e.SourceIdentifier].kind; name = [string]$e.SourceEventArgs.Name }
    }
  }
  return $snapshot
}
# ---- 单条通知：判定 -> 精确消费 -> 原始审计 -> （越界则）协议上报 ----
function Process-Notification($Event, [string]$Phase) {
  $meta = $script:SubMap[$Event.SourceIdentifier]
  if ($null -eq $meta) { return }                       # 外来事件：既不记录也不移除
  $kind = $meta.kind
  $eventId = [int]$Event.EventIdentifier
  $name = $null; $oldName = $null; $changeType = $null; $exceptionMessage = $null
  if ($kind -eq 'Error') {
    $exceptionMessage = $Event.SourceEventArgs.GetException().Message
  } else {
    $name = [string]$Event.SourceEventArgs.Name
    if ($kind -eq 'Renamed') { $oldName = [string]$Event.SourceEventArgs.OldName }
    $changeType = [string]$Event.SourceEventArgs.ChangeType
  }
  $root = $meta.root
  $newPath = $null; $oldPath = $null; $verdictNew = $null; $verdictOld = $null; $permittedOld = $null
  if ($kind -ne 'Error') {
    $newPath = Get-EventPath $root $name
    if ($kind -eq 'Renamed' -and -not [string]::IsNullOrEmpty($oldName)) { $oldPath = Get-EventPath $root $oldName }
    $verdictNew = Get-PathVerdict $meta.tag $newPath
    if ($null -ne $oldPath) { $verdictOld = Get-PathVerdict $meta.tag $oldPath; $permittedOld = [bool]$verdictOld.permitted }
  }
  # 就绪握手：只认"路径恰好等于就绪文件"的非 Error 通知
  if ($null -ne $newPath) {
    if (Test-SamePath $newPath $ReadinessProjectPath) { $script:ReadinessProjectSeen = $true }
    if (Test-SamePath $newPath $ReadinessApprovedPath) { $script:ReadinessApprovedSeen = $true }
  }
  # 越界判定：任一侧越界即 false（重命名必须核对旧、新两个路径）
  if ($kind -eq 'Error') { $permitted = $false }
  else { $permitted = ([bool]$verdictNew.permitted) -and (($null -eq $permittedOld) -or $permittedOld) }

  $script:RecordSeq++
  $recordSeq = $script:RecordSeq
  $script:NotificationRecords++
  $previousSameId = $script:ObservedIds[$eventId]
  $collision = ($null -ne $previousSameId)
  if ($collision) {
    [void]$script:IdentifierCollisions.Add(@{ record_seq = $recordSeq; event_identifier = $eventId; root_kind = $meta.tag
      previous_record_seq = $previousSameId.record_seq; same_source_identifier = ([string]$previousSameId.source_identifier -eq [string]$Event.SourceIdentifier) })
  }
  $script:ObservedIds[$eventId] = @{ record_seq = $recordSeq; event_identifier = $eventId
    source_identifier = [string]$Event.SourceIdentifier; kind = $kind; root_kind = $meta.tag; name = $name; old_name = $oldName }

  $queuedUtc = $Event.TimeGenerated.ToUniversalTime()
  $isSelfReference = (Test-SamePath $newPath $AuditPath) -or (Test-SamePath $oldPath $AuditPath)
  $consumption = Remove-NotificationByReference $Event

  $record = [ordered]@{
    type = 'notification'
    record_seq = $recordSeq
    time = [int64]([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())
    event = $kind
    root = $root
    root_kind = $meta.tag
    path = $newPath
    old_path = $oldPath
    permitted = [bool]$permitted
    permitted_new = $(if ($null -ne $verdictNew) { [bool]$verdictNew.permitted } else { $null })
    permitted_old = $permittedOld
    verdict_new = $verdictNew
    verdict_old = $verdictOld
    name = $name
    old_name = $oldName
    change_type = $changeType
    exception = $exceptionMessage
    event_identifier = $eventId
    source_identifier = [string]$Event.SourceIdentifier
    event_identifier_seen_before = $collision
    previous_record_with_same_identifier = $previousSameId
    event_queued_utc = $queuedUtc.ToString('o')
    collected_utc = [DateTime]::UtcNow.ToString('o')
    phase = $Phase
    self_reference = [bool]$isSelfReference
    consumer = $consumption
    identity_note = 'record_seq is this helper own observation sequence and IS the record identity; event_identifier is a DIAGNOSTIC field only and may repeat across different notifications'
    timing_note = 'event_queued_utc is when PowerShell queued the notification and collected_utc is when the loop read it; neither is the OS-level moment of the change'
    exemption_note = 'no later state clears this record: a violation stays a violation even if the file is restored, and an unchanged final hash never substitutes for an audited write'
  }
  if ($isSelfReference) {
    # 自引用（审计文件自身的通知）先缓存，等 watcher 全部停止后再落盘：
    # 否则"写审计 -> 产生通知 -> 再写审计"会自我放大。/ 计数一分不少，绝不静默丢弃。
    $script:SelfReferenceCount++
    [void]$script:DeferredSelfRecords.Add($record)
  } else {
    Write-AuditRecord $record
  }

  if (-not $consumption.ok) {
    $script:ConsumptionFailures++
    $script:AuditIntegrityLost = $true
    Write-AuditRecord @{ type = 'failure'; stage = 'running'; reason = 'PRECISE_CONSUMPTION_FAILURE'
      record_seq = $recordSeq; event_identifier = $eventId; source_identifier = [string]$Event.SourceIdentifier
      path = $newPath; error_message = $consumption.error_message; consumer = $consumption
      queue_snapshot = @(Get-QueueSnapshot); at_utc = [DateTime]::UtcNow.ToString('o') }
    Request-Stop 3 'running' 'PRECISE_CONSUMPTION_FAILURE' "precise consumption failed for record_seq $recordSeq (event_identifier $eventId): $($consumption.error_message)"
  }

  if ($kind -eq 'Error') {
    Write-AuditRecord @{ type = 'failure'; stage = 'running'; reason = 'WATCHER_ERROR_EVENT'
      path = $root; exception = $exceptionMessage; at_utc = [DateTime]::UtcNow.ToString('o') }
    Request-Stop 3 'running' 'WATCHER_ERROR_EVENT' "FileSystemWatcher reported an Error event (internal buffer overflow or internal failure): $exceptionMessage"
  }

  if (-not $permitted) {
    $script:ViolationCount++
    Write-Protocol @{ type = 'violation'; kind = $kind; path = $newPath; old_path = $oldPath
      root_kind = $meta.tag; root = $root; permitted = $false
      permitted_new = $record.permitted_new; permitted_old = $permittedOld
      record_seq = $recordSeq; change_type = $changeType; name = $name; old_name = $oldName
      collected_utc = $record.collected_utc
      note = 'non-permitted notification: the runner kills the child process and never reports success' }
  }
}
# ---- 有界收集：Get-Event 非阻塞 + 短等待；内外都检查 deadline ----
function Drain-Queue([string]$Phase, [int]$WindowMs) {
  $deadline = [DateTime]::UtcNow.AddMilliseconds($WindowMs)
  $handled = 0
  while ($true) {
    if ([DateTime]::UtcNow -ge $deadline) { break }
    $mine = @(Get-Event -ErrorAction SilentlyContinue | Where-Object { $script:SubMap.ContainsKey($_.SourceIdentifier) })
    if ($mine.Count -eq 0) {
      $remaining = [int][Math]::Floor(($deadline - [DateTime]::UtcNow).TotalMilliseconds)
      if ($remaining -le 0) { break }
      Start-Sleep -Milliseconds ([Math]::Min($PollMs, $remaining))
      continue
    }
    foreach ($e in $mine) {
      if ([DateTime]::UtcNow -ge $deadline) { break }
      Process-Notification $e $Phase
      $handled++
      $script:HandledTotal++
    }
  }
  return [int]$handled
}
function New-GuardedWatcher([string]$Tag, [string]$Root) {
  $watcher = [System.IO.FileSystemWatcher]::new()
  $watcher.Path = $Root
  $watcher.Filter = '*'
  $watcher.IncludeSubdirectories = $true
  $watcher.NotifyFilter = $script:NotifyFilters
  $watcher.InternalBufferSize = $script:InternalBufferSize
  $subscriptions = @()
  foreach ($kind in $script:EventKinds) {
    $sourceId = "m1guard-$Tag-$kind-$([Guid]::NewGuid().ToString('N'))"
    $null = Register-ObjectEvent -InputObject $watcher -EventName $kind -SourceIdentifier $sourceId
    $script:SubMap[$sourceId] = @{ tag = $Tag; kind = $kind; root = $Root }
    $subscriptions += $sourceId
  }
  $script:Subs += $subscriptions
  [void]$script:Watchers.Add(@{ tag = $Tag; root = $Root; watcher = $watcher; subscriptions = $subscriptions })
  return @{ tag = $Tag; root = $Root; watcher = $watcher; subscriptions = $subscriptions }
}

# ================================================================ 主流程
try {
  # ---------------- 前置：参数与路径（在创建任何东西之前）----------------
  $script:Stage = 'preconditions'
  $missing = @()
  foreach ($pair in @(
      @{ name = '-ProjectRoot'; value = $ProjectRoot },
      @{ name = '-ApprovedRoot'; value = $ApprovedRoot },
      @{ name = '-TempRoot'; value = $TempRoot },
      @{ name = '-AuditPath'; value = $AuditPath },
      @{ name = '-ReadinessProjectPath'; value = $ReadinessProjectPath },
      @{ name = '-ReadinessApprovedPath'; value = $ReadinessApprovedPath },
      @{ name = '-StopSentinelPath'; value = $StopSentinelPath })) {
    if ([string]::IsNullOrWhiteSpace($pair.value)) { $missing += $pair.name }
  }
  if ($missing.Count -gt 0) { throw "missing required argument(s): $($missing -join ', ')" }
  if ($ParentPid -le 0) { throw "-ParentPid must be a positive process id; got $ParentPid" }
  if ($PollMs -lt 5 -or $PollMs -gt 500) { throw "-PollMs must be within [5,500] ms; got $PollMs" }
  if ($ReadinessMs -lt 1000 -or $ReadinessMs -gt 60000) { throw "-ReadinessMs must be within [1000,60000] ms; got $ReadinessMs" }
  if ($FinalDrainMs -lt 100 -or $FinalDrainMs -gt 10000) { throw "-FinalDrainMs must be within [100,10000] ms; got $FinalDrainMs" }
  if ($HeartbeatMs -lt 250 -or $HeartbeatMs -gt 60000) { throw "-HeartbeatMs must be within [250,60000] ms; got $HeartbeatMs" }
  foreach ($root in @(@{ kind = 'project'; path = $ProjectRoot }, @{ kind = 'approved'; path = $ApprovedRoot }, @{ kind = 'temp'; path = $TempRoot })) {
    if (-not (Test-Path -LiteralPath $root.path)) { throw "the $($root.kind) root does not exist: $($root.path)" }
    if (-not (Get-Item -LiteralPath $root.path).PSIsContainer) { throw "the $($root.kind) root is not a directory: $($root.path)" }
  }
  if ((Get-RelativePathSafe $ApprovedRoot $TempRoot) -eq '..') { throw "-TempRoot must live inside -ApprovedRoot ($ApprovedRoot); got $TempRoot" }
  if (-not (Test-Path -LiteralPath $AuditPath)) { throw "the audit file does not exist (the runner must create it with wx before the helper starts): $AuditPath" }
  # 就绪文件与停止哨兵必须落在允许区内（否则本 helper 自己就会制造越界通知）
  foreach ($pair in @(
      @{ kind = 'project'; path = $ReadinessProjectPath; what = '-ReadinessProjectPath' },
      @{ kind = 'approved'; path = $ReadinessApprovedPath; what = '-ReadinessApprovedPath' },
      @{ kind = 'approved'; path = $StopSentinelPath; what = '-StopSentinelPath' })) {
    $verdict = Get-PathVerdict $pair.kind $pair.path
    if (-not $verdict.permitted) { throw "$($pair.what) must live inside the permitted set (project: .m1-evidence / .m1-work; approved: tempRoot); got $($pair.path)" }
  }

  # ---------------- 精确消费能力（不可用即 exit 2，绝不回退到 Remove-Event）----------------
  $script:Stage = 'consumption-capability'
  try {
    $events = $Host.Runspace.Events
    if ($null -ne $events) { $script:ReceivedEvents = $events.ReceivedEvents }
  } catch { $script:ReceivedEvents = $null }
  $script:ConsumptionCapability = Get-ConsumptionCapability $script:ReceivedEvents
  $capability = $script:ConsumptionCapability
  if (-not ($capability.reachable -and $capability.has_count -and $capability.has_sync_root -and $capability.has_remove_at -and $capability.has_indexer)) {
    Write-HelperError 'precise per-notification consumption is NOT available on this host'
    Write-HelperError 'need: $Host.Runspace.Events.ReceivedEvents with Count + SyncRoot + an indexer (get_Item) + RemoveAt (public SDK API)'
    Write-HelperError ('observed: ' + ($capability | ConvertTo-Json -Depth 6 -Compress))
    Write-HelperError 'refusing to fall back to Remove-Event (batch removal by identifier can remove other notifications)'
    Write-Protocol @{ type = 'error'; stage = 'consumption-capability'; reason = 'PRECISE_CONSUMPTION_UNAVAILABLE'
      message = 'precise per-notification consumption is not available on this host'
      capability = $capability; revision = $script:HelperRevision }
    $script:ExitCode = 2
    $script:StopReason = 'capability-unavailable'
    $script:Summary = [ordered]@{ type = 'summary'; revision = $script:HelperRevision; stop_reason = 'capability-unavailable'
      consumption_capability = $capability; notification_records = 0; record_seq_high_water = 0; violations = 0
      audit_lines_total = $script:AuditLines; note = 'nothing was created; no watcher was started' }
  } else {
    # ---------------- 审计流 + 启动记录 ----------------
    $script:Stage = 'audit-open'
    $script:Audit = Open-AuditStream $AuditPath
    $includedFilters = @(Get-FilterNames $script:NotifyFilters)
    $excludedFilters = @([System.IO.NotifyFilters].GetEnumNames() | Where-Object { $includedFilters -notcontains $_ })
    Write-AuditRecord @{ type = 'start'; revision = $script:HelperRevision; at_utc = [DateTime]::UtcNow.ToString('o')
      project_root = $ProjectRoot; approved_root = $ApprovedRoot; temp_root = $TempRoot; audit_path = $AuditPath
      parent_pid = $ParentPid; helper_pid = $PID; poll_ms = $PollMs; readiness_ms = $ReadinessMs; final_drain_ms = $FinalDrainMs; heartbeat_ms = $HeartbeatMs
      included_filters = $includedFilters; excluded_filters = $excludedFilters
      permission_model = 'project root: .m1-evidence / .m1-work subtrees; approved root: tempRoot subtree; everything else is a violation'
      rename_model = 'a Renamed notification checks BOTH the old and the new path; either side outside the permitted set makes it a violation'
      consumption_model = 'per-notification removal by object reference (SyncRoot + get_Item + RemoveAt); Remove-Event is never called'
      exemption_model = 'no final-hash or restored-content comparison can clear an audited write' }
    Write-Protocol @{ type = 'precondition'; revision = $script:HelperRevision
      project_root = $ProjectRoot; approved_root = $ApprovedRoot; temp_root = $TempRoot; audit_path = $AuditPath
      parent_pid = $ParentPid; helper_pid = $PID; poll_ms = $PollMs; readiness_ms = $ReadinessMs; final_drain_ms = $FinalDrainMs; heartbeat_ms = $HeartbeatMs
      include_subdirectories = $true; internal_buffer_size = $script:InternalBufferSize
      notify_filters = $includedFilters; excluded_filters = $excludedFilters; event_kinds = $script:EventKinds
      readiness_project_file = $ReadinessProjectPath; readiness_approved_file = $ReadinessApprovedPath; stop_sentinel = $StopSentinelPath
      consumption_capability = $capability
      capability_contract = 'Runspace.Events.ReceivedEvents + Count + SyncRoot + get_Item indexer + RemoveAt; Remove-Event is never called' }

    # ---------------- watcher：先订阅，再启用 ----------------
    $script:Stage = 'watchers'
    $null = New-GuardedWatcher 'project' $ProjectRoot
    $null = New-GuardedWatcher 'approved' $ApprovedRoot
    foreach ($entry in $script:Watchers) { $entry.watcher.EnableRaisingEvents = $true }
    foreach ($entry in $script:Watchers) {
      if (-not $entry.watcher.EnableRaisingEvents) { throw "the $($entry.tag) watcher refused to enable: $($entry.root)" }
    }

    # ---------------- 就绪握手：两个 watcher 必须各自观测到自己的就绪文件 ----------------
    $script:Stage = 'readiness'
    New-FreshFile $ReadinessProjectPath 'the project readiness file'
    New-FreshFile $ReadinessApprovedPath 'the approved readiness file'
    [System.IO.File]::WriteAllText($ReadinessProjectPath, ("{`"revision`":`"$($script:HelperRevision)`",`"role`":`"project-watcher-readiness`"}`n"), $script:Utf8)
    [System.IO.File]::WriteAllText($ReadinessApprovedPath, ("{`"revision`":`"$($script:HelperRevision)`",`"role`":`"approved-watcher-readiness`"}`n"), $script:Utf8)
    $readyStart = [DateTime]::UtcNow
    $readyDeadline = $readyStart.AddMilliseconds($ReadinessMs)
    while ([DateTime]::UtcNow -lt $readyDeadline) {
      if ($script:ReadinessProjectSeen -and $script:ReadinessApprovedSeen) { break }
      $null = Drain-Queue 'readiness' 150
    }
    $script:ReadinessElapsedMs = [int](([DateTime]::UtcNow - $readyStart).TotalMilliseconds)
    Write-AuditRecord @{ type = 'drain'; phase = 'readiness'; elapsed_ms = $script:ReadinessElapsedMs
      project_seen = $script:ReadinessProjectSeen; approved_seen = $script:ReadinessApprovedSeen
      handled_total = $script:HandledTotal; at_utc = [DateTime]::UtcNow.ToString('o') }
    if (-not ($script:ReadinessProjectSeen -and $script:ReadinessApprovedSeen)) {
      Request-Stop 4 'readiness' 'READINESS_HANDSHAKE_FAILED' "readiness handshake failed within $ReadinessMs ms: project_watcher_seen=$($script:ReadinessProjectSeen) approved_watcher_seen=$($script:ReadinessApprovedSeen)"
    }
    $script:Ready = $true
    Write-Protocol @{ type = 'ready'; revision = $script:HelperRevision
      readiness_ms = $script:ReadinessElapsedMs; project_seen = $true; approved_seen = $true
      readiness_project_file = $ReadinessProjectPath; readiness_approved_file = $ReadinessApprovedPath
      stop_sentinel = $StopSentinelPath; notify_filters = $includedFilters; excluded_filters = $excludedFilters
      subscription_count = $script:Subs.Count
      note = 'both recursive watchers are subscribed and enabled, and each has already delivered a notification about its own readiness file; the runner may now start the child process' }

    # ---------------- 运行期：有界轮询 + 心跳 + 停止哨兵/父进程检查 ----------------
    $script:Stage = 'running'
    $lastHeartbeat = [DateTime]::UtcNow
    $lastParentCheck = [DateTime]::UtcNow
    while ($true) {
      if (Test-Path -LiteralPath $StopSentinelPath) { $script:StopReason = 'stop_sentinel'; break }
      if ((([DateTime]::UtcNow) - $lastParentCheck).TotalMilliseconds -ge 500) {
        $lastParentCheck = [DateTime]::UtcNow
        if (-not (Test-ProcessAlive $ParentPid)) { $script:StopReason = 'parent_gone'; break }
      }
      $null = Drain-Queue 'running' $PollMs
      if ((([DateTime]::UtcNow) - $lastHeartbeat).TotalMilliseconds -ge $HeartbeatMs) {
        $lastHeartbeat = [DateTime]::UtcNow
        Write-Protocol @{ type = 'heartbeat'; revision = $script:HelperRevision; phase = 'running'
          handled_total = $script:HandledTotal; record_seq = $script:RecordSeq; violations = $script:ViolationCount
          consumption_failures = $script:ConsumptionFailures; audit_lines = $script:AuditLines
          queue_count = [int]$script:ReceivedEvents.Count }
      }
    }
    if ($script:StopReason -eq 'parent_gone') {
      Request-Stop 6 'running' 'PARENT_GONE' "the parent process ($ParentPid) is gone; stopping instead of watching forever"
    }
  }
} catch {
  $failure = @{ stage = $script:Stage; message = $_.Exception.Message; error_type = $_.Exception.GetType().Name
                script_stack = ($_.ScriptStackTrace -split "`n" | Select-Object -First 8) }
  if ($null -ne $script:StopRequest) {
    $script:ExitCode = $script:StopRequest.exit_code
    $failure.reason = $script:StopRequest.reason
    $failure.stage = $script:StopRequest.stage
  } elseif ($script:Ready) {
    if ($script:AuditIntegrityLost) {
      $script:ExitCode = 3
      $failure.reason = 'AUDIT_WRITE_FAILURE'
    } else {
      $script:ExitCode = 5
      $failure.reason = 'UNEXPECTED_INTERNAL_ERROR'
    }
  } else {
    $script:ExitCode = 2
    $failure.reason = 'STARTUP_FAILURE'
  }
  if ($script:StopReason -eq 'not-stopped') { $script:StopReason = "failed:$($failure.reason)" }
  $script:Failure = $failure
  Write-HelperError "watch-guard-c helper FAILED at stage '$($failure.stage)': $($failure.message)"
  foreach ($line in $failure.script_stack) { Write-HelperError "  at $line" }
  try {
    Write-Protocol @{ type = 'error'; revision = $script:HelperRevision; stage = $failure.stage; reason = $failure.reason
      message = $failure.message; error_type = $failure.error_type; script_stack = $failure.script_stack
      stop_reason = $script:StopReason; ready = $script:Ready }
  } catch { Write-HelperError 'could not write the error protocol line to stdout' }
} finally {
  # ---- 收尾：每一步单独 try/catch，失败登记；绝不无条件声称成功 ----
  # 1) 先停 watcher：之后写审计不会再产生新通知
  foreach ($entry in @($script:Watchers)) {
    if ($null -ne $entry -and $null -ne $entry.watcher) {
      try { $entry.watcher.EnableRaisingEvents = $false; Add-TeardownStep 'stop_watcher' "$($entry.tag):$($entry.root)" $true $null }
      catch { Add-TeardownStep 'stop_watcher' "$($entry.tag):$($entry.root)" $false $_.Exception.Message }
    }
  }
  # 2) 有界收尾（只在 watcher 已就绪、且审计完整性未被破坏时）
  if ($script:Ready -and -not $script:AuditIntegrityLost -and $null -ne $script:Audit) {
    try {
      $script:HandledFinal = Drain-Queue 'final' $FinalDrainMs
      Write-AuditRecord @{ type = 'drain'; phase = 'final'; window_ms = $FinalDrainMs; handled = $script:HandledFinal
        queue_count_after = [int]$script:ReceivedEvents.Count; at_utc = [DateTime]::UtcNow.ToString('o')
        note = 'bounded final drain after the watchers were stopped; it shrinks but does not eliminate the window between a change and the notification being queued' }
      Add-TeardownStep 'final_drain' 'bounded final queue drain' $true $null
    } catch {
      Add-TeardownStep 'final_drain' 'bounded final queue drain' $false $_.Exception.Message
      if ($script:ExitCode -eq 0) { $script:ExitCode = 3 }
      $script:AuditIntegrityLost = $true
    }
  } else {
    Add-TeardownStep 'final_drain' 'skipped (not ready, or audit integrity was already lost)' $true $null
  }
  # 3) 释放 watcher
  foreach ($entry in @($script:Watchers)) {
    if ($null -ne $entry -and $null -ne $entry.watcher) {
      try { $entry.watcher.Dispose(); Add-TeardownStep 'dispose_watcher' "$($entry.tag):$($entry.root)" $true $null }
      catch { Add-TeardownStep 'dispose_watcher' "$($entry.tag):$($entry.root)" $false $_.Exception.Message }
    }
  }
  # 4) 落盘"自引用"记录（此时 watcher 已停/已释放，写入不会再被观测到）
  if ($null -ne $script:Audit) {
    foreach ($record in @($script:DeferredSelfRecords)) {
      try { Write-AuditRecord $record }
      catch { Add-TeardownStep 'flush_self_reference_records' 'deferred self-reference notification records' $false $_.Exception.Message; if ($script:ExitCode -eq 0) { $script:ExitCode = 3 } }
    }
  }
  # 5) 注销订阅（**不使用** Remove-Event；未消费的残留事件留在队列里，不批量清理）
  foreach ($sid in @($script:Subs)) {
    try { Unregister-Event -SourceIdentifier $sid -ErrorAction Stop; Add-TeardownStep 'unregister_subscription' $sid $true $null }
    catch { Add-TeardownStep 'unregister_subscription' $sid $false $_.Exception.Message }
  }
  # 6) 汇总 + 关闭审计流
  if ($null -ne $script:Audit) {
    try {
      if ($null -eq $script:Summary) {
        $script:Summary = [ordered]@{ type = 'summary'; revision = $script:HelperRevision }
      }
      $script:Summary['stop_reason'] = $script:StopReason
      $script:Summary['exit_code'] = $script:ExitCode
      $script:Summary['audit_path'] = $AuditPath
      $script:Summary['notification_records'] = $script:NotificationRecords
      $script:Summary['record_seq_high_water'] = $script:RecordSeq
      $script:Summary['deferred_self_reference_records'] = $script:DeferredSelfRecords.Count
      $script:Summary['self_reference_notifications'] = $script:SelfReferenceCount
      $script:Summary['aux_records'] = $script:AuxRecords
      $script:Summary['identifier_collisions'] = @($script:IdentifierCollisions)
      $script:Summary['violations'] = $script:ViolationCount
      $script:Summary['consumption_failures'] = $script:ConsumptionFailures
      $script:Summary['handled_total'] = $script:HandledTotal
      $script:Summary['final_drain_handled'] = $script:HandledFinal
      $script:Summary['queue_count_at_stop'] = [int]$script:ReceivedEvents.Count
      $script:Summary['readiness'] = @{ project_seen = $script:ReadinessProjectSeen; approved_seen = $script:ReadinessApprovedSeen
        elapsed_ms = $script:ReadinessElapsedMs; project_file = $ReadinessProjectPath; approved_file = $ReadinessApprovedPath }
      $script:Summary['watchers'] = @(foreach ($entry in @($script:Watchers)) { @{ root_kind = $entry.tag; root = $entry.root
        include_subdirectories = $true; notify_filters = @(Get-FilterNames $script:NotifyFilters)
        internal_buffer_size = $script:InternalBufferSize } })
      $script:Summary['subscriptions'] = @($script:Subs)
      $script:Summary['teardown_steps'] = @($script:TeardownSteps)
      $script:Summary['teardown_failures'] = @($script:TeardownFailures)
      $script:Summary['consumption_capability'] = $script:ConsumptionCapability
      $script:Summary['failure'] = $script:Failure
      $script:Summary['invariants'] = @{
        record_seq_equals_notification_records = ($script:RecordSeq -eq $script:NotificationRecords)
        audit_lines_accounted = ($script:AuditLines -eq ($script:NotificationRecords + $script:AuxRecords))
        batch_removal_used = $false
        remove_event_called = $false
        event_identifier_used_for_removal_or_exemption = $false
        every_notification_has_a_consumption_attempt = $true
      }
      $script:Summary['limitations'] = @(
        'the helper writes its own audit file inside a watched root; notifications about the audit file itself are counted and deferred, then written after the watchers are stopped, so the log stays complete without self-amplifying',
        'event_queued_utc/collected_utc are queue/convenience timestamps, not the OS-level moment of the change',
        'one filesystem operation can produce several notifications, so notification counts are not operation counts',
        'notifications raised by .NET before the PowerShell queue receives them cannot be forced out; the bounded final drain shrinks but does not remove that window',
        'the parent-alive check polls the runner pid; a recycled pid is not distinguishable, which can only make the helper stop early (never report success)'
      )
      $script:Summary['note'] = 'permitted=false 绝不被"文件后来被恢复"或"最终哈希未变"抵消；审计里每条通知都带 record_seq 与其消费证据'
      $script:AuditLinesBeforeSummary = $script:AuditLines
      $script:Summary['audit_lines_before_summary'] = $script:AuditLinesBeforeSummary
      $script:Summary['audit_lines_total'] = $script:AuditLinesBeforeSummary + 1
      Write-AuditRecord $script:Summary
      $script:AuditBytesFinal = $script:Audit.stream.Length
      $script:Summary['audit_bytes'] = $script:AuditBytesFinal
      $script:AuditFlushOk = $true
    } catch {
      $script:AuditFlushOk = $false
      if ($script:ExitCode -eq 0) { $script:ExitCode = 3 }
      Write-HelperError "could not write the final audit summary: $($_.Exception.Message)"
    }
    try { $script:Audit.writer.Flush(); $script:Audit.writer.Dispose(); $script:Audit.stream.Dispose() }
    catch { Write-HelperError "could not close the audit stream: $($_.Exception.Message)"; if ($script:ExitCode -eq 0) { $script:ExitCode = 3 } }
  }
  if ($script:TeardownFailures.Count -gt 0 -and $script:ExitCode -eq 0) { $script:ExitCode = 3 }
  $script:StoppedCleanly = ($script:ExitCode -eq 0) -and ($script:StopReason -eq 'stop_sentinel') -and ($script:TeardownFailures.Count -eq 0)
}

# ================================================================ 结束协议
if ($null -ne $script:Summary) {
  # 收尾之后才能定论的字段在这里补齐（它们写在协议行里；
  # 审计里的 summary 行是收尾之前写的，所以审计行里不含这几个"最终"字段）
  $script:Summary['stopped_cleanly'] = $script:StoppedCleanly
  $script:Summary['audit_flush_ok'] = $script:AuditFlushOk
  $script:Summary['audit_bytes'] = $script:AuditBytesFinal
  $script:Summary['exit_code'] = $script:ExitCode
  $script:Summary['stop_reason'] = $script:StopReason
  $script:Summary['teardown_failure_count'] = $script:TeardownFailures.Count
  $script:Summary['failure'] = $script:Failure
  try {
    if ($script:StoppedCleanly) {
      Write-Protocol (New-ProtocolMessage 'stopped' $script:Summary)
    } else {
      Write-Protocol (New-ProtocolMessage 'failed' $script:Summary)
    }
  } catch { Write-HelperError 'could not write the final protocol line to stdout' }
} else {
  try { Write-Protocol @{ type = 'failed'; revision = $script:HelperRevision; stop_reason = $script:StopReason; exit_code = $script:ExitCode
    failure = $script:Failure; note = 'the helper stopped before an audit stream existed' } } catch { }
}
if (-not $script:StoppedCleanly) {
  Write-HelperError "watch-guard-c helper exiting with code $($script:ExitCode) (stop_reason=$($script:StopReason)); this is NOT a success"
}
exit $script:ExitCode
