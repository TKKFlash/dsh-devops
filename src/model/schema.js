/**
 * 数据模型校验与规范化（契约 §2、§3.1）。
 *
 * 设计要点：
 * - 校验函数**不抛异常**，统一返回 `{ ok:true, value }` 或 `{ ok:false, errors }`。
 * - `errors[].path` 用点路径（`stages[0].jobs[1].node`），`code` 只用契约列举的
 *   短横线小写码：missing-field / unknown-node / mixed-scheduling / cycle / bad-id / bad-type。
 * - 校验**不做类型强转**（不把 "3" 当 3），但 `normalizePipeline` 会补默认值。
 */

import { randomBytes } from 'node:crypto';

/** Pipeline/Stage/Job 的 id 规则（契约 §2.1）。 */
export const ID_PATTERN = /^[a-z0-9][a-z0-9-_]{0,63}$/;

/** 模板参数类型白名单（契约 §4 字段类型）。 */
export const FIELD_TYPES = Object.freeze([
  'string',
  'text',
  'code',
  'path.dir',
  'path.file',
  'glob',
  'enum',
  'boolean',
  'number',
  'server',
  'runtime',
  'keyvalue',
  'multiselect',
  'ref:envset',
  'ref:snippet',
  // 模板参数与节点字段共用同一套字段类型；pipeline.call 的 ref:pipeline
  // 必须在两份白名单里都存在，否则模板里用它会报「未知参数类型」。
  'ref:pipeline',
]);

const SCHEDULING_WHEN = Object.freeze(['on_success', 'always', 'manual']);
const SERVER_KINDS = Object.freeze(['local', 'ssh']);
const AUTH_TYPES = Object.freeze(['key', 'password', 'agent', 'none']);

/** 构造一条错误。 */
function err(path, code, message) {
  return { path, code, message };
}

/** 是否普通对象（非数组、非 null）。 */
function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 是否为非空字符串。 */
function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

/** 去重并保持首次出现顺序。 */
function dedupe(values) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value);
      out.push(value);
    }
  }
  return out;
}

/**
 * 深拷贝 JSON 值，保证 `normalizePipeline` 返回的新对象与入参
 * **不共享任何可变子结构**（否则调用方改结果会污染原始定义）。
 */
function cloneJson(value) {
  if (value === null || typeof value !== 'object') return value;
  try {
    return structuredClone(value);
  } catch {
    return JSON.parse(JSON.stringify(value));
  }
}

/**
 * 内置节点类型白名单（契约任务描述里约定的 18 个内置节点）。
 *
 * 为什么 model 层要持有这份清单：`validatePipeline` 是唯一校验入口，而
 * `unknown-node` 是契约 §3.1 明列的错误码，若默认不校验，保存接口就能写进
 * 坏流水线。装配层注册完自定义节点后应调用 `setKnownNodes()` 覆盖本清单
 * （见 index.js），否则自定义节点会被误判为未知。
 */
export const BUILTIN_NODE_TYPES = Object.freeze([
  'shell.exec',
  'node.exec',
  'python.exec',
  'file.pick',
  'file.write',
  'file.copy',
  'artifact.collect',
  'cache.save',
  'cache.restore',
  'condition.if',
  'wait.delay',
  'wait.approval',
  'pipeline.call',
  'server.ensureRuntime',
  'http.request',
  'notify.webhook',
  'log.message',
  'env.set',
]);

/** 当前生效的已知节点集合（装配层可覆盖）。 */
let knownNodeTypes = new Set(BUILTIN_NODE_TYPES);

/**
 * 注入已知节点类型集合（装配层在 nodeRegistry 就绪后调用）。
 * @param {Iterable<string>} types
 */
export function setKnownNodes(types) {
  const next = new Set();
  for (const type of types ?? []) {
    if (typeof type === 'string' && type !== '') next.add(type);
  }
  knownNodeTypes = next;
  return knownNodeTypes;
}

/** 读取当前已知节点类型（只读快照）。 */
export function getKnownNodes() {
  return new Set(knownNodeTypes);
}

/** 生成新 id：`prefix-<8位随机>`。 */
export function newId(prefix) {
  const body = randomBytes(4).toString('hex');
  const head = isNonEmptyString(prefix) ? String(prefix).trim() : 'id';
  return `${head}-${body}`;
}

/* ------------------------------------------------------------------ *
 * 变量与环境变量组
 * ------------------------------------------------------------------ */

