const { CronJob } = require("cron");
const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const fs = require("fs");
const input = require("input");
const { GITHUB_TOKEN, OWNER, REPO, API_ID, API_HASH } = require("./config");

const SESSION_FILE = "./session.json";

// Загружаем сессию из файла, если она есть
let stringSession = new StringSession("");
if (fs.existsSync(SESSION_FILE)) {
  stringSession = new StringSession(fs.readFileSync(SESSION_FILE, "utf8"));
}

const HEADERS = {
  Authorization: `Bearer ${GITHUB_TOKEN}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "linai-bot"
};

async function loadFromGitHub(file) {
  const res = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/contents/${file}?${Date.now()}`, { headers: HEADERS });
  if (!res.ok) return null;
  const data = await res.json();
  return JSON.parse(Buffer.from(data.content, "base64").toString("utf8"));
}

async function saveToGitHub(file, content, message) {
  let sha = undefined;
  const getRes = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/contents/${file}`, { headers: HEADERS });
  if (getRes.ok) {
    const fileData = await getRes.json();
    sha = fileData.sha;
  }

  await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/contents/${file}`, {
    method: "PUT",
    headers: HEADERS,
    body: JSON.stringify({
      message,
      content: Buffer.from(JSON.stringify(content, null, 2)).toString("base64"),
      sha
    })
  });
}

async function processSend(client) {
  console.log(`[CRON] Проверка заданий...`);

  const sendData = await loadFromGitHub("send.json");
  if (!sendData || !sendData.status) {
    console.log("[INFO] Нет активных задач");
    return;
  }

  const posts = await loadFromGitHub("posts.json");
  const post = posts.find(p => p.id === sendData.postId);
  if (!post) {
    console.error("[ERROR] Пост не найден");
    return;
  }

  for (const channelUsername of sendData.channelIds) { // ожидаем "@username"
    try {
      const entity = await client.getEntity(channelUsername);
      await client.sendMessage(entity, { message: post.content });
      console.log(`[SEND] Отправлено в ${channelUsername}`);
      await new Promise(r => setTimeout(r, 2000));
    } catch (err) {
      console.error(`[ERROR] Не удалось отправить в ${channelUsername}:`, err.message);
    }
  }

  const history = (await loadFromGitHub("history.json")) || [];
  history.unshift({
    postId: sendData.postId,
    channelIds: sendData.channelIds,
    sentAt: new Date().toISOString()
  });
  await saveToGitHub("history.json", history, "update history");

  await saveToGitHub("send.json", {}, "clear send.json");

  console.log("[DONE] Задача выполнена и очищена");
}

async function main() {
  const client = new TelegramClient(stringSession, API_ID, API_HASH, {
    connectionRetries: 5
  });

  if (!fs.existsSync(SESSION_FILE) || fs.readFileSync(SESSION_FILE, "utf8").trim() === "") {
    await client.start({
      phoneNumber: async () => await input.text("Введи номер телефона: "),
      password: async () => await input.text("Введи пароль 2FA (если есть): "),
      phoneCode: async () => await input.text("Введи код из Telegram: "),
      onError: (err) => console.log(err)
    });

    fs.writeFileSync(SESSION_FILE, client.session.save(), "utf8");
    console.log("Сессия сохранена в session.json — теперь можно запускать через pm2 без повторной авторизации.");
  } else {
    await client.connect();
  }

  new CronJob("*/2 * * * *", () => processSend(client), null, true, "Europe/Moscow");
}

main();
