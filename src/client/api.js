/**
 * HTTP 客户端：统一走 new URL('dsh-devops/api/...', document.baseURI)，
 * 反代到子路径时同样成立。响应形状见契约 §3.10：{ok,value} / {ok,message,code}。
 */

class ApiError extends Error {
  constructor(message, code, status) {
    super(message || '请求失败');
    this.name = 'ApiError';
    this.code = code || '';
    this.status = status || 0;
  }
}

/** 拼 API URL：baseURI 结尾带不带斜杠都能正确解析。 */
function apiUrl(path, query) {
  const clean = String(path).replace(/^\/+/, '');
  let url;
  try {
    let base = document.baseURI || '/';
    if (!base.endsWith('/')) base += '/';
    url = new URL('dsh-devops/api/' + clean, base);
  } catch {
    // baseURI 异常（极少数非标准环境）时退回相对当前路径
    url = new URL('dsh-devops/api/' + clean, window.location.href);
  }
  if (query) {
    for (const key of Object.keys(query)) {
      const value = query[key];
      if (value === undefined || value === null || value === '') continue;
      url.searchParams.set(key, String(value));
    }
  }
  return url;
}

/** 低层请求：解析统一响应形状，失败抛 ApiError。 */
async function request(path, options) {
  const opts = options || {};
  const init = {
    method: opts.method || 'GET',
    headers: { Accept: 'application/json' },
    credentials: 'same-origin',
  };
  if (opts.body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(opts.body);
  }
  if (opts.signal) init.signal = opts.signal;

  let res;
  try {
    res = await fetch(apiUrl(path, opts.query), init);
  } catch (error) {
    if (error && error.name === 'AbortError') throw error;
    throw new ApiError('无法连接插件后端：' + (error && error.message ? error.message : String(error)), 'network', 0);
  }

  let payload = null;
  const text = await res.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      if (!res.ok) throw new ApiError('HTTP ' + res.status, 'http', res.status);
      throw new ApiError('后端返回了非 JSON 内容', 'bad-json', res.status);
    }
  }
  if (payload && payload.ok === true) return payload.value;
  const message = payload && payload.message ? payload.message : 'HTTP ' + res.status;
  throw new ApiError(message, (payload && payload.code) || 'http', res.status);
}

const get = (path, query, options) => request(path, Object.assign({ method: 'GET', query }, options));
const post = (path, body, options) => request(path, Object.assign({ method: 'POST', body }, options));
const put = (path, body, options) => request(path, Object.assign({ method: 'PUT', body }, options));
const del = (path, options) => request(path, Object.assign({ method: 'DELETE' }, options));

/** 契约 §3.10 全部端点的薄封装；页面只调用这里，不自己拼 URL。 */
const api = {
  ApiError,
  apiUrl,
  request,

  meta: () => get('meta'),

  listPipelines: () => get('pipelines'),
  getPipeline: (id) => get('pipelines/' + encodeURIComponent(id)),
  createPipeline: (pipeline) => post('pipelines', { pipeline }),
  updatePipeline: (id, pipeline) => put('pipelines/' + encodeURIComponent(id), { pipeline }),
  deletePipeline: (id) => del('pipelines/' + encodeURIComponent(id)),
  runPipeline: (id, variables) => post('pipelines/' + encodeURIComponent(id) + '/runs', { variables: variables || {} }),
  validatePipeline: (pipeline) => post('pipelines/validate', { pipeline }),

  listTemplates: () => get('templates'),
  getTemplate: (id) => get('templates/' + encodeURIComponent(id)),
  createTemplate: (template) => post('templates', { template }),
  updateTemplate: (id, template) => put('templates/' + encodeURIComponent(id), { template }),
  deleteTemplate: (id) => del('templates/' + encodeURIComponent(id)),
  instantiateTemplate: (id, params) => post('templates/' + encodeURIComponent(id) + '/instantiate', { params: params || {} }),
  templateFromPipeline: (payload) => post('templates/from-pipeline', payload),

  listRuns: (query) => get('runs', query),
  getRun: (id) => get('runs/' + encodeURIComponent(id)),
  cancelRun: (id) => post('runs/' + encodeURIComponent(id) + '/cancel', {}),
  retryRun: (id) => post('runs/' + encodeURIComponent(id) + '/retry', {}),
  retryStep: (id, stepId) => post('runs/' + encodeURIComponent(id) + '/retry-step', { stepId }),
  runLogs: (id, query) => get('runs/' + encodeURIComponent(id) + '/logs', query),

  listServers: () => get('servers'),
  createServer: (server) => post('servers', { server }),
  updateServer: (id, server) => put('servers/' + encodeURIComponent(id), { server }),
  deleteServer: (id) => del('servers/' + encodeURIComponent(id)),
  testServer: (id) => post('servers/' + encodeURIComponent(id) + '/test', {}),
  provisionServer: (id, runtime) => post('servers/' + encodeURIComponent(id) + '/provision', { runtime }),
  serverEnv: (id) => get('servers/' + encodeURIComponent(id) + '/env'),

  listEnvSets: () => get('envsets'),
  createEnvSet: (envset) => post('envsets', { envset }),
  updateEnvSet: (id, envset) => put('envsets/' + encodeURIComponent(id), { envset }),
  deleteEnvSet: (id) => del('envsets/' + encodeURIComponent(id)),

  listSnippets: () => get('snippets'),
  createSnippet: (snippet) => post('snippets', { snippet }),
  updateSnippet: (id, snippet) => put('snippets/' + encodeURIComponent(id), { snippet }),
  deleteSnippet: (id) => del('snippets/' + encodeURIComponent(id)),

  listRecent: (key) => get('recent', { key }),
  putRecent: (key, values) => post('recent', { key, values }),

  listNodes: () => get('nodes'),
  registerCustomNode: (descriptor) => post('nodes/custom', { descriptor }),
  deleteCustomNode: (type) => del('nodes/custom/' + encodeURIComponent(type)),

  fsList: (server, path) => get('fs/list', { server, path }),
  fsStat: (server, path) => get('fs/stat', { server, path }),
  fsMatch: (payload) => post('fs/match', payload),

  exportDoc: (kind, id) => get('export', { kind, id }),
  importDoc: (payload) => post('import', payload),

  getSettings: () => get('settings'),
  putSettings: (patch) => put('settings', patch),
};

exports.api = api;
exports.ApiError = ApiError;
exports.apiUrl = apiUrl;
