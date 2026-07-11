import {
  auth, db, onAuthStateChanged, signOut,
  doc, getDoc, setDoc, updateDoc, deleteDoc,
  collection, addDoc, query, where, orderBy, limit,
  onSnapshot, serverTimestamp, arrayUnion, arrayRemove,
  getDocs, increment, deleteField
} from "./firebase-init.js";
import {
  avatarGradient, initials, escapeHtml, formatTime, formatLastSeen,
  formatDayLabel, toast, debounce, privateChatId
} from "./utils.js";

// ============================================================
// STATE
// ============================================================
let me = null;            // firebase auth user
let myProfile = null;     // firestore users/{uid} data
let usersCache = new Map(); // uid -> user data (live)
let chatsCache = new Map();  // chatId -> chat data (live)
let currentTab = "chats";
let currentChatId = null;
let currentChatData = null;
let editingMessageId = null;
let newChatModalMode = "private"; // or "group"
let selectedGroupMembers = new Set();

let unsubChats = null;
let unsubUsers = null;
let unsubMessages = null;
let unsubTyping = null;
let typingClearTimer = null;
let myTypingState = false;

// ============================================================
// DOM
// ============================================================
const $ = (id) => document.getElementById(id);
const listScroll = $("listScroll");
const listTitle = $("listTitle");
const searchInput = $("searchInput");
const railAvatar = $("railAvatar");
const mobileAvatar = $("mobileAvatar");
const chatEmpty = $("chatEmpty");
const chatActive = $("chatActive");
const messagesScroll = $("messagesScroll");
const chatHeaderAvatar = $("chatHeaderAvatar");
const chatHeaderName = $("chatHeaderName");
const chatHeaderStatus = $("chatHeaderStatus");
const messageInput = $("messageInput");
const sendBtn = $("sendBtn");
const editingBanner = $("editingBanner");
const appShell = $("appShell");

// ============================================================
// AUTH GUARD + BOOT
// ============================================================
onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = "index.html"; return; }
  me = user;
  await bootstrap();
});

async function bootstrap() {
  const snap = await getDoc(doc(db, "users", me.uid));
  if (!snap.exists()) { window.location.href = "index.html"; return; }
  myProfile = snap.data();

  applyTheme(myProfile.theme !== "light");
  renderMyAvatars();
  setupPresence();
  subscribeUsers();
  subscribeChats();
  wireUI();
}

function renderMyAvatars() {
  const grad = avatarGradient(me.uid);
  [railAvatar, mobileAvatar].forEach(el => {
    el.style.background = grad;
    el.textContent = initials(myProfile.displayName);
  });
}

// ============================================================
// PRESENCE (best-effort, Firestore-based)
// ============================================================
function setupPresence() {
  const ref = doc(db, "users", me.uid);
  updateDoc(ref, { online: true, lastSeen: serverTimestamp() }).catch(() => {});
  const heartbeat = setInterval(() => {
    updateDoc(ref, { online: true, lastSeen: serverTimestamp() }).catch(() => {});
  }, 25000);
  const goOffline = () => { updateDoc(ref, { online: false, lastSeen: serverTimestamp() }).catch(() => {}); };
  window.addEventListener("beforeunload", goOffline);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) goOffline();
    else updateDoc(ref, { online: true, lastSeen: serverTimestamp() }).catch(() => {});
  });
  window.__heartbeat = heartbeat;
}

// ============================================================
// USERS (live cache — needed for names/avatars/online status everywhere)
// ============================================================
function subscribeUsers() {
  unsubUsers = onSnapshot(collection(db, "users"), (snap) => {
    snap.docChanges().forEach((ch) => {
      usersCache.set(ch.doc.id, ch.doc.data());
    });
    if (currentTab === "contacts") renderContactList();
    if (currentTab === "chats") renderChatList();
    if (currentChatId) refreshChatHeader();
  });
}

// ============================================================
// CHATS LIST
// ============================================================
function subscribeChats() {
  const q = query(collection(db, "chats"), where("members", "array-contains", me.uid));
  unsubChats = onSnapshot(q, (snap) => {
    snap.docChanges().forEach((ch) => {
      if (ch.type === "removed") chatsCache.delete(ch.doc.id);
      else chatsCache.set(ch.doc.id, { id: ch.doc.id, ...ch.doc.data() });
    });
    if (currentTab === "chats") renderChatList();
    if (currentChatId && chatsCache.has(currentChatId)) {
      currentChatData = chatsCache.get(currentChatId);
      refreshChatHeader();
    }
  });
}

