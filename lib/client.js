window.__ModuleLoader__.load({
  id: `wgb`,
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    const React = require('react')
    const { useCallback, useEffect, useMemo, useState } = React
    const ICON_URL = (() => {
      try {
        return typeof require.asset === 'function'
          ? require.asset('plugins/wgb/assets/whale-girl.png')
          : '/dsh-backup-api/icon'
      } catch {
        return '/dsh-backup-api/icon'
      }
    })()

    // Bilingual UI. DSH sets <html lang> from the locale preference; when it
    // points at English we translate rendered copy through this dictionary.
    // Unknown strings fall back to Chinese, so a partial dictionary never
    // breaks the panel.
    const EN = {
      '鲸鱼娘备份': 'Whale Girl Backup',
      '安静地守护你的聊天记录、插件和设置，需要时一键找回。': 'Quietly guards your chats, plugins and settings — one click to bring them back.',
      '我的备份': 'My backups',
      '开始备份': 'Start backup',
      '恢复备份': 'Restore',
      '计划备份': 'Schedule',
      '设置': 'Settings',
      '刷新状态': 'Refresh',
      '刷新': 'Refresh',
      '备份健康度': 'Backup health',
      '健康': 'Healthy',
      '良好': 'Good',
      '注意': 'Warning',
      '危险': 'Danger',
      '手动备份': 'Manual backups',
      '自动备份（计划任务）': 'Automatic backups (schedule)',
      '备份': 'Backup',
      '大小': 'Size',
      '日期': 'Date',
      '操作': 'Actions',
      '检查': 'Verify',
      '下载': 'Download',
      '恢复': 'Restore',
      '删除': 'Delete',
      '还没有手动备份。点“开始备份”页的“开始备份”创建。': 'No manual backups yet. Create one on the Start backup tab.',
      '还没有自动备份。在“计划备份”页开启计划后，这里会出现按计划生成的备份。': 'No automatic backups yet. Enable a plan on the Schedule tab.',
      '还没有任何备份，现在去“开始备份”页创建一个': 'No backups yet. Create one on the Start backup tab.',
      '条形图按备份新旧分段：绿 = 24 小时内，黄 = 7 天内，红 = 超过 7 天。': 'The bar groups backups by age: green = within 24h, yellow = within 7 days, red = older than 7 days.',
      '24 小时内': 'Within 24h',
      '7 天内': 'Within 7 days',
      '超过 7 天': 'Older than 7 days',
      '电脑': 'PC',
      '第 1 步：存到哪里？': 'Step 1 · Where to save',
      '第 1 步 · 备份到哪里': 'Step 1 · Destination',
      '第 1 步 · 备份文件夹': 'Step 1 · Backup folder',
      '备份到哪里': 'Destination',
      '保存到这台电脑': 'This computer',
      '保存到 WebDAV': 'WebDAV',
      '电脑和 WebDAV 都存一份': 'Both computer and WebDAV',
      '保存到 WebDAV（未配置，点我去设置）': 'WebDAV (not configured — open settings)',
      '电脑和 WebDAV 都存一份（未配置，点我去设置）': 'Both (not configured — open settings)',
      '想存到 WebDAV？选下面两项会自动带你到设置页': 'Choose WebDAV to jump to its settings',
      '备份文件夹': 'Backup folder',
      '换位置…': 'Change…',
      '默认': 'Default',
      '第 2 步 · 压缩格式': 'Step 2 · Compression',
      '压缩格式': 'Format',
      '压缩力度（越大越小越慢）': 'Level (higher = smaller, slower)',
      'Zstandard（推荐）': 'Zstandard (recommended)',
      'gzip（兼容性好）': 'gzip (compatible)',
      '不压缩（体积最大）': 'No compression (largest)',
      '第 2 步：要备份什么？': 'Step 3 · What to back up',
      '聊天记录': 'Chat history',
      '插件（安装记录和程序）': 'Plugins (installed set and code)',
      '插件数据（账号和保存的数据）': 'Plugin data (accounts and saved data)',
      '设置': 'Settings',
      '项目文件': 'Project files',
      '账号密码/密钥（不安全）': 'Credentials (not secure)',
      '手动选择会话和项目…': 'Pick sessions and projects…',
      '收起高级选择': 'Hide advanced selection',
      '项目文件夹': 'Project folders',
      '聊天会话': 'Chat sessions',
      '文件夹范围': 'Folder scope',
      '所有项目': 'All projects',
      '当前项目': 'Current project',
      '手动选择文件夹': 'Pick folders',
      '同时备份选中文件夹里的项目文件': 'Also back up project files in selected folders',
      '会话范围': 'Session scope',
      '全部会话': 'All sessions',
      '最近 N 个会话': 'Recent N sessions',
      '手动勾选会话': 'Pick sessions',
      '最近几个': 'How many recent',
      '其他文件夹（每行一个，可选）': 'Other folders (one per line, optional)',
      '不在上面的列表里时，可以直接填绝对路径': 'Add absolute paths not listed above',
      '全选': 'Select all',
      '取消': 'Clear',
      '清空选择': 'Clear selection',
      '清空选择（恢复全部）': 'Clear selection (restore everything)',
      '开始备份': 'Start backup',
      '停止备份': 'Stop backup',
      '做完会告诉你保存在哪里。': 'We will show you where it is saved.',
      '停止': 'Stop',
      '正在备份': 'Backing up',
      '正在恢复备份': 'Restoring',
      '正在准备…': 'Preparing…',
      '正在处理…': 'Working…',
      '正在打包文件…': 'Packing files…',
      '正在恢复文件…': 'Restoring files…',
      '预计还要': 'About',
      '备份完成：': 'Backup complete: ',
      '恢复备份': 'Restore',
      '第 1 步 · 备份文件夹': 'Step 1 · Backup folder',
      '换位置…': 'Change…',
      '要恢复哪一个': 'Which backup',
      '遇到同名文件怎么办': 'If a file already exists',
      '直接替换（推荐）': 'Replace (recommended)',
      '跳过已有文件': 'Skip existing files',
      '保留较新的文件': 'Keep the newer file',
      '发现冲突就停止': 'Stop on conflict',
      '最新的备份': 'Latest backup',
      '第 2 步：要恢复什么？': 'Step 2 · What to restore',
      '插件': 'Plugins',
      '插件数据（账号和保存的数据）': 'Plugin data (accounts and saved data)',
      '恢复前先自动备份一次': 'Make a safety backup first',
      'dsh 开着时也允许恢复（不推荐）': 'Allow restore while dsh is running (not recommended)',
      '我确认要恢复': 'I confirm this restore',
      '手动选择要恢复的会话和项目…': 'Pick sessions and projects to restore…',
      '重新读取备份内容': 'Reload archive contents',
      '不选就是恢复全部': 'Nothing selected = restore everything',
      '这个备份里没有聊天会话。': 'This backup has no chat sessions.',
      '这个备份里没有项目文件。': 'This backup has no project files.',
      '只勾选部分时，未勾选的会话/项目文件不会被改动。': 'Unchecked sessions and project files will be left untouched.',
      '先看看会恢复什么': 'Preview restore',
      '开始恢复': 'Start restore',
      '停止恢复': 'Stop restore',
      '建议先关掉 dsh，恢复会更安全。': 'Closing dsh first makes the restore safer.',
      '这个文件夹里没有找到备份。点“换位置…”找到之前备份的位置，再点“刷新”。': 'No backups found here. Use “Change…” to pick the folder you backed up, then Refresh.',
      '自动备份': 'Automatic backup',
      '让备份自己完成': 'Let backups happen by themselves',
      '选一个时间，dsh 开着的时候会悄悄帮你备份一次。': 'Pick a time and dsh will quietly back up while it is running.',
      '选好时间，dsh 开着时会自动备份': 'Pick a time; dsh backs up while running',
      '本机 / WebDAV 上限可选，0 表示跟总上限一样': 'PC / WebDAV limits are optional; 0 = same as total',
      '常用计划': 'Presets',
      '点一下就能用，下面还能自己调': 'One click to apply; fine-tune below',
      '每天一次': 'Daily',
      '每 3 天一次': 'Every 3 days',
      '每周一次': 'Weekly',
      '每月一次': 'Monthly',
      '工作日': 'Weekdays',
      '节假日': 'Weekends',
      '工作日（周一至周五）': 'Weekdays (Mon–Fri)',
      '节假日（周六周日）': 'Weekends (Sat–Sun)',
      '周一至周五 20:00': 'Mon–Fri 20:00',
      '周六周日 20:00': 'Sat–Sun 20:00',
      '每天 20:00': 'Daily 20:00',
      '隔 3 天 20:00': 'Every 3 days 20:00',
      '每周日 20:00': 'Sundays 20:00',
      '每月 1 号 20:00': '1st of month 20:00',
      '自定义': 'Custom',
      '每天': 'Every day',
      '每隔几天': 'Every N days',
      '每周': 'Every week',
      '每月': 'Every month',
      '每隔几小时': 'Every N hours',
      '隔几天': 'Days between runs',
      '星期几': 'Weekday',
      '每月几号': 'Day of month',
      '隔几小时': 'Hours between runs',
      '几点备份': 'Time',
      '备份到哪里': 'Destination',
      '选择要备份的项目和会话…': 'Pick projects and sessions…',
      '收起范围选择': 'Hide scope',
      '只保留最近几个自动备份': 'Keep only the most recent automatic backups',
      '最多留几个（总上限）': 'Max total',
      '本机最多留几个': 'Max on this PC',
      'WebDAV 最多留几个': 'Max on WebDAV',
      '0 表示沿用设置页数量': '0 = use the Settings page value',
      '0 表示跟总上限一样': '0 = same as the total limit',
      '保存计划': 'Save plan',
      '关闭自动备份': 'Disable automatic backups',
      'dsh 关着的时候不会备份。': 'Nothing runs while dsh is closed.',
      '上次自动备份失败：': 'Last automatic backup failed: ',
      '计划已开启': 'Plan is on',
      '计划已关闭': 'Plan is off',
      '计划未开启，没有任何自动备份': 'Plan is off — no automatic backups',
      '计划已开启，但还没有跑过第一次备份': 'Plan is on but has not run yet',
      '接近计划的下次备份时间，属于正常': 'Close to the planned run time — normal',
      '设置': 'Settings',
      '重新读取': 'Reload',
      '恢复默认': 'Reset to defaults',
      '保存设置': 'Save settings',
      '备份文件夹': 'Backup folder',
      '本机最多留几个': 'Max on this PC',
      'WebDAV 最多留几个': 'Max on WebDAV',
      'WebDAV 地址（不用就留空）': 'WebDAV URL (leave empty to disable)',
      'WebDAV 里的文件夹': 'WebDAV folder',
      '账号': 'Account',
      '密码': 'Password',
      'WebDAV 密码': 'WebDAV password',
      'WebDAV 账号': 'WebDAV account',
      '测试连接': 'Test connection',
      '完成提醒（可选）': 'Completion email (optional)',
      '发测试邮件': 'Send test email',
      '收件邮箱': 'Recipient',
      'SMTP 服务器': 'SMTP server',
      '发件账号': 'Sender account',
      '发件授权码': 'App password',
      '高级设置（一般不用点开）': 'Advanced (usually not needed)',
      'WebDAV 登录方式': 'WebDAV auth',
      'WebDAV 登录令牌': 'WebDAV token',
      '失败重试次数': 'Retries',
      '超时（毫秒）': 'Timeout (ms)',
      '单个文件最大 MB': 'Max single file (MB)',
      '恢复时最多解压 MB': 'Max restore size (MB)',
      '还要备份的其他文件夹（每行一个）': 'Extra folders to back up (one per line)',
      '不要备份的文件规则（每行一个）': 'Exclude patterns (one per line)',
      '账号密码': 'Account and password',
      '登录令牌': 'Token',
      '不需要登录': 'No auth',
      '一般不用填': 'Usually not needed',
      '已保存，留空就不改': 'Saved — leave blank to keep',
      '选择备份保存位置': 'Choose backup folder',
      '关闭': 'Close',
      '前往': 'Go',
      '上一级': 'Up',
      '新建': 'New folder',
      '新建文件夹名称': 'New folder name',
      '选择此目录': 'Use this folder',
      '此目录下没有子目录。': 'No subfolders here.',
      '默认文件夹': 'Default folder',
      '跟随设置': 'Follow settings',
      '默认备份文件夹': 'Default backup folder',
      '已停止': 'Stopped',
      '操作失败': 'Operation failed',
      '完成': 'Done',
      '未开启': 'Off',
      '恢复计划': 'Restore plan',
      '恢复计划已生成。': 'Restore plan ready.',
      '这是需要确认的恢复计划。': 'This restore needs confirmation.',
      '恢复完成': 'Restore complete',
      '恢复完成。重启 dsh 以加载恢复后的插件和设置。': 'Restore complete. Restart dsh to load the restored plugins and settings.',
      '配置已保存，当前操作已使用新配置。CLI 在下次运行时读取。': 'Settings saved. New operations use them immediately; the CLI reads them on its next run.',
      '已恢复插件行配置。': 'Reset to the plugin row configuration.',
      '已切换到默认备份文件夹。': 'Switched to the default backup folder.',
      '已请求停止，正在等待任务结束…': 'Stop requested — waiting for the task to finish…',
      '读取配置中…': 'Loading settings…',
      '会改动本机数据': 'Changes data on this computer',
      '自动压缩 · 自动检查': 'Auto compression · auto verification',
      '备份文件': 'Archive',
      '检查码': 'Checksum',
      '本机备份：': 'Local backup: ',
      '安全备份：': 'Safety backup: ',
      '恢复报告：': 'Restore report: ',
      '数据量': 'Data',
      '会话': 'Sessions',
      '跳过已有文件': 'Skip existing files',
      '已完成': 'Done',
      '第 3 步：要备份什么？': 'Step 3 · What to back up',
      '多久备份一次': 'Frequency',
      '多出来的旧备份会自动删除；备份内容在“开始备份”页选，时间在“计划备份”页选。': 'Older backups are removed automatically. Choose contents on Start backup and timing on Schedule.',
      '密码交给 dsh 凭据服务保存，这里不会明文记录；留空表示保持原密码。': 'The password is stored by the dsh credential service, never in plain text here. Leave blank to keep the current one.',
      '备份或恢复完成后收到一封邮件；多个邮箱用英文逗号分隔，留空则不发。': 'Send an email after each backup or restore. Separate addresses with commas; leave empty to disable.',
      '例如 smtp.qq.com、smtp.163.com、smtp.gmail.com': 'e.g. smtp.qq.com, smtp.163.com, smtp.gmail.com',
      '不是邮箱登录密码；在邮箱设置里开启 SMTP 后生成。交给 dsh 凭据服务保存。': 'Not your mailbox password. Generate it after enabling SMTP; it is stored by the dsh credential service.',
      '备份会保存在默认文件夹；点“选择位置…”可以换地方。': 'Saved to the default folder; use “Change…” to pick another.',
      '每天 20:00 自动备份': 'Daily at 20:00',
      '隔 3 天 20:00 备份': 'Every 3 days at 20:00',
      '每周日 20:00 备份': 'Every Sunday at 20:00',
      '每月 1 号 20:00 备份': 'Monthly on the 1st at 20:00',
      '自己决定时间和频率': 'Choose your own time and frequency',
      '备份全部会话和项目': 'All sessions and projects',
      '只备份最近': 'Recent only',
      '个会话': 'sessions',
      '已选': 'Selected',
      '个会话': 'sessions',
      '个项目': 'projects',
      '个文件': 'files',
      '全部': 'All',
      '恢复计划已生成。': 'Restore plan ready.',
      '已读取': 'Loaded',
      '检查通过': 'Verified',
      '未设置': 'Not set',
      '已设置': 'Configured',
      '还没有': 'Not yet',
      '读取配置中…': 'Loading settings…',
    }

    const enDuration = (text) => String(text)
      .replace(/^(\d+) 秒$/, '$1s')
      .replace(/^(\d+) 分钟$/, '$1 min')
      .replace(/^(\d+) 分 (\d+) 秒$/, '$1m $2s')
      .replace(/^(\d+) 小时 (\d+) 分$/, '$1h $2m')
    const EN_PATTERNS = [
      [/^备份完成：(.*)$/, 'Backup complete: $1'],
      [/^检查通过：(.*)$/, 'Verified: $1'],
      [/^已删除备份：(.*)$/, 'Deleted backup: $1'],
      [/^删除备份“(.*)”？删了就找不回来了。$/, 'Delete backup "$1"? This cannot be undone.'],
      [/^安全备份：(.*)$/, 'Safety backup: $1'],
      [/^恢复报告：(.*)$/, 'Restore report: $1'],
      [/^自动备份已开启：(.*)$/, 'Automatic backups enabled: $1'],
      [/^自动备份已关闭。$/, 'Automatic backups disabled.'],
      [/^备份会保存在：(.*)$/, 'Saved to: $1'],
      [/^备份文件夹：(.*)$/, 'Backup folder: $1'],
      [/^默认：(.*)$/, 'Default: $1'],
      [/^最近一次备份在 (.*)前，一切正常$/, (_m, value) => `Last backup was ${enDuration(value)} ago — all good`],
      [/^已经 (\d+) 天没有成功备份了$/, 'No successful backup for $1 day(s)'],
      [/^备份比计划晚了 (-?\d+(?:\.\d+)?) 小时$/, 'Backup is $1 hour(s) behind schedule'],
      [/^上次自动备份失败：(.*)$/, 'Last automatic backup failed: $1'],
      [/^已创建 (\d+) 个项目文件夹（空的）。项目文件需要单独备份。$/, 'Created $1 empty project folder(s). Project files need a separate backup.'],
      [/^已重连 (\d+) 个本地 link 插件模块链接。$/, 'Reconnected $1 local link plugin module(s).'],
      [/^正在压缩 (\d+)%$/, 'Compressing $1%'],
      [/^正在恢复 (\d+)\/(\d+) 个文件$/, 'Restoring $1/$2 files'],
      [/^正在收集文件（(\d+) 个）$/, 'Collecting files ($1)'],
      [/^正在读取聊天记录（(\d+) 个会话）$/, 'Reading chats ($1 sessions)'],
      [/^正在读取备份内容（(\d+) 个文件）$/, 'Reading archive ($1 files)'],
      [/^预计还要 (.*)$/, (_m, value) => `About ${enDuration(value)} left`],
      [/^(\d+) 秒$/, '$1s'],
      [/^(\d+) 分钟$/, '$1 min'],
      [/^(\d+) 分 (\d+) 秒$/, '$1m $2s'],
      [/^(\d+) 小时 (\d+) 分$/, '$1h $2m'],
      [/^(健康|良好|注意|危险) (\d+)分$/, (_match, label, score) => `${({ 健康: 'Healthy', 良好: 'Good', 注意: 'Warning', 危险: 'Danger' })[label]} ${score}/100`],
      [/^每天 (\d{2}:\d{2})$/, 'Every day at $1'],
      [/^工作日 (\d{2}:\d{2})$/, 'Weekdays at $1'],
      [/^节假日 (\d{2}:\d{2})$/, 'Weekends at $1'],
      [/^每 (\d+) 天 (\d{2}:\d{2})$/, 'Every $1 days at $2'],
      [/^每周([日一二三四五六]) (\d{2}:\d{2})$/, (_m, day, time) => `Every week on ${({ 日: 'Sunday', 一: 'Monday', 二: 'Tuesday', 三: 'Wednesday', 四: 'Thursday', 五: 'Friday', 六: 'Saturday' })[day]} at ${time}`],
      [/^每月 (\d+) 号 (\d{2}:\d{2})$/, 'Monthly on day $1 at $2'],
      [/^每 (\d+) 小时$/, 'Every $1 hours'],
      [/^已选 (\d+) 个会话 · (\d+) 个项目$/, 'Selected $1 sessions · $2 projects'],
      [/^文件夹：(.*) · 会话：(.*)$/, (_m, folders, sessions) => `Folders: ${folders} · Sessions: ${sessions}`],
      [/^电脑 · (.*)$/, 'PC · $1'],
      [/^下次：(.*) · 上次：(.*)$/, (_m, next, last) => `Next: ${tr(next)} · Last: ${tr(last)}`],
      [/^下次：(.*) · 上次：(.*) · 本机备份 (.*) 个$/, (_m, next, last, count) => `Next: ${tr(next)} · Last: ${tr(last)} · Local: ${count}`],
    ]

    let translator = null
    let english = false
    const languageListeners = new Set()
    const detectLanguage = () => {
      try {
        const lang = (typeof document !== 'undefined' && document.documentElement.lang)
          || (typeof navigator !== 'undefined' && navigator.language)
          || ''
        return String(lang).toLowerCase().startsWith('en')
      } catch {
        return false
      }
    }
    const applyLanguage = (value) => {
      const next = value === undefined ? detectLanguage() : value
      if (next === english && languageListeners.size > 0) return
      english = next
      for (const listener of languageListeners) listener()
    }
    const tr = (text) => {
      if (typeof text !== 'string' || text === '' || !english) return text
      if (translator) {
        try {
          const value = translator(text)
          if (typeof value === 'string' && value !== text) return value
        } catch {
          // Fall back to the built-in dictionary.
        }
      }
      if (EN[text] !== undefined) return EN[text]
      for (const [pattern, replacement] of EN_PATTERNS) {
        if (pattern.test(text)) return typeof replacement === 'function' ? text.replace(pattern, replacement) : text.replace(pattern, replacement)
      }
      return text
    }
    const trProps = (props) => {
      if (!english || !props || typeof props !== 'object') return props
      let changed = false
      const next = { ...props }
      for (const key of ['placeholder', 'title', 'alt', 'aria-label']) {
        if (typeof next[key] === 'string') {
          const value = tr(next[key])
          if (value !== next[key]) { next[key] = value; changed = true }
        }
      }
      return changed ? next : props
    }
    const h = (type, props, ...children) => React.createElement(
      type,
      trProps(props),
      ...children.map((child) => (typeof child === 'string' ? tr(child) : child)),
    )

    const CSS_ID = 'wgb/ui.css'
    const CSS = `
      .dshbk{max-width:920px;display:flex;flex-direction:column;gap:16px;color:var(--dsw-alias-label-primary,#1f2328);font-size:13px;line-height:1.5;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
      .dshbk-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:4px 2px}
      .dshbk-title{margin:0;font-size:24px;font-weight:700;letter-spacing:-.03em;background:linear-gradient(120deg,var(--dsw-alias-label-primary,#0f172a) 10%,#2563eb 55%,#06b6d4);-webkit-background-clip:text;background-clip:text;color:transparent}
      .dshbk-sub{margin:6px 0 0;color:var(--dsw-alias-label-tertiary,#6b7280);font-size:12px}
      .dshbk-tabs{display:flex;gap:2px;padding:4px;border-radius:12px;background:rgba(127,127,127,.07);border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.12));flex-wrap:wrap}
      .dshbk-tab{border:0;background:transparent;color:var(--dsw-alias-label-tertiary,#6b7280);font:inherit;cursor:pointer;padding:7px 13px;border-radius:9px;transition:background .22s cubic-bezier(.22,1,.36,1),color .22s,box-shadow .22s,transform .18s cubic-bezier(.22,1,.36,1)}
      .dshbk-tab:hover{color:var(--dsw-alias-label-primary,#111);background:rgba(127,127,127,.08)}
      .dshbk-tab:active{transform:scale(.97)}
      .dshbk-tab[data-active="true"]{color:var(--dsw-alias-label-primary,#111);background:var(--dsw-alias-bg-l1,#fff);font-weight:600;box-shadow:0 1px 2px rgba(15,23,42,.10),0 4px 14px rgba(15,23,42,.06)}
      .dshbk-panel{animation:dshbk-rise .36s cubic-bezier(.22,1,.36,1)}
      .dshbk-card.compact{padding:13px 15px;border-radius:14px;max-width:920px}
      .dshbk-card.compact .dshbk-step{margin:10px 0 4px;font-size:11px}
      .dshbk-card.compact .dshbk-field>span{font-size:10.5px}
      .dshbk-card.compact input,.dshbk-card.compact select,.dshbk-card.compact textarea{padding:6px 9px}
      .dshbk-card.compact .dshbk-check{padding:2px 2px}
      .dshbk-card{position:relative;overflow:hidden;border:1px solid rgba(255,255,255,.6);border-radius:18px;padding:16px;background:linear-gradient(150deg,rgba(255,255,255,.82),rgba(255,255,255,.46));-webkit-backdrop-filter:blur(22px) saturate(180%);backdrop-filter:blur(22px) saturate(180%);box-shadow:0 10px 30px rgba(15,23,42,.07),inset 0 1px 0 rgba(255,255,255,.9);transition:border-color .25s,box-shadow .25s,transform .25s cubic-bezier(.22,1,.36,1)}
      .dshbk-card::before{content:'';position:absolute;inset:0;pointer-events:none;background:radial-gradient(130% 90% at 8% -20%,rgba(255,255,255,.85),rgba(255,255,255,0) 55%),linear-gradient(300deg,rgba(120,200,255,.10),rgba(255,255,255,0) 40%);opacity:.7}
      .dshbk-card:hover{border-color:rgba(120,180,255,.6);box-shadow:0 14px 40px rgba(15,23,42,.10),inset 0 1px 0 rgba(255,255,255,.95)}
      .dshbk-brand{display:flex;align-items:center;gap:12px}
      .dshbk-logo{width:48px;height:48px;flex:none;border-radius:16px;object-fit:contain;background:linear-gradient(150deg,rgba(255,255,255,.9),rgba(190,235,255,.55));box-shadow:0 6px 18px rgba(37,99,235,.18),inset 0 1px 0 rgba(255,255,255,.9);padding:2px}
      .dshbk-progress-card{position:relative;border:1px solid rgba(255,255,255,.65);border-radius:18px;padding:14px 16px 26px;background:linear-gradient(150deg,rgba(255,255,255,.9),rgba(230,246,255,.55));-webkit-backdrop-filter:blur(24px) saturate(180%);backdrop-filter:blur(24px) saturate(180%);box-shadow:0 14px 40px rgba(37,99,235,.12),inset 0 1px 0 rgba(255,255,255,.95);animation:dshbk-rise .3s cubic-bezier(.22,1,.36,1)}
      .dshbk-progress-head{display:flex;align-items:center;gap:8px;font-size:13px}
      .dshbk-progress-percent{font-variant-numeric:tabular-nums;font-weight:700;font-size:16px;letter-spacing:-.01em}
      .dshbk-progress-track{position:relative;height:10px;margin-top:12px;border-radius:999px;background:rgba(127,127,127,.18);box-shadow:inset 0 1px 3px rgba(15,23,42,.14)}
      .dshbk-progress-fill{position:relative;height:100%;border-radius:999px;background:linear-gradient(90deg,#5ac8fa,#2563eb 60%,#a855f7);box-shadow:0 0 14px rgba(37,99,235,.45);transition:width .4s cubic-bezier(.22,1,.36,1);overflow:hidden}
      .dshbk-progress-fill::after{content:'';position:absolute;inset:0;background:linear-gradient(110deg,transparent 15%,rgba(255,255,255,.7) 50%,transparent 85%);transform:translateX(-100%);animation:dshbk-shimmer 1.5s linear infinite}
      .dshbk-progress-card[data-kind="restore"] .dshbk-progress-fill{background:linear-gradient(90deg,#f9a8d4,#ec4899 55%,#8b5cf6);box-shadow:0 0 14px rgba(236,72,153,.42)}
      .dshbk-runner{position:absolute;bottom:4px;width:52px;height:52px;object-fit:cover;border-radius:14px;transition:left .4s cubic-bezier(.22,1,.36,1);filter:drop-shadow(0 4px 8px rgba(37,99,235,.28));animation:dshbk-runner-bob .48s ease-in-out infinite;pointer-events:none}
      .dshbk-progress-meta{display:flex;justify-content:space-between;gap:12px;margin-top:10px;font-size:11px;color:var(--dsw-alias-label-tertiary,#6b7280)}
      .dshbk-hero-card{position:relative;overflow:hidden;border:1px solid rgba(37,99,235,.20);border-radius:18px;padding:24px;background:linear-gradient(120deg,rgba(37,99,235,.16),rgba(14,165,233,.07) 45%,rgba(16,185,129,.10));background-size:200% 200%;display:flex;flex-direction:column;gap:8px;animation:dshbk-drift 12s ease infinite}
      .dshbk-hero-badge{align-self:flex-start;border-radius:999px;background:rgba(37,99,235,.14);color:#1d4ed8;padding:3px 10px;font-size:11px;font-weight:700;letter-spacing:.02em}
      .dshbk-hero-title{margin:0;font-size:22px;line-height:1.25;letter-spacing:-.025em}
      .dshbk-hero-text{margin:0;max-width:560px;color:var(--dsw-alias-label-secondary,#4b5563);font-size:13px}
      .dshbk-hero-actions{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:6px}
      .dshbk-step{margin:16px 0 8px;font-size:12px;font-weight:700;color:var(--dsw-alias-label-secondary,#4b5563);letter-spacing:.01em}
      .dshbk-step:first-child{margin-top:0}
      .dshbk-presets{display:grid;grid-template-columns:repeat(auto-fit,minmax(148px,1fr));gap:10px}
      .dshbk-preset{position:relative;display:flex;flex-direction:column;align-items:flex-start;gap:4px;text-align:left;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.24));border-radius:14px;background:var(--dsw-alias-bg-l1,rgba(127,127,127,.035));color:inherit;font:inherit;padding:14px;cursor:pointer;transition:transform .24s cubic-bezier(.22,1,.36,1),box-shadow .24s,border-color .22s,background .22s}
      .dshbk-preset:hover{transform:translateY(-2px);border-color:rgba(37,99,235,.34);box-shadow:0 10px 26px rgba(15,23,42,.10)}
      .dshbk-preset:active{transform:translateY(0) scale(.985)}
      .dshbk-preset[data-active="true"]{border-color:#2563eb;background:linear-gradient(155deg,rgba(37,99,235,.16),rgba(14,165,233,.06));box-shadow:0 0 0 3px rgba(37,99,235,.13),0 10px 26px rgba(37,99,235,.12)}
      .dshbk-preset-title{font-weight:650;font-size:14px;letter-spacing:-.01em}
      .dshbk-preset-desc{font-size:11px;color:var(--dsw-alias-label-tertiary,#6b7280)}
      .dshbk-preset-check{position:absolute;top:9px;right:10px;width:18px;height:18px;border-radius:50%;background:#2563eb;color:#fff;font-size:11px;display:flex;align-items:center;justify-content:center;animation:dshbk-pop .28s cubic-bezier(.34,1.56,.64,1)}
      .dshbk-preset.compact{padding:9px 11px;border-radius:11px}
      .dshbk-preset.compact .dshbk-preset-title{font-size:12px}
      .dshbk-preset.compact .dshbk-preset-desc{font-size:10px}
      .dshbk-picker-card{border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.22));border-radius:12px;padding:10px;margin-top:10px;background:rgba(127,127,127,.04)}
      .dshbk-pick-list{margin-top:8px;max-height:190px;overflow:auto;display:flex;flex-direction:column;gap:6px;padding-right:4px}
      .dshbk-pick-group{border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.16));border-radius:9px;padding:6px 8px;background:var(--dsw-alias-bg-l1,rgba(127,127,127,.02))}
      .dshbk-pick-children{display:flex;flex-direction:column;gap:2px;margin:4px 0 0 18px}
      .dshbk-pick-path{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px}
      .dshbk-scope-title{font-size:11px;font-weight:700;color:var(--dsw-alias-label-secondary,#4b5563);letter-spacing:.02em}
      .dshbk-schedule-top{padding:12px 14px}
      .dshbk-schedule-title{font-size:15px;letter-spacing:-.01em}
      .dshbk-schedule-hint{font-size:11px}
      .dshbk-schedule-top .dshbk-presets{grid-template-columns:repeat(7,minmax(0,1fr));gap:5px}
      .dshbk-schedule-preset{padding:7px 8px;border-radius:10px;min-width:0;box-sizing:border-box;overflow:hidden}
      .dshbk-schedule-preset .dshbk-preset-title{font-size:11.5px;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .dshbk-schedule-preset .dshbk-preset-desc{font-size:10px;line-height:13px;height:13px;max-width:100%;box-sizing:border-box;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .dshbk-schedule-grid{grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}
      .dshbk-schedule-row{margin-top:8px}
      .dshbk-schedule-foot{display:flex;align-items:center;gap:8px;margin-top:10px;padding-top:10px;border-top:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.16))}
      @media (max-width:720px){.dshbk-schedule-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.dshbk-schedule-top .dshbk-presets{grid-template-columns:repeat(4,minmax(0,1fr))}.dshbk-schedule-hint{display:none}}
      .dshbk-switch{display:inline-flex;align-items:center;gap:9px;cursor:pointer;user-select:none}
      .dshbk-switch input{position:absolute;opacity:0;width:0;height:0}
      .dshbk-switch-track{position:relative;width:46px;height:27px;border-radius:999px;background:rgba(127,127,127,.32);transition:background .28s cubic-bezier(.22,1,.36,1);flex:none}
      .dshbk-switch-thumb{position:absolute;top:3px;left:3px;width:21px;height:21px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(15,23,42,.28);transition:transform .28s cubic-bezier(.22,1,.36,1)}
      .dshbk-switch input:checked + .dshbk-switch-track{background:#2563eb}
      .dshbk-switch input:checked + .dshbk-switch-track .dshbk-switch-thumb{transform:translateX(19px)}
      .dshbk-switch input:focus-visible + .dshbk-switch-track{box-shadow:0 0 0 3px rgba(37,99,235,.25)}
      .dshbk-switch-label{font-weight:600;font-size:12px}
      .dshbk-health{display:inline-flex;align-items:center;gap:7px;border-radius:999px;padding:4px 12px;font-size:12px;font-weight:650;border:1px solid transparent}
      .dshbk-health-dot{width:9px;height:9px;border-radius:50%;background:currentColor;box-shadow:0 0 0 3px color-mix(in srgb,currentColor 25%,transparent);animation:dshbk-pulse 2.2s ease infinite}
      .dshbk-health-ok{background:rgba(16,185,129,.14);color:#047857;border-color:rgba(16,185,129,.3)}
      .dshbk-health-warn{background:rgba(245,158,11,.16);color:#92400e;border-color:rgba(245,158,11,.32)}
      .dshbk-health-danger{background:rgba(180,35,24,.14);color:#b42318;border-color:rgba(180,35,24,.32);animation:dshbk-flash 1.6s ease infinite}
      @keyframes dshbk-pulse{0%,100%{opacity:1}50%{opacity:.55}}
      @keyframes dshbk-flash{0%,100%{box-shadow:0 0 0 0 rgba(180,35,24,.3)}50%{box-shadow:0 0 0 6px rgba(180,35,24,.12)}}
      .dshbk-progress-track{display:flex;gap:2px;border-radius:999px;overflow:hidden;box-shadow:inset 0 1px 3px rgba(15,23,42,.14);background:rgba(127,127,127,.16)}
      .dshbk-health-seg{height:100%;border-radius:2px;transition:width .4s cubic-bezier(.22,1,.36,1)}
      .dshbk-health-seg.dshbk-health-ok{background:linear-gradient(90deg,#34d399,#059669)}
      .dshbk-health-seg.dshbk-health-warn{background:linear-gradient(90deg,#fbbf24,#d97706)}
      .dshbk-health-seg.dshbk-health-danger{background:linear-gradient(90deg,#f87171,#b91c1c)}
      .dshbk-card + .dshbk-card{margin-top:12px}
      .dshbk-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px}
      .dshbk-stat{border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.18));border-radius:12px;padding:12px;min-width:0;background:var(--dsw-alias-bg-l1,rgba(127,127,127,.02));transition:transform .24s cubic-bezier(.22,1,.36,1),box-shadow .24s,border-color .22s}
      .dshbk-stat:hover{transform:translateY(-1px);border-color:rgba(37,99,235,.24);box-shadow:0 8px 22px rgba(15,23,42,.07)}
      .dshbk-stat-label{font-size:11px;color:var(--dsw-alias-label-tertiary,#6b7280);text-transform:uppercase;letter-spacing:.04em}
      .dshbk-stat-value{font-size:16px;font-weight:600;margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .dshbk-stat-sub{font-size:11px;color:var(--dsw-alias-label-tertiary,#6b7280);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .dshbk-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
      .dshbk-field{display:flex;flex-direction:column;gap:5px;min-width:140px;flex:1 1 180px}
      .dshbk-field > span{font-size:11px;color:var(--dsw-alias-label-tertiary,#6b7280)}
      .dshbk-pathrow{display:flex;gap:6px;align-items:center;width:100%}
      .dshbk-pathrow input{flex:1;min-width:0}
      .dshbk-modal-overlay{position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,.28);display:flex;align-items:center;justify-content:center;padding:24px}
      .dshbk-modal{width:min(680px,100%);max-height:min(72vh,720px);display:flex;flex-direction:column;background:var(--dsw-alias-bg-l1,#fff);color:inherit;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.3));border-radius:14px;box-shadow:0 24px 80px rgba(0,0,0,.24);overflow:hidden}
      .dshbk-modal-head{display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.2))}
      .dshbk-modal-body{padding:12px 16px;overflow:auto;flex:1}
      .dshbk-modal-foot{display:flex;align-items:center;gap:8px;padding:12px 16px;border-top:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.2))}
      .dshbk-picker-list{display:flex;flex-direction:column;gap:2px;margin-top:10px}
      .dshbk-picker-row{display:flex;align-items:center;gap:8px;border:0;background:transparent;color:inherit;text-align:left;padding:7px 8px;border-radius:6px;font:inherit;cursor:pointer}
      .dshbk-picker-row:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.1))}
      .dshbk-picker-path{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;color:var(--dsw-alias-label-tertiary,#6b7280);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0}
      .dshbk input[type=text],.dshbk input[type=number],.dshbk input[type=password],.dshbk input[type=time],.dshbk select{box-sizing:border-box;width:100%;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.3));border-radius:9px;background:var(--dsw-alias-bg-l1,transparent);color:inherit;font:inherit;padding:8px 10px;outline:none;transition:border-color .2s,box-shadow .2s,background .2s}
      .dshbk input[readonly]{opacity:.75}
      .dshbk textarea{box-sizing:border-box;width:100%;min-height:74px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.3));border-radius:9px;background:var(--dsw-alias-bg-l1,transparent);color:inherit;font:inherit;padding:8px 10px;outline:none;resize:vertical;transition:border-color .2s,box-shadow .2s}
      .dshbk input:focus,.dshbk select:focus,.dshbk textarea:focus{border-color:#2563eb;box-shadow:0 0 0 3px rgba(37,99,235,.16)}
      .dshbk button{font:inherit;cursor:pointer;border-radius:9px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.24));background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.1));color:inherit;padding:7px 12px;white-space:nowrap;transition:transform .18s cubic-bezier(.22,1,.36,1),box-shadow .2s,background .2s,border-color .2s,filter .2s}
      .dshbk button:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 6px 18px rgba(15,23,42,.10);filter:brightness(1.01)}
      .dshbk button:active:not(:disabled){transform:translateY(0) scale(.97);box-shadow:none}
      .dshbk button:focus-visible{outline:none;box-shadow:0 0 0 3px rgba(37,99,235,.28)}
      .dshbk button:disabled{opacity:.5;cursor:not-allowed}
      .dshbk button.primary{background:linear-gradient(180deg,#3b82f6,#2563eb);border-color:#2563eb;color:#fff;font-weight:600;box-shadow:0 2px 8px rgba(37,99,235,.28)}
      .dshbk button.primary:hover:not(:disabled){box-shadow:0 10px 24px rgba(37,99,235,.34)}
      .dshbk button.danger{background:linear-gradient(180deg,#dc4a3d,#b42318);border-color:#b42318;color:#fff;box-shadow:0 2px 8px rgba(180,35,24,.24)}
      .dshbk button.ghost{background:transparent}
      .dshbk-check{display:flex;align-items:center;gap:7px;font-size:12px;color:var(--dsw-alias-label-secondary,#374151);cursor:pointer}
      .dshbk-check input{margin:0;accent-color:#2563eb}
      .dshbk-checks{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:6px 16px}
      .dshbk-checks .dshbk-check{padding:5px 2px;border-radius:7px;transition:background .18s}
      .dshbk-checks .dshbk-check:hover{background:rgba(127,127,127,.06)}
      .dshbk-note{font-size:12px;color:var(--dsw-alias-label-tertiary,#6b7280);margin:0}
      .dshbk-notice{border-radius:10px;padding:10px 12px;font-size:12px;background:rgba(16,185,129,.10);border:1px solid rgba(16,185,129,.30);animation:dshbk-pop .3s cubic-bezier(.22,1,.36,1)}
      .dshbk-error{border-radius:10px;padding:10px 12px;font-size:12px;background:rgba(180,35,24,.08);border:1px solid rgba(180,35,24,.28);color:#b42318;white-space:pre-wrap;animation:dshbk-pop .3s cubic-bezier(.22,1,.36,1)}
      .dshbk-warn{border-radius:10px;padding:10px 12px;font-size:12px;background:rgba(245,158,11,.09);border:1px solid rgba(245,158,11,.30);color:#92400e}
      .dshbk-table-wrap{overflow:auto;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.2));border-radius:9px}
      .dshbk-table{width:100%;border-collapse:collapse;font-size:12px}
      .dshbk-table th,.dshbk-table td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.16));white-space:nowrap}
      .dshbk-table td:last-child{width:1%}
      .dshbk-table th:last-child{width:1%}
      .dshbk-table.archives{table-layout:fixed}
      .dshbk-table.archives th:nth-child(1),.dshbk-table.archives td:nth-child(1){overflow:hidden;text-overflow:ellipsis}
      .dshbk-table.archives th:nth-child(2),.dshbk-table.archives td:nth-child(2){width:64px}
      .dshbk-table.archives th:nth-child(3),.dshbk-table.archives td:nth-child(3){width:84px}
      .dshbk-table.archives th:nth-child(4),.dshbk-table.archives td:nth-child(4){width:210px}
      .dshbk-cell-name{display:flex;align-items:center;gap:6px;min-width:0}
      .dshbk-cell-name .dshbk-mono{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .dshbk-actions.compact button,.dshbk-actions.compact .dshbk-linkbtn{padding:4px 7px;font-size:11px}
      .dshbk-table th{font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:var(--dsw-alias-label-tertiary,#6b7280);background:rgba(127,127,127,.04)}
      .dshbk-table tr:last-child td{border-bottom:0}
      .dshbk-mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px}
      .dshbk-pre{margin:0;max-height:380px;overflow:auto;border-radius:8px;background:rgba(127,127,127,.08);padding:12px;font-size:11px;line-height:1.5;white-space:pre-wrap;word-break:break-word}
      .dshbk-badge{display:inline-block;border-radius:999px;padding:1px 7px;font-size:10px;font-weight:600;background:rgba(127,127,127,.14);color:var(--dsw-alias-label-secondary,#4b5563)}
      .dshbk-badge.ok{background:rgba(16,185,129,.16);color:#047857}
      .dshbk-badge.warn{background:rgba(245,158,11,.18);color:#92400e}
      .dshbk-spacer{flex:1}
      .dshbk-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
      .dshbk-actions.compact{flex-wrap:nowrap;gap:6px}
      .dshbk-linkbtn{display:inline-flex;align-items:center;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.3));border-radius:7px;padding:6px 10px;color:inherit;text-decoration:none;background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.1));font:inherit;white-space:nowrap}
      .dshbk-linkbtn:hover{filter:brightness(.98)}
      .dshbk-spin{display:inline-block;width:11px;height:11px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:dshbk-spin .8s linear infinite;vertical-align:-1px;margin-right:6px}
      @keyframes dshbk-spin{to{transform:rotate(360deg)}}
      @keyframes dshbk-rise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
      @keyframes dshbk-pop{0%{opacity:0;transform:scale(.9)}100%{opacity:1;transform:scale(1)}}
      @keyframes dshbk-drift{0%,100%{background-position:0% 50%}50%{background-position:100% 50%}}
      @keyframes dshbk-shimmer{to{transform:translateX(100%)}}
      @keyframes dshbk-runner-bob{0%,100%{transform:translateY(0) rotate(-2deg)}50%{transform:translateY(-5px) rotate(2deg)}}
      @media (prefers-color-scheme:dark){
        .dshbk-card{background:linear-gradient(150deg,rgba(52,58,76,.74),rgba(32,36,50,.56));border-color:rgba(255,255,255,.14);box-shadow:0 12px 34px rgba(0,0,0,.42),inset 0 1px 0 rgba(255,255,255,.08)}
        .dshbk-card::before{opacity:.16}
        .dshbk-logo{background:linear-gradient(150deg,rgba(80,110,150,.55),rgba(40,60,90,.45));box-shadow:0 6px 18px rgba(0,0,0,.35),inset 0 1px 0 rgba(255,255,255,.18)}
        .dshbk-progress-card{background:linear-gradient(150deg,rgba(45,55,78,.82),rgba(28,34,50,.62));border-color:rgba(255,255,255,.14);box-shadow:0 14px 40px rgba(0,0,0,.45),inset 0 1px 0 rgba(255,255,255,.10)}
        .dshbk-tabs{background:rgba(255,255,255,.06)}
        .dshbk-tab[data-active="true"]{background:rgba(255,255,255,.12);box-shadow:0 1px 2px rgba(0,0,0,.32)}
        .dshbk input[type=text],.dshbk input[type=number],.dshbk input[type=password],.dshbk input[type=time],.dshbk select,.dshbk textarea{background:rgba(255,255,255,.06)}
      }
      @media (prefers-reduced-motion:reduce){.dshbk *,.dshbk *::before,.dshbk *::after{animation:none!important;transition:none!important}}
      @media (max-width:640px){.dshbk-head{flex-direction:column}.dshbk-field{flex-basis:100%}}
    `

    function ensureCss() {
      if (typeof document === 'undefined') return
      if (document.querySelector(`style[data-plugin-css="${CSS_ID}"]`) !== null) return
      const style = document.createElement('style')
      style.dataset.plugin = 'wgb'
      style.dataset.pluginCss = CSS_ID
      style.textContent = CSS
      document.head.appendChild(style)
    }

    async function api(path, options = {}) {
      const headers = { ...(options.body === undefined ? {} : { 'content-type': 'application/json' }), ...(options.headers || {}) }
      const response = await fetch(`/dsh-backup-api${path}`, {
        cache: 'no-store',
        ...options,
        headers,
      })
      let data = null
      try {
        data = await response.json()
      } catch {
        data = null
      }
      if (!response.ok || !data || data.ok === false) {
        const error = data && data.error ? data.error : {}
        const message = error.message || `HTTP ${response.status}`
        const details = error.details ? `\n${JSON.stringify(error.details)}` : ''
        throw new Error(`${message}${details}`)
      }
      return data
    }

    function formatBytes(value) {
      const n = Number(value) || 0
      if (n < 1024) return `${n} B`
      const units = ['KiB', 'MiB', 'GiB', 'TiB']
      let size = n
      let index = -1
      do { size /= 1024; index += 1 } while (size >= 1024 && index < units.length - 1)
      return `${size.toFixed(size >= 10 ? 1 : 2)} ${units[index]}`
    }

    function formatDate(value) {
      if (!value) return ''
      const date = new Date(value)
      return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString()
    }

    function formatShortDate(value) {
      if (!value) return ''
      const date = new Date(value)
      return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString()
    }

    function formatDuration(ms) {
      const total = Math.max(0, Math.round(Number(ms) / 1000))
      if (total < 60) return `${total} 秒`
      const minutes = Math.floor(total / 60)
      const seconds = total % 60
      if (minutes < 60) return seconds === 0 ? `${minutes} 分钟` : `${minutes} 分 ${seconds} 秒`
      return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分`
    }

    function shortHash(value) {
      return typeof value === 'string' && value.length > 18 ? `${value.slice(0, 10)}…${value.slice(-8)}` : value || ''
    }

    function readStored(key) {
      try { return window.localStorage.getItem(`dsh-backup.${key}`) || '' } catch { return '' }
    }

    function writeStored(key, value) {
      try {
        if (value === '') window.localStorage.removeItem(`dsh-backup.${key}`)
        else window.localStorage.setItem(`dsh-backup.${key}`, value)
      } catch {
        // localStorage may be disabled.
      }
    }

    function Button({ children, onClick, primary, danger, disabled, busy, ghost, title, type }) {      return h('button', {
        type: type || 'button',
        className: [primary ? 'primary' : '', danger ? 'danger' : '', ghost ? 'ghost' : ''].filter(Boolean).join(' ') || undefined,
        onClick,
        disabled: disabled || busy,
        title,
      }, busy ? h('span', { className: 'dshbk-spin' }) : null, children)
    }

    function Field({ label, children, hint }) {
      return h('label', { className: 'dshbk-field' },
        h('span', null, label),
        children,
        hint ? h('span', { className: 'dshbk-note' }, hint) : null,
      )
    }

    function Check({ checked, onChange, children }) {
      return h('label', { className: 'dshbk-check' },
        h('input', { type: 'checkbox', checked: !!checked, onChange: (event) => onChange(event.target.checked) }),
        h('span', null, children),
      )
    }

    function Stat({ label, value, sub }) {
      return h('div', { className: 'dshbk-stat' },
        h('div', { className: 'dshbk-stat-label' }, label),
        h('div', { className: 'dshbk-stat-value', title: typeof value === 'string' ? value : undefined }, value),
        sub ? h('div', { className: 'dshbk-stat-sub', title: typeof sub === 'string' ? sub : undefined }, sub) : null,
      )
    }

    function ProgressCard({ progress, onCancel }) {
      if (!progress) return null
      const percent = Math.round(Math.max(0, Math.min(100, Number(progress.percent) || 0)))
      const elapsed = progress.startedAt ? Date.now() - progress.startedAt : 0
      const eta = percent >= 4 && percent < 100 && elapsed > 1500
        ? Math.max(0, elapsed * (100 - percent) / percent)
        : null
      const isRestore = progress.kind === 'restore'
      return h('div', { className: 'dshbk-progress-card', 'data-kind': progress.kind, role: 'status', 'aria-live': 'polite' },
        h('div', { className: 'dshbk-progress-head' },
          h('strong', null, isRestore ? '正在恢复备份' : '正在备份'),
          h('span', { className: 'dshbk-progress-percent' }, `${percent}%`),
          h('span', { className: 'dshbk-spacer' }),
          h(Button, { danger: true, onClick: onCancel, busy: progress.cancelling }, '停止'),
        ),
        h('div', { className: 'dshbk-progress-track' },
          h('div', { className: 'dshbk-progress-fill', style: { width: `${percent}%` } }),
          h('img', {
            className: 'dshbk-runner',
            src: ICON_URL,
            alt: '',
            style: { left: `clamp(0px, calc(${percent}% - 30px), calc(100% - 52px))` },
          }),
        ),
        h('div', { className: 'dshbk-progress-meta' },
          h('span', null, progress.message || (isRestore ? '正在恢复文件…' : '正在打包文件…')),
          eta !== null ? h('span', null, `预计还要 ${formatDuration(eta)}`) : null,
        ),
      )
    }

    function Switch({ checked, onChange, label }) {
      return h('label', { className: 'dshbk-switch' },
        h('input', { type: 'checkbox', role: 'switch', checked: !!checked, onChange: (event) => onChange(event.target.checked) }),
        h('span', { className: 'dshbk-switch-track', 'aria-hidden': 'true' }, h('span', { className: 'dshbk-switch-thumb' })),
        label ? h('span', { className: 'dshbk-switch-label' }, label) : null,
      )
    }

    const SCHEDULE_PRESETS = [
      { key: 'daily', title: '每天一次', desc: '每天 20:00', patch: { kind: 'daily', time: '20:00' } },
      { key: 'every-3-days', title: '每 3 天一次', desc: '隔 3 天 20:00', patch: { kind: 'every-n-days', days: 3, time: '20:00' } },
      { key: 'weekly', title: '每周一次', desc: '每周日 20:00', patch: { kind: 'weekly', weekday: 0, time: '20:00' } },
      { key: 'monthly', title: '每月一次', desc: '每月 1 号 20:00', patch: { kind: 'monthly', dayOfMonth: 1, time: '20:00' } },
      { key: 'weekdays', title: '工作日', desc: '周一至周五 20:00', patch: { kind: 'weekdays', time: '20:00' } },
      { key: 'weekends', title: '节假日', desc: '周六周日 20:00', patch: { kind: 'weekends', time: '20:00' } },
      { key: 'custom', title: '自定义', desc: '自己决定时间', patch: null },
    ]

    function scheduleSummary(value) {
      if (!value) return '未设置'
      if (!value.enabled) return '未开启'
      if (value.kind === 'daily') return `每天 ${value.time}`
      if (value.kind === 'every-n-days') return `每 ${value.days} 天 ${value.time}`
      if (value.kind === 'weekly') return `每周${'日一二三四五六'[value.weekday] || '日'} ${value.time}`
      if (value.kind === 'weekdays') return `工作日 ${value.time}`
      if (value.kind === 'weekends') return `节假日 ${value.time}`
      if (value.kind === 'monthly') return `每月 ${value.dayOfMonth} 号 ${value.time}`
      return `每 ${value.hours} 小时`
    }

    function presetMatches(preset, value) {
      if (!value) return false
      if (preset.key === 'custom') return false
      const patch = preset.patch
      if (value.kind !== patch.kind) return false
      if (patch.time !== undefined && value.time !== patch.time) return false
      if (patch.days !== undefined && value.days !== patch.days) return false
      if (patch.weekday !== undefined && value.weekday !== patch.weekday) return false
      if (patch.dayOfMonth !== undefined && value.dayOfMonth !== patch.dayOfMonth) return false
      return true
    }

    function ScopePicker({ value, onChange, sessions }) {
      const workspaces = useMemo(() => {
        const map = new Map()
        for (const session of sessions || []) {
          const key = session.workspace || session.project || '(未知项目)'
          if (!map.has(key)) map.set(key, [])
          map.get(key).push(session)
        }
        return [...map.entries()].map(([path, list]) => ({ path, count: list.length, sessions: list }))
      }, [sessions])
      const selectedPaths = value.workspacePaths || []
      const selectedIds = value.sessionIds || []
      const togglePath = (path, checked) => {
        const next = checked
          ? [...new Set([...selectedPaths, path])]
          : selectedPaths.filter((item) => item !== path)
        onChange({ workspacePaths: next, workspaceMode: next.length > 0 ? 'custom' : 'all' })
      }
      const toggleSession = (id, checked) => {
        onChange({ sessionIds: checked ? [...new Set([...selectedIds, id])] : selectedIds.filter((item) => item !== id) })
      }
      return h('div', { className: 'dshbk-picker-card' },
        h('div', { className: 'dshbk-scope-title' }, '项目文件夹'),
        h('div', { className: 'dshbk-grid', style: { marginTop: 6 } },
          h(Field, { label: '文件夹范围' },
            h('select', { value: value.workspaceMode || 'all', onChange: (event) => onChange({ workspaceMode: event.target.value }) },
              h('option', { value: 'all' }, '所有项目'),
              h('option', { value: 'auto' }, '当前项目'),
              h('option', { value: 'custom' }, '手动选择文件夹'),
            )),
          h('div', { className: 'dshbk-field' },
            h('span', null, '项目文件'),
            h(Check, { checked: value.includeWorkspaceFiles === true, onChange: (checked) => onChange({ includeWorkspaceFiles: checked }) }, '同时备份选中文件夹里的项目文件'),
          ),
        ),
        value.workspaceMode === 'custom' ? h('div', { style: { marginTop: 6 } },
          h('div', { className: 'dshbk-pick-list', style: { maxHeight: 120 } },
            workspaces.length === 0 ? h('p', { className: 'dshbk-note' }, '还没有找到项目。') : workspaces.map((workspace) =>
              h('label', { key: workspace.path, className: 'dshbk-check' },
                h('input', { type: 'checkbox', checked: selectedPaths.includes(workspace.path), onChange: (event) => togglePath(workspace.path, event.target.checked) }),
                h('span', { className: 'dshbk-pick-path', title: workspace.path }, `${workspace.path}（${workspace.count} 个会话）`),
              )),
          ),
          h(Field, { label: '其他文件夹（每行一个，可选）', hint: '不在上面的列表里时，可以直接填绝对路径' },
            h('textarea', {
              className: 'dshbk-textarea',
              style: { minHeight: 52 },
              value: selectedPaths.filter((path) => !workspaces.some((workspace) => workspace.path === path)).join('\n'),
              onChange: (event) => {
                const extra = event.target.value.split('\n').map((line) => line.trim()).filter(Boolean)
                const known = selectedPaths.filter((path) => workspaces.some((workspace) => workspace.path === path))
                const next = [...new Set([...known, ...extra])]
                onChange({ workspacePaths: next, workspaceMode: next.length > 0 ? 'custom' : 'all' })
              },
            })),
        ) : null,
        h('div', { className: 'dshbk-scope-title', style: { marginTop: 10 } }, '聊天会话'),
        h('div', { className: 'dshbk-grid', style: { marginTop: 6 } },
          h(Field, { label: '会话范围' },
            h('select', { value: value.sessionMode || 'all', onChange: (event) => onChange({ sessionMode: event.target.value }) },
              h('option', { value: 'all' }, '全部会话'),
              h('option', { value: 'recent' }, '最近 N 个会话'),
              h('option', { value: 'selected' }, '手动勾选会话'),
            )),
          value.sessionMode === 'recent' ? h(Field, { label: '最近几个' },
            h('input', { type: 'number', min: 1, max: 500, value: value.sessionCount ?? 10, onChange: (event) => onChange({ sessionCount: Number(event.target.value) }) })) : null,
        ),
        value.sessionMode === 'selected' ? h('div', { className: 'dshbk-pick-list', style: { marginTop: 6 } },
          workspaces.length === 0 ? h('p', { className: 'dshbk-note' }, '还没有找到会话。') : workspaces.map((workspace) =>
            h('div', { key: workspace.path, className: 'dshbk-pick-group' },
              h('div', { className: 'dshbk-row' },
                h('span', { className: 'dshbk-pick-path', title: workspace.path }, `${workspace.path}（${workspace.count} 个会话）`),
                h('span', { className: 'dshbk-spacer' }),
                h(Button, { ghost: true, onClick: () => onChange({ sessionIds: [...new Set([...selectedIds, ...workspace.sessions.map((session) => session.id)])] }) }, '全选'),
                h(Button, { ghost: true, onClick: () => onChange({ sessionIds: selectedIds.filter((id) => !workspace.sessions.some((session) => session.id === id)) }) }, '取消'),
              ),
              h('div', { className: 'dshbk-pick-children' }, workspace.sessions.slice(0, 30).map((session) =>
                h('label', { key: session.id, className: 'dshbk-check' },
                  h('input', { type: 'checkbox', checked: selectedIds.includes(session.id), onChange: (event) => toggleSession(session.id, event.target.checked) }),
                  h('span', { className: 'dshbk-pick-path', title: session.id },
                    `${formatShortDate(session.updatedAt)} · ${session.id.slice(0, 22)}…（${session.files} 个文件）`),
                )),
              ),
            )),
        ) : null,
        h('div', { className: 'dshbk-row', style: { marginTop: 8 } },
          h(Button, { ghost: true, onClick: () => onChange({ sessionIds: [], workspacePaths: [], workspaceMode: 'all' }) }, '清空选择'),
          h('span', { className: 'dshbk-note' },
            `文件夹：${value.workspaceMode === 'custom' ? `${selectedPaths.length} 个` : value.workspaceMode === 'auto' ? '当前项目' : '全部'} · 会话：${value.sessionMode === 'recent' ? `最近 ${value.sessionCount ?? 10} 个` : value.sessionMode === 'selected' ? `${selectedIds.length} 个` : '全部'}`),
        ),
      )
    }

    function SchedulePanel({ info, status, busy, onSave, sessions }) {
      const [draft, setDraft] = useState(null)
      const [custom, setCustom] = useState(false)
      const [showScope, setShowScope] = useState(false)
      useEffect(() => {
        if (info && info.schedule) setDraft({ ...info.schedule })
      }, [info])
      const value = draft || (info && info.schedule) || {
        enabled: false, kind: 'daily', time: '20:00', days: 3, weekday: 0, dayOfMonth: 1, hours: 24, destination: 'local',
        keepAuto: 0, keepLocal: 0, keepWebdav: 0,
        workspaceMode: 'all', workspacePaths: [], includeWorkspaceFiles: false, sessionMode: 'all', sessionCount: 10, sessionIds: [],
      }
      const patch = (next) => setDraft({ ...value, ...next })
      const isCustom = custom || !SCHEDULE_PRESETS.some((preset) => presetMatches(preset, value))
      const pickPreset = (preset) => {
        if (preset.key === 'custom') {
          setCustom(true)
          setDraft({ ...value, enabled: true })
          return
        }
        setCustom(false)
        setDraft({ ...value, ...preset.patch, enabled: true })
      }
      const workspaces = useMemo(() => {
        const map = new Map()
        for (const session of sessions || []) {
          if (!session.workspace) continue
          if (!map.has(session.workspace)) map.set(session.workspace, [])
          map.get(session.workspace).push(session)
        }
        return [...map.entries()].map(([path, list]) => ({ path, count: list.length, sessions: list }))
      }, [sessions])
      const nextRun = info && info.nextRunAt ? formatDate(info.nextRunAt) : '保存后显示'
      return h('div', null,
        h('div', { className: 'dshbk-card compact dshbk-schedule-top' },
          h('div', { className: 'dshbk-row' },
            h('span', { className: 'dshbk-hero-badge' }, '自动备份'),
            h('strong', { className: 'dshbk-schedule-title' }, '让备份自己完成'),
            h('span', { className: 'dshbk-note dshbk-schedule-hint' }, '选好时间，dsh 开着时会自动备份'),
            h('span', { className: 'dshbk-spacer' }),
            h(Switch, {
              checked: value.enabled,
              label: value.enabled ? '计划已开启' : '计划已关闭',
              onChange: (checked) => patch({ enabled: checked }),
            }),
          ),
          h('div', { className: 'dshbk-presets', style: { marginTop: 8 } },
            SCHEDULE_PRESETS.map((preset) => {
              const active = value.enabled && (preset.key === 'custom' ? custom : presetMatches(preset, value))
              return h('button', {
                key: preset.key,
                type: 'button',
                className: 'dshbk-preset dshbk-schedule-preset',
                'data-active': active ? 'true' : 'false',
                onClick: () => pickPreset(preset),
              },
                active ? h('span', { className: 'dshbk-preset-check' }, '✓') : null,
                h('span', { className: 'dshbk-preset-title' }, preset.title),
                h('span', { className: 'dshbk-preset-desc' }, preset.desc),
              )
            }),
          ),
        ),
        h('div', { className: 'dshbk-card compact' },
          h('div', { className: 'dshbk-grid dshbk-schedule-grid' },
            h(Field, { label: '备份到哪里' },
              h('select', { value: value.destination, onChange: (event) => patch({ destination: event.target.value }) },
                h('option', { value: 'local' }, '保存到这台电脑'),
                h('option', { value: 'webdav' }, '保存到 WebDAV'),
                h('option', { value: 'both' }, '电脑和 WebDAV 都存一份'),
              )),
            h(Field, { label: '多久备份一次' },
              h('select', { value: value.kind, onChange: (event) => patch({ kind: event.target.value }) },
                h('option', { value: 'daily' }, '每天'),
                h('option', { value: 'every-n-days' }, '每隔几天'),
                h('option', { value: 'weekly' }, '每周'),
                h('option', { value: 'weekdays' }, '工作日（周一至周五）'),
                h('option', { value: 'weekends' }, '节假日（周六周日）'),
                h('option', { value: 'monthly' }, '每月'),
                h('option', { value: 'every-hours' }, '每隔几小时'),
              )),
            value.kind === 'every-n-days' ? h(Field, { label: '隔几天' }, h('input', { type: 'number', min: 1, max: 365, value: value.days, onChange: (event) => patch({ days: Number(event.target.value) }) })) : null,
            value.kind === 'weekly' ? h(Field, { label: '星期几' },
              h('select', { value: value.weekday, onChange: (event) => patch({ weekday: Number(event.target.value) }) },
                ['日', '一', '二', '三', '四', '五', '六'].map((name, index) => h('option', { key: name, value: index }, `周${name}`)),
              )) : null,
            value.kind === 'monthly' ? h(Field, { label: '每月几号' }, h('input', { type: 'number', min: 1, max: 31, value: value.dayOfMonth, onChange: (event) => patch({ dayOfMonth: Number(event.target.value) }) })) : null,
            value.kind === 'every-hours' ? h(Field, { label: '隔几小时' }, h('input', { type: 'number', min: 1, max: 720, value: value.hours, onChange: (event) => patch({ hours: Number(event.target.value) }) })) : null,
            value.kind !== 'every-hours' ? h(Field, { label: '几点备份' }, h('input', { type: 'time', value: value.time, onChange: (event) => patch({ time: event.target.value }) })) : null,
          ),
          h('div', { className: 'dshbk-row dshbk-schedule-row' },
            h(Button, { ghost: true, onClick: () => setShowScope((current) => !current) }, showScope ? '收起范围选择' : '选择要备份的项目和会话…'),
            h('span', { className: 'dshbk-note' },
              value.workspaceMode === 'custom' ? `自选 ${value.workspacePaths.length} 个项目` : value.workspaceMode === 'auto' ? '当前项目' : '所有项目',
              ' · ',
              value.sessionMode === 'recent' ? `最近 ${value.sessionCount} 个会话` : value.sessionMode === 'selected' ? `自选 ${value.sessionIds.length} 个会话` : '全部会话'),
          ),
          showScope ? h(ScopePicker, { value, onChange: patch, sessions }) : null,
          h('div', { className: 'dshbk-row dshbk-schedule-row' },
            h(Check, {
              checked: value.keepAuto > 0,
              onChange: (checked) => patch({ keepAuto: checked ? (value.keepAuto > 0 ? value.keepAuto : 10) : 0 }),
            }, '只保留最近几个自动备份'),
            value.keepAuto > 0 ? h('input', {
              type: 'number', min: 1, max: 999, value: value.keepAuto,
              onChange: (event) => patch({ keepAuto: Number(event.target.value) }),
              style: { width: 72 },
            }) : null,
            value.keepAuto > 0 ? h('span', { className: 'dshbk-note' }, '本机 / WebDAV 上限可选，0 表示跟总上限一样') : null,
          ),
          value.keepAuto > 0 ? h('div', { className: 'dshbk-grid dshbk-schedule-grid' },
            h(Field, { label: '本机最多留几个' }, h('input', { type: 'number', min: 0, max: 999, value: value.keepLocal, onChange: (event) => patch({ keepLocal: Number(event.target.value) }) })),
            h(Field, { label: 'WebDAV 最多留几个' }, h('input', { type: 'number', min: 0, max: 999, value: value.keepWebdav, onChange: (event) => patch({ keepWebdav: Number(event.target.value) }) })),
          ) : null,
          info && info.lastError ? h('div', { className: 'dshbk-warn', style: { marginTop: 8 } }, `上次自动备份失败：${info.lastError.message}`) : null,
          h('div', { className: 'dshbk-schedule-foot' },
            h('span', { className: 'dshbk-note' },
              `下次：${value.enabled ? nextRun : '未开启'} · 上次：${info && info.lastRunAt ? formatShortDate(info.lastRunAt) : '还没有'}`),
            h('span', { className: 'dshbk-spacer' }),
            h(Button, { ghost: true, busy, onClick: () => onSave({ ...value, enabled: false }) }, '关闭自动备份'),
            h(Button, { primary: true, busy, onClick: () => onSave({ ...value }) }, '保存计划'),
          ),
        ),
      )
    }

    function FolderPicker({ picker, onClose, onBrowse, onChangePath, onCreate, onSelect }) {
      if (!picker.open) return null
      const entries = picker.entries || []
      return h('div', { className: 'dshbk-modal-overlay', onMouseDown: (event) => { if (event.target === event.currentTarget) onClose() } },
        h('div', { className: 'dshbk-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': '选择备份保存位置' },
          h('div', { className: 'dshbk-modal-head' },
            h('strong', null, '选择备份保存位置'),
            h('span', { className: 'dshbk-spacer' }),
            h(Button, { ghost: true, onClick: onClose }, '关闭'),
          ),
          h('div', { className: 'dshbk-modal-body' },
            picker.error ? h('div', { className: 'dshbk-error', style: { marginBottom: 10 } }, picker.error) : null,
            picker.notice ? h('div', { className: 'dshbk-warn', style: { marginBottom: 10 } }, picker.notice) : null,
            h('div', { className: 'dshbk-pathrow' },
              h('input', {
                type: 'text',
                value: picker.current || '',
                placeholder: '输入绝对路径，例如 D:\\backups 或 /home/me/backups',
                onChange: (event) => onChangePath(event.target.value),
                onKeyDown: (event) => { if (event.key === 'Enter') onBrowse(picker.current) },
              }),
              h(Button, { ghost: true, onClick: () => onBrowse(picker.current) }, '前往'),
              picker.parent ? h(Button, { ghost: true, onClick: () => onBrowse(picker.parent) }, '上一级') : null,
            ),
            h('div', { className: 'dshbk-row', style: { marginTop: 10 } },
              (picker.roots || []).map((root) => h(Button, { key: root.path, ghost: true, onClick: () => onBrowse(root.path) }, root.name)),
            ),
            h('div', { className: 'dshbk-picker-list' },
              entries.length === 0 ? h('p', { className: 'dshbk-note' }, '此目录下没有子目录。') : entries.map((entry) =>
                h('button', { key: entry.path, type: 'button', className: 'dshbk-picker-row', onClick: () => onBrowse(entry.path) },
                  h('span', { className: 'dshbk-badge' }, 'DIR'),
                  h('span', { className: 'dshbk-picker-path', title: entry.path }, entry.name),
                )),
            ),
            h('div', { className: 'dshbk-pathrow', style: { marginTop: 12 } },
              h('input', {
                type: 'text',
                value: picker.newName || '',
                placeholder: '新建文件夹名称',
                onChange: (event) => onCreate({ name: event.target.value }),
                onKeyDown: (event) => { if (event.key === 'Enter') onCreate({ name: picker.newName, submit: true }) },
              }),
              h(Button, { ghost: true, busy: picker.busy, onClick: () => onCreate({ name: picker.newName, submit: true }) }, '新建'),
            ),
            h('p', { className: 'dshbk-note', style: { marginTop: 8 } }, '备份会写入所选目录；该目录不存在时，备份时会自动创建。'),
          ),
          h('div', { className: 'dshbk-modal-foot' },
            h('span', { className: 'dshbk-picker-path', title: picker.current || '' }, picker.current || ''),
            h('span', { className: 'dshbk-spacer' }),
            h(Button, { ghost: true, onClick: onClose }, '取消'),
            h(Button, { primary: true, onClick: () => onSelect(picker.current) }, '选择此目录'),
          ),
        ),
      )
    }

    function ResultView({ value, onDownload }) {
      if (!value) return null
      const result = value.result || value
      if (result.plan && result.archive) {
        const plan = result.plan
        return h('div', { className: 'dshbk-card' },
          h('div', { className: 'dshbk-row' }, h('strong', null, '恢复计划'), h('span', { className: 'dshbk-spacer' }), h('span', { className: 'dshbk-badge' }, result.archive.name)),
          h('div', { className: 'dshbk-grid', style: { marginTop: 10 } },
            h(Stat, { label: '新建', value: plan.create }),
            h(Stat, { label: '覆盖', value: plan.replace }),
            h(Stat, { label: '跳过', value: plan.skip }),
            h(Stat, { label: '冲突', value: plan.conflicts ? plan.conflicts.length : 0 }),
          ),
          plan.conflicts && plan.conflicts.length > 0 ? h('div', { className: 'dshbk-warn', style: { marginTop: 10 } },
            `已有文件将被覆盖：${plan.conflicts.slice(0, 12).map((item) => item.path).join(', ')}${plan.conflicts.length > 12 ? ' …' : ''}`) : null,
          result.message ? h('p', { className: 'dshbk-note', style: { marginTop: 10 } }, result.message) : null,
        )
      }
      if (result.restored) {
        return h('div', { className: 'dshbk-card' },
          h('div', { className: 'dshbk-row' }, h('strong', null, '恢复完成'), h('span', { className: 'dshbk-spacer' }), h('span', { className: 'dshbk-badge ok' }, 'OK')),
          h('div', { className: 'dshbk-grid', style: { marginTop: 10 } },
            h(Stat, { label: '文件', value: result.restored.files }),
            h(Stat, { label: '目录', value: result.restored.dirs }),
            h(Stat, { label: '链接', value: result.restored.symlinks }),
            h(Stat, { label: '数据量', value: formatBytes(result.restored.bytes) }),
          ),
          result.safetyBackup ? h('p', { className: 'dshbk-note', style: { marginTop: 10 } }, `安全备份：${result.safetyBackup.path}`) : null,
          result.reportPath ? h('p', { className: 'dshbk-note' }, `恢复报告：${result.reportPath}`) : null,
          result.workspaceDirs && result.workspaceDirs.created && result.workspaceDirs.created.length ? h('p', { className: 'dshbk-note' }, `已创建 ${result.workspaceDirs.created.length} 个项目文件夹（空的）。项目文件需要单独备份。`) : null,
          result.credentialWarning ? h('div', { className: 'dshbk-warn', style: { marginTop: 10 } }, result.credentialWarning) : null,
          result.linkModules && result.linkModules.length ? h('p', { className: 'dshbk-note' }, `已重连 ${result.linkModules.length} 个本地 link 插件模块链接。`) : null,
          result.installWarnings && result.installWarnings.length ? h('div', { className: 'dshbk-warn', style: { marginTop: 10 } }, `插件安装提示：\n${result.installWarnings.join('\n')}`) : null,
          result.warnings && result.warnings.length ? h('div', { className: 'dshbk-warn', style: { marginTop: 10 } }, result.warnings.join('\n')) : null,
        )
      }
      if (result.name && result.sha256 && result.summary) {
        return h('div', { className: 'dshbk-card' },
          h('div', { className: 'dshbk-row' }, h('strong', null, '备份文件'), h('span', { className: 'dshbk-spacer' }), h('span', { className: 'dshbk-badge ok' }, result.checksumVerified ? '检查通过' : '已读取')),
          h('div', { className: 'dshbk-grid', style: { marginTop: 10 } },
            h(Stat, { label: '文件', value: result.name, sub: result.sizeLabel }),
            h(Stat, { label: '会话', value: result.summary.sessions, sub: `${result.summary.sessionFiles || 0} 个日志` }),
            h(Stat, { label: '创建时间', value: formatDate(result.createdAt) }),
            h(Stat, { label: '检查码', value: shortHash(result.sha256) }),
          ),
        )
      }
      return h('div', { className: 'dshbk-card' },
        h('div', { className: 'dshbk-row' }, h('strong', null, '完成'), h('span', { className: 'dshbk-spacer' }), h('span', { className: 'dshbk-badge ok' }, 'OK')),
        h('div', { className: 'dshbk-grid', style: { marginTop: 10 } },
          h(Stat, { label: '备份文件', value: result.name || result.archiveName || '—' }),
          h(Stat, { label: '大小', value: result.sizeLabel || '—' }),
          h(Stat, { label: '检查码', value: shortHash(result.sha256) }),
          h(Stat, { label: '会话', value: result.summary && result.summary.sessions !== undefined ? result.summary.sessions : '—' }),
        ),
        result.local ? h('p', { className: 'dshbk-note', style: { marginTop: 10 } },
          '本机备份：', h('span', { className: 'dshbk-mono' }, result.local.path), ' ',
          h('a', { href: `/dsh-backup-api/download?name=${encodeURIComponent(result.local.name)}` }, '下载'),
        ) : null,
        result.remote ? h('p', { className: 'dshbk-note' }, `WebDAV：${result.remote.url}`) : null,
        result.warnings && result.warnings.length ? h('div', { className: 'dshbk-warn', style: { marginTop: 10 } }, result.warnings.join('\n')) : null,
        result.summary && result.summary.skipped ? h('p', { className: 'dshbk-note' }, `跳过 ${result.summary.skipped} 个文件；详见命令行日志。`) : null,
      )
    }

    function BackupPanel({ value, setValue, busy, onSubmit, onCancel, localDir, defaultLocalDir, onBrowse, webdavConfigured, sessions, onNeedWebdavSetup }) {
      const webdavOnly = value.destination === 'webdav'
      const [showPicker, setShowPicker] = useState(false)
      const sessionMode = value.sessionMode || 'all'
      const workspaces = useMemo(() => {
        const map = new Map()
        for (const session of sessions || []) {
          if (!session.workspace) continue
          if (!map.has(session.workspace)) map.set(session.workspace, [])
          map.get(session.workspace).push(session)
        }
        return [...map.entries()].map(([path, list]) => ({ path, count: list.length, sessions: list }))
      }, [sessions])
      return h('div', null,
        h('div', { className: 'dshbk-card compact' },
          h('div', { className: 'dshbk-row' }, h('strong', null, '开始备份'), h('span', { className: 'dshbk-spacer' }), h('span', { className: 'dshbk-badge ok' }, '自动压缩 · 自动检查')),
          h('div', { className: 'dshbk-grid', style: { marginTop: 10 } },
            h(Field, { label: '第 1 步 · 备份到哪里', hint: webdavConfigured ? undefined : '想存到 WebDAV？选下面两项会自动带你到设置页' },
              h('select', {
                value: value.destination,
                onChange: (event) => {
                  const next = event.target.value
                  if ((next === 'webdav' || next === 'both') && !webdavConfigured) {
                    setValue({ ...value, destination: 'local' })
                    onNeedWebdavSetup?.()
                    return
                  }
                  setValue({ ...value, destination: next })
                },
              },
                h('option', { value: 'local' }, '保存到这台电脑'),
                h('option', { value: 'webdav' }, webdavConfigured ? '保存到 WebDAV' : '保存到 WebDAV（未配置，点我去设置）'),
                h('option', { value: 'both' }, webdavConfigured ? '电脑和 WebDAV 都存一份' : '电脑和 WebDAV 都存一份（未配置，点我去设置）'),
              )),
              !webdavOnly ? h(Field, { label: '第 1 步 · 备份文件夹', hint: `默认：${defaultLocalDir || '跟随设置'}` },
              h('div', { className: 'dshbk-pathrow' },
                h('input', { type: 'text', value: localDir, placeholder: '默认文件夹', onChange: () => undefined, readOnly: true }),
                h(Button, { ghost: true, onClick: onBrowse }, '换位置…'),
                h(Button, { ghost: true, onClick: () => onPickDefault() }, '默认'),
              )) : null,
            h(Field, { label: '第 2 步 · 压缩格式' },
              h('select', { value: value.compression || 'zstd', onChange: (event) => setValue({ ...value, compression: event.target.value }) },
                h('option', { value: 'zstd' }, 'Zstandard（推荐）'),
                h('option', { value: 'gzip' }, 'gzip（兼容性好）'),
                h('option', { value: 'none' }, '不压缩（体积最大）'),
              )),
            value.compression === 'none' ? h('div', { className: 'dshbk-field' }) : h(Field, { label: '压缩力度（越大越小越慢）' },
              h('input', {
                type: 'number',
                min: 1,
                max: value.compression === 'gzip' ? 9 : 22,
                value: value.level ?? (value.compression === 'gzip' ? 6 : 9),
                onChange: (event) => setValue({ ...value, level: Number(event.target.value) }),
              })),
          ),
          webdavOnly ? h('p', { className: 'dshbk-note', style: { marginTop: 6 } }, '备份会上传到设置里填写的 WebDAV 文件夹。')
            : (!localDir ? h('p', { className: 'dshbk-note', style: { marginTop: 6 } }, `备份会保存在默认文件夹：${defaultLocalDir || '跟随设置'}。`) : null),
          value.destination === 'both' ? h('p', { className: 'dshbk-note', style: { marginTop: 6 } }, '会同时保存到这台电脑和 WebDAV，两边都能恢复。') : null,
          h('div', { className: 'dshbk-step' }, '第 3 步：要备份什么？'),
          h('div', { className: 'dshbk-checks', style: { marginTop: 8 } },
            h(Check, { checked: value.includeSessions !== false, onChange: (checked) => setValue({ ...value, includeSessions: checked }) }, '聊天记录'),
            h(Check, { checked: value.includePlugins !== false, onChange: (checked) => setValue({ ...value, includePlugins: checked, includePluginCode: checked }) }, '插件（安装记录和程序）'),
            h(Check, { checked: value.includePluginData !== false, onChange: (checked) => setValue({ ...value, includePluginData: checked, includeStorages: checked }) }, '插件数据（账号和保存的数据）'),
            h(Check, { checked: value.includeConfig !== false, onChange: (checked) => setValue({ ...value, includeConfig: checked }) }, '设置'),
            h(Check, { checked: value.includeWorkspaceFiles === true, onChange: (checked) => setValue({ ...value, includeWorkspaceFiles: checked }) }, '项目文件'),
            h(Check, { checked: value.includeCredentials === true, onChange: (checked) => setValue({ ...value, includeCredentials: checked }) }, '账号密码/密钥（不安全）'),
          ),
          h('div', { className: 'dshbk-row', style: { marginTop: 8 } },
            h(Button, { ghost: true, onClick: () => setShowPicker((current) => !current) }, showPicker ? '收起高级选择' : '手动选择会话和项目…'),
            h('span', { className: 'dshbk-note' },
              sessionMode === 'all' ? '备份全部会话和项目'
                : sessionMode === 'recent' ? `只备份最近 ${value.sessionCount} 个会话`
                : `只备份已勾选的 ${value.sessionIds.length} 个会话`),
          ),
          showPicker ? h(ScopePicker, { value, onChange: (next) => setValue({ ...value, ...next }), sessions }) : null,
          h('div', { className: 'dshbk-actions', style: { marginTop: 12 } },
            h(Button, { primary: true, busy: busy === 'backup', onClick: onSubmit, disabled: busy === 'backup' }, '开始备份'),
            busy === 'backup' ? h(Button, { danger: true, onClick: onCancel }, '停止备份') : null,
            h('span', { className: 'dshbk-note' }, '做完会告诉你保存在哪里。'),
          ),
        ),
      )
    }

    function ArchivesPanel({ archives, busy, onRefresh, onVerify, onRestore, onDelete, localDir, remoteDir }) {
      const downloadHref = (name) => `/dsh-backup-api/download?name=${encodeURIComponent(name)}${localDir ? `&localDir=${encodeURIComponent(localDir)}` : ''}`
      const manual = (archives.local || []).map((item) => ({ ...item, source: 'local' }))
        .concat((archives.webdav || []).map((item) => ({ ...item, source: 'webdav' })))
        .filter((item) => !/-auto\b|-auto\.|-auto-/.test(item.name) && !/^auto-/.test(item.name) && item.label !== 'auto')
      const auto = (archives.local || []).map((item) => ({ ...item, source: 'local' }))
        .concat((archives.webdav || []).map((item) => ({ ...item, source: 'webdav' })))
        .filter((item) => /-auto\b|-auto\.|-auto-/.test(item.name) || /^auto-/.test(item.name) || item.label === 'auto')
      const all = manual.concat(auto)
      const table = (title, rows, emptyText) => h('div', { className: 'dshbk-card' },
        h('div', { className: 'dshbk-row' }, h('strong', null, title), h('span', { className: 'dshbk-spacer' })),
        rows.length === 0
          ? h('p', { className: 'dshbk-note', style: { marginTop: 8 } }, emptyText)
          : h('div', { className: 'dshbk-table-wrap', style: { marginTop: 10 } },
            h('table', { className: 'dshbk-table archives' },
              h('thead', null, h('tr', null, h('th', null, '备份'), h('th', null, '大小'), h('th', null, '日期'), h('th', null, '操作'))),
              h('tbody', null, rows.map((item) =>
                h('tr', { key: `${item.source}:${item.name}` },
                  h('td', null, h('div', { className: 'dshbk-cell-name', title: item.path || item.name },
                    h('span', { className: 'dshbk-badge' }, item.source === 'webdav' ? 'WebDAV' : '电脑'),
                    h('span', { className: 'dshbk-mono' }, item.name),
                  )),
                  h('td', null, item.sizeLabel || '?'),
                  h('td', null, formatShortDate(item.createdAt)),
                  h('td', null, h('div', { className: 'dshbk-actions compact' },
                    h(Button, { ghost: true, onClick: () => onVerify(item), busy: busy === `verify:${item.name}`, disabled: busy !== '' && busy !== `verify:${item.name}` }, '检查'),
                    item.source === 'local' ? h('a', { href: downloadHref(item.name), className: 'dshbk-linkbtn' }, '下载') : null,
                    h(Button, { onClick: () => onRestore(item), disabled: busy !== '' }, '恢复'),
                    h(Button, { danger: true, onClick: () => onDelete(item), busy: busy === `delete:${item.name}`, disabled: busy !== '' && busy !== `delete:${item.name}` }, '删除'),
                  )),
                ))),
            )),
      )
      return h('div', null,
        h('div', { className: 'dshbk-card compact' },
          h('div', { className: 'dshbk-row' },
            h('strong', null, '备份列表'), h('span', { className: 'dshbk-spacer' }),
            h(Button, { onClick: onRefresh, busy: busy === 'refresh', ghost: true }, '刷新'),
          ),
          h('p', { className: 'dshbk-note', style: { marginTop: 6 } }, `备份文件夹：${localDir || '默认文件夹'}${remoteDir ? ` · WebDAV 文件夹：${remoteDir}` : ''}`),
          archives.webdavError ? h('div', { className: 'dshbk-warn', style: { marginTop: 8 } }, `WebDAV 读取失败：${archives.webdavError.message}`) : null,
        ),
        table('手动备份', manual, '还没有手动备份。点“开始备份”页的“开始备份”创建。'),
        table('自动备份（计划任务）', auto, '还没有自动备份。在“计划备份”页开启计划后，这里会出现按计划生成的备份。'),
      )
    }

    function RestorePanel({ value, setValue, archives, busy, onPlan, onRestore, onCancel, localDir, onBrowse, onPickDefault, onRefresh, defaultLocalDir }) {
      const set = (key) => (event) => setValue({ ...value, [key]: event.target.type === 'checkbox' ? event.target.checked : event.target.value })
      const [contents, setContents] = useState(null)
      const [contentsBusy, setContentsBusy] = useState(false)
      const [contentsError, setContentsError] = useState('')
      const loadContents = async () => {
        setContentsBusy(true)
        setContentsError('')
        try {
          const data = await api('/archive/contents', {
            method: 'POST',
            body: JSON.stringify({ archive: value.archive, source: value.source, localDir, remoteDir }),
          })
          setContents(data.result)
        } catch (cause) {
          setContentsError(String(cause.message || cause))
        } finally {
          setContentsBusy(false)
        }
      }
      const selectedSessionIds = value.restoreSessionIds || []
      const selectedWorkspaceIds = value.restoreWorkspaceIds || []
      const toggleSession = (id, checked) => setValue({
        ...value,
        restoreSessionIds: checked ? [...new Set([...selectedSessionIds, id])] : selectedSessionIds.filter((item) => item !== id),
      })
      const toggleWorkspace = (id, checked) => setValue({
        ...value,
        restoreWorkspaceIds: checked ? [...new Set([...selectedWorkspaceIds, id])] : selectedWorkspaceIds.filter((item) => item !== id),
      })
      const sessionGroups = contents ? [...new Set(contents.sessions.map((session) => session.project))].map((project) => ({
        project,
        sessions: contents.sessions.filter((session) => session.project === project),
      })) : []
      const options = (archives.local || []).map((item) => ({ ...item, source: 'local' }))
        .concat((archives.webdav || []).map((item) => ({ ...item, source: 'webdav' })))
      const pickArchive = (name) => {
        const item = options.find((candidate) => candidate.name === name)
        setValue({ ...value, archive: name, source: item ? item.source : value.source, confirm: false })
      }
      return h('div', null,
        h('div', { className: 'dshbk-card compact' },
          h('div', { className: 'dshbk-row' }, h('strong', null, '恢复备份'), h('span', { className: 'dshbk-spacer' }), h('span', { className: 'dshbk-badge warn' }, '会改动本机数据')),
          h('div', { className: 'dshbk-grid', style: { marginTop: 10 } },
            h('div', { style: { gridColumn: '1 / -1' } },
              h(Field, { label: '第 1 步 · 备份文件夹', hint: `默认：${defaultLocalDir || '跟随设置'}` },
                h('div', { className: 'dshbk-pathrow' },
                  h('input', { type: 'text', value: localDir, placeholder: '默认备份文件夹', readOnly: true }),
                  h(Button, { ghost: true, onClick: onBrowse }, '换位置…'),
                  h(Button, { ghost: true, onClick: () => onPickDefault() }, '默认'),
                  h(Button, { ghost: true, busy: busy === 'refresh', onClick: onRefresh }, '刷新'),
                ))),
            h(Field, { label: '要恢复哪一个' },
              h('select', { value: value.archive, onChange: (event) => pickArchive(event.target.value) },
                h('option', { value: 'latest' }, '最新的备份'),
                options.map((item) => h('option', { key: `${item.source}:${item.name}`, value: item.name }, `${item.source === 'webdav' ? 'WebDAV' : '电脑'} · ${item.name}`)),
              )),
            h(Field, { label: '遇到同名文件怎么办' }, h('select', { value: value.conflict, onChange: set('conflict') },
              h('option', { value: 'overwrite' }, '直接替换（推荐）'),
              h('option', { value: 'skip' }, '跳过已有文件'),
              h('option', { value: 'prefer-newer' }, '保留较新的文件'),
              h('option', { value: 'fail' }, '发现冲突就停止'),
            )),
          ),
          options.length === 0 ? h('div', { className: 'dshbk-warn', style: { marginTop: 8 } }, '这个文件夹里没有找到备份。点“换位置…”找到之前备份的位置，再点“刷新”。') : null,
          h('div', { className: 'dshbk-step' }, '第 2 步：要恢复什么？'),
          h('div', { className: 'dshbk-checks', style: { marginTop: 8 } },
            h(Check, { checked: value.restoreSessions !== false, onChange: (checked) => setValue({ ...value, restoreSessions: checked }) }, '聊天记录'),
            h(Check, { checked: value.restorePlugins !== false, onChange: (checked) => setValue({ ...value, restorePlugins: checked }) }, '插件'),
            h(Check, { checked: value.restorePluginData !== false, onChange: (checked) => setValue({ ...value, restorePluginData: checked }) }, '插件数据（账号和保存的数据）'),
            h(Check, { checked: value.restoreConfig !== false, onChange: (checked) => setValue({ ...value, restoreConfig: checked }) }, '设置'),
            h(Check, { checked: value.restoreWorkspaceFiles !== false, onChange: (checked) => setValue({ ...value, restoreWorkspaceFiles: checked }) }, '项目文件'),
            h(Check, { checked: value.safetyBackup, onChange: (checked) => setValue({ ...value, safetyBackup: checked }) }, '恢复前先自动备份一次'),
            h(Check, { checked: value.allowRunning, onChange: (checked) => setValue({ ...value, allowRunning: checked }) }, 'dsh 开着时也允许恢复（不推荐）'),
            h(Check, { checked: value.confirm, onChange: (checked) => setValue({ ...value, confirm: checked }) }, '我确认要恢复'),
          ),
          h('div', { className: 'dshbk-row', style: { marginTop: 8 } },
            h(Button, { ghost: true, busy: contentsBusy, onClick: () => void loadContents() }, contents ? '重新读取备份内容' : '手动选择要恢复的会话和项目…'),
            h('span', { className: 'dshbk-note' },
              contents
                ? `会话：${selectedSessionIds.length ? `已选 ${selectedSessionIds.length} 个` : '全部'} · 项目：${selectedWorkspaceIds.length ? `已选 ${selectedWorkspaceIds.length} 个` : '全部'}`
                : '不选就是恢复全部'),
          ),
          contentsError ? h('div', { className: 'dshbk-error', style: { marginTop: 8 } }, contentsError) : null,
          contents ? h('div', { className: 'dshbk-picker-card' },
            h('div', { className: 'dshbk-scope-title' }, '聊天会话'),
            sessionGroups.length === 0
              ? h('p', { className: 'dshbk-note' }, '这个备份里没有聊天会话。')
              : h('div', { className: 'dshbk-pick-list', style: { maxHeight: 140 } }, sessionGroups.map((group) =>
                h('div', { key: group.project, className: 'dshbk-pick-group' },
                  h('div', { className: 'dshbk-row' },
                    h('span', { className: 'dshbk-pick-path', title: group.project }, `${group.project}（${group.sessions.length} 个会话）`),
                    h('span', { className: 'dshbk-spacer' }),
                    h(Button, { ghost: true, onClick: () => setValue({ ...value, restoreSessionIds: [...new Set([...selectedSessionIds, ...group.sessions.map((session) => session.id)])] }) }, '全选'),
                    h(Button, { ghost: true, onClick: () => setValue({ ...value, restoreSessionIds: selectedSessionIds.filter((id) => !group.sessions.some((session) => session.id === id)) }) }, '取消'),
                  ),
                  h('div', { className: 'dshbk-pick-children' }, group.sessions.slice(0, 40).map((session) =>
                    h('label', { key: session.id, className: 'dshbk-check' },
                      h('input', { type: 'checkbox', checked: selectedSessionIds.includes(session.id), onChange: (event) => toggleSession(session.id, event.target.checked) }),
                      h('span', { className: 'dshbk-pick-path', title: session.id }, session.id),
                    )),
                  ),
                ))),
            h('div', { className: 'dshbk-scope-title', style: { marginTop: 10 } }, '项目文件夹'),
            contents.workspaces.length === 0
              ? h('p', { className: 'dshbk-note' }, '这个备份里没有项目文件。')
              : h('div', { className: 'dshbk-pick-list', style: { maxHeight: 100 } }, contents.workspaces.map((workspace) =>
                h('label', { key: workspace.id, className: 'dshbk-check' },
                  h('input', { type: 'checkbox', checked: selectedWorkspaceIds.includes(workspace.id), onChange: (event) => toggleWorkspace(workspace.id, event.target.checked) }),
                  h('span', { className: 'dshbk-pick-path', title: workspace.path },
                    `${workspace.path}${workspace.files !== undefined ? `（${workspace.files} 个文件）` : ''}`),
                ))),
            h('div', { className: 'dshbk-row', style: { marginTop: 8 } },
              h(Button, { ghost: true, onClick: () => setValue({ ...value, restoreSessionIds: [], restoreWorkspaceIds: [] }) }, '清空选择（恢复全部）'),
              h('span', { className: 'dshbk-note' }, '只勾选部分时，未勾选的会话/项目文件不会被改动。'),
            ),
          ) : null,
          h('div', { className: 'dshbk-actions', style: { marginTop: 12 } },
            h(Button, { onClick: onPlan, busy: busy === 'plan', disabled: busy === 'restore' }, '先看看会恢复什么'),
            h(Button, { danger: true, onClick: onRestore, busy: busy === 'restore', disabled: !value.confirm || busy === 'restore' }, '开始恢复'),
            busy === 'restore' ? h(Button, { ghost: true, onClick: onCancel }, '停止恢复') : null,
            h('span', { className: 'dshbk-note' }, '建议先关掉 dsh，恢复会更安全。'),
          ),
        ),
      )
    }

    function ConfigPanel({ config, loading, saving, onLoad, onSave, onReset }) {
      const [draft, setDraft] = useState(null)
      const [webdavTest, setWebdavTest] = useState(null)
      const [notifyTest, setNotifyTest] = useState(null)
      useEffect(() => {
        if (config) setDraft(JSON.parse(JSON.stringify(config)))
      }, [config])
      const testWebdav = async () => {
        setWebdavTest({ busy: true })
        try {
          const data = await api('/webdav/test', {
            method: 'POST',
            body: JSON.stringify({ webdav: draft.webdav || {} }),
          })
          setWebdavTest({ ok: true, message: `${data.result.message}（${data.result.remoteDir || '/'}，${data.result.entries} 个项目，${data.result.durationMs} ms）` })
        } catch (cause) {
          setWebdavTest({ ok: false, message: String(cause.message || cause) })
        }
      }
      const testNotify = async () => {
        setNotifyTest({ busy: true })
        try {
          const data = await api('/notify/test', {
            method: 'POST',
            body: JSON.stringify({ notifyEmail: draft.notifyEmail || {} }),
          })
          setNotifyTest({ ok: true, message: data.result.message })
        } catch (cause) {
          setNotifyTest({ ok: false, message: String(cause.message || cause) })
        }
      }
      if (!config || !draft) {
        return h('div', { className: 'dshbk-card' },
          h('p', { className: 'dshbk-note' }, '读取配置中…'),
          h(Button, { onClick: onLoad, busy: loading }, '重新读取'),
        )
      }
      const update = (path, value) => {
        setDraft((current) => {
          const next = JSON.parse(JSON.stringify(current))
          const keys = Array.isArray(path) ? path : path.split('.')
          let target = next
          for (let i = 0; i < keys.length - 1; i += 1) {
            if (target[keys[i]] === null || typeof target[keys[i]] !== 'object') target[keys[i]] = {}
            target = target[keys[i]]
          }
          target[keys[keys.length - 1]] = value
          return next
        })
      }
      const textArray = (value) => Array.isArray(value) ? value.join('\n') : (value ? String(value) : '')
      const parseLines = (value) => value.split('\n').map((item) => item.trim()).filter(Boolean)
      return h('div', null,
        h('div', { className: 'dshbk-card compact' },
          h('div', { className: 'dshbk-row' },
            h('strong', null, '设置'), h('span', { className: 'dshbk-spacer' }),
            h(Button, { ghost: true, onClick: onLoad, busy: loading }, '重新读取'),
            h(Button, { ghost: true, onClick: onReset, busy: saving }, '恢复默认'),
            h(Button, { primary: true, onClick: () => onSave(draft), busy: saving }, '保存设置'),
          ),
          h('div', { className: 'dshbk-grid', style: { marginTop: 10 } },
            h('div', { style: { gridColumn: '1 / -1' } },
              h(Field, { label: '备份文件夹', hint: '多出来的旧备份会自动删除；备份内容在“开始备份”页选，时间在“计划备份”页选。' },
                h('input', { type: 'text', value: draft.localDir || '', onChange: (event) => update('localDir', event.target.value) }))),
            h(Field, { label: '本机最多留几个' }, h('input', { type: 'number', min: 0, value: draft.keepLocal ?? 10, onChange: (event) => update('keepLocal', Number(event.target.value)) })),
            h(Field, { label: 'WebDAV 最多留几个' }, h('input', { type: 'number', min: 0, value: draft.keepWebdav ?? 10, onChange: (event) => update('keepWebdav', Number(event.target.value)) })),
          ),
          h('div', { className: 'dshbk-grid', style: { marginTop: 10 } },
            h('div', { style: { gridColumn: '1 / -1' } }, h(Field, { label: 'WebDAV 地址（不用就留空）' }, h('input', { type: 'text', value: draft.webdav?.url || '', placeholder: 'https://dav.example.com/remote.php/dav/files/me/', onChange: (event) => update('webdav.url', event.target.value) }))),
            h(Field, { label: 'WebDAV 里的文件夹' }, h('input', { type: 'text', value: draft.webdav?.remoteDir || '', onChange: (event) => update('webdav.remoteDir', event.target.value) })),
            h(Field, { label: '账号' }, h('input', { type: 'text', value: draft.webdav?.username || '', placeholder: 'WebDAV 账号', onChange: (event) => update('webdav.username', event.target.value) })),
            h(Field, { label: '密码', hint: '密码交给 dsh 凭据服务保存，这里不会明文记录；留空表示保持原密码。' }, h('input', { type: 'password', value: draft.webdav?.password === '<set>' ? '' : (draft.webdav?.password || ''), placeholder: draft.webdav?.password === '<set>' ? '已保存，留空就不改' : 'WebDAV 密码', autocomplete: 'new-password', onChange: (event) => update('webdav.password', event.target.value) })),
            h('div', { style: { gridColumn: '1 / -1' }, className: 'dshbk-actions' },
              h(Button, { onClick: () => void testWebdav(), busy: webdavTest?.busy }, '测试连接'),
              webdavTest && !webdavTest.busy ? h('span', { className: webdavTest.ok ? 'dshbk-note' : 'dshbk-error' }, webdavTest.message) : null,
            ),
          ),
          h('div', { className: 'dshbk-grid', style: { marginTop: 10 } },
            h('div', { style: { gridColumn: '1 / -1' } },
              h('div', { className: 'dshbk-row' }, h('strong', null, '完成提醒（可选）'), h('span', { className: 'dshbk-spacer' }),
                h(Button, { ghost: true, onClick: () => void testNotify(), busy: notifyTest?.busy, disabled: !(draft.notifyEmail?.to || draft.notifyEmail?.smtpHost) }, '发测试邮件')),
            ),
            h(Field, { label: '收件邮箱', hint: '备份或恢复完成后收到一封邮件；多个邮箱用英文逗号分隔，留空则不发。' },
              h('input', { type: 'text', value: draft.notifyEmail?.to || '', placeholder: 'me@example.com', onChange: (event) => update('notifyEmail.to', event.target.value) })),
            h(Field, { label: 'SMTP 服务器', hint: '例如 smtp.qq.com、smtp.163.com、smtp.gmail.com' },
              h('input', { type: 'text', value: draft.notifyEmail?.smtpHost || '', placeholder: 'smtp.example.com:587', onChange: (event) => update('notifyEmail.smtpHost', event.target.value) })),
            h(Field, { label: '发件账号' },
              h('input', { type: 'text', value: draft.notifyEmail?.username || '', placeholder: '一般就是邮箱地址', onChange: (event) => update('notifyEmail.username', event.target.value) })),
            h(Field, { label: '发件授权码', hint: '不是邮箱登录密码；在邮箱设置里开启 SMTP 后生成。交给 dsh 凭据服务保存。' },
              h('input', { type: 'password', value: draft.notifyEmail?.password === '<set>' ? '' : (draft.notifyEmail?.password || ''), placeholder: draft.notifyEmail?.password === '<set>' ? '已保存，留空就不改' : 'SMTP 授权码', autocomplete: 'new-password', onChange: (event) => update('notifyEmail.password', event.target.value) })),
          ),
          notifyTest && !notifyTest.busy ? h('p', { className: notifyTest.ok ? 'dshbk-note' : 'dshbk-error', style: { marginTop: 6 } }, notifyTest.message) : null,
        ),
        h('details', { className: 'dshbk-card compact' },
          h('summary', { style: { cursor: 'pointer', fontWeight: 600 } }, '高级设置（一般不用点开）'),
          h('div', { className: 'dshbk-grid', style: { marginTop: 10 } },
            h(Field, { label: 'WebDAV 登录方式' }, h('select', { value: draft.webdav?.auth || 'basic', onChange: (event) => update('webdav.auth', event.target.value) },
              h('option', { value: 'basic' }, '账号密码'),
              h('option', { value: 'bearer' }, '登录令牌'),
              h('option', { value: 'none' }, '不需要登录'),
            )),
            h(Field, { label: 'WebDAV 登录令牌' }, h('input', { type: 'password', value: draft.webdav?.token === '<set>' ? '' : (draft.webdav?.token || ''), placeholder: draft.webdav?.token === '<set>' ? '已保存，留空就不改' : '一般不用填', autocomplete: 'new-password', onChange: (event) => update('webdav.token', event.target.value) })),
            h(Field, { label: '失败重试次数' }, h('input', { type: 'number', min: 0, value: draft.webdav?.retries ?? 3, onChange: (event) => update('webdav.retries', Number(event.target.value)) })),
            h(Field, { label: '超时（毫秒）' }, h('input', { type: 'number', min: 1000, value: draft.webdav?.timeoutMs ?? 60000, onChange: (event) => update('webdav.timeoutMs', Number(event.target.value)) })),
            h(Field, { label: '单个文件最大 MB' }, h('input', { type: 'number', min: 1, value: draft.maxFileSizeMB ?? 1024, onChange: (event) => update('maxFileSizeMB', Number(event.target.value)) })),
            h(Field, { label: '恢复时最多解压 MB' }, h('input', { type: 'number', min: 1, value: draft.maxExtractMB ?? 102400, onChange: (event) => update('maxExtractMB', Number(event.target.value)) })),
            h('div', { style: { gridColumn: '1 / -1' } }, h(Field, { label: '还要备份的其他文件夹（每行一个）' }, h('textarea', { className: 'dshbk-textarea', value: textArray(draft.extraPaths), onChange: (event) => update('extraPaths', parseLines(event.target.value)) }))),
            h('div', { style: { gridColumn: '1 / -1' } }, h(Field, { label: '不要备份的文件规则（每行一个）' }, h('textarea', { className: 'dshbk-textarea', value: textArray(draft.excludePatterns), onChange: (event) => update('excludePatterns', parseLines(event.target.value)) }))),
          ),
        ),
      )
    }

    function BackupSettingsSection() {
      const [tab, setTab] = useState('archives')
      const [, setLanguageTick] = useState(0)
      useEffect(() => {
        const listener = () => setLanguageTick((value) => value + 1)
        languageListeners.add(listener)
        applyLanguage(detectLanguage())
        let observer
        if (typeof MutationObserver !== 'undefined' && typeof document !== 'undefined') {
          observer = new MutationObserver(() => applyLanguage(detectLanguage()))
          observer.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] })
        }
        return () => {
          languageListeners.delete(listener)
          observer?.disconnect()
        }
      }, [])
      const [status, setStatus] = useState(null)
      const [archives, setArchives] = useState({ local: [], webdav: [] })
      const [busy, setBusy] = useState('')
      const [error, setError] = useState('')
      const [notice, setNotice] = useState('')
      const [lastResult, setLastResult] = useState(null)
      const [config, setConfig] = useState(null)
      const [scheduleInfo, setScheduleInfo] = useState(null)
      const [scheduleBusy, setScheduleBusy] = useState(false)
      const [progress, setProgress] = useState(null)
      const [sessions, setSessions] = useState([])
      const [localDir, setLocalDirState] = useState(() => readStored('localDir'))
      const [remoteDir, setRemoteDirState] = useState(() => readStored('remoteDir'))
      const [picker, setPicker] = useState({ open: false, current: '', parent: null, roots: [], entries: [], error: '', notice: '', busy: false, newName: '' })
      const setLocalDir = (value) => { setLocalDirState(value); writeStored('localDir', value) }
      const setRemoteDir = (value) => { setRemoteDirState(value); writeStored('remoteDir', value) }
      const [backupForm, setBackupForm] = useState({
        destination: 'local',
        workspace: 'all',
        workspaceMode: 'all',
        workspacePaths: [],
        sessionMode: 'all',
        sessionCount: 10,
        sessionIds: [],
        compression: 'zstd',
        level: 9,
        label: '',
        includePluginCode: true,
        includePluginData: true,
        includeWorkspaceFiles: false,
        includeStorages: true,
        includeCredentials: false,
        prune: true,
        overwrite: false,
      })
      const [restoreForm, setRestoreForm] = useState({
        archive: 'latest',
        source: 'auto',
        conflict: 'overwrite',
        safetyBackup: true,
        createMissingWorkspaceDirs: true,
        restoreSessions: true,
        restorePlugins: true,
        restorePluginData: true,
        restoreConfig: true,
        restoreWorkspaceFiles: true,
        restoreSessionIds: [],
        restoreWorkspaceIds: [],
        allowRunning: false,
        confirm: false,
      })

      const refresh = useCallback(async (quiet, override) => {
        if (!quiet) setBusy('refresh')
        try {
          const scopeLocal = override && override.localDir !== undefined ? override.localDir : localDir
          const scopeRemote = override && override.remoteDir !== undefined ? override.remoteDir : remoteDir
          const query = `${scopeLocal ? `&localDir=${encodeURIComponent(scopeLocal)}` : ''}${scopeRemote ? `&remoteDir=${encodeURIComponent(scopeRemote)}` : ''}`
          const statusData = await api(`/status?workspace=all${query}`)
          const localData = await api(`/archives?source=local${query}`)
          setStatus(statusData.status)
          setArchives({ local: localData.local || [], webdav: [], webdavError: undefined })
          if (statusData.status) {
            setLocalDirState((current) => current || statusData.status.localDir)
            if (statusData.status.webdav) setRemoteDirState((current) => current || statusData.status.webdav.remoteDir)
            setBackupForm((current) => ({
              ...current,
              compression: current.compression || statusData.status.compression,
              level: current.level === undefined ? statusData.status.compressionLevel : current.level,
            }))
            if (statusData.status.webdavConfigured) {
              api(`/archives?source=webdav${query}`).then((remoteData) => {
                setArchives((current) => ({ ...current, webdav: remoteData.webdav || [], webdavError: remoteData.webdavError }))
              }, (cause) => {
                setArchives((current) => ({ ...current, webdavError: { message: String(cause.message || cause) } }))
              })
            }
          }
          if (!quiet) setError('')
        } catch (cause) {
          if (!quiet) setError(String(cause.message || cause))
        } finally {
          if (!quiet) setBusy('')
        }
      }, [localDir, remoteDir])

      const loadSchedule = useCallback(async () => {
        try {
          const data = await api('/schedule')
          setScheduleInfo(data)
        } catch (cause) {
          setError(String(cause.message || cause))
        }
      }, [])

      const saveSchedule = async (draft) => {
        setScheduleBusy(true)
        setError('')
        setNotice('')
        try {
          const data = await api('/schedule', { method: 'POST', body: JSON.stringify({ schedule: draft }) })
          setScheduleInfo(data)
          setNotice(data.schedule.enabled ? `自动备份已开启：${data.description}` : '自动备份已关闭。')
        } catch (cause) {
          setError(String(cause.message || cause))
        } finally {
          setScheduleBusy(false)
        }
      }

      useEffect(() => {
        void refresh()
        void loadSchedule()
        api('/sessions').then((data) => setSessions(data.sessions || [])).catch(() => undefined)
      }, [])

      const onPickDefault = () => {
        setLocalDir('')
        void refresh(true, { localDir: '' })
        setNotice('已切换到默认备份文件夹。')
      }

      useEffect(() => {
        if (!progress) return undefined
        const timer = window.setInterval(() => setProgress((current) => (current ? { ...current } : current)), 1000)
        return () => window.clearInterval(timer)
      }, [progress === null])

      const pollJob = async (id, kind, signalRef) => {
        const startedAt = Date.now()
        setProgress({ kind, percent: 1, message: '正在准备…', startedAt, id })
        for (;;) {
          await new Promise((resolve) => window.setTimeout(resolve, 450))
          const data = await api(`/job?id=${encodeURIComponent(id)}`)
          const job = data.job || {}
          setProgress({
            kind,
            percent: typeof job.percent === 'number' ? job.percent : 0,
            message: job.message || '正在处理…',
            startedAt,
            id,
          })
          if (job.status === 'running') {
            if (signalRef?.cancelled) {
              await api('/job/cancel', { method: 'POST', body: JSON.stringify({ id }) }).catch(() => undefined)
              setProgress(null)
              throw new Error('已停止')
            }
            continue
          }
          setProgress(null)
          if (job.status === 'error') throw new Error(job.message || '操作失败')
          return job.result && job.result.result !== undefined ? job.result.result : job.result
        }
      }

      const cancelJob = async () => {
        const id = progress?.id
        if (!id) return
        try {
          await api('/job/cancel', { method: 'POST', body: JSON.stringify({ id }) })
          setNotice('已请求停止，正在等待任务结束…')
        } catch (cause) {
          setError(String(cause.message || cause))
        }
      }

      const cancelRef = { cancelled: false }
      const stopNow = () => {
        cancelRef.cancelled = true
        setProgress((current) => (current ? { ...current, cancelling: true } : current))
        void cancelJob()
      }

      const browseTo = async (path) => {
        setPicker((current) => ({ ...current, open: true, busy: true, error: '', notice: '' }))
        try {
          const data = await api(`/browse${path ? `?path=${encodeURIComponent(path)}` : ''}`)
          setPicker({
            open: true,
            current: data.current,
            parent: data.parent,
            roots: data.roots || [],
            entries: data.entries || [],
            error: '',
            notice: data.notice || '',
            busy: false,
            newName: '',
          })
        } catch (cause) {
          setPicker((current) => ({ ...current, open: true, busy: false, error: String(cause.message || cause) }))
        }
      }

      const openPicker = () => { void browseTo(localDir || (status && status.localDir) || '') }

      const createFolder = async ({ name, submit }) => {
        if (!submit) {
          setPicker((current) => ({ ...current, newName: name }))
          return
        }
        if (!name || name.trim() === '') return
        setPicker((current) => ({ ...current, busy: true, error: '' }))
        try {
          const data = await api('/browse/mkdir', { method: 'POST', body: JSON.stringify({ parent: picker.current, name }) })
          await browseTo(data.path)
        } catch (cause) {
          setPicker((current) => ({ ...current, busy: false, error: String(cause.message || cause) }))
        }
      }

      const runBackup = async (destination) => {
        const form = destination ? { ...backupForm, destination } : backupForm
        const workspace = form.workspaceMode === 'custom'
          ? (form.workspacePaths || [])
          : form.workspaceMode === 'auto' ? 'auto' : 'all'
        const sessionOptions = form.sessionMode === 'recent'
          ? { recentSessions: Number(form.sessionCount) || 10, sessionIds: undefined }
          : form.sessionMode === 'selected'
            ? { sessionIds: form.sessionIds || [], recentSessions: undefined }
            : { sessionIds: undefined, recentSessions: undefined }
        setBusy('backup')
        setError('')
        setNotice('')
        setLastResult(null)
        cancelRef.cancelled = false
        try {
          const data = await api('/backup', {
            method: 'POST',
            body: JSON.stringify({
              ...form,
              ...sessionOptions,
              workspace,
              includeWorkspaceFiles: form.includeWorkspaceFiles === true,
              localDir,
              remoteDir,
              async: true,
            }),
          })
          const result = data.job ? await pollJob(data.job.id, 'backup', cancelRef) : data.result
          setLastResult({ kind: 'backup', result })
          setNotice(`备份完成：${result.archiveName || result.name}`)
          await refresh(true)
        } catch (cause) {
          setError(String(cause.message || cause))
        } finally {
          setProgress(null)
          setBusy('')
        }
      }

      const runVerify = async (item) => {
        setBusy(`verify:${item.name}`)
        setError('')
        setLastResult(null)
        try {
          const data = await api('/verify', { method: 'POST', body: JSON.stringify({ archive: item.name, source: item.source, localDir, remoteDir }) })
          setLastResult({ kind: 'verify', result: data.result })
          setNotice(`检查通过：${item.name}`)
        } catch (cause) {
          setError(String(cause.message || cause))
        } finally {
          setBusy('')
        }
      }

      const openRestore = (item) => {
        setRestoreForm((current) => ({ ...current, archive: item.name, source: item.source, confirm: false }))
        setLastResult(null)
        setError('')
        setTab('restore')
      }

      const deleteArchive = async (item) => {
        const ok = typeof window === 'undefined' || window.confirm(`删除备份“${item.name}”？删了就找不回来了。`)
        if (!ok) return
        setBusy(`delete:${item.name}`)
        setError('')
        setLastResult(null)
        try {
          await api('/delete', { method: 'POST', body: JSON.stringify({ name: item.name, source: item.source, localDir, remoteDir }) })
          setNotice(`已删除备份：${item.name}`)
          await refresh(true)
        } catch (cause) {
          setError(String(cause.message || cause))
        } finally {
          setBusy('')
        }
      }

      const runPlan = async () => {
        setBusy('plan')
        setError('')
        setLastResult(null)
        try {
          const data = await api('/restore', { method: 'POST', body: JSON.stringify({ ...restoreForm, localDir, remoteDir, yes: false, dryRun: true }) })
          setLastResult({ kind: 'restore', result: data.result })
          setNotice(data.result.needsConfirmation ? '这是需要确认的恢复计划。' : '恢复计划已生成。')
        } catch (cause) {
          setError(String(cause.message || cause))
        } finally {
          setBusy('')
        }
      }

      const runRestore = async () => {
        if (!restoreForm.confirm) return
        setBusy('restore')
        setError('')
        setNotice('')
        setLastResult(null)
        cancelRef.cancelled = false
        try {
          const data = await api('/restore', { method: 'POST', body: JSON.stringify({ ...restoreForm, localDir, remoteDir, yes: true, dryRun: false, async: true }) })
          const result = data.job ? await pollJob(data.job.id, 'restore', cancelRef) : data.result
          setLastResult({ kind: 'restore', result })
          setNotice('恢复完成。重启 dsh 以加载恢复后的插件和设置。')
          await refresh(true)
        } catch (cause) {
          setError(String(cause.message || cause))
        } finally {
          setProgress(null)
          setBusy('')
        }
      }

      const loadConfig = async () => {
        setBusy('config')
        try {
          const data = await api('/config')
          setConfig(data.config)
        } catch (cause) {
          setError(String(cause.message || cause))
        } finally {
          setBusy('')
        }
      }

      const saveConfig = async (draft) => {
        setBusy('config-save')
        setError('')
        setNotice('')
        try {
          const data = await api('/config', { method: 'POST', body: JSON.stringify({ config: draft }) })
          setConfig(data.config)
          setLocalDirState(data.config.localDir || '')
          writeStored('localDir', data.config.localDir || '')
          setRemoteDirState(data.config.webdav?.remoteDir || '')
          writeStored('remoteDir', data.config.webdav?.remoteDir || '')
          setNotice('配置已保存，当前操作已使用新配置。CLI 在下次运行时读取。')
          await refresh(true, { localDir: data.config.localDir || '', remoteDir: data.config.webdav?.remoteDir || '' })
        } catch (cause) {
          setError(String(cause.message || cause))
        } finally {
          setBusy('')
        }
      }

      const resetConfig = async () => {
        setBusy('config-save')
        setError('')
        setNotice('')
        try {
          const data = await api('/config', { method: 'POST', body: JSON.stringify({ reset: true }) })
          setConfig(data.config)
          setLocalDirState(data.config.localDir || '')
          writeStored('localDir', data.config.localDir || '')
          setRemoteDirState(data.config.webdav?.remoteDir || '')
          writeStored('remoteDir', data.config.webdav?.remoteDir || '')
          setNotice('已恢复插件行配置。')
          await refresh(true, { localDir: data.config.localDir || '', remoteDir: data.config.webdav?.remoteDir || '' })
        } catch (cause) {
          setError(String(cause.message || cause))
        } finally {
          setBusy('')
        }
      }

      const tabs = [
        ['archives', '我的备份'],
        ['backup', '开始备份'],
        ['restore', '恢复备份'],
        ['schedule', '计划备份'],
        ['config', '设置'],
      ]

      return h('div', { className: 'dshbk' },
        h('div', { className: 'dshbk-head' },
          h('div', { className: 'dshbk-brand' },
            h('img', { className: 'dshbk-logo', src: ICON_URL, alt: '鲸鱼娘' }),
            h('div', null,
              h('h2', { className: 'dshbk-title' }, '鲸鱼娘备份'),
              h('p', { className: 'dshbk-sub' }, '安静地守护你的聊天记录、插件和设置，需要时一键找回。'),
            ),
          ),
          h('div', { className: 'dshbk-actions' },
            h(Button, { onClick: () => void refresh(), busy: busy === 'refresh', ghost: true }, '刷新状态'),
          ),
        ),
        h('div', { className: 'dshbk-tabs', role: 'tablist' }, tabs.map(([id, label]) =>
          h('button', {
            key: id,
            type: 'button',
            role: 'tab',
            'aria-selected': tab === id ? 'true' : 'false',
            className: 'dshbk-tab',
            'data-active': tab === id ? 'true' : 'false',
            onClick: () => { setTab(id); if (id === 'config' && !config) void loadConfig() },
          }, label))),
        error ? h('div', { className: 'dshbk-error', role: 'alert' }, error) : null,
        notice ? h('div', { className: 'dshbk-notice' }, notice) : null,
        progress ? h(ProgressCard, { progress, onCancel: stopNow }) : null,
        tab === 'schedule' ? h('div', { className: 'dshbk-panel', key: 'schedule' }, h(SchedulePanel, {
          info: scheduleInfo,
          status,
          busy: scheduleBusy,
          sessions,
          onSave: (draft) => void saveSchedule(draft),
        })) : null,
        tab === 'backup' ? h('div', { className: 'dshbk-panel', key: 'backup' }, h(BackupPanel, {
          value: backupForm,
          setValue: setBackupForm,
          busy,
          onSubmit: () => void runBackup(),
          onCancel: stopNow,
          localDir,
          defaultLocalDir: status?.localDir,
          onBrowse: openPicker,
          onPickDefault,
          sessions,
          webdavConfigured: !!(status && status.webdavConfigured),
          onNeedWebdavSetup: () => {
            setTab('config')
            if (!config) void loadConfig()
            setNotice('请先填写 WebDAV 地址和账号，保存后回来选择“保存到 WebDAV”。')
          },
        })) : null,
        tab === 'archives' ? h('div', { className: 'dshbk-panel', key: 'archives' }, h(ArchivesPanel, {
          archives,
          busy,
          onRefresh: () => void refresh(),
          onVerify: (item) => void runVerify(item),
          onRestore: openRestore,
          onDelete: (item) => void deleteArchive(item),
          localDir,
          remoteDir,
        })) : null,
        tab === 'restore' ? h('div', { className: 'dshbk-panel', key: 'restore' }, h(RestorePanel, {
          value: restoreForm,
          setValue: setRestoreForm,
          archives,
          busy,
          onPlan: () => void runPlan(),
          onRestore: () => void runRestore(),
          onCancel: stopNow,
          localDir,
          onBrowse: openPicker,
          onPickDefault,
          onRefresh: () => void refresh(),
          defaultLocalDir: status?.localDir,
        })) : null,
        tab === 'config' ? h('div', { className: 'dshbk-panel', key: 'config' }, h(ConfigPanel, {
          config,
          loading: busy === 'config',
          saving: busy === 'config-save',
          onLoad: () => void loadConfig(),
          onSave: (draft) => void saveConfig(draft),
          onReset: () => void resetConfig(),
        })) : null,
        h(FolderPicker, {
          picker,
          onClose: () => setPicker((current) => ({ ...current, open: false })),
          onBrowse: (path) => void browseTo(path),
          onChangePath: (path) => setPicker((current) => ({ ...current, current: path })),
          onCreate: (options) => void createFolder(options),
          onSelect: (path) => { if (path) { setLocalDir(path); setPicker((current) => ({ ...current, open: false })); void refresh(true, { localDir: path }) } },
        }),
        lastResult ? h(ResultView, { value: lastResult }) : null,
      )
    }

    function apply(ctx) {
      ensureCss()
      ctx.effect(() => () => {
        if (typeof document === 'undefined') return
        document.querySelector(`style[data-plugin-css="${CSS_ID}"]`)?.remove()
      }, 'dsh-backup-ui-css')
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'backup',
        order: 18,
        label: () => (detectLanguage() ? 'Whale Girl Backup' : '鲸鱼娘备份'),
      }, BackupSettingsSection))
    }

    const inject = ['slots']
    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
