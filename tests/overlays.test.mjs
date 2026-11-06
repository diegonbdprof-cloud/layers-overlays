import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const require = createRequire(import.meta.url);
const axePath = require.resolve("axe-core/axe.min.js");
const axeVersion = require("axe-core/package.json").version;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pageUrl = "file://" + path.join(root, "index.html");
const imageDir = path.join(root, "images");

fs.mkdirSync(imageDir, { recursive: true });

const results = [];
const externalRequests = [];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function test(name, fn) {
  const started = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - started });
    console.log("ok  " + name);
  } catch (error) {
    results.push({
      name,
      ok: false,
      ms: Date.now() - started,
      error: error && error.stack ? error.stack : String(error)
    });
    console.error("FAIL " + name + "\n" + (error && error.stack ? error.stack : error));
  }
}

function track(page) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(message.text());
    }
  });
  page.on("dialog", (dialog) => {
    errors.push("unexpected dialog: " + dialog.message());
    dialog.dismiss();
  });
  page.on("request", (request) => {
    const url = request.url();
    if (!url.startsWith("file:") && !url.startsWith("data:") && url !== "about:blank") {
      externalRequests.push(url);
    }
  });
  return errors;
}

async function openPage(browser, options) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    locale: "pt-BR",
    reducedMotion: "no-preference",
    colorScheme: "light",
    ...options
  });
  const page = await context.newPage();
  const errors = track(page);
  await page.goto(pageUrl);
  await page.waitForSelector("#open-session");
  return { context, page, errors };
}

async function openDialog(page) {
  await page.locator("#open-session").click();
  await page.waitForFunction(() => document.getElementById("session-dialog").open);
}

async function openDrawer(page) {
  await page.locator("#open-notes").click();
  await page.waitForFunction(() => document.getElementById("notes-drawer").open);
}

async function waitClosed(page, id) {
  await page.waitForFunction((dialogId) => !document.getElementById(dialogId).open, id);
}

async function visibleButtons(page) {
  return page.locator("button").evaluateAll((buttons) =>
    buttons
      .filter((button) => button.getClientRects().length > 0)
      .map((button) => {
        const rect = button.getBoundingClientRect();
        return { name: (button.getAttribute("aria-label") || button.textContent).trim(), width: rect.width, height: rect.height };
      })
  );
}

async function assertBackgroundBlocked(page, id) {
  const focused = await page.evaluate((buttonId) => {
    const button = document.getElementById(buttonId);
    button.focus();
    return document.activeElement === button;
  }, id);
  assert(focused === false, "o foco saiu para #" + id);
  let userBlocked = false;
  try {
    await page.locator("#" + id).click({ timeout: 800 });
  } catch (error) {
    userBlocked = true;
  }
  assert(userBlocked, "o ponteiro conseguiu acionar #" + id);
}

async function settleDialog(page, id) {
  await page.waitForFunction((dialogId) => {
    const dialog = document.getElementById(dialogId);
    if (!dialog.open) {
      return false;
    }
    const style = getComputedStyle(dialog);
    const opacity = parseFloat(style.opacity);
    return opacity > 0.98 && (style.transform === "none" || style.transform === "matrix(1, 0, 0, 1, 0, 0)");
  }, id);
}

async function activeId(page) {
  return page.evaluate(() => (document.activeElement && document.activeElement.id) || document.activeElement.tagName);
}

async function overflow(page) {
  return page.evaluate(() => ({
    doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    body: document.body.scrollWidth - document.body.clientWidth
  }));
}

async function assertNoOverflow(page, label) {
  const delta = await overflow(page);
  assert(delta.doc <= 1 && delta.body <= 1, label + " " + JSON.stringify(delta));
}

async function assertInViewport(page, selector) {
  const box = await page.evaluate((sel) => {
    const rect = document.querySelector(sel).getBoundingClientRect();
    return {
      top: rect.top,
      left: rect.left,
      right: rect.right,
      bottom: rect.bottom,
      width: window.innerWidth,
      height: window.innerHeight
    };
  }, selector);
  assert(box.top >= -1, selector + " top " + JSON.stringify(box));
  assert(box.left >= -1, selector + " left " + JSON.stringify(box));
  assert(box.right <= box.width + 1, selector + " right " + JSON.stringify(box));
  assert(box.bottom <= box.height + 1, selector + " bottom " + JSON.stringify(box));
}

