const FORMAT = "SecurePass";
const ITERATIONS = 600000;
const STORAGE = "securepass.v1";
const encoder = new TextEncoder();
export const categories = ["Электронная почта", "Банки", "Социальные сети", "Работа", "Другое"];
export const limits = {title: 120, login: 254, password: 1024, tags: 250, notes: 3000};

function toLocalXml(raw) {
  const file = JSON.parse(raw);
  const doc = document.implementation.createDocument(null, "vault");
  const root = doc.documentElement;
  for (const name of ["format", "version", "iterations"]) root.setAttribute(name, String(file[name]));
  for (const name of ["salt", "iv", "data"]) {
    const child = doc.createElement(name);
    child.textContent = file[name];
    root.appendChild(child);
  }
  return new XMLSerializer().serializeToString(doc);
}
export function readVault() {
  const raw = localStorage.getItem(STORAGE);
  if (raw === null || !raw.startsWith("<vault ")) return raw;
  const root = new DOMParser().parseFromString(raw, "application/xml").documentElement;
  if (root.localName !== "vault") return raw;
  const field = name => Array.from(root.children).find(child => child.localName === name)?.textContent;
  return JSON.stringify({format:root.getAttribute("format"), version:Number(root.getAttribute("version")),
    iterations:Number(root.getAttribute("iterations")), salt:field("salt"), iv:field("iv"), data:field("data")});
}
export const isVaultEvent = event => event.key === STORAGE || event.key === null;

function encode(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(binary);
}
function decode(value) {
  if (typeof value !== "string") throw Error("Некорректное поле контейнера.");
  return Uint8Array.from(atob(value), character => character.charCodeAt(0));
}
function validate(records) {
  if (!Array.isArray(records) || records.length > 5000) throw Error("Некорректный список записей.");
  const ids = new Set();
  for (const item of records) {
    if (!item || typeof item.id !== "string" || !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(item.id) ||
        ids.has(item.id) || !categories.includes(item.category)) throw Error("Некорректная запись.");
    for (const [field, limit] of Object.entries(limits)) {
      if (typeof item[field] !== "string" || item[field].length > limit) throw Error("Некорректные поля записи.");
    }
    if (!item.title.trim() || !item.login.trim() || !item.password.length) throw Error("Заполните название, логин и пароль.");
    ids.add(item.id);
  }
}
export async function makeKey(password, salt = encode(crypto.getRandomValues(new Uint8Array(16)))) {
  const base = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey({name:"PBKDF2", hash:"SHA-256", salt:decode(salt), iterations:ITERATIONS}, base,
    {name:"AES-GCM", length:256}, false, ["encrypt", "decrypt"]);
  return {key, salt};
}
export async function seal(session, records) {
  validate(records);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const bytes = await crypto.subtle.encrypt({name:"AES-GCM", iv}, session.key, encoder.encode(JSON.stringify(records)));
  return JSON.stringify({format:FORMAT, version:1, iterations:ITERATIONS, salt:session.salt, iv:encode(iv), data:encode(new Uint8Array(bytes))});
}
export async function unseal(raw, password) {
  let file, iv, data;
  try {
    if (raw.length > 8 * 1024 * 1024) throw Error();
    file = JSON.parse(raw);
    if (file.format !== FORMAT || file.version !== 1 || file.iterations !== ITERATIONS ||
        decode(file.salt).length !== 16) throw Error();
    iv = decode(file.iv);
    data = decode(file.data);
    if (iv.length !== 12 || data.length < 16) throw Error();
  } catch { throw Error("Нужен зашифрованный JSON-файл SecurePass версии 1."); }
  const session = await makeKey(password, file.salt);
  try {
    const plain = await crypto.subtle.decrypt({name:"AES-GCM", iv}, session.key, data);
    const records = JSON.parse(new TextDecoder().decode(plain));
    validate(records);
    return {...session, records};
  } catch { throw Error("Неверный мастер-пароль или хранилище повреждено."); }
}
export async function commit(previous, next, active) {
  await navigator.locks.request(STORAGE, () => {
    if (!active()) throw Error("Сеанс завершён.");
    if (readVault() !== previous) throw Error("Данные изменены в другой вкладке. Войдите снова.");
    try { localStorage.setItem(STORAGE, toLocalXml(next)); }
    catch { throw Error("Не удалось сохранить изменения. Проверьте свободное место и разрешение на хранение данных."); }
  });
}

export function mergeRecords(current, incoming) {
  const ids = new Set(current.map(record => record.id));
  const added = incoming.filter(record => !ids.has(record.id));
  const records = [...current, ...added];
  validate(records);
  return {records, count:added.length};
}
