const express = require('express');
const { Low } = require('lowdb');
const { JSONFile } = require('lowdb/node');
const bodyParser = require('body-parser');
const cors = require('cors');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const port = 3000;

// 管理员固定账号密码
const ADMIN_USER = "admin";
const ADMIN_PWD = "admin123";

// 数据库初始化
const dbPath = path.join(__dirname, 'db.json');
if (!fs.existsSync(dbPath)) {
  fs.writeFileSync(dbPath, JSON.stringify({
    users: [],
    sessions: []
  }, null, 2));
}
const adapter = new JSONFile(dbPath);
const db = new Low(adapter, { users: [], sessions: [] });

app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// 密码加密
function encryptPassword(pwd) {
  return crypto.createHash('sha256').update(pwd).digest('hex');
}

// ===================== 用户登录接口（仅普通用户使用，管理员无需登录进后台） =====================
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const hash = encryptPassword(password);
  await db.read();

  // 管理员账号登录（仅用于网站普通功能登录，后台独立密码）
  if (username === ADMIN_USER && hash === encryptPassword(ADMIN_PWD)) {
    const token = crypto.randomBytes(16).toString('hex');
    db.data.sessions.push({ token, username, expireTime: Date.now() + 86400000 });
    await db.write();
    return res.json({ code: 200, msg: "管理员登录成功", data: { token, username, isAdmin: true } });
  }

  // 普通用户
  const user = db.data.users.find(u => u.username === username && u.password === hash);
  if (!user) return res.json({ code: 400, msg: "用户名或密码错误" });
  if (user.status !== "pass") return res.json({ code: 400, msg: "账号未通过审核，无法登录" });

  const token = crypto.randomBytes(16).toString('hex');
  db.data.sessions.push({ token, username, expireTime: Date.now() + 86400000 });
  await db.write();
  return res.json({ code: 200, msg: "登录成功", data: { token, username, isAdmin: false } });
});

// ===================== 用户注册接口 =====================
app.post('/api/register', async (req, res) => {
  const { username, password, phone, qq, wechat } = req.body;
  const regTime = new Date().toLocaleString();
  if (!username || !password) return res.json({ code: 400, msg: "用户名、密码必填" });
  if (password.length < 6) return res.json({ code: 400, msg: "密码至少6位" });
  const fillList = [phone, qq, wechat].filter(v => v?.trim());
  if (fillList.length === 0) return res.json({ code: 400, msg: "手机号/QQ/微信至少填写一项" });

  await db.read();
  if (db.data.users.find(u => u.username === username)) return res.json({ code: 400, msg: "用户名已被注册" });
  const p = phone?.trim(), q = qq?.trim(), w = wechat?.trim();
  if (p && db.data.users.find(u => u.phone === p)) return res.json({ code: 400, msg: "该手机号已注册" });
  if (q && db.data.users.find(u => u.qq === q)) return res.json({ code: 400, msg: "该QQ已注册" });
  if (w && db.data.users.find(u => u.wechat === w)) return res.json({ code: 400, msg: "该微信号已注册" });

  db.data.users.push({
    username,
    password: encryptPassword(password),
    phone: p || "",
    qq: q || "",
    wechat: w || "",
    status: "pending",
    registerTime: regTime
  });
  await db.write();
  return res.json({ code: 200, msg: "注册成功，等待管理员审核" });
});

// ===================== 校验管理员密码（主页点击管理按钮调用） =====================
app.post('/api/verifyAdminPwd', (req, res) => {
  const { inputPwd } = req.body;
  if (inputPwd === ADMIN_PWD) {
    return res.json({ code: 200, msg: "密码正确，可进入后台" });
  } else {
    return res.json({ code: 400, msg: "管理员密码错误" });
  }
});

// ===================== 管理员后台接口（全部接收前端传入的管理员密码校验，无session读取） =====================
// 获取全部用户
app.get('/api/admin/userlist', async (req, res) => {
  const pwd = req.query.adminPwd;
  if (pwd !== ADMIN_PWD) return res.json({ code: 403, msg: "无管理员权限" });
  await db.read();
  res.json({ code: 200, data: db.data.users });
});

// 审核通过用户
app.post('/api/admin/pass', async (req, res) => {
  const { adminPwd, username } = req.body;
  if (adminPwd !== ADMIN_PWD) return res.json({ code: 403, msg: "无管理员权限" });
  await db.read();
  const user = db.data.users.find(u => u.username === username);
  if (!user) return res.json({ code: 400, msg: "用户不存在" });
  user.status = "pass";
  await db.write();
  res.json({ code: 200, msg: "审核通过" });
});

// 删除用户
app.post('/api/admin/del', async (req, res) => {
  const { adminPwd, username } = req.body;
  if (adminPwd !== ADMIN_PWD) return res.json({ code: 403, msg: "无管理员权限" });
  await db.read();
  db.data.users = db.data.users.filter(u => u.username !== username);
  await db.write();
  res.json({ code: 200, msg: "已删除用户" });
});

// ===================== 云电脑、网盘（仅区分普通用户审核状态，管理员无需登录也可访问） =====================
app.get('/api/cloudpc', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  await db.read();
  // 管理员直接放行
  if (token) {
    const session = db.data.sessions.find(s => s.token === token);
    if (session && session.username === ADMIN_USER) {
      return res.json({ code: 200, msg: "云电脑访问成功(管理员)" });
    }
  }
  // 普通用户校验审核状态
  if (!token) return res.json({ code: 401, msg: "请先登录账号" });
  const session = db.data.sessions.find(s => s.token === token);
  if (!session) return res.json({ code: 401, msg: "登录过期" });
  const user = db.data.users.find(u => u.username === session.username);
  if (!user || user.status !== "pass") return res.json({ code: 403, msg: "账号未审核，禁止访问" });
  res.json({ code: 200, msg: "云电脑访问成功" });
});

app.get('/api/pan', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  await db.read();
  if (token) {
    const session = db.data.sessions.find(s => s.token === token);
    if (session && session.username === ADMIN_USER) {
      return res.json({ code: 200, msg: "网盘访问成功(管理员)" });
    }
  }
  if (!token) return res.json({ code: 401, msg: "请先登录账号" });
  const session = db.data.sessions.find(s => s.token === token);
  if (!session) return res.json({ code: 401, msg: "登录过期" });
  const user = db.data.users.find(u => u.username === session.username);
  if (!user || user.status !== "pass") return res.json({ code: 403, msg: "账号未审核，禁止访问" });
  res.json({ code: 200, msg: "网盘访问成功" });
});

// 登录状态校验（仅前台展示欢迎文字，做完备判空）
app.get('/api/checkLogin', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.json({ code: 401, msg: "未登录" });
  await db.read();
  const session = db.data.sessions.find(s => s.token === token);
  if (!session || !session.username) return res.json({ code: 401, msg: "登录过期" });
  const isAdmin = session.username === ADMIN_USER;
  res.json({ code: 200, data: { username: session.username, isAdmin } });
});

app.listen(port, async () => {
  await db.read();
  console.log(`服务启动：http://localhost:${port}`);
});