/** 校验 `{name,value,secret}` 形态的变量数组。 */
function validateVarList(list, path, errors) {
  if (list === undefined || list === null) return;
  if (!Array.isArray(list)) {
    errors.push(err(path, 'bad-type', '必须是数组'));
    return;
  }
  list.forEach((item, i) => {
    const itemPath = `${path}[${i}]`;
    if (!isPlainObject(item)) {
      errors.push(err(itemPath, 'bad-type', '必须是对象'));
      return;
    }
    if (!isNonEmptyString(item.name)) {
      errors.push(err(`${itemPath}.name`, 'missing-field', '变量名不能为空'));
    } else if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(item.name)) {
      errors.push(err(`${itemPath}.name`, 'bad-id', '变量名需符合 shell 标识符规则'));
    }
    if (item.value !== undefined && item.value !== null && typeof item.value !== 'string') {
      errors.push(err(`${itemPath}.value`, 'bad-type', '变量值必须是字符串'));
    }
    if (item.secret !== undefined && typeof item.secret !== 'boolean') {
      errors.push(err(`${itemPath}.secret`, 'bad-type', 'secret 必须是布尔值'));
    }
  });
}

/** 校验环境变量组引用数组。 */
function validateRefList(list, path, errors) {
  if (list === undefined || list === null) return;
  if (!Array.isArray(list)) {
    errors.push(err(path, 'bad-type', '必须是数组'));
    return;
  }
  list.forEach((item, i) => {
    if (!isNonEmptyString(item)) {
      errors.push(err(`${path}[${i}]`, 'bad-type', '引用必须是非空字符串'));
    }
  });
}

/** 校验字符串数组。 */
function validateStringList(list, path, errors) {
  if (list === undefined || list === null) return;
  if (!Array.isArray(list)) {
    errors.push(err(path, 'bad-type', '必须是数组'));
    return;
  }
  list.forEach((item, i) => {
    if (typeof item !== 'string') {
      errors.push(err(`${path}[${i}]`, 'bad-type', '必须是字符串'));
    }
  });
}

/* ------------------------------------------------------------------ *
 * Pipeline
 * ------------------------------------------------------------------ */

/** 收集 pipeline 中所有 job（带 path）。 */
function collectJobs(pipeline) {
  const out = [];
  const stages = Array.isArray(pipeline?.stages) ? pipeline.stages : [];
  stages.forEach((stage, si) => {
    const jobs = Array.isArray(stage?.jobs) ? stage.jobs : [];
    jobs.forEach((job, ji) => {
      out.push({ job, path: `stages[${si}].jobs[${ji}]`, stageIndex: si, jobIndex: ji });
    });
  });
  return out;
}

/**
 * 检测 needs 依赖环。
 * @returns {string[]|null} 环上的 job id 序列（首尾同 id），无环返回 null
 */
function findCycle(jobs) {
  const byId = new Map();
  for (const entry of jobs) {
    if (isNonEmptyString(entry.job?.id)) byId.set(entry.job.id, entry);
  }
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map();
  const stack = [];

  for (const startId of byId.keys()) {
    if ((color.get(startId) ?? WHITE) !== WHITE) continue;
    // 迭代式 DFS，避免深流水线爆栈
    const work = [{ id: startId, iterator: null }];
    while (work.length > 0) {
      const frame = work[work.length - 1];
      if (frame.iterator === null) {
        color.set(frame.id, GRAY);
        stack.push(frame.id);
        const needs = byId.get(frame.id)?.job?.needs;
        frame.iterator = (Array.isArray(needs) ? needs : []).filter((n) => byId.has(n))[Symbol.iterator]();
      }
      const next = frame.iterator.next();
      if (next.done) {
        color.set(frame.id, BLACK);
        stack.pop();
        work.pop();
        continue;
      }
      const childId = next.value;
      const childColor = color.get(childId) ?? WHITE;
      if (childColor === GRAY) {
        const at = stack.indexOf(childId);
        return [...stack.slice(at), childId];
      }
      if (childColor === WHITE) {
        work.push({ id: childId, iterator: null });
      }
    }
  }
  return null;
}

/**
 * 判定调度模式（契约 §2.1）。
 * 任一 job 有非空 needs → 'dag'，否则 'staged'。
 * @param {object} pipeline
 * @returns {'dag'|'staged'}
 */
export function detectScheduling(pipeline) {
  const jobs = collectJobs(pipeline);
  for (const entry of jobs) {
    const needs = entry.job?.needs;
    if (Array.isArray(needs) && needs.length > 0) return 'dag';
  }
  return 'staged';
}

