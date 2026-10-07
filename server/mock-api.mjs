// API simulada compartida por ambas apps (Angular 19 y 21).
// Es un middleware compatible con Express y con http.createServer:
//   handler(req, res, next)
//
// Endpoints:
//   GET  /api/time        -> datos "vivos" (dataGroup freshness)
//   GET  /api/catalog     -> datos "estables" (dataGroup performance)
//   GET  /api/slow?ms=N   -> respuesta lenta (prueba de timeout en freshness)
//   GET  /api/private     -> NO incluido en dataGroups (siempre red)
//   POST /api/echo        -> los POST nunca se cachean en el SW
//   GET  /admin/state     -> estado del simulador
//   GET  /admin/fail?on=1 -> la API responde 503 (servidor degradado)
//   GET  /admin/down?on=1 -> TODO el servidor (estáticos incluidos) responde 503
//                            (simula caída del backend sin usar DevTools)

const state = { counter: 0, fail: false, down: false };

function send(res, status, body, extraHeaders = {}) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-cache',
    ...extraHeaders,
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => resolve(data));
  });
}

export function isDown() {
  return state.down;
}

export function mockApi(req, res, next) {
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname;

  // --- Administración del simulador (nunca la cachea el SW: ver ngsw-config) ---
  if (path === '/admin/state') return send(res, 200, state);
  if (path === '/admin/fail') {
    state.fail = url.searchParams.get('on') === '1';
    return send(res, 200, state);
  }
  if (path === '/admin/down') {
    state.down = url.searchParams.get('on') === '1';
    return send(res, 200, state);
  }

  if (!path.startsWith('/api/')) return next ? next() : false;

  if (state.fail) {
    return send(res, 503, { error: 'API degradada (simulada)', servedAt: new Date().toISOString() });
  }

  const servedAt = new Date().toISOString();

  if (req.method === 'GET' && path === '/api/time') {
    state.counter++;
    return send(res, 200, { servedAt, counter: state.counter });
  }

  if (req.method === 'GET' && path === '/api/catalog') {
    return send(res, 200, {
      servedAt,
      items: [
        { id: 1, name: 'Expediente A' },
        { id: 2, name: 'Expediente B' },
        { id: 3, name: 'Expediente C' },
      ],
    });
  }

  if (req.method === 'GET' && path === '/api/slow') {
    const ms = Math.min(Number(url.searchParams.get('ms') ?? 4000), 30000);
    setTimeout(() => send(res, 200, { servedAt, delayedMs: ms }), ms);
    return;
  }

  if (req.method === 'GET' && path === '/api/private') {
    return send(res, 200, { servedAt, secret: 'dato sensible' }, { 'Cache-Control': 'no-store' });
  }

  if (req.method === 'POST' && path === '/api/echo') {
    readBody(req).then((body) => send(res, 200, { servedAt, received: body }));
    return;
  }

  return send(res, 404, { error: 'not found', path });
}
