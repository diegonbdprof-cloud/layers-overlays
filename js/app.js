(function () {
  var modal = document.getElementById("session-dialog");
  var drawer = document.getElementById("notes-drawer");
  var glossary = document.getElementById("glossary");
  var glossaryButton = document.getElementById("open-glossary");
  var form = document.getElementById("session-form");
  var errors = document.getElementById("session-errors");
  var proof = document.getElementById("proof-badge");
  var proofButton = document.getElementById("toggle-proof");
  var toasts = document.getElementById("toasts");
  var noteList = document.getElementById("note-list");
  var noteCount = document.getElementById("note-count");

  var notes = [
    {
      id: "empilhamento",
      title: "Contexto de empilhamento",
      body: "Um elemento posicionado com z-index diferente de auto cria um contexto. O filho com z-index 50 permanece nesse grupo. O irmão do pai, com z-index 1, é pintado depois e cobre o filho. Aumentar o número do filho não muda essa ordem."
    },
    {
      id: "top-layer",
      title: "Top layer do diálogo",
      body: "showModal() promove o diálogo à top layer e desenha o ::backdrop imediatamente atrás dele. Essa camada fica acima do documento inteiro. A faixa com z-index 9999 continua competindo só com outras caixas do documento, então o diálogo modal a cobre."
    },
    {
      id: "backdrop",
      title: "Pano de fundo e inércia",
      body: "Com o diálogo modal aberto, o navegador torna o restante do documento inerte: sem foco e sem clique. Esc, o botão Fechar, Cancelar e o clique no pano de fundo fecham a gaveta ou o diálogo. O foco volta ao controle que abriu."
    },
    {
      id: "toast",
      title: "Aviso que não interrompe",
      body: "A notificação usa role status, ícone e rótulo. Ela não recebe foco ao aparecer e não desaparece sozinha. Fica numa camada fixa com z-index 30, abaixo da top layer. Por isso o aviso de sucesso só é mostrado depois que o diálogo fecha."
    }
  ];

  var icons = {
    info: "i-info",
    success: "i-check",
    warning: "i-alert",
    error: "i-error"
  };

  var labels = {
    info: "Informação",
    success: "Sucesso",
    warning: "Atenção",
    error: "Erro"
  };

  function reducedMotion() {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  var lockedScrollY = 0;

  function lockPage() {
    if (document.body.classList.contains("is-scroll-locked")) {
      return;
    }
    lockedScrollY = window.scrollY;
    document.body.style.top = "-" + lockedScrollY + "px";
    document.body.classList.add("is-scroll-locked");
  }

  function unlockPage() {
    if (!document.body.classList.contains("is-scroll-locked")) {
      return;
    }
    var y = lockedScrollY;
    document.body.classList.remove("is-scroll-locked");
    document.body.style.top = "";
    window.scrollTo(0, y);
  }

  function hideGlossary() {
    if (glossary.matches(":popover-open")) {
      glossary.hidePopover();
    }
  }

  function forceClose(dialog) {
    dialog.classList.remove("is-closing");
    delete dialog.dataset.closing;
    if (dialog.open) {
      dialog.close();
    }
  }

  function focusInside(dialog, preferred) {
    var target = preferred || dialog.querySelector("[data-initial-focus]");
    if (target) {
      target.focus();
    }
  }

  function openModal() {
    if (drawer.open) {
      forceClose(drawer);
    }
    hideGlossary();
    lockPage();
    if (!modal.open) {
      modal.showModal();
    }
    focusInside(modal);
  }

  function openDrawer(noteId) {
    if (modal.open) {
      forceClose(modal);
    }
    hideGlossary();
    lockPage();
    if (!drawer.open) {
      drawer.showModal();
    }
    var note = noteId ? document.getElementById("note-" + noteId) : null;
    focusInside(drawer, note);
  }

  function releaseIfIdle(dialog) {
    var other = dialog === modal ? drawer : modal;
    if (!other.open) {
      unlockPage();
    }
  }

  function requestClose(dialog, returnValue) {
    if (!dialog.open || dialog.dataset.closing === "true") {
      return;
    }

    var settled = false;
    var timer = 0;

    function finish() {
      if (settled) {
        return;
      }
      settled = true;
      window.clearTimeout(timer);
      dialog.removeEventListener("transitionend", onEnd);
      dialog.classList.remove("is-closing");
      delete dialog.dataset.closing;
      if (dialog.open) {
        releaseIfIdle(dialog);
        dialog.close(returnValue || "");
      }
    }

    function onEnd(event) {
      if (event.target === dialog && (event.propertyName === "opacity" || event.propertyName === "transform")) {
        finish();
      }
    }

    if (reducedMotion()) {
      finish();
      return;
    }

    dialog.dataset.closing = "true";
    dialog.classList.add("is-closing");
    timer = window.setTimeout(finish, 360);
    dialog.addEventListener("transitionend", onEnd);
  }

  function bindDialog(dialog) {
    dialog.addEventListener("cancel", function (event) {
      if (reducedMotion()) {
        return;
      }
      event.preventDefault();
      requestClose(dialog);
    });

    dialog.addEventListener("click", function (event) {
      if (event.target === dialog) {
        requestClose(dialog);
      }
    });

    dialog.addEventListener("keydown", function (event) {
      if (event.key !== "Tab" || !dialog.open) {
        return;
      }
      var items = Array.prototype.filter.call(
        dialog.querySelectorAll("button, a[href], input, select, textarea, [tabindex]"),
        function (element) {
          return !element.disabled && element.tabIndex >= 0 && element.getClientRects().length > 0;
        }
      );
      if (!items.length) {
        return;
      }
      var first = items[0];
      var last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });

    dialog.addEventListener("close", function () {
      dialog.classList.remove("is-closing");
      delete dialog.dataset.closing;
      if (!modal.open && !drawer.open) {
        unlockPage();
      }
    });

    dialog.querySelectorAll("[data-close-dialog]").forEach(function (button) {
      button.addEventListener("click", function () {
        requestClose(dialog);
      });
    });
  }

  function clearErrors() {
    errors.hidden = true;
    errors.replaceChildren();
    ["session-theme", "session-note", "session-ack"].forEach(function (id) {
      var field = document.getElementById(id);
      field.removeAttribute("aria-invalid");
      field.removeAttribute("aria-describedby");
    });
  }

  function showErrors(messages, focusId) {
    errors.replaceChildren();
    var icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.setAttribute("class", "icon");
    icon.setAttribute("aria-hidden", "true");
    var use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", "#i-error");
    icon.appendChild(use);
    var list = document.createElement("ul");
    messages.forEach(function (message) {
      var item = document.createElement("li");
      item.textContent = message;
      list.appendChild(item);
    });
    var label = document.createElement("span");
    label.textContent = "Erro";
    errors.append(icon, label, list);
    errors.hidden = false;
    if (focusId) {
      document.getElementById(focusId).focus();
    }
  }

  function readSession() {
    return {
      theme: document.getElementById("session-theme").value.trim(),
      duration: document.getElementById("session-duration").value.trim(),
      note: document.getElementById("session-note").value.trim(),
      ack: document.getElementById("session-ack").checked
    };
  }

  function validate(data) {
    var problems = [];
    if (!data.theme) {
      problems.push({ id: "session-theme", text: "Selecione um tema de estudo." });
    }
    if (data.note.length < 3) {
      problems.push({ id: "session-note", text: "Escreva uma anotação com pelo menos 3 caracteres." });
    }
    if (!data.ack) {
      problems.push({ id: "session-ack", text: "Confirme que a anotação não será enviada nem gravada." });
    }
    return problems;
  }

  function renderNotes() {
    noteList.replaceChildren();
    notes.forEach(function (note) {
      var item = document.createElement("li");
      var article = document.createElement("article");
      var title = document.createElement("h3");
      var body = document.createElement("p");
      article.id = "note-" + note.id;
      article.tabIndex = -1;
      title.textContent = note.title;
      body.textContent = note.body;
      article.append(title, body);
      item.appendChild(article);
      noteList.appendChild(item);
    });
    noteCount.textContent = notes.length + (notes.length === 1 ? " nota nesta aba" : " notas nesta aba");
  }

  function addUserNote(data) {
    var note = {
      id: "sessao-" + (notes.length + 1),
      title: "Sessão: " + data.theme,
      body: data.note + " Duração anotada: " + (data.duration || "não informada") + " min. Existe só nesta aba."
    };
    notes.unshift(note);
    renderNotes();
  }

  function addExampleNote() {
    var note = {
      id: "exemplo-" + (notes.length + 1),
      title: "Nota de exemplo",
      body: "Criada agora, só na memória desta aba. Recarregar a página remove esta nota. Nada foi enviado."
    };
    notes.unshift(note);
    renderNotes();
    var created = document.getElementById("note-" + note.id);
    if (created) {
      created.focus();
    }
  }

  function showToast(type, message) {
    var toast = document.createElement("div");
    var kicker = document.createElement("p");
    var icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    var use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    var kickerText = document.createElement("span");
    var copy = document.createElement("p");
    var close = document.createElement("button");
    var label = labels[type] || labels.info;

    toast.className = "toast toast-" + type;
    toast.setAttribute("role", "status");
    icon.setAttribute("class", "icon");
    icon.setAttribute("aria-hidden", "true");
    use.setAttribute("href", "#" + (icons[type] || icons.info));
    icon.appendChild(use);
    kicker.className = "toast-kicker";
    kickerText.textContent = label;
    kicker.append(icon, kickerText);
    copy.className = "toast-message";
    copy.textContent = message;
    close.type = "button";
    close.className = "btn btn-secondary";
    close.textContent = "Fechar";
    close.setAttribute("aria-label", "Fechar notificação de " + label.toLowerCase());
    close.addEventListener("click", function () {
      removeToast(toast);
    });
    toast.append(kicker, copy, close);
    toasts.appendChild(toast);

    while (toasts.children.length > 4) {
      toasts.firstElementChild.remove();
    }
  }

  function removeToast(toast) {
    if (!toast.isConnected) {
      return;
    }
    if (reducedMotion()) {
      toast.remove();
      return;
    }
    toast.classList.add("is-leaving");
    var done = function () {
      toast.remove();
    };
    toast.addEventListener("animationend", done, { once: true });
    window.setTimeout(function () {
      if (toast.isConnected) {
        toast.remove();
      }
    }, 240);
  }

  function placeGlossary() {
    var rect = glossaryButton.getBoundingClientRect();
    var margin = 8;
    var spaceBelow = window.innerHeight - rect.bottom - margin;
    var spaceAbove = rect.top - margin;
    var openBelow = spaceBelow >= 180 || spaceBelow >= spaceAbove;
    var available = Math.max(140, openBelow ? spaceBelow : spaceAbove);
    glossary.style.maxHeight = available + "px";
    var width = glossary.offsetWidth || Math.min(352, window.innerWidth - 16);
    var height = glossary.offsetHeight;
    var left = Math.min(Math.max(margin, rect.left), window.innerWidth - width - margin);
    var top = openBelow ? rect.bottom + margin : Math.max(margin, rect.top - height - margin);
    glossary.style.left = Math.max(margin, left) + "px";
    glossary.style.top = Math.max(margin, top) + "px";
  }

  document.getElementById("open-session").addEventListener("click", openModal);
  document.getElementById("open-notes").addEventListener("click", function () {
    openDrawer();
  });

  document.querySelectorAll("[data-open-note]").forEach(function (button) {
    button.addEventListener("click", function () {
      openDrawer(button.getAttribute("data-open-note"));
    });
  });

  document.getElementById("show-info").addEventListener("click", function () {
    showToast("info", "Leitura registrada só nesta página. Nenhum servidor foi contactado.");
  });

  document.getElementById("show-warning").addEventListener("click", function () {
    showToast("warning", "Esta ação não publica o portfólio. O botão de publicar permanece desativado porque não há conta nem envio.");
  });

  proofButton.addEventListener("click", function () {
    var show = proof.hidden;
    proof.hidden = !show;
    proofButton.setAttribute("aria-pressed", show ? "true" : "false");
    proofButton.textContent = show ? "Ocultar faixa z-index 9999" : "Mostrar faixa z-index 9999";
  });

  document.getElementById("add-note").addEventListener("click", addExampleNote);

  glossary.addEventListener("toggle", function () {
    var open = glossary.matches(":popover-open");
    glossaryButton.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) {
      placeGlossary();
    }
  });

  window.addEventListener("resize", function () {
    if (glossary.matches(":popover-open")) {
      placeGlossary();
    }
  });

  window.addEventListener("scroll", function () {
    if (glossary.matches(":popover-open")) {
      placeGlossary();
    }
  }, { passive: true });

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    clearErrors();
    var data = readSession();
    var problems = validate(data);
    if (problems.length) {
      problems.forEach(function (problem) {
        var field = document.getElementById(problem.id);
        field.setAttribute("aria-invalid", "true");
        field.setAttribute("aria-describedby", "session-errors");
      });
      showErrors(problems.map(function (problem) {
        return problem.text;
      }), problems[0].id);
      return;
    }
    form.dataset.pendingTheme = data.theme;
    form.dataset.pendingDuration = data.duration;
    form.dataset.pendingNote = data.note;
    requestClose(modal, "salvar");
  });

  modal.addEventListener("close", function () {
    if (modal.returnValue === "salvar" && form.dataset.pendingNote) {
      addUserNote({
        theme: form.dataset.pendingTheme,
        duration: form.dataset.pendingDuration,
        note: form.dataset.pendingNote
      });
      showToast("success", "Sessão anotada apenas nesta demonstração. Nada foi enviado nem gravado.");
    }
    modal.returnValue = "";
    delete form.dataset.pendingTheme;
    delete form.dataset.pendingDuration;
    delete form.dataset.pendingNote;
    form.reset();
    clearErrors();
  });

  bindDialog(modal);
  bindDialog(drawer);
  renderNotes();
})();