/**
 * 校验流水线。
 * @param {object} pipeline
 * @param {{knownNodes?: Iterable<string>}} [options]
 *   缺省用 `knownNodeTypes`（内置 18 个节点 + 装配层注入的自定义节点）。
 *   显式传入 `knownNodes` 可覆盖（测试与局部校验用）。
 * @returns {{ok:true, value:object}|{ok:false, errors:Array<{path:string,code:string,message:string}>}}
 */
export function validatePipeline(pipeline, options = {}) {
  const errors = [];
  if (!isPlainObject(pipeline)) {
    return { ok: false, errors: [err('', 'bad-type', '流水线必须是对象')] };
  }

  if (!isNonEmptyString(pipeline.id)) {
    errors.push(err('id', 'missing-field', '缺少 id'));
  } else if (!ID_PATTERN.test(pipeline.id)) {
    errors.push(err('id', 'bad-id', 'id 需匹配 [a-z0-9][a-z0-9-_]{0,63}'));
  }
  if (!isNonEmptyString(pipeline.name)) {
    errors.push(err('name', 'missing-field', '缺少 name'));
  }
  if (pipeline.description !== undefined && typeof pipeline.description !== 'string') {
    errors.push(err('description', 'bad-type', '必须是字符串'));
  }
  if (pipeline.category !== undefined && typeof pipeline.category !== 'string') {
    errors.push(err('category', 'bad-type', '必须是字符串'));
  }
  if (pipeline.version !== undefined && (typeof pipeline.version !== 'number' || !Number.isFinite(pipeline.version))) {
    errors.push(err('version', 'bad-type', 'version 必须是数字'));
  }
  if (pipeline.favorite !== undefined && typeof pipeline.favorite !== 'boolean') {
    errors.push(err('favorite', 'bad-type', 'favorite 必须是布尔值'));
  }
  if (pipeline.owner !== undefined && pipeline.owner !== null && typeof pipeline.owner !== 'string') {
    errors.push(err('owner', 'bad-type', 'owner 必须是字符串或 null'));
  }
  validateStringList(pipeline.tags, 'tags', errors);
  validateVarList(pipeline.variables, 'variables', errors);
  validateRefList(pipeline.envSetRefs, 'envSetRefs', errors);

  if (pipeline.defaults !== undefined) {
    if (!isPlainObject(pipeline.defaults)) {
      errors.push(err('defaults', 'bad-type', '必须是对象'));
    } else {
      const { server, timeoutMs } = pipeline.defaults;
      if (server !== undefined && server !== null && typeof server !== 'string') {
        errors.push(err('defaults.server', 'bad-type', '必须是字符串'));
      }
      if (timeoutMs !== undefined && (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs < 0)) {
        errors.push(err('defaults.timeoutMs', 'bad-type', 'timeoutMs 必须是非负数字'));
      }
    }
  }

  if (!Array.isArray(pipeline.stages)) {
    errors.push(err('stages', 'bad-type', 'stages 必须是数组'));
  } else {
    const knownNodes = options?.knownNodes ? new Set(options.knownNodes) : knownNodeTypes;
    const stageIds = new Set();
    const jobIds = new Set();
    let hasNeeds = false;
    let hasParallelStage = false;

    pipeline.stages.forEach((stage, si) => {
      const stagePath = `stages[${si}]`;
      if (!isPlainObject(stage)) {
        errors.push(err(stagePath, 'bad-type', '阶段必须是对象'));
        return;
      }
      if (!isNonEmptyString(stage.id)) {
        errors.push(err(`${stagePath}.id`, 'missing-field', '缺少阶段 id'));
      } else if (!ID_PATTERN.test(stage.id)) {
        errors.push(err(`${stagePath}.id`, 'bad-id', '阶段 id 需匹配 [a-z0-9][a-z0-9-_]{0,63}'));
      } else if (stageIds.has(stage.id)) {
        errors.push(err(`${stagePath}.id`, 'bad-id', `阶段 id 重复：${stage.id}`));
      } else {
        stageIds.add(stage.id);
      }
      if (stage.name !== undefined && typeof stage.name !== 'string') {
        errors.push(err(`${stagePath}.name`, 'bad-type', '必须是字符串'));
      }
      if (stage.parallel !== undefined) {
        if (typeof stage.parallel !== 'boolean') {
          errors.push(err(`${stagePath}.parallel`, 'bad-type', 'parallel 必须是布尔值'));
        } else if (stage.parallel) {
          hasParallelStage = true;
        }
      }
      validateVarList(stage.variables, `${stagePath}.variables`, errors);

      if (!Array.isArray(stage.jobs)) {
        errors.push(err(`${stagePath}.jobs`, 'bad-type', 'jobs 必须是数组'));
        return;
      }
      stage.jobs.forEach((job, ji) => {
        const jobPath = `${stagePath}.jobs[${ji}]`;
        if (!isPlainObject(job)) {
          errors.push(err(jobPath, 'bad-type', '作业必须是对象'));
          return;
        }
        if (!isNonEmptyString(job.id)) {
          errors.push(err(`${jobPath}.id`, 'missing-field', '缺少作业 id'));
        } else if (!ID_PATTERN.test(job.id)) {
          errors.push(err(`${jobPath}.id`, 'bad-id', '作业 id 需匹配 [a-z0-9][a-z0-9-_]{0,63}'));
        } else if (jobIds.has(job.id)) {
          errors.push(err(`${jobPath}.id`, 'bad-id', `作业 id 重复：${job.id}`));
        } else {
          jobIds.add(job.id);
        }
        if (job.name !== undefined && typeof job.name !== 'string') {
          errors.push(err(`${jobPath}.name`, 'bad-type', '必须是字符串'));
        }
        if (!isNonEmptyString(job.node)) {
          errors.push(err(`${jobPath}.node`, 'missing-field', '缺少节点类型 node'));
        } else if (knownNodes && !knownNodes.has(job.node)) {
          errors.push(err(`${jobPath}.node`, 'unknown-node', `未知节点类型：${job.node}`));
        }
        if (job.server !== undefined && job.server !== null && typeof job.server !== 'string') {
          errors.push(err(`${jobPath}.server`, 'bad-type', '必须是字符串'));
        }
        if (job.needs !== undefined) {
          if (!Array.isArray(job.needs)) {
            errors.push(err(`${jobPath}.needs`, 'bad-type', 'needs 必须是数组'));
          } else {
            job.needs.forEach((need, ni) => {
              if (!isNonEmptyString(need)) {
                errors.push(err(`${jobPath}.needs[${ni}]`, 'bad-type', '依赖项必须是非空字符串'));
              } else if (need === job.id) {
                errors.push(err(`${jobPath}.needs[${ni}]`, 'cycle', `作业不能依赖自身：${need}`));
              }
            });
            if (job.needs.length > 0) hasNeeds = true;
          }
        }
        if (job.retry !== undefined) {
          if (!isPlainObject(job.retry)) {
            errors.push(err(`${jobPath}.retry`, 'bad-type', '必须是对象'));
          } else {
            const { max, delayMs } = job.retry;
            if (max !== undefined && (typeof max !== 'number' || !Number.isInteger(max) || max < 0)) {
              errors.push(err(`${jobPath}.retry.max`, 'bad-type', 'max 必须是非负整数'));
            }
            if (delayMs !== undefined && (typeof delayMs !== 'number' || !Number.isFinite(delayMs) || delayMs < 0)) {
              errors.push(err(`${jobPath}.retry.delayMs`, 'bad-type', 'delayMs 必须是非负数字'));
            }
          }
        }
        if (job.timeoutMs !== undefined && (typeof job.timeoutMs !== 'number' || !Number.isFinite(job.timeoutMs) || job.timeoutMs < 0)) {
          errors.push(err(`${jobPath}.timeoutMs`, 'bad-type', 'timeoutMs 必须是非负数字'));
        }
        if (job.allowFailure !== undefined && typeof job.allowFailure !== 'boolean') {
          errors.push(err(`${jobPath}.allowFailure`, 'bad-type', 'allowFailure 必须是布尔值'));
        }
        if (job.allowProvision !== undefined && typeof job.allowProvision !== 'boolean') {
          errors.push(err(`${jobPath}.allowProvision`, 'bad-type', 'allowProvision 必须是布尔值'));
        }
        if (job.when !== undefined && !SCHEDULING_WHEN.includes(job.when)) {
          errors.push(err(`${jobPath}.when`, 'bad-type', `when 只能是 ${SCHEDULING_WHEN.join('|')}`));
        }
        if (job.with !== undefined && !isPlainObject(job.with)) {
          errors.push(err(`${jobPath}.with`, 'bad-type', 'with 必须是对象'));
        }
        if (job.cache !== undefined) {
          if (!isPlainObject(job.cache)) {
            errors.push(err(`${jobPath}.cache`, 'bad-type', '必须是对象'));
          } else {
            if (job.cache.key !== undefined && typeof job.cache.key !== 'string') {
              errors.push(err(`${jobPath}.cache.key`, 'bad-type', '必须是字符串'));
            }
            validateStringList(job.cache.paths, `${jobPath}.cache.paths`, errors);
          }
        }
        validateStringList(job.artifacts, `${jobPath}.artifacts`, errors);
        validateVarList(job.env, `${jobPath}.env`, errors);
        validateRefList(job.envSetRefs, `${jobPath}.envSetRefs`, errors);
      });
    });

    // 悬空依赖：needs 指向不存在的 job
    for (const entry of collectJobs(pipeline)) {
      const needs = entry.job?.needs;
      if (!Array.isArray(needs)) continue;
      needs.forEach((need, ni) => {
        if (isNonEmptyString(need) && !jobIds.has(need)) {
          errors.push(err(`${entry.path}.needs[${ni}]`, 'missing-field', `依赖的作业不存在：${need}`));
        }
      });
    }

    // 两种调度模式不得混用
    if (hasNeeds && hasParallelStage) {
      const idx = pipeline.stages.findIndex((s) => isPlainObject(s) && s.parallel === true);
      errors.push(
        err(
          `stages[${idx}]`,
          'mixed-scheduling',
          '存在 needs 依赖（DAG 模式）时不得再使用 parallel:true 阶段',
        ),
      );
    }

    const cycle = findCycle(collectJobs(pipeline));
    if (cycle) {
      const entry = collectJobs(pipeline).find((e) => e.job?.id === cycle[0]);
      errors.push(err(`${entry?.path ?? 'stages'}.needs`, 'cycle', `依赖成环：${cycle.join(' → ')}`));
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: pipeline };
}

/**
 * 补默认值、去重 id、稳定排序；返回新对象（不修改入参）。
 *
 * 关于「稳定排序」的选择：阶段与作业的**声明顺序是用户意图**，因此原样保留；
 * 排序作用于无序集合——`tags` 去重、`needs` 去重并按字典序稳定排序，
 * 使同一份定义在不同次规范化后得到完全一致的结果（利于 diff 与哈希）。
 * @param {object} pipeline
 * @returns {object} 规范化后的新对象
 */
export function normalizePipeline(pipeline) {
  const source = isPlainObject(pipeline) ? pipeline : {};
  const now = Date.now();
  const variables = Array.isArray(source.variables)
    ? source.variables
        .filter(isPlainObject)
        .map((item) => ({ name: String(item.name ?? ''), value: item.value ?? '', secret: item.secret === true }))
    : [];

  const stages = (Array.isArray(source.stages) ? source.stages : []).filter(isPlainObject).map((stage, si) => {
    const jobs = (Array.isArray(stage.jobs) ? stage.jobs : []).filter(isPlainObject).map((job, ji) => {
      const needs = Array.isArray(job.needs) ? dedupe(job.needs.filter(isNonEmptyString)).sort() : [];
      return {
        id: isNonEmptyString(job.id) ? job.id : `job-${si}-${ji}`,
        name: typeof job.name === 'string' ? job.name : '',
        node: typeof job.node === 'string' ? job.node : '',
        // 契约 §2.1：server 缺省用 defaults.server（而不是 null，否则执行器拿不到目标机）
        server: isNonEmptyString(job.server) ? job.server : (source.defaults?.server ?? null) || 'local',
        needs,
        retry: {
          max: Number.isInteger(job.retry?.max) ? job.retry.max : 0,
          delayMs: Number.isFinite(job.retry?.delayMs) ? job.retry.delayMs : 1000,
        },
        timeoutMs: Number.isFinite(job.timeoutMs) ? job.timeoutMs : (source.defaults?.timeoutMs ?? 600000),
        allowFailure: job.allowFailure === true,
        when: SCHEDULING_WHEN.includes(job.when) ? job.when : 'on_success',
        allowProvision: job.allowProvision === true,
        env: Array.isArray(job.env)
          ? job.env.filter(isPlainObject).map((item) => ({
              name: String(item.name ?? ''),
              value: item.value ?? '',
              secret: item.secret === true,
            }))
          : [],
        envSetRefs: Array.isArray(job.envSetRefs) ? dedupe(job.envSetRefs.filter(isNonEmptyString)) : [],
        with: isPlainObject(job.with) ? cloneJson(job.with) : {},
        artifacts: Array.isArray(job.artifacts) ? dedupe(job.artifacts.filter((a) => typeof a === 'string')) : [],
        cache: {
          key: typeof job.cache?.key === 'string' ? job.cache.key : '',
          paths: Array.isArray(job.cache?.paths) ? dedupe(job.cache.paths.filter((p) => typeof p === 'string')) : [],
        },
      };
    });
    // 阶段内 id 去重
    const seen = new Set();
    for (const job of jobs) {
      let candidate = job.id;
      let n = 2;
      while (seen.has(candidate)) {
        candidate = `${job.id}-${n}`;
        n += 1;
      }
      job.id = candidate;
      seen.add(candidate);
    }
    return {
      id: isNonEmptyString(stage.id) ? stage.id : `stage-${si}`,
      name: typeof stage.name === 'string' ? stage.name : '',
      parallel: stage.parallel === true,
      // 阶段级变量是流水线变量的补充层，独立规范化，绝不复用流水线级数组
      variables: Array.isArray(stage.variables)
        ? stage.variables
            .filter(isPlainObject)
            .map((item) => ({
              name: String(item.name ?? ''),
              value: item.value ?? '',
              secret: item.secret === true,
            }))
        : [],
      jobs,
    };
  });

  // 阶段 id 去重
  const seenStages = new Set();
  for (const stage of stages) {
    let candidate = stage.id;
    let n = 2;
    while (seenStages.has(candidate)) {
      candidate = `${stage.id}-${n}`;
      n += 1;
    }
    stage.id = candidate;
    seenStages.add(candidate);
  }

  return {
    id: isNonEmptyString(source.id) ? source.id : newId('pipeline'),
    name: typeof source.name === 'string' ? source.name : '',
    description: typeof source.description === 'string' ? source.description : '',
    category: typeof source.category === 'string' ? source.category : '',
    tags: Array.isArray(source.tags) ? dedupe(source.tags.filter((t) => typeof t === 'string')) : [],
    favorite: source.favorite === true,
    owner: source.owner ?? null,
    version: Number.isFinite(source.version) ? source.version : 1,
    variables,
    envSetRefs: Array.isArray(source.envSetRefs) ? dedupe(source.envSetRefs.filter(isNonEmptyString)) : [],
    defaults: {
      server: typeof source.defaults?.server === 'string' ? source.defaults.server : 'local',
      timeoutMs: Number.isFinite(source.defaults?.timeoutMs) ? source.defaults.timeoutMs : 600000,
    },
    stages,
    createdAt: Number.isFinite(source.createdAt) ? source.createdAt : now,
    updatedAt: Number.isFinite(source.updatedAt) ? source.updatedAt : now,
  };
}

/* ------------------------------------------------------------------ *
 * Template
 * ------------------------------------------------------------------ */

/**
 * 校验模板（契约 §2.2）。
 * `body` 只做浅校验（必须是对象且 stages 为数组）；body 内允许 `${{ }}` 占位，
 * 因此不在此处跑完整 pipeline 校验。
 * @param {object} template
 * @returns {{ok:true, value:object}|{ok:false, errors:Array}}
 */
export function validateTemplate(template) {
  const errors = [];
  if (!isPlainObject(template)) {
    return { ok: false, errors: [err('', 'bad-type', '模板必须是对象')] };
  }
  if (!isNonEmptyString(template.id)) {
    errors.push(err('id', 'missing-field', '缺少 id'));
  } else if (!ID_PATTERN.test(template.id)) {
    errors.push(err('id', 'bad-id', 'id 需匹配 [a-z0-9][a-z0-9-_]{0,63}'));
  }
  if (!isNonEmptyString(template.name)) {
    errors.push(err('name', 'missing-field', '缺少 name'));
  }
  if (template.description !== undefined && typeof template.description !== 'string') {
    errors.push(err('description', 'bad-type', '必须是字符串'));
  }
  if (template.category !== undefined && typeof template.category !== 'string') {
    errors.push(err('category', 'bad-type', '必须是字符串'));
  }
  if (template.icon !== undefined && typeof template.icon !== 'string') {
    errors.push(err('icon', 'bad-type', '必须是字符串'));
  }
  validateStringList(template.tags, 'tags', errors);

  if (!Array.isArray(template.parameters)) {
    errors.push(err('parameters', 'bad-type', 'parameters 必须是数组'));
  } else {
    const names = new Set();
    template.parameters.forEach((param, i) => {
      const paramPath = `parameters[${i}]`;
      if (!isPlainObject(param)) {
        errors.push(err(paramPath, 'bad-type', '参数必须是对象'));
        return;
      }
      if (!isNonEmptyString(param.name)) {
        errors.push(err(`${paramPath}.name`, 'missing-field', '缺少参数名'));
      } else if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(param.name)) {
        errors.push(err(`${paramPath}.name`, 'bad-id', '参数名需符合标识符规则'));
      } else if (names.has(param.name)) {
        errors.push(err(`${paramPath}.name`, 'bad-id', `参数名重复：${param.name}`));
      } else {
        names.add(param.name);
      }
      if (param.label !== undefined && typeof param.label !== 'string') {
        errors.push(err(`${paramPath}.label`, 'bad-type', '必须是字符串'));
      }
      if (param.description !== undefined && typeof param.description !== 'string') {
        errors.push(err(`${paramPath}.description`, 'bad-type', '必须是字符串'));
      }
      if (param.required !== undefined && typeof param.required !== 'boolean') {
        errors.push(err(`${paramPath}.required`, 'bad-type', 'required 必须是布尔值'));
      }
      if (!isNonEmptyString(param.type)) {
        errors.push(err(`${paramPath}.type`, 'missing-field', '缺少参数类型 type'));
      } else if (!FIELD_TYPES.includes(param.type)) {
        errors.push(err(`${paramPath}.type`, 'bad-type', `未知参数类型：${param.type}`));
      }
      if (param.options !== undefined) {
        if (!Array.isArray(param.options)) {
          errors.push(err(`${paramPath}.options`, 'bad-type', 'options 必须是数组'));
        } else if (param.type === 'enum' || param.type === 'multiselect') {
          // enum/multiselect 没有选项就无法渲染控件，必须给出非空 options
          if (param.options.length === 0) {
            errors.push(err(`${paramPath}.options`, 'missing-field', `${param.type} 参数必须提供非空 options`));
          } else if (param.options.some((option) => typeof option !== 'string')) {
            errors.push(err(`${paramPath}.options`, 'bad-type', 'options 元素必须是字符串'));
          }
        }
        // 其它类型：契约 §2.2 的官方示例就带 `options: []`，按「仅 enum 使用」容忍，不报错
      } else if (param.type === 'enum' || param.type === 'multiselect') {
        errors.push(err(`${paramPath}.options`, 'missing-field', `${param.type} 参数必须提供非空 options`));
      }
      if (param.field !== undefined && !FIELD_TYPES.includes(param.field)) {
        errors.push(err(`${paramPath}.field`, 'bad-type', `未知字段类型：${param.field}`));
      }
      if (param.min !== undefined && typeof param.min !== 'number') {
        errors.push(err(`${paramPath}.min`, 'bad-type', 'min 必须是数字'));
      }
      if (param.max !== undefined && typeof param.max !== 'number') {
        errors.push(err(`${paramPath}.max`, 'bad-type', 'max 必须是数字'));
      }
    });
  }

  if (!isPlainObject(template.body)) {
    errors.push(err('body', 'missing-field', '缺少 body'));
  } else if (!Array.isArray(template.body.stages)) {
    errors.push(err('body.stages', 'bad-type', 'body.stages 必须是数组'));
  }

  if (template.usageCount !== undefined && (typeof template.usageCount !== 'number' || !Number.isFinite(template.usageCount))) {
    errors.push(err('usageCount', 'bad-type', 'usageCount 必须是数字'));
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: template };
}