function otherMemberUid(chat) {
  return chat.members.find((m) => m !== me.uid);
}

function chatDisplayName(chat) {
  if (chat.type === "group") return chat.name || "Группа";
  const other = usersCache.get(otherMemberUid(chat));
  return other ? other.displayName : "Пользователь";
}

function chatDisplaySeed(chat) {
  return chat.type === "group" ? chat.id : otherMemberUid(chat);
}

function renderChatList() {
  const filter = searchInput.value.trim().toLowerCase();
  const chats = Array.from(chatsCache.values())
    .filter((c) => chatDisplayName(c).toLowerCase().includes(filter))
    .sort((a, b) => (b.lastMessageAt?.toMillis?.() || 0) - (a.lastMessageAt?.toMillis?.() || 0));

  if (chats.length === 0) {
    listScroll.innerHTML = `<div class="empty-hint">Пока нет чатов.<br>Нажмите «+», чтобы начать общение.</div>`;
    return;
  }

  listScroll.innerHTML = "";
  chats.forEach((chat) => {
    const name = chatDisplayName(chat);
    const seed = chatDisplaySeed(chat);
    const isGroup = chat.type === "group";
    const other = !isGroup ? usersCache.get(otherMemberUid(chat)) : null;
    const unread = (chat.unread && chat.unread[me.uid]) || 0;
    const lastText = chat.lastMessage
      ? (chat.lastMessage.deleted ? "Сообщение удалено" : chat.lastMessage.text)
      : "Нет сообщений";
    const prefix = isGroup && chat.lastMessage && chat.lastMessage.senderId === me.uid ? "Вы: "
      : (isGroup && chat.lastMessage ? `${(chat.lastMessage.senderName || "").split(" ")[0]}: ` : "");

    const row = document.createElement("div");
    row.className = "chat-row" + (chat.id === currentChatId ? " active" : "");
    row.innerHTML = `
      <div class="avatar" style="background:${avatarGradient(seed)}">
        ${isGroup ? groupIconSvg() : escapeHtml(initials(name))}
        ${!isGroup ? `<span class="presence ${other?.online ? "online" : ""}"></span>` : ""}
      </div>
      <div class="meta">
        <div class="row1">
          <span class="name">${escapeHtml(name)}</span>
          <span class="time">${chat.lastMessageAt ? formatTime(chat.lastMessageAt) : ""}</span>
        </div>
        <div class="row2">
          <span class="preview">${escapeHtml(prefix + lastText)}</span>
          ${unread > 0 ? `<span class="unread">${unread > 99 ? "99+" : unread}</span>` : ""}
        </div>
      </div>`;
    row.addEventListener("click", () => openChat(chat.id));
    listScroll.appendChild(row);
  });
}

function groupIconSvg() {
  return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.8"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`;
}

// ============================================================
// CONTACTS LIST
// ============================================================
function renderContactList() {
  const filter = searchInput.value.trim().toLowerCase();
  const users = Array.from(usersCache.entries())
    .filter(([uid]) => uid !== me.uid)
    .map(([uid, u]) => ({ uid, ...u }))
    .filter((u) => u.displayName.toLowerCase().includes(filter) || (u.username || "").toLowerCase().includes(filter))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));

  if (users.length === 0) {
    listScroll.innerHTML = `<div class="empty-hint">Пользователи не найдены</div>`;
    return;
  }

  listScroll.innerHTML = "";
  users.forEach((u) => {
    const row = document.createElement("div");
    row.className = "chat-row";
    row.innerHTML = `
      <div class="avatar" style="background:${avatarGradient(u.uid)}">
        ${escapeHtml(initials(u.displayName))}
        <span class="presence ${u.online ? "online" : ""}"></span>
      </div>
      <div class="meta">
        <div class="row1"><span class="name">${escapeHtml(u.displayName)}</span></div>
        <div class="row2"><span class="preview">@${escapeHtml(u.username || "")} · ${u.online ? "в сети" : formatLastSeen(u.lastSeen)}</span></div>
      </div>`;
    row.addEventListener("click", () => startPrivateChat(u.uid));
    listScroll.appendChild(row);
  });
}

