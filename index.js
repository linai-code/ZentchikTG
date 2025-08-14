import fetch from "node-fetch";
import { CronJob } from "cron";
import TelegramBot from "node-telegram-bot-api";
import { TELEGRAM_TOKEN, GITHUB_TOKEN, OWNER, REPO } from "./config.js";

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: false });

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
  const getRes = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/contents/${file}`, { headers: HEADERS });
  const fileData = await getRes.json();
  const sha = fileData.sha;

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

async function processSend() {
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

  for (const channelId of sendData.channelIds) {
    try {
      await bot.sendMessage(channelId, `${post.content}`, { parse_mode: "HTML" });
      console.log(`[SEND] Отправлено в ${channelId}`);
    } catch (err) {
      console.error(`[ERROR] Не удалось отправить в ${channelId}:`, err.message);
    }
    time.sleep(2000);
  }

  const history = (await loadFromGitHub("history.json")) || [];
  history.unshift({
    postId: sendData.postId,
    channelIds: sendData.channelIds,
    sentAt: new Date().toISOString()
  });
  await saveToGitHub("history.json", history, "update history");

  await saveToGitHub("send.json", { status: false }, "clear send.json");

  console.log("[DONE] Задача выполнена и перенесена в историю");
}

new CronJob("*/5 * * * *", processSend, null, true, "Europe/Moscow");

console.log("📢 Селф-бот запущен и проверяет GitHub каждые 5 минут...");