async function runAxe(page) {
  await page.addScriptTag({ path: axePath });
  return page.evaluate(async () => {
    const outcome = await window.axe.run(document, { resultTypes: ["violations"] });
    return outcome.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      help: violation.help,
      nodes: violation.nodes.slice(0, 6).map((node) => node.target.join(" "))
    }));
  });
}

const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"]
});

const chromeVersion = browser.version();
const axeReports = [];

try {
  await test("página em português abre sem pedido externo", async () => {
    const { context, page, errors } = await openPage(browser);
    assert((await page.locator("html").getAttribute("lang")) === "pt-BR");
    assert((await page.title()).includes("Ateliê Camadas"));
    assert(await page.locator("main").count() === 1);
    assert((await page.locator("h1").innerText()).includes("Camadas"));
    await assertNoOverflow(page, "desktop");
    assert(errors.length === 0, errors.join("\n"));
    await context.close();
  });

  await test("botões têm nome acessível, foco, hover e desativado distintos", async () => {
    const { context, page } = await openPage(browser);
    const names = await page.locator("button").evaluateAll((buttons) =>
      buttons.map((button) => ({
        name: button.getAttribute("aria-label") || button.textContent.trim(),
        disabled: button.disabled
      }))
    );
    assert(names.every((item) => item.name.length > 0), JSON.stringify(names));
    assert(names.some((item) => item.disabled && item.name.includes("desativado")));

    const help = await page.locator("#publish-help").innerText();
    assert(help.includes("Desativado"));
    const described = await page.locator("#publish-disabled").getAttribute("aria-describedby");
    assert(described === "publish-help");

    const before = await page.locator("#open-session").evaluate((element) => getComputedStyle(element).backgroundColor);
    await page.locator("#open-session").hover();
    const after = await page.locator("#open-session").evaluate((element) => getComputedStyle(element).backgroundColor);
    assert(before !== after, "hover não alterou o primário: " + after);

    const disabledBefore = await page.locator("#publish-disabled").evaluate((element) => getComputedStyle(element).backgroundColor);
    await page.locator("#publish-disabled").hover({ force: true });
    const disabledAfter = await page.locator("#publish-disabled").evaluate((element) => ({
      background: getComputedStyle(element).backgroundColor,
      cursor: getComputedStyle(element).cursor
    }));
    assert(disabledBefore === disabledAfter.background, "desativado mudou no hover");
    assert(disabledAfter.cursor === "not-allowed", disabledAfter.cursor);

    await page.evaluate(() => document.getElementById("open-session").focus({ focusVisible: true }));
    const outline = await page.locator("#open-session").evaluate((element) => ({
      style: getComputedStyle(element).outlineStyle,
      width: parseFloat(getComputedStyle(element).outlineWidth)
    }));
    assert(outline.style === "solid" && outline.width >= 3, JSON.stringify(outline));

    const targets = await visibleButtons(page);
    const small = targets.filter((item) => item.width < 44 || item.height < 44);
    assert(small.length === 0, "alvos pequenos: " + JSON.stringify(small));
    await context.close();
  });

  await test("diálogo: abrir, validar, Escape, pano de fundo, fechar e foco", async () => {
    const { context, page, errors } = await openPage(browser);

    await openDialog(page);
    assert(await activeId(page) === "session-theme");
    assert(await page.evaluate(() => document.getElementById("session-dialog").matches(":modal")));
    await assertBackgroundBlocked(page, "open-notes");
    assert(await page.locator(".toast").count() === 0);
    const dialogTargets = await visibleButtons(page);
    const smallDialog = dialogTargets.filter((item) => item.width < 44 || item.height < 44);
    assert(smallDialog.length === 0, JSON.stringify(smallDialog));

    for (let step = 0; step < 16; step += 1) {
      await page.keyboard.press("Tab");
      const inside = await page.evaluate(() => document.getElementById("session-dialog").contains(document.activeElement));
      assert(inside, "foco saiu no Tab " + step);
    }

    await page.locator("#session-close").focus();
    await page.keyboard.press("Shift+Tab");
    const wrapped = await activeId(page);
    assert(wrapped === "session-save", "Shift+Tab no primeiro foi para " + wrapped);
    await page.keyboard.press("Tab");
    assert(await activeId(page) === "session-close");

    await page.locator("#session-save").click();
    assert(await page.evaluate(() => document.getElementById("session-dialog").open));
    const errorText = await page.locator("#session-errors").innerText();
    assert(errorText.includes("Erro"), errorText);
    assert(errorText.includes("Selecione um tema"));
    assert(errorText.includes("3 caracteres"));
    assert(errorText.includes("Confirme"));
    assert((await page.locator("#session-theme").getAttribute("aria-invalid")) === "true");

    await page.keyboard.press("Escape");
    await waitClosed(page, "session-dialog");
    assert(await activeId(page) === "open-session");
    assert(await page.evaluate(() => !document.body.classList.contains("is-scroll-locked")));

    await openDialog(page);
    await page.mouse.click(8, 8);
    await waitClosed(page, "session-dialog");
    assert(await activeId(page) === "open-session");

    await openDialog(page);
    await page.locator("#session-close").click();
    await waitClosed(page, "session-dialog");
    assert(await activeId(page) === "open-session");

    await openDialog(page);
    await page.locator("#session-cancel").click();
    await waitClosed(page, "session-dialog");
    assert(await activeId(page) === "open-session");
    assert(errors.length === 0, errors.join("\n"));
    await context.close();
  });

  await test("diálogo válido gera nota e notificação sem roubar foco nem gravar", async () => {
    const { context, page } = await openPage(browser);
    await openDialog(page);
    await page.locator("#session-theme").selectOption("Empilhamento");
    await page.locator("#session-note").fill("<img src=x onerror=alert(1)> ok");
    await page.locator("#session-ack").check();
    await page.locator("#session-save").click();
    await waitClosed(page, "session-dialog");
    assert(await activeId(page) === "open-session");
    await page.waitForSelector(".toast-success");
    assert(await activeId(page) === "open-session");
    const toastText = await page.locator(".toast-success").innerText();
    assert(toastText.includes("Sucesso"));
    assert(toastText.includes("Nada foi enviado"));
    assert(await page.locator(".toast-success svg").count() === 1);
    const noteText = await page.locator("#note-list").innerText();
    assert(noteText.includes("<img src=x onerror=alert(1)> ok"));
    assert(await page.locator("#note-list img").count() === 0);
    await page.waitForTimeout(2500);
    assert(await page.locator(".toast").count() === 1);
    const storage = await page.evaluate(() => ({
      local: localStorage.length,
      session: sessionStorage.length,
      cookie: document.cookie
    }));
    assert(storage.local === 0 && storage.session === 0 && storage.cookie === "", JSON.stringify(storage));
    await page.locator(".toast button").click();
    await page.waitForFunction(() => document.querySelectorAll(".toast").length === 0);
    await context.close();
  });

  await test("notificações não modais conservam o foco e só fecham pelo controle", async () => {
    const { context, page } = await openPage(browser);
    await page.locator("#show-info").click();
    await page.waitForSelector(".toast-info");
    assert(await activeId(page) === "show-info");
    const info = await page.locator(".toast-info").innerText();
    assert(info.includes("Informação"));
    assert((await page.locator(".toast-info").getAttribute("role")) === "status");
    await page.locator("#show-warning").click();
    const warning = await page.locator(".toast-warning").innerText();
    assert(warning.includes("Atenção"));
    assert(await activeId(page) === "show-warning");
    await page.waitForTimeout(2500);
    assert(await page.locator(".toast").count() === 2);
    const closeName = await page.locator(".toast-info button").getAttribute("aria-label");
    assert(closeName.includes("Fechar"));
    await page.locator(".toast-info button").click();
    await page.waitForFunction(() => document.querySelectorAll(".toast-info").length === 0);
    assert(await page.locator(".toast-warning").count() === 1);
    await context.close();
  });

  await test("gaveta: cartão, Escape, pano de fundo, botão e nota de exemplo", async () => {
    const { context, page } = await openPage(browser);
    await page.locator('[data-open-note="top-layer"]').click();
    await page.waitForFunction(() => document.getElementById("notes-drawer").open);
    assert(await activeId(page) === "note-top-layer");
    assert(await page.evaluate(() => document.getElementById("notes-drawer").matches(":modal")));
    await assertBackgroundBlocked(page, "open-session");
    assert(await page.evaluate(() => !document.getElementById("session-dialog").open));
    await page.keyboard.press("Escape");
    await waitClosed(page, "notes-drawer");
    const returned = await page.evaluate(() => document.activeElement.getAttribute("data-open-note"));
    assert(returned === "top-layer", returned);

    await openDrawer(page);
    assert(await activeId(page) === "drawer-close");
    await page.mouse.click(8, 80);
    await waitClosed(page, "notes-drawer");
    assert(await activeId(page) === "open-notes");

    await openDrawer(page);
    await page.locator("#add-note").click();
    assert(await page.locator("#note-list article").count() === 5);
    const created = await activeId(page);
    assert(created.startsWith("note-exemplo-"), created);
    const storage = await page.evaluate(() => localStorage.length + sessionStorage.length);
    assert(storage === 0);
    await page.locator("#drawer-close").click();
    await waitClosed(page, "notes-drawer");
    await page.waitForFunction(() => !document.body.classList.contains("is-scroll-locked"));
    assert(await activeId(page) === "open-notes");
    await context.close();
  });

  await test("glossário não é modal e não convive com o diálogo", async () => {
    const { context, page } = await openPage(browser);
    await page.locator("#open-glossary").click();
    await page.waitForFunction(() => {
      const glossary = document.getElementById("glossary");
      return glossary.matches(":popover-open") && document.getElementById("open-glossary").getAttribute("aria-expanded") === "true";
    });
    assert(await activeId(page) === "open-glossary");
    assert(await page.evaluate(() => !document.getElementById("glossary").matches(":modal")));
    const glossaryPageStillUsable = await page.evaluate(() => {
      const button = document.getElementById("show-info");
      const previous = document.activeElement;
      button.focus();
      const focused = document.activeElement === button;
      previous.focus();
      return focused;
    });
    assert(glossaryPageStillUsable, "o glossário bloqueou o foco da página");
    await page.keyboard.press("Tab");
    const moved = await activeId(page);
    assert(moved !== "open-glossary", moved);
    assert(await page.evaluate(() => document.getElementById("glossary").matches(":popover-open")));
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => {
      return !document.getElementById("glossary").matches(":popover-open") &&
        document.getElementById("open-glossary").getAttribute("aria-expanded") === "false";
    });

    await page.locator("#open-glossary").click();
    await page.waitForFunction(() => document.getElementById("glossary").matches(":popover-open"));
    await page.mouse.click(8, 520);
    await page.waitForFunction(() => !document.getElementById("glossary").matches(":popover-open"));

    await page.locator("#open-glossary").click();
    await page.waitForFunction(() => document.getElementById("glossary").matches(":popover-open"));
    await openDialog(page);
    assert(await page.evaluate(() => !document.getElementById("glossary").matches(":popover-open")));
    assert(await page.evaluate(() => !document.getElementById("notes-drawer").open));
    await context.close();
  });

  await test("rolagem trava com o modal e volta ao mesmo ponto", async () => {
    const { context, page } = await openPage(browser, { viewport: { width: 1280, height: 640 } });
    await page.evaluate(() => window.scrollTo(0, 480));
    await page.waitForFunction(() => window.scrollY > 400);
    const before = await page.evaluate(() => window.scrollY);
    await page.evaluate(() => document.getElementById("open-session").click());
    await page.waitForFunction(() => document.getElementById("session-dialog").open);
    const during = await page.evaluate(() => ({
      locked: document.body.classList.contains("is-scroll-locked"),
      top: document.body.style.top
    }));
    assert(during.locked, "não travou");
    assert(Math.abs(parseFloat(during.top) + before) < 2, JSON.stringify({ during, before }));
    await page.mouse.move(10, 10);
    await page.mouse.wheel(0, 900);
    const topAfterWheel = await page.evaluate(() => document.body.style.top);
    assert(Math.abs(parseFloat(topAfterWheel) + before) < 2, "a roda moveu o fundo: " + topAfterWheel);
    await page.keyboard.press("Escape");
    await waitClosed(page, "session-dialog");
    await page.waitForFunction(() => !document.body.classList.contains("is-scroll-locked"));
    const after = await page.evaluate(() => window.scrollY);
    assert(Math.abs(after - before) < 2, "não restaurou: antes " + before + " depois " + after);
    await context.close();
  });

  await test("diálogo alto rola por dentro e cabe na viewport curta", async () => {
    const { context, page } = await openPage(browser, { viewport: { width: 390, height: 480 } });
    await openDialog(page);
    await settleDialog(page, "session-dialog");
    await assertInViewport(page, "#session-dialog");
    const metrics = await page.evaluate(() => {
      const body = document.getElementById("session-body");
      body.scrollTop = 80;
      return {
        scrollHeight: body.scrollHeight,
        clientHeight: body.clientHeight,
        scrollTop: body.scrollTop
      };
    });
    assert(metrics.scrollHeight > metrics.clientHeight + 8, JSON.stringify(metrics));
    assert(metrics.scrollTop >= 40, JSON.stringify(metrics));
    await assertNoOverflow(page, "modal curto");
    await context.close();
  });

  await test("z-index da página não alcança o diálogo modal", async () => {
    const { context, page } = await openPage(browser);
    const legend = {
      header: await page.locator('[data-z="header"]').innerText(),
      toast: await page.locator('[data-z="toast"]').innerText(),
      proof: await page.locator('[data-z="proof"]').innerText()
    };
    const computed = await page.evaluate(() => ({
      header: getComputedStyle(document.getElementById("site-header")).zIndex,
      toast: getComputedStyle(document.getElementById("toast-dock")).zIndex
    }));
    assert(legend.header === computed.header && computed.header === "20", JSON.stringify({ legend, computed }));
    assert(legend.toast === computed.toast && computed.toast === "30", JSON.stringify({ legend, computed }));
    assert(legend.proof === "9999");

    await page.locator(".stack-stage").scrollIntoViewIfNeeded();
    const stack = await page.evaluate(() => {
      const child = document.querySelector(".stack-child");
      const sibling = document.querySelector(".stack-sibling");
      const childRect = child.getBoundingClientRect();
      const siblingRect = sibling.getBoundingClientRect();
      const left = Math.max(childRect.left, siblingRect.left);
      const right = Math.min(childRect.right, siblingRect.right);
      const top = Math.max(childRect.top, siblingRect.top);
      const bottom = Math.min(childRect.bottom, siblingRect.bottom);
      const x = (left + right) / 2;
      const y = (top + bottom) / 2;
      return {
        overlap: right - left > 8 && bottom - top > 8,
        hit: document.elementsFromPoint(x, y).map((element) => String(element.className)).slice(0, 5)
      };
    });
    assert(stack.overlap, "o irmão não sobrepõe o filho");
    const siblingAt = stack.hit.findIndex((name) => String(name).includes("stack-sibling"));
    const childAt = stack.hit.findIndex((name) => String(name).includes("stack-child"));
    assert(siblingAt !== -1 && childAt !== -1 && siblingAt < childAt, JSON.stringify(stack));

    await page.locator("#toggle-proof").click();
    const proofZ = await page.locator("#proof-badge").evaluate((element) => getComputedStyle(element).zIndex);
    assert(proofZ === "9999");
    await openDialog(page);
    await page.waitForFunction(() => parseFloat(getComputedStyle(document.getElementById("session-dialog")).opacity) > 0.95);
    const coverage = await page.evaluate(() => {
      const badge = document.getElementById("proof-badge");
      const rect = badge.getBoundingClientRect();
      const x = rect.left + 24;
      const y = rect.top + rect.height / 2;
      return {
        dialogZ: getComputedStyle(document.getElementById("session-dialog")).zIndex,
        modal: document.getElementById("session-dialog").matches(":modal"),
        hit: document.elementsFromPoint(x, y).slice(0, 4).map((element) => element.id || element.tagName)
      };
    });
    assert(coverage.modal);
    assert(coverage.dialogZ === "auto", coverage.dialogZ);
    assert(coverage.hit[0] !== "proof-badge", JSON.stringify(coverage));
    fs.writeFileSync(path.join(root, "tests", "z-index-hit.json"), JSON.stringify(coverage, null, 2));
    await context.close();
  });

  await test("movimento reduzido encurta a transição e ainda fecha", async () => {
    const { context, page } = await openPage(browser, { reducedMotion: "reduce" });
    const duration = await page.locator("#session-dialog").evaluate((element) => getComputedStyle(element).transitionDuration);
    assert(duration.split(",").every((part) => parseFloat(part) <= 0.05), duration);
    const started = Date.now();
    await openDialog(page);
    const opacity = await page.locator("#session-dialog").evaluate((element) => getComputedStyle(element).opacity);
    assert(parseFloat(opacity) > 0.95, opacity);
    await page.keyboard.press("Escape");
    await waitClosed(page, "session-dialog");
    assert(Date.now() - started < 800);
    assert(await activeId(page) === "open-session");
    await page.locator("#show-info").click();
    await page.waitForSelector(".toast-info");
    await page.locator(".toast-info button").click();
    await page.waitForFunction(() => document.querySelectorAll(".toast").length === 0);
    await context.close();
  });

  await test("sem overflow horizontal em 320px nos estados principais", async () => {
    const { context, page } = await openPage(browser, { viewport: { width: 320, height: 720 } });
    const targets = await visibleButtons(page);
    const small = targets.filter((item) => item.width < 44 || item.height < 44);
    assert(small.length === 0, JSON.stringify(small));
    await assertNoOverflow(page, "repouso");

    await openDialog(page);
    await settleDialog(page, "session-dialog");
    await assertInViewport(page, "#session-dialog");
    await assertNoOverflow(page, "modal");
    await page.keyboard.press("Escape");
    await waitClosed(page, "session-dialog");

    await openDrawer(page);
    await settleDialog(page, "notes-drawer");
    await assertInViewport(page, "#notes-drawer");
    await assertNoOverflow(page, "gaveta");
    const gutter = await page.locator("#notes-drawer").evaluate((element) => element.getBoundingClientRect().left);
    assert(gutter >= 40, "faixa do pano de fundo estreita: " + gutter);
    await page.keyboard.press("Escape");
    await waitClosed(page, "notes-drawer");

    await page.locator("#show-info").click();
    await page.waitForSelector(".toast");
    await assertInViewport(page, ".toast");
    await assertNoOverflow(page, "toast");
    await page.locator("#open-glossary").click();
    await page.waitForFunction(() => document.getElementById("glossary").matches(":popover-open"));
    await assertInViewport(page, "#glossary");
    await assertNoOverflow(page, "glossário");
    await context.close();
  });

  await test("axe-core nos estados desktop e mobile", async () => {
    async function check(label, options, prepare) {
      const { context, page } = await openPage(browser, options);
      if (prepare) {
        await prepare(page);
      }
      const violations = await runAxe(page);
      axeReports.push({ label, violations });
      assert(violations.length === 0, label + " " + JSON.stringify(violations, null, 2));
      await context.close();
    }

    await check("repouso 1280", { viewport: { width: 1280, height: 800 } });
    await check("modal 1280", { viewport: { width: 1280, height: 800 } }, async (page) => {
      await openDialog(page);
      await page.waitForFunction(() => parseFloat(getComputedStyle(document.getElementById("session-dialog")).opacity) > 0.95);
    });
    await check("gaveta 1280", { viewport: { width: 1280, height: 800 } }, async (page) => {
      await openDrawer(page);
    });
    await check("toast 1280", { viewport: { width: 1280, height: 800 } }, async (page) => {
      await page.locator("#show-warning").click();
      await page.waitForSelector(".toast-warning");
    });
    await check("glossário 1280", { viewport: { width: 1280, height: 800 } }, async (page) => {
      await page.locator("#open-glossary").click();
      await page.waitForFunction(() => document.getElementById("glossary").matches(":popover-open"));
    });
    await check("repouso 320", { viewport: { width: 320, height: 720 } });
    await check("modal 320x480", { viewport: { width: 320, height: 480 } }, async (page) => {
      await openDialog(page);
      await settleDialog(page, "session-dialog");
    });
  });

  await test("capturas de tela dos estados pedidos", async () => {
    async function shot(name, options, prepare, fullPage) {
      const { context, page } = await openPage(browser, options);
      if (prepare) {
        await prepare(page);
      }
      await page.mouse.move(2, 2);
      await page.screenshot({
        path: path.join(imageDir, name),
        fullPage: Boolean(fullPage)
      });
      const stat = fs.statSync(path.join(imageDir, name));
      assert(stat.size > 1000, name + " ficou pequeno");
      await context.close();
    }

    await shot("desktop-painel.png", { viewport: { width: 1280, height: 800 } }, async (page) => {
      await page.evaluate(() => window.scrollTo(0, 0));
    });
    await shot("desktop-painel-completo.png", { viewport: { width: 1280, height: 800 } }, null, true);
    await shot("mobile-320-painel.png", { viewport: { width: 320, height: 720 } }, null, true);
    await shot("desktop-modal.png", { viewport: { width: 1280, height: 800 } }, async (page) => {
      await openDialog(page);
      await settleDialog(page, "session-dialog");
    });
    await shot("mobile-320-modal.png", { viewport: { width: 320, height: 720 } }, async (page) => {
      await openDialog(page);
      await settleDialog(page, "session-dialog");
    });
    await shot("desktop-modal-rolagem.png", { viewport: { width: 1280, height: 520 } }, async (page) => {
      await openDialog(page);
      await settleDialog(page, "session-dialog");
      await page.evaluate(() => {
        const body = document.getElementById("session-body");
        body.scrollTop = body.scrollHeight;
      });
    });
    await shot("desktop-gaveta.png", { viewport: { width: 1280, height: 800 } }, async (page) => {
      await openDrawer(page);
      await settleDialog(page, "notes-drawer");
    });
    await shot("mobile-320-gaveta.png", { viewport: { width: 320, height: 720 } }, async (page) => {
      await openDrawer(page);
      await settleDialog(page, "notes-drawer");
    });
    await shot("desktop-toast.png", { viewport: { width: 1280, height: 800 } }, async (page) => {
      await page.locator("#show-info").click();
      await page.locator("#show-warning").click();
      await page.waitForSelector(".toast-warning");
      await page.waitForTimeout(250);
    });
    await shot("mobile-320-toast.png", { viewport: { width: 320, height: 720 } }, async (page) => {
      await page.locator("#show-info").click();
      await page.waitForSelector(".toast-info");
      await page.waitForTimeout(250);
    });
    await shot("desktop-glossario.png", { viewport: { width: 1280, height: 800 } }, async (page) => {
      await page.locator("#open-glossary").click();
      await page.waitForFunction(() => {
        const glossary = document.getElementById("glossary");
        return glossary.matches(":popover-open") && parseFloat(getComputedStyle(glossary).opacity) > 0.95;
      });
    });
    await shot("desktop-prova-zindex.png", { viewport: { width: 1280, height: 800 } }, async (page) => {
      await page.locator("#toggle-proof").click();
      await openDialog(page);
      await settleDialog(page, "session-dialog");
    });
  });
} finally {
  await browser.close();
}

const summary = {
  ranAt: new Date().toISOString(),
  chrome: chromeVersion,
  axeCore: axeVersion,
  page: pageUrl,
  passed: results.filter((item) => item.ok).length,
  failed: results.filter((item) => !item.ok).length,
  externalRequests,
  results,
  axe: axeReports
};

fs.writeFileSync(path.join(root, "tests", "last-run.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ passed: summary.passed, failed: summary.failed, chrome: chromeVersion, axe: axeVersion, externalRequests }, null, 2));

if (summary.failed > 0 || externalRequests.length > 0) {
  process.exit(1);
}