/* ------------------------------------------------------------------ *
 * Server
 * ------------------------------------------------------------------ */

/**
 * 校验服务器（契约 §2.3）。
 * 内置 `local` 服务器必须是 `kind:'local'`（不可改 kind）。
 * @param {object} server
 * @returns {{ok:true, value:object}|{ok:false, errors:Array}}
 */
export function validateServer(server) {
  const errors = [];
  if (!isPlainObject(server)) {
    return { ok: false, errors: [err('', 'bad-type', '服务器必须是对象')] };
  }
  if (!isNonEmptyString(server.id)) {
    errors.push(err('id', 'missing-field', '缺少 id'));
  } else if (!ID_PATTERN.test(server.id)) {
    errors.push(err('id', 'bad-id', 'id 需匹配 [a-z0-9][a-z0-9-_]{0,63}'));
  }
  if (!isNonEmptyString(server.name)) {
    errors.push(err('name', 'missing-field', '缺少 name'));
  }
  if (!isNonEmptyString(server.kind)) {
    errors.push(err('kind', 'missing-field', '缺少 kind'));
  } else if (!SERVER_KINDS.includes(server.kind)) {
    errors.push(err('kind', 'bad-type', `kind 只能是 ${SERVER_KINDS.join('|')}`));
  }
  if (server.id === 'local' && server.kind !== 'local') {
    errors.push(err('kind', 'bad-type', '内置 local 服务器的 kind 不可修改'));
  }
  if (server.kind === 'ssh') {
    if (!isNonEmptyString(server.host)) {
      errors.push(err('host', 'missing-field', 'ssh 服务器必须提供 host'));
    }
  } else if (server.host !== undefined && server.host !== null && typeof server.host !== 'string') {
    errors.push(err('host', 'bad-type', 'host 必须是字符串'));
  }
  if (server.port !== undefined) {
    // 本机服务器不经 TCP，port 0 表示「无端口」；ssh 才要求 1-65535。
    // 契约 §2.3 内置 local 的预置值就是 0，若一律要求 >=1 会让
    // 「读取服务器 → validateServer → 保存/导出」对内置本机服务器全线失败。
    const minPort = server.kind === 'local' ? 0 : 1;
    if (
      typeof server.port !== 'number' ||
      !Number.isInteger(server.port) ||
      server.port < minPort ||
      server.port > 65535
    ) {
      errors.push(err('port', 'bad-type', `port 必须是 ${minPort}-65535 的整数`));
    }
  }
  if (server.user !== undefined && server.user !== null && typeof server.user !== 'string') {
    errors.push(err('user', 'bad-type', 'user 必须是字符串'));
  }
  if (server.auth !== undefined) {
    if (!isPlainObject(server.auth)) {
      errors.push(err('auth', 'bad-type', 'auth 必须是对象'));
    } else {
      if (server.auth.type !== undefined && !AUTH_TYPES.includes(server.auth.type)) {
        errors.push(err('auth.type', 'bad-type', `auth.type 只能是 ${AUTH_TYPES.join('|')}`));
      }
      // 安全约束（lead 裁决 (b)）：none 只对内置本机服务器合法。
      // ssh 上用 none 会退化成「静默无认证连接」，必须显式报错而不是放行。
      if (server.auth.type === 'none' && server.kind !== 'local') {
        errors.push(err('auth.type', 'bad-type', 'none 仅适用于 kind:local 的本机服务器'));
      }
      if (server.auth.type === 'key' && server.kind === 'ssh') {
        const keyRef = server.auth.keyRef ?? server.auth.privateKeyRef;
        if (keyRef !== undefined && keyRef !== null && typeof keyRef !== 'string') {
          errors.push(err('auth.keyRef', 'bad-type', 'keyRef 必须是字符串'));
        }
      }
      for (const key of ['keyRef', 'passwordRef', 'privateKeyRef', 'passphraseRef']) {
        if (server.auth[key] !== undefined && server.auth[key] !== null && typeof server.auth[key] !== 'string') {
          errors.push(err(`auth.${key}`, 'bad-type', '必须是字符串'));
        }
      }
    }
  }
  if (server.shell !== undefined && server.shell !== null && typeof server.shell !== 'string') {
    errors.push(err('shell', 'bad-type', 'shell 必须是字符串'));
  }
  if (server.workdir !== undefined && server.workdir !== null && typeof server.workdir !== 'string') {
    errors.push(err('workdir', 'bad-type', 'workdir 必须是字符串'));
  }
  validateStringList(server.tags, 'tags', errors);
  validateVarList(server.defaultEnv, 'defaultEnv', errors);
  validateVarList(server.customEnv, 'customEnv', errors);
  validateRefList(server.envSetRefs, 'envSetRefs', errors);
  if (server.probe !== undefined && !isPlainObject(server.probe)) {
    errors.push(err('probe', 'bad-type', 'probe 必须是对象'));
  }
  if (server.runtimes !== undefined && !isPlainObject(server.runtimes)) {
    errors.push(err('runtimes', 'bad-type', 'runtimes 必须是对象'));
  }
  if (server.allowProvision !== undefined && typeof server.allowProvision !== 'boolean') {
    errors.push(err('allowProvision', 'bad-type', 'allowProvision 必须是布尔值'));
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: server };
}
