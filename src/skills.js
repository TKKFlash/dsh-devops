/**
 * dsh-devops · 技能注册（契约 §3.12）
 *
 * 扫描 `<pluginDir>/skills/<name>/SKILL.md`，解析 YAML frontmatter 的顶层
 * `name` / `description`，然后经 `ctx.skills.register` 注册为 runtime 技能，
 * 并把该技能目录作为 `resourceBase`，让模型能按相对路径读取技能自带的资源。
 *
 * 为什么自己写极小解析而不引 YAML 库（契约 §0：零运行时依赖）：
 * 本插件只需要 frontmatter 里的两个**顶层标量**。完整 YAML 的锚点、块标量、
 * 复合键等能力在这里既用不到，也会带来依赖与解析面。因此只支持：
 *   * 顶层 `key: value` 单行（可选引号、行尾注释）；
 *   * `|` / `>` 块标量（多行文本，作为缩进块读取）；
 *   * `#` 开头的整行注释与空行。
 * 其它形态（嵌套映射、列表、锚点）一律忽略——技能元数据不该依赖它们。
 *
 * 目录名必须等于 frontmatter 的 name（契约要求）；不一致或 name 非法则 warn 跳过。
 */

import fs from 'node:fs/promises'
import path from 'node:path'

/** 技能名规则（与宿主 dsh-skill 的 SKILL_NAME 一致）。 */
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * 解析 frontmatter。只认顶层标量与块标量，且只取需要的键。
 *
 * @param {string} text SKILL.md 全文
 * @returns {{frontmatter: Record<string,string>, body: string, hasFrontmatter: boolean}}
 */
export function parseFrontmatter(text) {
  const source = String(text ?? '')
  // 必须位于文件最开头（允许 BOM）
  const normalized = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source
  if (!normalized.startsWith('---')) {
    return { frontmatter: {}, body: normalized, hasFrontmatter: false }
  }
  const firstBreak = normalized.indexOf('\n')
  if (firstBreak === -1) return { frontmatter: {}, body: normalized, hasFrontmatter: false }
  // 结束分隔符：单独一行的 ---
  const rest = normalized.slice(firstBreak + 1)
  const endMatch = /^(?:---|\.\.\.)[ \t]*\r?$/m.exec(rest)
  if (!endMatch) {
    return { frontmatter: {}, body: normalized, hasFrontmatter: false }
  }
  const head = rest.slice(0, endMatch.index)
  const body = rest.slice(endMatch.index + endMatch[0].length).replace(/^\r?\n/, '')

  const frontmatter = {}
  const lines = head.split(/\r?\n/)
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index]
    const trimmed = raw.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    // 只处理顶层键（无缩进）；嵌套结构一律跳过
    if (/^\s/.test(raw)) continue
    const match = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(raw)
    if (!match) continue
    const key = match[1]
    const inline = match[2]

    // 块标量：| 或 >（可带 chomping 指示符）
    if (/^[|>][-+]?\d*$/.test(inline.trim())) {
      const block = []
      for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
        const line = lines[cursor]
        if (line.trim() === '') {
          block.push('')
          continue
        }
        if (!/^\s/.test(line)) break
        block.push(line.replace(/^\s{1,}/, ''))
        index = cursor
      }
      while (block.length > 0 && block[block.length - 1] === '') block.pop()
      frontmatter[key] = block.join(inline.trim().startsWith('|') ? '\n' : ' ')
      continue
    }

    frontmatter[key] = stripScalar(inline)
  }
  return { frontmatter, body, hasFrontmatter: true }
}