async function startPrivateChat(otherUid) {
  const chatId = privateChatId(me.uid, otherUid);
  const ref = doc(db, "chats", chatId);
  const existing = await getDoc(ref);
  if (!existing.exists()) {
    await setDoc(ref, {
      type: "private",
      members: [me.uid, otherUid],
      createdAt: serverTimestamp(),
      lastMessage: null,
      lastMessageAt: null,
      unread: {}
    });
  }
  closeModal("newChatModal");
  switchTab("chats");
  openChat(chatId);
}

// ============================================================
// TABS / SEARCH
// ============================================================
function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll(".rail-btn[data-tab]").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
  document.querySelectorAll(".mobilenav button[data-tab]").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
  listTitle.textContent = tab === "chats" ? "Чаты" : "Контакты";
  searchInput.value = "";
  $("fabBtn").style.display = tab === "chats" ? "flex" : "none";
  if (tab === "chats") renderChatList(); else renderContactList();
}

// ============================================================
// OPEN CHAT / HEADER
// ============================================================
async function openChat(chatId) {
  currentChatId = chatId;
  currentChatData = chatsCache.get(chatId);
  chatEmpty.style.display = "none";
  chatActive.style.display = "flex";
  appShell.classList.add("mobile-show-chat");

  cancelEdit();
  refreshChatHeader();
  renderChatList();

  // Сброс непрочитанных
  updateDoc(doc(db, "chats", chatId), { [`unread.${me.uid}`]: 0 }).catch(() => {});

  subscribeMessages(chatId);
  subscribeTyping(chatId);
}

function refreshChatHeader() {
  if (!currentChatData) return;
  const chat = currentChatData;
  const name = chatDisplayName(chat);
  const seed = chatDisplaySeed(chat);
  chatHeaderAvatar.style.background = avatarGradient(seed);
  chatHeaderAvatar.innerHTML = chat.type === "group" ? groupIconSvg() : escapeHtml(initials(name));
  chatHeaderName.textContent = name;

  if (chat.type === "group") {
    chatHeaderStatus.textContent = `${chat.members.length} участников`;
  } else {
    const other = usersCache.get(otherMemberUid(chat));
    chatHeaderStatus.textContent = other?.online ? "в сети" : `был(а) ${formatLastSeen(other?.lastSeen)}`;
  }
}

function closeChat() {
  currentChatId = null;
  currentChatData = null;
  chatEmpty.style.display = "flex";
  chatActive.style.display = "none";
  appShell.classList.remove("mobile-show-chat");
  if (unsubMessages) unsubMessages();
  if (unsubTyping) unsubTyping();
}

$("backBtn").addEventListener("click", () => {
  appShell.classList.remove("mobile-show-chat");
});

// ============================================================
// MESSAGES
// ============================================================
function subscribeMessages(chatId) {
  if (unsubMessages) unsubMessages();
  const q = query(collection(db, "chats", chatId, "messages"), orderBy("createdAt", "asc"), limit(200));
  unsubMessages = onSnapshot(q, (snap) => {
    const msgs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderMessages(msgs);
    markMessagesRead(chatId, msgs);
  });
}

function markMessagesRead(chatId, msgs) {
  msgs.forEach((m) => {
    if (m.senderId !== me.uid && !(m.readBy || []).includes(me.uid)) {
      updateDoc(doc(db, "chats", chatId, "messages", m.id), { readBy: arrayUnion(me.uid) }).catch(() => {});
    }
  });
}

function renderMessages(msgs) {
  const wasAtBottom = messagesScroll.scrollHeight - messagesScroll.scrollTop - messagesScroll.clientHeight < 80;
  messagesScroll.innerHTML = "";
  let lastDay = null;
  const isGroup = currentChatData?.type === "group";
  const otherUid = !isGroup ? otherMemberUid(currentChatData) : null;

  msgs.forEach((m) => {
    const dayLabel = formatDayLabel(m.createdAt);
    if (dayLabel && dayLabel !== lastDay) {
      lastDay = dayLabel;
      const sep = document.createElement("div");
      sep.className = "day-sep";
      sep.textContent = dayLabel;
      messagesScroll.appendChild(sep);
    }
    messagesScroll.appendChild(buildMessageRow(m, isGroup, otherUid));
  });

  if (wasAtBottom) messagesScroll.scrollTop = messagesScroll.scrollHeight;
}

