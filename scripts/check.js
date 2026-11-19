const authUrl = process.env.AUTH_URL || "http://127.0.0.1:4000";
const chatUrl = process.env.CHAT_URL || "ws://127.0.0.1:4001";
const streamsUrl = process.env.STREAMS_URL || "http://127.0.0.1:4002";
const contentUrl = process.env.CONTENT_URL || "http://127.0.0.1:4003";
const frontendUrl = process.env.FRONTEND_URL || "http://127.0.0.1:4173";

const stamp = Date.now().toString(36);
const user = {
  username: `demo${stamp}`.slice(0, 32),
  email: `demo${stamp}@example.com`,
  password: "Demo123!"
};

function fail(message) {
  console.error(`FAIL ${message}`);
  process.exitCode = 1;
}

async function json(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body = null;
  if (text) {
    try { body = JSON.parse(text); } catch { body = text; }
  }
  return { response, body };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function checkHealth() {
  for (const [name, url] of [
    ["auth", `${authUrl}/health`],
    ["chat", `${chatUrl.replace(/^ws/, "http")}/health`],
    ["streams", `${streamsUrl}/health`],
    ["content", `${contentUrl}/health`],
    ["frontend", `${frontendUrl}/health`]
  ]) {
    const { response, body } = await json(url);
    assert(response.ok && body?.ok === true && body.service === name, `${name} health: ${response.status} ${JSON.stringify(body)}`);
    console.log(`ok  ${name} health`);
  }
}

async function checkAuth() {
  const registered = await json(`${frontendUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(user)
  });
  assert(registered.response.status === 201, `register ${registered.response.status} ${JSON.stringify(registered.body)}`);
  assert(registered.body.accessToken && registered.body.refreshToken, "register did not return tokens");
  console.log("ok  register via frontend proxy");

  const loggedIn = await json(`${authUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ emailOrUsername: user.email, password: user.password })
  });
  assert(loggedIn.response.ok && loggedIn.body.accessToken, `login ${loggedIn.response.status}`);
  console.log("ok  login");

  const profile = await json(`${frontendUrl}/api/auth/profile`, {
    headers: { Authorization: `Bearer ${loggedIn.body.accessToken}` }
  });
  assert(profile.response.ok && profile.body.user?.username === user.username, `profile ${profile.response.status} ${JSON.stringify(profile.body)}`);
  console.log("ok  profile");
  return loggedIn.body.accessToken;
}

async function checkStreams(token) {
  const started = await json(`${streamsUrl}/api/stream/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ title: `Local ${stamp}`, source: "browser" })
  });
  assert(started.response.status === 201 && started.body.streamKey, `start stream ${started.response.status} ${JSON.stringify(started.body)}`);
  console.log("ok  stream start returned a key");

  const listed = await json(`${frontendUrl}/api/streams`);
  assert(listed.response.ok && listed.body.streams?.some((stream) => stream.id === started.body.id), "started stream is not listed as active");
  console.log("ok  stream listed as active");
  return started.body.id;
}

function connectChat(token, room) {
  const messages = [];
  const socket = new WebSocket(`${chatUrl}/?room=${encodeURIComponent(room)}&token=${encodeURIComponent(token)}`);
  let waiter = null;
  socket.addEventListener("message", (event) => {
    messages.push(JSON.parse(event.data));
    if (waiter?.predicate(messages)) {
      const resolve = waiter.resolve;
      waiter = null;
      resolve(messages);
    }
  });
  const opened = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("websocket connect timeout")), 5000);
    socket.addEventListener("open", () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("websocket error"));
    });
  });
  function until(predicate, timeoutMs = 5000) {
    if (predicate(messages)) return Promise.resolve(messages);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        waiter = null;
        reject(new Error(`timed out; saw ${JSON.stringify(messages)}`));
      }, timeoutMs);
      waiter = {
        predicate,
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        }
      };
    });
  }
  return { socket, opened, until, messages };
}

async function checkChat(token) {
  const room = `room-${stamp}`;
  const first = connectChat(token, room);
  await first.opened;
  await first.until((messages) => messages.some((payload) => payload.type === "history"));
  first.socket.send(`hello-${stamp}`);
  const echoed = await first.until((messages) => messages.some((payload) => payload.type === "message" && payload.text === `hello-${stamp}`));
  assert(echoed.at(-1).user?.username === user.username, "broadcast missing username");

  const second = connectChat(token, room);
  await second.opened;
  const replay = await second.until((messages) => messages.some((payload) => payload.type === "history" && payload.data?.some((item) => item.text === `hello-${stamp}`)));
  assert(replay.some((payload) => payload.type === "history" && payload.data.some((item) => item.text === `hello-${stamp}`)), "history did not include the first message");

  const live = second.until((messages) => messages.some((payload) => payload.type === "message" && payload.text === `again-${stamp}`));
  first.socket.send(`again-${stamp}`);
  await live;
  first.socket.close();
  second.socket.close();
  console.log("ok  chat broadcast and history");
}

async function checkContent(token) {
  const created = await json(`${frontendUrl}/api/content/items`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ title: `Clip ${stamp}`, authorId: user.username })
  });
  assert(created.response.status === 201 && created.body.item?.title === `Clip ${stamp}`, `content create ${created.response.status}`);
  const listed = await json(`${contentUrl}/api/content/items`);
  assert(listed.response.ok && listed.body.items?.some((item) => item.title === `Clip ${stamp}`), "content item missing from list");
  console.log("ok  content create and list");
}

async function checkPage() {
  const response = await fetch(frontendUrl);
  const html = await response.text();
  assert(response.ok, `frontend page ${response.status}`);
  for (const marker of ["loginForm", "registerForm", "history", "createKeyBtn", "streamsList"]) {
    assert(html.includes(marker), `page missing ${marker}`);
  }
  const script = await fetch(`${frontendUrl}/index.js`);
  assert(script.ok, "frontend script missing");
  console.log("ok  frontend page");
}

try {
  await checkHealth();
  const token = await checkAuth();
  await checkStreams(token);
  await checkChat(token);
  await checkContent(token);
  await checkPage();
  if (process.exitCode) process.exit(process.exitCode);
  console.log("All checks passed.");
} catch (error) {
  fail(error?.stack || error?.message || error);
}
