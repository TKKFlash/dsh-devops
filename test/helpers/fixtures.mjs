// 测试夹具：严格按 docs/CONTRACT.md §2 的 JSON 形状构造样本。
// 这些对象是"契约的形状"本身，任何模块的不一致都应当被测出来。

/** §2.1 一条最简单但完整的流水线（staged 模式） */
export function samplePipeline(overrides = {}) {
  return {
    id: 'build-deploy',
    name: '构建并部署',
    description: '',
    category: 'build',
    tags: ['prod'],
    favorite: false,
    owner: null,
    version: 1,
    variables: [{ name: 'ENV', value: 'prod', secret: false }],
    envSetRefs: ['prod-env'],
    defaults: { server: 'local', timeoutMs: 600000 },
    stages: [
      {
        id: 'build',
        name: '构建',
        parallel: false,
        jobs: [
          {
            id: 'compile',
            name: '编译',
            node: 'shell.exec',
            server: 'local',
            needs: [],
            retry: { max: 0, delayMs: 1000 },
            timeoutMs: 600000,
            allowFailure: false,
            when: 'on_success',
            allowProvision: false,
            env: [{ name: 'NODE_ENV', value: 'production', secret: false }],
            envSetRefs: [],
            with: { script: 'npm ci && npm run build' },
            artifacts: ['dist/**'],
            cache: { key: '', paths: [] },
          },
        ],
      },
    ],
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

/** DAG 模式流水线：job 带 needs，阶段不得 parallel:true */
export function dagPipeline() {
  return samplePipeline({
    id: 'dag-flow',
    stages: [
      {
        id: 's1',
        name: '阶段一',
        parallel: false,
        jobs: [
          { id: 'a', name: 'A', node: 'shell.exec', with: { script: 'echo a' } },
          { id: 'b', name: 'B', node: 'shell.exec', needs: ['a'], with: { script: 'echo b' } },
        ],
      },
    ],
  });
}

/** §2.2 模板 */
export function sampleTemplate(overrides = {}) {
  return {
    id: 'tpl-node-build',
    name: 'Node 构建模板',
    description: '',
    category: 'build',
    tags: [],
    icon: 'box',
    parameters: [
      {
        name: 'image_tag',
        label: '镜像标签',
        type: 'string',
        required: true,
        default: 'latest',
        field: 'string',
        description: '',
      },
    ],
    body: samplePipeline({ id: 'tpl-body' }),
    usageCount: 0,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

/** §2.3 SSH 服务器 */
export function sampleServer(overrides = {}) {
  return {
    id: 'prod-01',
    name: '生产机',
    kind: 'ssh',
    host: '10.0.0.5',
    port: 22,
    user: 'deploy',
    auth: { type: 'key', keyRef: 'PROD_SSH_KEY', passwordRef: '' },
    shell: '',
    workdir: '/srv/app',
    tags: ['prod'],
    defaultEnv: [{ name: 'LANG', value: 'C.UTF-8', secret: false }],
    customEnv: [{ name: 'APP_ENV', value: 'prod', secret: false }],
    envSetRefs: [],
    probe: { at: 0, os: '', arch: '', shell: '', workdir: '', runtime: {}, managers: [], sudo: 'none', error: '' },
    runtimes: {},
    allowProvision: false,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

/** §2.3 内置 local 服务器 */
export function localServer() {
  return { id: 'local', name: '本机', kind: 'local', host: '127.0.0.1' };
}

/** §2.4 环境变量组 */
export function sampleEnvSet(overrides = {}) {
  return {
    id: 'prod-env',
    name: '生产环境变量',
    description: '',
    tags: [],
    vars: [{ name: 'API_HOST', value: 'x', secret: false }],
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}