function buildMessageRow(m, isGroup, otherUid) {
  const mine = m.senderId === me.uid;
  const row = document.createElement("div");
  row.className = "msg-row" + (mine ? " mine" : "");

  const sender = usersCache.get(m.senderId);
  let ticksHtml = "";
  if (mine) {
    const readByOther = otherUid ? (m.readBy || []).includes(otherUid) : (m.readBy || []).length > 1;
    ticksHtml = `<span class="ticks">${readByOther ? doubleTick() : singleTick()}</span>`;
  }

  const bubble = document.createElement("div");
  bubble.className = "bubble" + (m.deleted ? " deleted" : "");
  bubble.innerHTML = `
    ${isGroup && !mine ? `<div class="sender-name">${escapeHtml(sender?.displayName || "Пользователь")}</div>` : ""}
    <div class="msg-text">${m.deleted ? "Сообщение удалено" : escapeHtml(m.text)}</div>
    <div class="msg-meta">
      ${m.editedAt && !m.deleted ? '<span class="edited-tag">изм.</span>' : ""}
      <span>${formatTime(m.createdAt)}</span>
      ${ticksHtml}
    </div>`;

  if (mine && !m.deleted) {
    const actions = document.createElement("div");
    actions.className = "msg-actions";
    actions.innerHTML = `
      <button title="Изменить" data-act="edit">${editIconSvg()}</button>
      <button title="Удалить" data-act="delete">${trashIconSvg()}</button>`;
    actions.querySelector('[data-act="edit"]').addEventListener("click", () => startEdit(m));
    actions.querySelector('[data-act="delete"]').addEventListener("click", () => deleteMessage(m.id));
    bubble.appendChild(actions);
  }

  if (isGroup && !mine) {
    const av = document.createElement("div");
    av.className = "avatar sm";
    av.style.background = avatarGradient(m.senderId);
    av.textContent = initials(sender?.displayName || "?");
    row.appendChild(av);
  }
  row.appendChild(bubble);
  return row;
}

