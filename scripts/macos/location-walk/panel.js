const $ = (id) => document.getElementById(id);
let token = '';
let sessionRequest;
let active = false;
let east = 0;
let north = 0;
let busy = false;
let steering = false;
let pointer = null;
const keys = new Set();
const directions = {
  ArrowUp: [0, 1],
  w: [0, 1],
  ArrowDown: [0, -1],
  s: [0, -1],
  ArrowLeft: [-1, 0],
  a: [-1, 0],
  ArrowRight: [1, 0],
  d: [1, 0],
};

function render(state) {
  active = state.active;
  $('device').textContent = state.device?.name ?? 'Not connected';
  $('connect').disabled = busy || Boolean(state.device);
  $('clear').disabled = busy || !state.device;
  $('platform').disabled = busy || Boolean(state.device);
  $('latitude').textContent = state.point.latitude.toFixed(6);
  $('longitude').textContent = state.point.longitude.toFixed(6);
  $('distance').textContent = `${state.distance.toFixed(1)} m`;
  $('motion').textContent =
    active && Math.hypot(state.vector.east, state.vector.north) > 0 ? 'Walking' : 'Standing still';
  if (state.error) $('error').textContent = state.error;
}

async function session() {
  if (!sessionRequest) {
    sessionRequest = (async () => {
      const response = await fetch('/session', {
        headers: { 'X-Panel-Session': '1' },
        signal: AbortSignal.timeout(6000),
      });
      if (!response.ok)
        throw new Error('Could not connect to the local walking panel. Reload to retry.');
      token = (await response.json()).token;
    })().finally(() => {
      sessionRequest = null;
    });
  }
  await sessionRequest;
}

async function request(action, values = {}) {
  try {
    if (!token) await session();
    const send = () =>
      fetch(action ? '/command' : '/state', {
        method: action ? 'POST' : 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          ...(action ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(action ? { body: JSON.stringify({ action, ...values }) } : {}),
        signal: AbortSignal.timeout(6000),
      });
    let response = await send();
    // A server restart changes the token. A rejected command has not executed,
    // so one retry with the fresh local session cannot duplicate an action.
    if (response.status === 403) {
      await session();
      response = await send();
    }
    const state = await response.json();
    if (!response.ok) throw new Error(state.error);
    render(state);
    return true;
  } catch (error) {
    $('error').textContent =
      error.name === 'TypeError' || error.name === 'TimeoutError'
        ? 'Panel connection lost. Walking stops automatically.'
        : error.message;
    resetInput();
    return false;
  }
}

function setVector(x, y) {
  const scale = Math.max(1, Math.hypot(x, y));
  east = x / scale;
  north = y / scale;
  $('stick').style.transform = `translate(${east * 76}px, ${-north * 76}px)`;
}

function resetInput() {
  keys.clear();
  pointer = null;
  setVector(0, 0);
}

async function steer() {
  if (!active || busy || steering) return;
  steering = true;
  await request('steer', { east, north, speed: Number($('speed').value) });
  steering = false;
}

function stop() {
  resetInput();
  if (active) void request('pause');
}

async function command(action, values) {
  if (busy) return;
  busy = true;
  stop();
  $('connect').disabled = true;
  $('clear').disabled = true;
  $('error').textContent = '';
  await request(action, values);
  busy = false;
  await request();
}

$('connect').onclick = () => command('connect', { platform: $('platform').value });
$('clear').onclick = () => command('clear');
$('reset').onclick = () =>
  command('position', { point: { latitude: 33.7176, longitude: -84.4792 } });
$('position-form').onsubmit = (event) => {
  event.preventDefault();
  void command('position', {
    point: {
      latitude: Number($('start-latitude').value),
      longitude: Number($('start-longitude').value),
    },
  });
};
$('pause').onclick = stop;
function speedLabel() {
  const speed = Number($('speed').value);
  $('speed-value').textContent = `${speed.toFixed(1)} m/s · ${(speed * 3.6).toFixed(1)} km/h`;
}
$('speed').oninput = speedLabel;
document.querySelectorAll('[data-speed]').forEach((button) => {
  button.onclick = () => {
    $('speed').value = button.dataset.speed;
    speedLabel();
  };
});

const joystick = $('joystick');
function move(event) {
  if (event.pointerId !== pointer) return;
  const bounds = joystick.getBoundingClientRect();
  const x = (event.clientX - bounds.left - bounds.width / 2) / 76;
  const y = -(event.clientY - bounds.top - bounds.height / 2) / 76;
  setVector(Math.hypot(x, y) < 0.08 ? 0 : x, Math.hypot(x, y) < 0.08 ? 0 : y);
}
joystick.onpointerdown = (event) => {
  if (!active || busy || pointer !== null || event.button !== 0) return;
  event.preventDefault();
  joystick.focus({ preventScroll: true });
  keys.clear();
  pointer = event.pointerId;
  joystick.setPointerCapture(pointer);
  move(event);
  void steer();
};
joystick.onpointermove = move;

document.querySelectorAll('[data-east]').forEach((button) => {
  button.onpointerdown = (event) => {
    if (!active || busy || pointer !== null || event.button !== 0) return;
    event.preventDefault();
    keys.clear();
    pointer = event.pointerId;
    button.setPointerCapture(pointer);
    setVector(Number(button.dataset.east), Number(button.dataset.north));
    void steer();
  };
  button.onkeydown = (event) => {
    if (event.key !== ' ' && event.key !== 'Enter') return;
    event.preventDefault();
    if (active && !busy) {
      setVector(Number(button.dataset.east), Number(button.dataset.north));
      void steer();
    }
  };
  button.onkeyup = (event) => {
    if (event.key === ' ' || event.key === 'Enter') stop();
  };
});
for (const eventName of ['pointerup', 'pointercancel', 'lostpointercapture']) {
  document.addEventListener(eventName, (event) => {
    if (event.pointerId === pointer) stop();
  });
}
function keyboardVector() {
  const vectors = [...keys].map((key) => directions[key]);
  setVector(
    vectors.reduce((sum, v) => sum + v[0], 0),
    vectors.reduce((sum, v) => sum + v[1], 0),
  );
}
document.addEventListener('keydown', (event) => {
  if (
    event.target.matches('input, textarea, select') ||
    event.metaKey ||
    event.ctrlKey ||
    event.altKey
  )
    return;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  if (key === ' ') {
    if (event.target.matches('button')) return;
    event.preventDefault();
    stop();
    return;
  }
  if (!directions[key] || !active || busy || pointer !== null) return;
  event.preventDefault();
  keys.add(key);
  keyboardVector();
  void steer();
});
document.addEventListener('keyup', (event) => {
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  if (!keys.delete(key)) return;
  keyboardVector();
  if (!keys.size) stop();
});
window.addEventListener('blur', stop);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stop();
});
document.addEventListener('focusin', stop);
setInterval(() => {
  if (!document.hidden && (east || north)) void steer();
}, 250);
setInterval(() => {
  if (!document.hidden && !busy) void request();
}, 750);
void request();
