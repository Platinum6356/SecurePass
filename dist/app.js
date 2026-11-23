import {categories, readVault, isVaultEvent, makeKey, seal, unseal, commit, mergeRecords} from "./vault.js";
import {generatePassword} from "./generator.js";

const $ = id => document.getElementById(id);
const fields = $("entryForm").elements;
const all = "Все записи";
const idleMs = 5 * 60 * 1000;
let session = null, epoch = 0, selected = null, editing = null, category = all;
let revealed = false, lastActivity = 0, idleTimer, noticeTimer, saving = false;
const node = (tag, text, cls) => {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  if (cls) el.className = cls;
  return el;
};
function action(text, handler, cls) {
  const button = node("button", text, cls);
  button.type = "button";
  button.addEventListener("click", handler);
  return button;
}
function notice(text) {
  $("notice").textContent = text;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { $("notice").textContent = ""; }, 4600);
}
function gate(message = "") {
  epoch++;
  session = null;
  selected = editing = null;
  category = all;
  revealed = false;
  clearTimeout(idleTimer);
  document.querySelectorAll("dialog[open]").forEach(el => el.close());
  document.querySelectorAll("form").forEach(el => el.reset());
  ["rows","nav","detail","resultCount","listTitle","deleteHint","notice"].forEach(id => $(id).replaceChildren());
  $("search").value = "";
  $("lock").hidden = $("workspace").hidden = true;
  $("gate").hidden = false;
  let existing;
  try {
    existing = readVault() !== null;
    if (!crypto.subtle || !navigator.locks) throw Error();
  } catch {
    $("accessError").textContent = "Откройте SecurePass через start.cmd в современном браузере и разрешите локальное хранение.";
    $("accessSubmit").disabled = true;
    return;
  }
  $("accessTitle").textContent = existing ? "Вход в хранилище" : "Создание хранилища";
  $("accessSubmit").textContent = existing ? "Открыть хранилище" : "Создать хранилище";
  $("accessHelp").textContent = existing ? "Записи хранятся в этом браузере." :
    "Записи будут храниться в этом браузере. Задайте мастер-пароль длиной от 12 символов. Он понадобится при каждом входе. Восстановить его нельзя.";
  $("master").autocomplete = existing ? "current-password" : "new-password";
  $("master").minLength = existing ? 1 : 12;
  $("confirmLabel").hidden = existing;
  $("confirmMaster").required = !existing;
  $("accessError").textContent = message;
  $("master").focus();
}
function touch() {
  if (!session) return;
  if (Date.now() - lastActivity >= idleMs) { gate("Сеанс завершён после 5 минут бездействия."); return; }
  lastActivity = Date.now();
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => gate("Сеанс завершён после 5 минут бездействия."), idleMs);
}
for (const event of ["pointerdown","keydown","input","wheel"]) document.addEventListener(event, touch, {capture:true, passive:true});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && session && Date.now() - lastActivity >= idleMs) gate("Сеанс завершён после 5 минут бездействия.");
});
window.addEventListener("storage", event => { if (isVaultEvent(event)) gate("Хранилище изменилось в другой вкладке. Войдите снова."); });
window.addEventListener("pagehide", () => gate());
$("lock").onclick = () => gate();
$("accessForm").onsubmit = async event => {
  event.preventDefault();
  const token = epoch, password = $("master").value;
  $("accessError").textContent = "";
  $("accessSubmit").disabled = true;
  try {
    let raw = readVault(), opened;
    if (raw === null) {
      if (password.length < 12 || password !== $("confirmMaster").value) throw Error("Введите одинаковый мастер-пароль длиной от 12 символов.");
      opened = {...await makeKey(password), records:[]};
      raw = await seal(opened, []);
      await commit(null, raw, () => token === epoch);
    } else {
      opened = await unseal(raw, password);
    }
    if (token !== epoch) return;
    if (readVault() !== raw) throw Error("Данные изменились. Повторите вход.");
    session = {...opened, raw};
    $("accessForm").reset();
    $("gate").hidden = true;
    $("lock").hidden = $("workspace").hidden = false;
    lastActivity = Date.now(); touch(); render();
    $("search").focus();
  } catch (error) { if (token === epoch) $("accessError").textContent = error.message; }
  finally { $("accessSubmit").disabled = false; }
};
function detail(item) {
  const el = $("detail");
  el.replaceChildren();
  if (!item) return;
  el.append(node("h2",item.title),node("p",item.category,"category-name"));
  const info = node("div",undefined,"info");
  function field(label, content) {
    const line = node("div",undefined,"field");
    line.append(node("div",label,"field-key"),content);
    info.append(line);
    return line;
  }
  field("Логин",node("div",item.login,"value"));
  const pass = field("Пароль",node("div",revealed ? item.password : "••••••••••••","value secret"));
  pass.append(action(revealed ? "Скрыть пароль" : "Показать пароль", () => {
    revealed = !revealed; detail(item); $("detail").querySelector(".textbtn").focus();
  },"textbtn"));
  field("Теги",node("div",item.tags.split(",").map(tag => tag.trim()).filter(Boolean).join(", ") || "—","value"));
  field("Заметки",node("div",item.notes || "—","value"));
  const controls = node("div",undefined,"actions");
  controls.append(action("Изменить",() => openEditor(item)),action("Удалить",() => {
    $("deleteHint").textContent = "«" + item.title + "» будет удалена из этого хранилища.";
    $("deleteError").textContent = ""; $("deleteDialog").showModal();
  },"danger"));
  el.append(info,controls);
}
function render() {
  if (!session) return;
  const query = $("search").value.trim().toLocaleLowerCase("ru");
  const matches = session.records.filter(item => (category === all || item.category === category) &&
    [item.title,item.login,item.tags].some(text => text.toLocaleLowerCase("ru").includes(query)))
    .sort((a,b) => a.title.localeCompare(b.title,"ru"));
  if (!matches.some(item => item.id === selected)) { selected = matches[0]?.id ?? null; revealed = false; }
  $("listTitle").textContent = category;
  $("resultCount").textContent = query ? "Найдено записей: " + matches.length : "";
  $("nav").replaceChildren();
  for (const name of [all,...categories]) {
    const count = name === all ? session.records.length : session.records.filter(item => item.category === name).length;
    const link = action("",() => { category = name; revealed = false; render(); $("nav").querySelector(".active").focus(); },
      "navline" + (name === category ? " active" : ""));
    link.setAttribute("aria-pressed",String(name === category));
    link.append(node("span",name),node("span",String(count)));
    $("nav").append(link);
  }
  $("rows").replaceChildren();
  for (const item of matches) {
    const row = action("",() => {
      selected = item.id; revealed = false; render();
      $("rows").querySelector('[aria-pressed="true"]').focus({preventScroll:true});
      if (matchMedia("(max-width:720px)").matches) $("detail").scrollIntoView();
    },"row");
    row.setAttribute("aria-pressed",String(item.id === selected));
    const text = node("span",undefined,"rowtext");
    text.append(node("b",item.title),node("small",item.login));
    row.append(text); $("rows").append(row);
  }
  if (!matches.length) {
    const empty = node("div",undefined,"empty");
    const fresh = !session.records.length;
    empty.append(node("h3",fresh ? "Пока нет записей" : "Записей не найдено"),
      node("p",fresh ? "Нажмите «Добавить запись», чтобы сохранить первый пароль." : "Измените запрос или выберите другую категорию."));
    $("rows").append(empty);
  }
  detail(matches.find(item => item.id === selected));
}
$("search").oninput = () => { revealed = false; render(); };
for (const name of categories) fields.category.add(new Option(name,name));
function passwordVisibility(visible) {
  fields.password.type = visible ? "text" : "password";
  $("editReveal").textContent = visible ? "Скрыть" : "Показать";
}
function openEditor(item) {
  editing = item?.id ?? null;
  $("entryForm").reset();
  for (const field of ["title","login","password","tags","notes"]) fields[field].value = item?.[field] ?? "";
  fields.category.value = item?.category ?? (category === all ? categories[0] : category);
  $("editorTitle").textContent = item ? "Изменение записи" : "Новая запись";
  $("editorError").textContent = $("genError").textContent = "";
  $("gen").open = false; $("lengthText").value = $("length").value;
  passwordVisibility(false); $("editor").showModal(); fields.title.focus();
}
$("add").onclick = () => openEditor();
$("editReveal").onclick = () => passwordVisibility(fields.password.type === "password");
$("length").oninput = () => { $("lengthText").value = $("length").value; };
$("generate").onclick = () => {
  try {
    const groups = [...$("gen").querySelectorAll("input:checked")].map(check => check.value);
    fields.password.value = generatePassword(Number($("length").value),groups);
    passwordVisibility(true); $("genError").textContent = "";
  } catch (e) { $("genError").textContent = e.message; }
};
document.querySelectorAll("[data-close]").forEach(button => { button.onclick = () => { if (!saving) button.closest("dialog").close(); }; });
document.querySelectorAll("dialog").forEach(dialog => {
  dialog.addEventListener("cancel",event => { if (saving) event.preventDefault(); });
  dialog.addEventListener("close",() => { dialog.querySelector("form").reset(); if (dialog === $("editor")) passwordVisibility(false); });
});
async function writeRecords(current, records) {
  const raw = await seal(current, records);
  await commit(current.raw, raw, () => session === current);
  if (session !== current) throw Error("Сеанс завершён.");
  current.records = records; current.raw = raw;
}
function submitDialog(form, button, error, operation) {
  $(form).onsubmit = async event => {
    event.preventDefault();
    if (saving || !session) return;
    const current = session;
    saving = true; $(button).disabled = true; $(error).textContent = "";
    try {
      const result = await operation(current);
      if (current !== session) return;
      $(form).closest("dialog").close();
      revealed = false; render(); notice(result);
    } catch (e) { if (current === session) $(error).textContent = e.message; }
    finally { saving = false; $(button).disabled = false; }
  };
}
submitDialog("entryForm","save","editorError",async current => {
  const item = {id:editing || crypto.randomUUID(),title:fields.title.value.trim(),login:fields.login.value.trim(),
    password:fields.password.value,category:fields.category.value,tags:fields.tags.value.trim(),notes:fields.notes.value};
  const records = editing ? current.records.map(row => row.id === editing ? item : row) : [...current.records,item];
  await writeRecords(current,records); selected = item.id;
  if (category !== all) category = item.category;
  $("search").value = ""; return "Запись сохранена.";
});
submitDialog("deleteForm","deleteSubmit","deleteError",async current => {
  await writeRecords(current,current.records.filter(row => row.id !== selected)); return "Запись удалена.";
});
$("export").onclick = () => {
  const url = URL.createObjectURL(new Blob([session.raw],{type:"application/json"}));
  const link = node("a");
  link.href = url; link.download = "SecurePass-" + new Date().toISOString().slice(0,10) + ".json";
  link.click(); setTimeout(() => URL.revokeObjectURL(url),30000);
  notice("Копия зашифрована текущим мастер-паролем.");
};
$("importOpen").onclick = () => {
  $("importForm").reset(); $("importError").textContent = ""; $("importDialog").showModal();
};
submitDialog("importForm","importSubmit","importError",async current => {
  const file = $("file").files[0];
  if (!file || file.size > 8 * 1024 * 1024) throw Error("Выберите JSON-файл размером до 8 МБ.");
  const password = $("filePass").value;
  const incoming = await unseal(await file.text(),password);
  if (session !== current) throw Error("Сеанс завершён.");
  const merged = mergeRecords(current.records,incoming.records);
  if (merged.count) {
    await writeRecords(current,merged.records);
    $("search").value = ""; category = all;
  }
  return "Добавлено записей: " + merged.count + ". Совпадающих: " + (incoming.records.length - merged.count) + ".";
});
gate();