function singleTick() {
  return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><polyline points="20 6 9 17 4 12"/></svg>`;
}
function doubleTick() {
  return `<svg width="19" height="15" viewBox="0 0 28 24" fill="none" stroke="currentColor" stroke-width="2.4"><polyline points="1 13 6 18 15 6"/><polyline points="10 13 15 18 27 3"/></svg>`;
}
function editIconSvg() {
  return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`;
}
function trashIconSvg() {
  return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>`;
}

// ============================================================
// SEND / EDIT / DELETE MESSAGE
// ============================================================
async function sendMessage() {
  const text = messageInput.value.trim();
  if (!text || !currentChatId) return;

  if (editingMessageId) {
    await updateDoc(doc(db, "chats", currentChatId, "messages", editingMessageId), {
      text, editedAt: serverTimestamp()
    });
    cancelEdit();
    messageInput.value = "";
    autoGrow();
    return;
  }

  messageInput.value = "";
  autoGrow();
  updateSendBtn();
  setTyping(false);

  const chat = currentChatData;
  await addDoc(collection(db, "chats", currentChatId, "messages"), {
    text,
    senderId: me.uid,
    senderName: myProfile.displayName,
    createdAt: serverTimestamp(),
    readBy: [me.uid]
  });

  const unreadUpdates = {};
  chat.members.filter(u => u !== me.uid).forEach(u => { unreadUpdates[`unread.${u}`] = increment(1); });

  await updateDoc(doc(db, "chats", currentChatId), {
    lastMessage: { text, senderId: me.uid, senderName: myProfile.displayName, deleted: false },
    lastMessageAt: serverTimestamp(),
    ...unreadUpdates
  });
}

function startEdit(m) {
  editingMessageId = m.id;
  messageInput.value = m.text;
  messageInput.focus();
  autoGrow();
  editingBanner.classList.remove("hidden");
  updateSendBtn();
}

function cancelEdit() {
  editingMessageId = null;
  editingBanner.classList.add("hidden");
}

async function deleteMessage(messageId) {
  if (!confirm("Удалить сообщение?")) return;
  await updateDoc(doc(db, "chats", currentChatId, "messages", messageId), {
    deleted: true, text: ""
  });
  if (currentChatData?.lastMessage?.senderId === me.uid) {
    // Обновим превью, если удалили последнее сообщение — не критично, оставим как есть
  }
}

// ============================================================
// TYPING INDICATOR
// ============================================================
function subscribeTyping(chatId) {
  if (unsubTyping) unsubTyping();
  unsubTyping = onSnapshot(collection(db, "chats", chatId, "typing"), (snap) => {
    const now = Date.now();
    const othersTyping = snap.docs.some((d) => {
      if (d.id === me.uid) return false;
      const data = d.data();
      const t = data.updatedAt?.toMillis?.() || 0;
      return data.typing && (now - t < 5000);
    });
    if (currentChatId === chatId) {
      chatHeaderStatus.classList.toggle("typing", othersTyping);
      if (othersTyping) chatHeaderStatus.textContent = "печатает...";
      else refreshChatHeader();
    }
  });
}

function setTyping(isTyping) {
  if (!currentChatId) return;
  if (myTypingState === isTyping) return;
  myTypingState = isTyping;
  setDoc(doc(db, "chats", currentChatId, "typing", me.uid), {
    typing: isTyping, updatedAt: serverTimestamp()
  }).catch(() => {});
}

messageInput.addEventListener("input", () => {
  updateSendBtn();
  autoGrow();
  setTyping(messageInput.value.trim().length > 0);
  clearTimeout(typingClearTimer);
  typingClearTimer = setTimeout(() => setTyping(false), 3000);
});

function autoGrow() {
  messageInput.style.height = "auto";
  messageInput.style.height = Math.min(messageInput.scrollHeight, 140) + "px";
}

function updateSendBtn() {
  sendBtn.disabled = messageInput.value.trim().length === 0;
}

messageInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});
sendBtn.addEventListener("click", sendMessage);
$("cancelEditBtn").addEventListener("click", () => { cancelEdit(); messageInput.value = ""; autoGrow(); updateSendBtn(); });

// ============================================================
// LEAVE / DELETE CHAT
// ============================================================
$("leaveChatBtn").addEventListener("click", async () => {
  if (!currentChatId || !currentChatData) return;
  const isGroup = currentChatData.type === "group";
  const msg = isGroup ? "Покинуть эту группу?" : "Удалить этот чат?";
  if (!confirm(msg)) return;

  if (isGroup) {
    const remaining = currentChatData.members.filter(u => u !== me.uid);
    if (remaining.length === 0) {
      await deleteDoc(doc(db, "chats", currentChatId));
    } else {
      await updateDoc(doc(db, "chats", currentChatId), { members: arrayRemove(me.uid) });
    }
  } else {
    await deleteDoc(doc(db, "chats", currentChatId));
  }
  closeChat();
});

// ============================================================
// NEW CHAT / NEW GROUP MODAL
// ============================================================
function openNewChatModal() {
  newChatModalMode = "private";
  selectedGroupMembers.clear();
  $("groupNameField").style.display = "none";
  $("newChatTitle").textContent = "Новый чат";
  $("switchToGroupBtn").textContent = "Создать группу вместо этого";
  $("createGroupBtn").classList.add("hidden");
  $("newChatSearch").value = "";
  renderNewChatResults("");
  openModal("newChatModal");
}

function renderNewChatResults(filter) {
  const container = $("newChatResults");
  const users = Array.from(usersCache.entries())
    .filter(([uid]) => uid !== me.uid)
    .map(([uid, u]) => ({ uid, ...u }))
    .filter((u) => u.displayName.toLowerCase().includes(filter) || (u.username || "").toLowerCase().includes(filter));

  if (users.length === 0) {
    container.innerHTML = `<div class="empty-hint">Никого не найдено</div>`;
    return;
  }

  container.innerHTML = "";
  users.forEach((u) => {
    const row = document.createElement("div");
    row.className = "contact-pick-row";
    row.innerHTML = `
      <div class="avatar sm" style="background:${avatarGradient(u.uid)}">${escapeHtml(initials(u.displayName))}</div>
      <span>${escapeHtml(u.displayName)} <span style="color:var(--text-faint)">@${escapeHtml(u.username || "")}</span></span>
      ${newChatModalMode === "group" ? `<input type="checkbox" data-uid="${u.uid}">` : ""}
    `;
    if (newChatModalMode === "group") {
      const cb = row.querySelector("input");
      cb.checked = selectedGroupMembers.has(u.uid);
      cb.addEventListener("change", () => {
        if (cb.checked) selectedGroupMembers.add(u.uid); else selectedGroupMembers.delete(u.uid);
      });
      row.addEventListener("click", (e) => {
        if (e.target.tagName !== "INPUT") { cb.checked = !cb.checked; cb.dispatchEvent(new Event("change")); }
      });
    } else {
      row.addEventListener("click", () => startPrivateChat(u.uid));
    }
    container.appendChild(row);
  });
}

$("newChatSearch").addEventListener("input", debounce((e) => {
  renderNewChatResults(e.target.value.trim().toLowerCase());
}, 150));

$("switchToGroupBtn").addEventListener("click", () => {
  newChatModalMode = "group";
  $("groupNameField").style.display = "block";
  $("newChatTitle").textContent = "Новая группа";
  $("switchToGroupBtn").classList.add("hidden");
  $("createGroupBtn").classList.remove("hidden");
  renderNewChatResults($("newChatSearch").value.trim().toLowerCase());
});

$("createGroupBtn").addEventListener("click", async () => {
  const name = $("groupNameInput").value.trim();
  if (!name) return toast("Введите название группы", "error");
  if (selectedGroupMembers.size === 0) return toast("Выберите хотя бы одного участника", "error");

  const members = [me.uid, ...Array.from(selectedGroupMembers)];
  const ref = await addDoc(collection(db, "chats"), {
    type: "group",
    name,
    members,
    createdBy: me.uid,
    createdAt: serverTimestamp(),
    lastMessage: null,
    lastMessageAt: serverTimestamp(),
    unread: {}
  });
  closeModal("newChatModal");
  switchTab("chats");
  openChat(ref.id);
});

// ============================================================
// PROFILE MODAL
// ============================================================
function openProfileModal() {
  $("profileAvatar").style.background = avatarGradient(me.uid);
  $("profileAvatar").textContent = initials(myProfile.displayName);
  $("profileName").value = myProfile.displayName || "";
  $("profileStatus").value = myProfile.statusText || "";
  $("profileUsername").value = "@" + (myProfile.username || "");
  $("themeSwitch").classList.toggle("on", myProfile.theme !== "light");
  openModal("profileModal");
}

$("saveProfileBtn").addEventListener("click", async () => {
  const displayName = $("profileName").value.trim();
  const statusText = $("profileStatus").value.trim();
  if (!displayName) return toast("Имя не может быть пустым", "error");
  await updateDoc(doc(db, "users", me.uid), { displayName, statusText });
  myProfile.displayName = displayName;
  myProfile.statusText = statusText;
  renderMyAvatars();
  toast("Профиль обновлён");
  closeModal("profileModal");
});

$("logoutBtn").addEventListener("click", async () => {
  await updateDoc(doc(db, "users", me.uid), { online: false, lastSeen: serverTimestamp() }).catch(() => {});
  await signOut(auth);
  window.location.href = "index.html";
});

$("themeSwitch").addEventListener("click", async () => {
  const nowDark = !$("themeSwitch").classList.contains("on");
  $("themeSwitch").classList.toggle("on", nowDark);
  applyTheme(nowDark);
  await updateDoc(doc(db, "users", me.uid), { theme: nowDark ? "dark" : "light" }).catch(() => {});
});

function applyTheme(dark) {
  document.body.classList.toggle("theme-light", !dark);
}

$("themeBtn").addEventListener("click", () => {
  const dark = document.body.classList.contains("theme-light");
  applyTheme(dark);
  updateDoc(doc(db, "users", me.uid), { theme: dark ? "dark" : "light" }).catch(() => {});
});

// ============================================================
// MODAL HELPERS
// ============================================================
function openModal(id) { $(id).classList.remove("hidden"); }
function closeModal(id) { $(id).classList.add("hidden"); }

// ============================================================
// WIRE UI
// ============================================================
function wireUI() {
  document.querySelectorAll(".rail-btn[data-tab]").forEach(b => {
    b.addEventListener("click", () => switchTab(b.dataset.tab));
  });
  document.querySelectorAll(".mobilenav button[data-tab]").forEach(b => {
    b.addEventListener("click", () => switchTab(b.dataset.tab));
  });
  $("railProfileBtn").addEventListener("click", openProfileModal);
  $("mobileProfileBtn").addEventListener("click", openProfileModal);
  $("closeProfileBtn").addEventListener("click", () => closeModal("profileModal"));
  $("fabBtn").addEventListener("click", openNewChatModal);
  $("closeNewChatBtn").addEventListener("click", () => closeModal("newChatModal"));
  searchInput.addEventListener("input", () => {
    if (currentTab === "chats") renderChatList(); else renderContactList();
  });
  document.querySelectorAll(".modal-backdrop").forEach(bg => {
    bg.addEventListener("click", (e) => { if (e.target === bg) bg.classList.add("hidden"); });
  });

  switchTab("chats");
}
