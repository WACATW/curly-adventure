const express = require('express');
const fs = require('fs');
const path = require('path');
const bodyParser = require('body-parser');
const axios = require('axios');

const app = express();
const PORT = 3000;

// ===================== 基础配置 =====================
// 中间件：解析请求、跨域、静态文件托管
app.use(bodyParser.json({ limit: '5GB' })); // 支持大文件请求
app.use(bodyParser.urlencoded({ extended: true, limit: '5GB' }));
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  next();
});
// 托管GitHub上的前端静态文件（你的html/css/js）
app.use(express.static(path.join(__dirname)));

// ===================== Hugging Face 配置（替换为你的信息） =====================
const HF_CONFIG = {
  token: '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', // 生成的write权限token
  username: 'WACATW', // 如：cat-website-123
  repo: 'userpan', // 你在HF创建的私有仓库名
  apiUrl: ''
};
HF_CONFIG.apiUrl = `https://huggingface.co/api/models/${HF_CONFIG.username}/${HF_CONFIG.repo}/files`;

// ===================== 用户数据管理（本地JSON，也可改存HF） =====================
const USERS_FILE = path.join(__dirname, 'users.json');
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, JSON.stringify([], null, 2), 'utf8');
const readUsers = () => JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
const writeUsers = (users) => fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');

// ===================== 接口1：用户注册 =====================
app.post('/api/register', (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password || password.length < 6) {
      return res.json({ success: false, message: '用户名不能为空，密码至少6位！' });
    }

    const users = readUsers();
    if (users.some(u => u.username === username)) {
      return res.json({ success: false, message: '用户名已存在！' });
    }

    // 保存用户（实际项目建议用bcrypt加密密码）
    users.push({ username, password, createTime: new Date().toLocaleString() });
    writeUsers(users);
    res.json({ success: true, message: `注册成功！欢迎 ${username}` });
  } catch (err) {
    res.json({ success: false, message: '服务器错误：' + err.message });
  }
});

// ===================== 接口2：用户登录 =====================
app.post('/api/login', (req, res) => {
  try {
    const { username, password } = req.body;
    const users = readUsers();
    const user = users.find(u => u.username === username && u.password === password);
    
    if (user) {
      res.json({ success: true, message: `登录成功！欢迎 ${username}` });
    } else {
      res.json({ success: false, message: '用户名或密码错误！' });
    }
  } catch (err) {
    res.json({ success: false, message: '服务器错误：' + err.message });
  }
});

// ===================== 接口3：上传文件到Hugging Face =====================
app.post('/api/upload-to-hf', async (req, res) => {
  try {
    const { filename, content, username } = req.body;
    if (!filename || !content || !username) {
      return res.json({ success: false, message: '文件名、文件内容、用户名不能为空！' });
    }

    // 按用户名分文件夹存储（避免文件重名）
    const filePath = `user-files/${username}/${filename}`;
    // 调用HF API上传文件（二进制格式）
    await axios.put(
      `${HF_CONFIG.apiUrl}/${filePath}`,
      Buffer.from(content, 'base64'), // base64转二进制
      {
        headers: {
          'Authorization': `Bearer ${HF_CONFIG.token}`,
          'Content-Type': 'application/octet-stream',
          'Accept': '*/*'
        },
        timeout: 600000 // 10分钟超时（适配大文件）
      }
    );

    // 生成文件访问链接
    const fileUrl = `https://huggingface.co/${HF_CONFIG.username}/${HF_CONFIG.repo}/blob/main/${filePath}`;
    res.json({
      success: true,
      message: `文件 ${filename} 上传成功！`,
      fileUrl: fileUrl
    });
  } catch (err) {
    const errorMsg = err.response?.data?.error || err.message || 'HF上传失败';
    res.json({ success: false, message: errorMsg });
  }
});

// ===================== 启动服务器 =====================
app.listen(PORT, () => {
  console.log(`✅ 服务器运行在：http://localhost:${PORT}`);
  console.log(`🌐 前端页面：http://localhost:${PORT}/index.html`);
  console.log(`📁 HF文件仓库：https://huggingface.co/${HF_CONFIG.username}/${HF_CONFIG.repo}`);
});