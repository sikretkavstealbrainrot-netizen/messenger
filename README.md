# Aurora — мессенджер

Веб-мессенджер на чистом HTML/CSS/JS + Firebase (Auth + Firestore). Работает как
статический сайт — без своего сервера.

## Что уже есть

- Регистрация/вход по email+паролю, уникальные юзернеймы
- Личные и групповые чаты в реальном времени
- Статус «в сети» / «был(а) в сети N назад»
- Индикатор набора текста
- Галочки прочтения (одна — отправлено, две — прочитано)
- Редактирование и удаление своих сообщений
- Поиск по контактам и по списку чатов
- Тёмная/светлая тема (сохраняется в профиле)
- Адаптивная вёрстка: на десктопе — три колонки, на мобильном — как в Telegram
  (список чатов и открытый чат на весь экран, с кнопкой «назад»)

## 1. Создай проект Firebase

1. Зайди на https://console.firebase.google.com → **Add project**.
2. В разделе **Build → Authentication** включи провайдер **Email/Password**.
3. В разделе **Build → Firestore Database** нажми **Create database** (режим
   production, регион — любой ближайший).
4. В **Project settings → General → Your apps** нажми **Web (</>)**, зарегистрируй
   приложение и скопируй объект `firebaseConfig`.

## 2. Вставь конфиг

Открой `js/firebase-config.js` и замени плейсхолдеры реальными значениями из шага 1.

## 3. Настрой правила доступа Firestore

В **Firestore → Rules** вставь содержимое файла `firestore.rules` из этого проекта
и нажми **Publish**. Без этого база будет либо полностью закрыта (по умолчанию),
либо полностью открытой — оба варианта небезопасны.

## 4. Индексы

Firestore может попросить создать составной индекс при первом запросе списка чатов
(`members array-contains + orderBy`). Если увидишь в консоли браузера ссылку вида
`https://console.firebase.google.com/.../firestore/indexes?create_composite=...` —
просто перейди по ней и нажми **Create index**. Через 1-2 минуты индекс будет готов.

## 5. Запусти локально

Открыть `index.html` напрямую двойным кликом не получится — модули ES (`type="module"`)
и Firebase требуют HTTP(S). Проще всего поднять локальный сервер в папке проекта:

```bash
# Python
python3 -m http.server 8080

# либо Node
npx serve .
```

Затем открой `http://localhost:8080`.

## 6. Задеплой (бесплатно)

Проще всего через Firebase Hosting:

```bash
npm install -g firebase-tools
firebase login
firebase init hosting   # public directory: . (текущая папка)
firebase deploy
```

Либо просто перетащи папку проекта в Netlify Drop (netlify.com/drop) — тоже
бесплатно и без консоли.

## Структура проекта

```
index.html              — экран входа/регистрации
app.html                — основной интерфейс (чаты, контакты, профиль)
css/style.css           — вся стилистика (дизайн-система "Aurora")
js/firebase-config.js   — сюда вставляешь свои ключи Firebase
js/firebase-init.js     — инициализация SDK
js/auth.js              — логика входа/регистрации
js/app.js               — вся логика приложения
firestore.rules         — правила безопасности базы
```

## Модель данных Firestore

```
users/{uid}         { displayName, username, usernameLower, statusText,
                       online, lastSeen, theme, createdAt }
usernames/{name}    { uid }                       — для проверки уникальности
chats/{chatId}      { type: "private"|"group", members: [uid...],
                       name (для групп), lastMessage, lastMessageAt, unread: {uid: count} }
chats/{chatId}/messages/{id}  { text, senderId, senderName, createdAt,
                                 editedAt, deleted, readBy: [uid...] }
chats/{chatId}/typing/{uid}   { typing: bool, updatedAt }
```

## Куда развивать дальше

- Вложения (фото/файлы) через Firebase Storage
- Push-уведомления (Firebase Cloud Messaging)
- Голосовые/видеозвонки (WebRTC)
- Реакции на сообщения, ответы (reply), пересылка
- Роли администратора в группах
