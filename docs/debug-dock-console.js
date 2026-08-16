// dsh-notes 浏览器端诊断脚本
//
// 用法：打开 DSH Web 页面 → F12（DevTools）→ Console 标签 → 粘贴本脚本 → 回车。
// 把控制台输出的「dsh-notes 诊断报告」完整发给我即可。
//
// 排查目标：
//   1. 浏览器实际加载的 client.js 是哪个 rev（是否旧 bundle）
//   2. 样式标签是否注入、关键规则是否在
//   3. 勾选框/置顶按钮的实时计算样式（opacity/border/尺寸）
//   4. 勾选框位置实际命中的元素（是否被其他浮层遮挡）
//   5. 是否有其他样式表冲突覆盖 .np-* 规则

(() => {
  const out = []
  const log = (k, v) => out.push(`${k}: ${v}`)

  /* 1. boot 图广告的 rev 与浏览器实际加载的 URL */
  try {
    const boot = window.__DSH_BOOT__
    const entry = boot && boot.entries ? boot.entries.find((e) => e.id === '@dsh-external/dsh-notes') : undefined
    log('boot 广告 rev', entry ? entry.rev : '(boot 图中未找到 dsh-notes 条目)')
  } catch (e) { log('boot 读取失败', String(e)) }

  const resUrls = performance.getEntriesByType('resource')
    .map((r) => r.name)
    .filter((u) => u.includes('dsh-notes/client.js'))
  log('浏览器实际加载 URL', resUrls.length ? resUrls.join(' | ') : '(资源列表未找到)')

  /* 2. 样式标签 */
  const tag = document.getElementById('dsh-notes-dock-style')
  log('样式标签 #dsh-notes-dock-style', tag ? `存在，${tag.textContent.length} 字符` : '不存在')
  if (tag) {
    const css = tag.textContent
    for (const frag of ['opacity: 0.35', '1.5px solid var(--dsw-alias-label-tertiary)', 'data-notes-ver', 'workspaceBySession', 'font-size: 10.5px']) {
      log(`样式含「${frag}」`, css.includes(frag))
    }
  }

  /* 3. 竖栏根节点与主题令牌解析 */
  const dock = document.querySelector('[data-notes-ver], [class*="dsh-notes-dock"]')
  if (!dock) {
    log('竖栏根节点', '未找到！（竖栏可能未渲染）')
  } else {
    log('竖栏根节点标签', dock.outerHTML.slice(0, 160))
    log('data-notes-ver', dock.getAttribute('data-notes-ver') ?? '(无 → 旧 bundle)')
    const cs = getComputedStyle(dock)
    log('根 opacity', cs.opacity)
    log('根 display', cs.display)
    log('根 font-size', cs.fontSize)
    log('根 position/left', `${cs.position} / ${cs.left}`)
    log('body 暗色主题', document.body.hasAttribute('data-ds-dark-theme'))
    for (const v of ['--dsw-alias-label-tertiary', '--dsw-alias-border-l4', '--dsw-alias-brand-primary', '--dsw-alias-bg-layer-1']) {
      log(v, cs.getPropertyValue(v) || '(未解析!)')
    }
  }

  /* 4. 未完成勾选框实测样式 + 命中检测 */
  const checks = [...document.querySelectorAll('.np-check')]
  log('勾选框数量', checks.length)
  checks.slice(0, 3).forEach((el, i) => {
    const s = getComputedStyle(el)
    const r = el.getBoundingClientRect()
    log(`勾选[${i}]`, `尺寸=${Math.round(r.width)}x${Math.round(r.height)} opacity=${s.opacity} border=${s.borderWidth} ${s.borderColor} bg=${s.backgroundColor} visibility=${s.visibility} pointerEvents=${s.pointerEvents}`)
    if (r.width > 0 && r.height > 0) {
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      log(`勾选[${i}] 中心命中元素`, hit ? `${hit.tagName}.${String(hit.className).slice(0, 80)}` : '(无)')
      log(`勾选[${i}] 命中是否自身`, hit === el || (hit && el.contains(hit)))
    }
  })

  /* 5. 置顶按钮实测样式 */
  const pins = [...document.querySelectorAll('.np-pin')]
  log('置顶按钮数量', pins.length)
  pins.slice(0, 3).forEach((el, i) => {
    const s = getComputedStyle(el)
    log(`置顶[${i}]`, `opacity=${s.opacity} color=${s.color} title=${el.getAttribute('title')} size=${Math.round(el.getBoundingClientRect().width)}x${Math.round(el.getBoundingClientRect().height)}`)
  })

  /* 6. 其他样式表冲突扫描 */
  const conflicts = []
  for (const sheet of document.styleSheets) {
    let rules
    try { rules = sheet.cssRules } catch { continue }
    const walk = (list) => {
      for (const rule of list) {
        if (rule.cssRules) walk(rule.cssRules)
        else if (rule.selectorText && /\.(np-check|np-pin|np-item|np-del)\b/.test(rule.selectorText)) {
          conflicts.push(`${sheet.ownerNode ? (sheet.ownerNode.id || sheet.ownerNode.tagName) : (sheet.href || 'inline')}: ${rule.selectorText} { ${rule.style.cssText.slice(0, 140)} }`)
        }
      }
    }
    walk(rules)
  }
  log('涉及 np-* 的样式规则数', conflicts.length)
  conflicts.slice(0, 10).forEach((c) => log('  规则', c))

  /* 7. 浏览器视角的服务端内容（同源直取，排除缓存） */
  fetch(`/plugins/@dsh-external/dsh-notes/client.js?diag=${Date.now()}`)
    .then((r) => r.text())
    .then((t) => {
      console.log('浏览器直取服务端 bundle：data-notes-ver=' + t.includes('data-notes-ver') + '，pin035=' + t.includes('opacity: 0.35') + '，border-tertiary=' + t.includes('1.5px solid var(--dsw-alias-label-tertiary)'))
    })
    .catch((e) => console.log('浏览器直取服务端 bundle 失败：' + String(e)))

  console.log('==== dsh-notes 诊断报告 ====')
  console.log(out.join('\n'))
  return out.join('\n')
})()