/** 去掉引号与行尾注释。 */
function stripScalar(value) {
  let text = String(value ?? '').trim()
  if (text === '') return ''
  const quote = text[0]
  if ((quote === '"' || quote === "'") && text.length >= 2) {
    const end = text.lastIndexOf(quote)
    if (end > 0) return text.slice(1, end)
  }
  // 行尾注释：仅当 # 前是空白时才当注释（避免砍掉 "a#b"）
  const hashAt = text.search(/\s#/)
  if (hashAt !== -1) text = text.slice(0, hashAt).trim()
  return text
}

/** 读取单个技能目录并解析。 */
async function readSkill(dir, name) {
  const file = path.join(dir, 'SKILL.md')
  const text = await fs.readFile(file, 'utf8')
  const { frontmatter, body, hasFrontmatter } = parseFrontmatter(text)
  return {
    dir,
    name: typeof frontmatter.name === 'string' ? frontmatter.name.trim() : '',
    description: typeof frontmatter.description === 'string' ? frontmatter.description.trim() : '',
    content: body.trim(),
    hasFrontmatter,
  }
}

/**
 * 注册全部技能。
 *
 * @param {{ctx:object, pluginDir:string, log?:object}} options
 *   pluginDir：插件根目录（含 skills/ 子目录）；缺省用调用方传入值。
 * @returns {Promise<{registered:string[], skipped:Array<{dir:string,reason:string}>}>}
 */
export async function registerSkills({ ctx, pluginDir, log } = {}) {
  const registered = []
  const skipped = []
  const warn = (message) => {
    if (log && typeof log.warn === 'function') log.warn(message)
    else if (ctx?.logger?.warn) ctx.logger.warn(message)
  }

  if (!pluginDir || typeof pluginDir !== 'string') {
    warn('dsh-devops: 未提供 pluginDir，跳过技能注册')
    return { registered, skipped }
  }

  const skillsRoot = path.join(pluginDir, 'skills')
  let entries = []
  try {
    entries = await fs.readdir(skillsRoot, { withFileTypes: true })
  } catch {
    // 没有 skills 目录是合法状态（技能是可选内容）
    return { registered, skipped }
  }

  const skills = safeGet(ctx, 'skills')
  const registry = skills && typeof skills.register === 'function' ? skills : null

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const dirName = entry.name
    const dir = path.join(skillsRoot, dirName)
    let parsed
    try {
      parsed = await readSkill(dir, dirName)
    } catch (error) {
      skipped.push({ dir: dirName, reason: `读取失败：${error?.message ?? error}` })
      continue
    }

    if (!parsed.hasFrontmatter) {
      skipped.push({ dir: dirName, reason: 'SKILL.md 缺少 YAML frontmatter' })
      continue
    }
    if (parsed.name === '') {
      skipped.push({ dir: dirName, reason: 'frontmatter 缺少 name' })
      continue
    }
    if (!SKILL_NAME.test(parsed.name)) {
      skipped.push({ dir: dirName, reason: `技能名非法：${parsed.name}（需为 kebab-case）` })
      continue
    }
    // 契约要求：目录名必须等于 name。不一致就跳过，避免出现两个来源打架的同名技能。
    if (parsed.name !== dirName) {
      skipped.push({ dir: dirName, reason: `目录名(${dirName})与 frontmatter name(${parsed.name})不一致` })
      continue
    }
    if (parsed.description === '') {
      skipped.push({ dir: dirName, reason: 'frontmatter 缺少 description' })
      continue
    }
    if (parsed.content === '') {
      skipped.push({ dir: dirName, reason: 'SKILL.md 正文为空' })
      continue
    }

    if (!registry) {
      skipped.push({ dir: dirName, reason: '宿主未提供 skills 服务' })
      continue
    }

    try {
      registry.register({
        name: parsed.name,
        description: parsed.description,
        content: parsed.content,
        // 目录形态的资源基址：模型按相对路径取技能自带文件
        resourceBase: { kind: 'directory', path: dir },
        source: 'runtime',
        path: path.join(dir, 'SKILL.md'),
      })
      registered.push(parsed.name)
    } catch (error) {
      const message = String(error?.message ?? error)
      if (/already registered/i.test(message)) {
        // 重载时同名已存在：宿主会返回 no-op disposer，不算失败
        registered.push(parsed.name)
      } else {
        skipped.push({ dir: dirName, reason: `注册失败：${message}` })
      }
    }
  }

  for (const item of skipped) {
    warn(`dsh-devops: 技能 ${item.dir} 已跳过（${item.reason}）`)
  }
  return { registered, skipped }
}

function safeGet(ctx, name) {
  try {
    return ctx?.get?.(name)
  } catch {
    return null
  }
}

export default registerSkills
