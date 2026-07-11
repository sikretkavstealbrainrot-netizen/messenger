import {
  auth, db, onAuthStateChanged,
  createUserWithEmailAndPassword, signInWithEmailAndPassword, updateProfile,
  doc, setDoc, getDoc, runTransaction, serverTimestamp
} from "./firebase-init.js";
import { toast } from "./utils.js";

let mode = "login"; // or "register"

const form = document.getElementById("authForm");
const submitBtn = document.getElementById("submitBtn");
const submitLabel = document.getElementById("submitLabel");
const formError = document.getElementById("formError");
const formTitle = document.getElementById("formTitle");
const formSub = document.getElementById("formSub");
const switchText = document.getElementById("switchText");
const switchBtn = document.getElementById("switchBtn");
const fieldName = document.getElementById("fieldName");
const fieldUsername = document.getElementById("fieldUsername");

switchBtn.addEventListener("click", () => {
  mode = mode === "login" ? "register" : "login";
  applyMode();
});

function applyMode() {
  formError.textContent = "";
  if (mode === "login") {
    formTitle.textContent = "Вход";
    formSub.textContent = "Рады видеть вас снова";
    submitLabel.textContent = "Войти";
    switchText.textContent = "Нет аккаунта?";
    switchBtn.textContent = "Создать";
    fieldName.classList.add("hidden");
    fieldUsername.classList.add("hidden");
  } else {
    formTitle.textContent = "Регистрация";
    formSub.textContent = "Создайте аккаунт за пару секунд";
    submitLabel.textContent = "Создать аккаунт";
    switchText.textContent = "Уже есть аккаунт?";
    switchBtn.textContent = "Войти";
    fieldName.classList.remove("hidden");
    fieldUsername.classList.remove("hidden");
  }
}

function setLoading(isLoading) {
  submitBtn.disabled = isLoading;
  submitBtn.innerHTML = isLoading
    ? '<span class="spinner"></span>'
    : `<span>${mode === "login" ? "Войти" : "Создать аккаунт"}</span>`;
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  formError.textContent = "";
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;

  try {
    setLoading(true);
    if (mode === "login") {
      await signInWithEmailAndPassword(auth, email, password);
    } else {
      const displayName = document.getElementById("displayName").value.trim();
      const usernameRaw = document.getElementById("username").value.trim();
      const usernameLower = usernameRaw.toLowerCase();

      if (!displayName) throw new Error("Введите имя");
      if (!/^[a-z0-9_]{3,20}$/.test(usernameLower)) {
        throw new Error("Юзернейм: 3-20 символов, латиница/цифры/_");
      }

      const cred = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(cred.user, { displayName });

      // Резервируем юзернейм атомарно, чтобы избежать дублей
      await runTransaction(db, async (tx) => {
        const unameRef = doc(db, "usernames", usernameLower);
        const existing = await tx.get(unameRef);
        if (existing.exists()) {
          throw new Error("Этот юзернейм уже занят");
        }
        tx.set(unameRef, { uid: cred.user.uid });
        tx.set(doc(db, "users", cred.user.uid), {
          uid: cred.user.uid,
          displayName,
          username: usernameRaw,
          usernameLower,
          statusText: "Привет! Я использую Aurora",
          createdAt: serverTimestamp(),
          online: true,
          lastSeen: serverTimestamp()
        });
      });
    }
    window.location.href = "app.html";
  } catch (err) {
    console.error(err);
    formError.textContent = friendlyError(err);
  } finally {
    setLoading(false);
  }
});

function friendlyError(err) {
  const code = err.code || "";
  if (code.includes("email-already-in-use")) return "Этот email уже зарегистрирован";
  if (code.includes("invalid-email")) return "Некорректный email";
  if (code.includes("weak-password")) return "Пароль слишком простой (мин. 6 символов)";
  if (code.includes("invalid-credential") || code.includes("wrong-password") || code.includes("user-not-found")) {
    return "Неверный email или пароль";
  }
  return err.message || "Что-то пошло не так";
}

// Если уже залогинен — сразу в приложение
onAuthStateChanged(auth, (user) => {
  if (user) window.location.href = "app.html";
});

applyMode();
