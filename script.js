const weddingDate = new Date("2027-08-21T16:30:00-03:00");
const loveStartDate = new Date("2019-07-19T23:00:00-03:00");
const pad = (value, size = 2) => String(value).padStart(size, "0");

function updateCountdown() {
  const difference = Math.max(0, weddingDate.getTime() - Date.now());
  const days = Math.floor(difference / 86400000);
  const hours = Math.floor((difference % 86400000) / 3600000);
  const minutes = Math.floor((difference % 3600000) / 60000);
  const seconds = Math.floor((difference % 60000) / 1000);

  const daysEl = document.querySelector("#days");
  const hoursEl = document.querySelector("#hours");
  const minutesEl = document.querySelector("#minutes");
  const secondsEl = document.querySelector("#seconds");

  if (!daysEl || !hoursEl || !minutesEl || !secondsEl) return;

  daysEl.textContent = pad(days, 3);
  hoursEl.textContent = pad(hours);
  minutesEl.textContent = pad(minutes);
  secondsEl.textContent = pad(seconds);
}

function addMonths(date, monthsToAdd) {
  const result = new Date(date);
  const originalDay = result.getDate();
  result.setDate(1);
  result.setMonth(result.getMonth() + monthsToAdd);
  const lastDay = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
  result.setDate(Math.min(originalDay, lastDay));
  return result;
}

function getRelationshipTime(start, end) {
  let totalMonths = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());

  if (addMonths(start, totalMonths) > end) {
    totalMonths -= 1;
  }

  let cursor = addMonths(start, totalMonths);
  const years = Math.floor(totalMonths / 12);
  const months = totalMonths % 12;
  const days = Math.floor((end.getTime() - cursor.getTime()) / 86400000);
  cursor = new Date(cursor.getTime() + days * 86400000);
  const hours = Math.floor((end.getTime() - cursor.getTime()) / 3600000);
  cursor = new Date(cursor.getTime() + hours * 3600000);
  const minutes = Math.floor((end.getTime() - cursor.getTime()) / 60000);
  cursor = new Date(cursor.getTime() + minutes * 60000);
  const seconds = Math.floor((end.getTime() - cursor.getTime()) / 1000);

  return { years, months, days, hours, minutes, seconds };
}

function updateLoveCounter() {
  const yearsEl = document.querySelector("#loveYears");
  const monthsEl = document.querySelector("#loveMonths");
  const daysEl = document.querySelector("#loveDays");
  const hoursEl = document.querySelector("#loveHours");
  const minutesEl = document.querySelector("#loveMinutes");
  const secondsEl = document.querySelector("#loveSeconds");

  if (!yearsEl || !monthsEl || !daysEl || !hoursEl || !minutesEl || !secondsEl) return;

  const elapsed = getRelationshipTime(loveStartDate, new Date());
  yearsEl.textContent = pad(elapsed.years);
  monthsEl.textContent = pad(elapsed.months);
  daysEl.textContent = pad(elapsed.days);
  hoursEl.textContent = pad(elapsed.hours);
  minutesEl.textContent = pad(elapsed.minutes);
  secondsEl.textContent = pad(elapsed.seconds);
}

function initNavigation() {
  const topbar = document.querySelector("#topbar");
  if (topbar) {
    window.addEventListener("scroll", () => topbar.classList.toggle("scrolled", window.scrollY > 40), { passive: true });
  }

  const menuButton = document.querySelector("#menuButton");
  const navigation = document.querySelector("#navigation");

  if (!menuButton || !navigation) return;

  menuButton.addEventListener("click", () => {
    const isOpen = menuButton.getAttribute("aria-expanded") === "true";
    menuButton.setAttribute("aria-expanded", String(!isOpen));
    navigation.classList.toggle("open", !isOpen);
    document.body.classList.toggle("menu-open", !isOpen);
  });

  navigation.querySelectorAll("a").forEach((link) => link.addEventListener("click", () => {
    menuButton.setAttribute("aria-expanded", "false");
    navigation.classList.remove("open");
    document.body.classList.remove("menu-open");
  }));
}

function initReveal() {
  const elements = document.querySelectorAll(".reveal");
  if (!elements.length) return;

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("visible");
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.14 });

  elements.forEach((element) => observer.observe(element));
}

function initRsvp() {
  const rsvpForm = document.querySelector("#rsvpForm");
  const formNote = document.querySelector("#formNote");

  if (!rsvpForm || !formNote) return;

  rsvpForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const response = Object.fromEntries(new FormData(rsvpForm).entries());
    const savedResponses = JSON.parse(localStorage.getItem("dc-rsvp-demo") || "[]");
    savedResponses.push({ ...response, sentAt: new Date().toISOString() });
    localStorage.setItem("dc-rsvp-demo", JSON.stringify(savedResponses));
    formNote.textContent = response.attendance === "sim"
      ? "Presença confirmada. Que alegria ter você com a gente!"
      : "Resposta registrada. Sentiremos sua falta!";
    rsvpForm.reset();
  });
}

function initGalleryCarousel() {
  const carousel = document.querySelector("#galleryCarousel");
  const track = document.querySelector("#galleryTrack");
  const dotsContainer = document.querySelector("#galleryDots");
  const gallerySection = document.querySelector(".gallery");

  if (!carousel || !track || !dotsContainer || !gallerySection) return;

  const slides = Array.from(track.querySelectorAll(".carousel-slide"));
  const prevButton = document.querySelector(".carousel-arrow.prev");
  const nextButton = document.querySelector(".carousel-arrow.next");

  if (!slides.length || !prevButton || !nextButton) return;

  let currentIndex = 0;
  let autoplayId = null;
  let touchStartX = 0;
  let touchEndX = 0;

  function renderDots() {
    dotsContainer.innerHTML = "";
    slides.forEach((_, index) => {
      const dot = document.createElement("button");
      dot.type = "button";
      dot.className = `carousel-dot${index === currentIndex ? " active" : ""}`;
      dot.setAttribute("aria-label", `Ir para foto ${index + 1}`);
      dot.addEventListener("click", () => showSlide(index));
      dotsContainer.appendChild(dot);
    });
  }

  function showSlide(index) {
    currentIndex = (index + slides.length) % slides.length;
    slides.forEach((slide, slideIndex) => {
      slide.classList.toggle("active", slideIndex === currentIndex);
    });
    dotsContainer.querySelectorAll(".carousel-dot").forEach((dot, dotIndex) => {
      dot.classList.toggle("active", dotIndex === currentIndex);
    });
  }

  function startAutoplay() {
    stopAutoplay();
    autoplayId = window.setInterval(() => showSlide(currentIndex + 1), 4500);
  }

  function stopAutoplay() {
    if (autoplayId) {
      window.clearInterval(autoplayId);
      autoplayId = null;
    }
  }

  function restartAutoplay() {
    stopAutoplay();
    startAutoplay();
  }

  prevButton.addEventListener("click", () => {
    showSlide(currentIndex - 1);
    restartAutoplay();
  });

  nextButton.addEventListener("click", () => {
    showSlide(currentIndex + 1);
    restartAutoplay();
  });

  gallerySection.addEventListener("mouseenter", stopAutoplay);
  gallerySection.addEventListener("mouseleave", startAutoplay);

  track.addEventListener("touchstart", (event) => {
    touchStartX = event.changedTouches[0].clientX;
  }, { passive: true });

  track.addEventListener("touchend", (event) => {
    touchEndX = event.changedTouches[0].clientX;
    const swipeDistance = touchStartX - touchEndX;

    if (Math.abs(swipeDistance) < 40) return;

    if (swipeDistance > 0) {
      showSlide(currentIndex + 1);
    } else {
      showSlide(currentIndex - 1);
    }

    restartAutoplay();
  }, { passive: true });

  renderDots();
  showSlide(0);
  startAutoplay();
}

function formatCurrency(value) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0
  }).format(value);
}

function slugify(value) {
  return (value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function getSiteBaseUrl() {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  url.pathname = url.pathname.replace(/[^/]*$/, "");
  return url;
}

function generateOrderId() {
  return `dc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function initGiftStore() {
  if (!document.querySelector("#giftGrid")) return;

  const giftGrid = document.querySelector("#giftGrid");
  const giftSort = document.querySelector("#giftSort");
  const giftCategory = document.querySelector("#giftCategory");
  const giftSearch = document.querySelector("#giftSearch");
  const giftResetFilters = document.querySelector("#giftResetFilters");
  const giftCartList = document.querySelector("#giftCartList");
  const giftCartEmpty = document.querySelector("#giftCartEmpty");
  const giftCartSubtotal = document.querySelector("#giftCartSubtotal");
  const giftCartBadge = document.querySelector("#giftCartBadge");
  const navCartCount = document.querySelector("#navCartCount");
  const floatingCartCount = document.querySelector("#floatingCartCount");
  const giftCartToggle = document.querySelector("#giftCartToggle");
  const giftClearCart = document.querySelector("#giftClearCart");
  const giftCheckoutButton = document.querySelector("#giftCheckoutButton");
  const giftCartPanel = document.querySelector("#carrinho");
  const giftBuyerName = document.querySelector("#giftBuyerName");
  const giftBuyerEmail = document.querySelector("#giftBuyerEmail");
  const giftBuyerPhone = document.querySelector("#giftBuyerPhone");

  if (!giftSort || !giftCategory || !giftSearch || !giftCartList || !giftCartSubtotal || !giftCartBadge || !giftCartToggle || !giftClearCart || !giftCheckoutButton || !giftCartPanel) return;

  const storageKey = "dc-gift-cart-v1";
  const checkoutDraftKey = "dc-gift-checkout-draft";
  const collator = new Intl.Collator("pt-BR", { sensitivity: "base" });
  const infinitepayHandle = document.body.dataset.infinitepayHandle?.trim() || "";
  const siteBase = getSiteBaseUrl();
  const cards = Array.from(giftGrid.querySelectorAll(".gift-card"));
  const noResults = document.createElement("div");
  noResults.className = "gift-no-results";
  noResults.hidden = true;
  noResults.innerHTML = "<strong>Nenhum presente encontrado</strong><p>Tente ajustar a busca ou limpar os filtros para ver mais opções.</p>";
  giftGrid.after(noResults);

  const catalog = cards.map((card, index) => {
    const title = card.querySelector("h3")?.textContent?.trim() || `Presente ${index + 1}`;
    const description = card.querySelector("p")?.textContent?.trim() || "";
    const category = card.querySelector(".gift-tag")?.textContent?.trim() || "Geral";
    const image = card.querySelector("img")?.getAttribute("src") || "";
    const price = Number(card.dataset.price || 0);
    const relevance = Number(card.dataset.relevance || index);
    const id = slugify(title);
    const button = card.querySelector(".gift-button");

    card.dataset.category = category;
    card.dataset.id = id;

    if (button) {
      button.textContent = "Adicionar ao carrinho";
      button.classList.remove("disabled");
      button.removeAttribute("aria-disabled");
      button.setAttribute("href", "#carrinho");
      button.dataset.giftId = id;
      button.classList.add("ready");
    }

    return { id, title, description, category, image, price, relevance, card, button };
  });

  const categories = Array.from(new Set(catalog.map((item) => item.category))).sort((a, b) => collator.compare(a, b));
  categories.forEach((category) => {
    const option = document.createElement("option");
    option.value = category;
    option.textContent = category;
    giftCategory.appendChild(option);
  });

  let cart = JSON.parse(localStorage.getItem(storageKey) || "{}");
  try {
    const savedBuyer = JSON.parse(localStorage.getItem(checkoutDraftKey) || "{}");
    if (giftBuyerName) giftBuyerName.value = savedBuyer.name || "";
    if (giftBuyerEmail) giftBuyerEmail.value = savedBuyer.email || "";
    if (giftBuyerPhone) giftBuyerPhone.value = savedBuyer.phone || "";
  } catch {}

  function persistCart() {
    localStorage.setItem(storageKey, JSON.stringify(cart));
  }

  function persistBuyerData() {
    const buyer = {
      name: giftBuyerName?.value.trim() || "",
      email: giftBuyerEmail?.value.trim() || "",
      phone: giftBuyerPhone?.value.trim() || ""
    };
    localStorage.setItem(checkoutDraftKey, JSON.stringify(buyer));
    return buyer;
  }

  function getCartEntries() {
    return Object.entries(cart)
      .map(([id, quantity]) => {
        const item = catalog.find((gift) => gift.id === id);
        return item ? { ...item, quantity } : null;
      })
      .filter(Boolean);
  }

  function updateCounts(totalItems) {
    const countLabel = totalItems === 1 ? "1 item" : `${totalItems} itens`;
    giftCartBadge.textContent = countLabel;
    if (navCartCount) navCartCount.textContent = String(totalItems);
    if (floatingCartCount) floatingCartCount.textContent = String(totalItems);
  }

  function renderCart() {
    const entries = getCartEntries();
    const totalItems = entries.reduce((sum, item) => sum + item.quantity, 0);
    const subtotal = entries.reduce((sum, item) => sum + item.price * item.quantity, 0);

    giftCartList.querySelectorAll(".gift-cart-item").forEach((node) => node.remove());
    if (giftCartEmpty) giftCartEmpty.hidden = entries.length > 0;

    entries.forEach((item) => {
      const row = document.createElement("div");
      row.className = "gift-cart-item";
      row.innerHTML = `
        <img class="gift-cart-thumb" src="${item.image}" alt="${item.title}">
        <div class="gift-cart-item-copy">
          <strong>${item.title}</strong>
          <span>${item.category}</span>
          <div class="gift-cart-qty">
            <button type="button" data-action="decrease" data-id="${item.id}" aria-label="Diminuir quantidade">−</button>
            <b>${item.quantity}</b>
            <button type="button" data-action="increase" data-id="${item.id}" aria-label="Aumentar quantidade">+</button>
          </div>
        </div>
        <div class="gift-cart-item-side">
          <strong>${formatCurrency(item.price * item.quantity)}</strong>
          <button type="button" class="gift-cart-remove" data-action="remove" data-id="${item.id}">Remover</button>
        </div>
      `;
      giftCartList.appendChild(row);
    });

    giftCartSubtotal.textContent = formatCurrency(subtotal);
    updateCounts(totalItems);
    persistCart();
  }

  function setCartAction(id, action) {
    const current = Number(cart[id] || 0);

    if (action === "increase") {
      cart[id] = current + 1;
    }

    if (action === "decrease") {
      if (current <= 1) {
        delete cart[id];
      } else {
        cart[id] = current - 1;
      }
    }

    if (action === "remove") {
      delete cart[id];
    }

    renderCart();
  }

  function sortCatalog(items, mode) {
    return [...items].sort((a, b) => {
      if (mode === "price-desc") return b.price - a.price || collator.compare(a.title, b.title);
      if (mode === "alpha") return collator.compare(a.title, b.title) || a.price - b.price;
      if (mode === "relevance") return a.relevance - b.relevance;
      return a.price - b.price || collator.compare(a.title, b.title);
    });
  }

  function renderCatalog() {
    const searchTerm = slugify(giftSearch.value).replace(/-/g, " ");
    const category = giftCategory.value;
    const mode = giftSort.value;

    const filtered = catalog.filter((item) => {
      const normalizedTitle = slugify(item.title).replace(/-/g, " ");
      const normalizedDescription = slugify(item.description).replace(/-/g, " ");
      const matchesSearch = !searchTerm || normalizedTitle.includes(searchTerm) || normalizedDescription.includes(searchTerm);
      const matchesCategory = category === "all" || item.category === category;
      return matchesSearch && matchesCategory;
    });

    const ordered = sortCatalog(filtered, mode);
    catalog.forEach((item) => { item.card.hidden = true; });
    ordered.forEach((item) => {
      item.card.hidden = false;
      giftGrid.appendChild(item.card);
    });

    noResults.hidden = ordered.length > 0;
  }

  catalog.forEach((item) => {
    item.button?.addEventListener("click", (event) => {
      event.preventDefault();
      cart[item.id] = Number(cart[item.id] || 0) + 1;
      renderCart();
      if (window.innerWidth <= 900) {
        giftCartPanel.classList.add("open");
      }
      giftCartPanel.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });

  giftCartList.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    setCartAction(button.dataset.id, button.dataset.action);
  });

  giftSort.addEventListener("change", renderCatalog);
  giftCategory.addEventListener("change", renderCatalog);
  giftSearch.addEventListener("input", renderCatalog);
  giftResetFilters.addEventListener("click", () => {
    giftSearch.value = "";
    giftCategory.value = "all";
    giftSort.value = "price-asc";
    renderCatalog();
  });

  giftCartToggle.addEventListener("click", () => {
    giftCartPanel.classList.toggle("open");
    giftCartPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  giftClearCart.addEventListener("click", () => {
    cart = {};
    renderCart();
  });

  giftCheckoutButton.addEventListener("click", async () => {
    const entries = getCartEntries();
    if (!entries.length) {
      window.alert("Seu carrinho est? vazio. Escolha pelo menos um presente para continuar.");
      return;
    }

    if (!infinitepayHandle) {
      window.alert("Falta preencher a InfiniteTag da conta que vai receber os presentes. Assim que esse dado for adicionado no site, o checkout abre normalmente.");
      return;
    }

    const buyer = persistBuyerData();
    const subtotal = entries.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const orderId = generateOrderId();
    const redirectUrl = new URL("checkout-success.html", siteBase).toString();
    const payload = {
      handle: infinitepayHandle,
      redirect_url: redirectUrl,
      order_nsu: orderId,
      items: entries.map((item) => ({
        quantity: item.quantity,
        price: Math.round(item.price * 100),
        description: item.title
      }))
    };

    if (buyer.name) payload.name = buyer.name;
    if (buyer.email) payload.email = buyer.email;
    if (buyer.phone) payload.phone = buyer.phone;

    localStorage.setItem("dc-last-infinitepay-order", JSON.stringify({
      orderId,
      subtotal,
      createdAt: new Date().toISOString(),
      buyer,
      items: entries.map((item) => ({
        id: item.id,
        title: item.title,
        category: item.category,
        image: item.image,
        price: item.price,
        quantity: item.quantity
      }))
    }));

    const previousLabel = giftCheckoutButton.textContent;
    giftCheckoutButton.disabled = true;
    giftCheckoutButton.textContent = "Abrindo checkout...";

    try {
      const response = await fetch("https://api.checkout.infinitepay.io/links", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const detail = data?.message || data?.error || "N?o foi poss?vel gerar o checkout agora.";
        throw new Error(detail);
      }

      const checkoutUrl = data?.link || data?.url || data?.checkout_url;
      if (!checkoutUrl) {
        throw new Error("A InfinitePay respondeu sem retornar o link do checkout.");
      }

      window.location.href = checkoutUrl;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro inesperado ao abrir o checkout.";
      window.alert(`N?o conseguimos abrir o pagamento agora.

${message}`);
      giftCheckoutButton.disabled = false;
      giftCheckoutButton.textContent = previousLabel;
    }
  });

  renderCatalog();
  renderCart();
}

updateCountdown();
updateLoveCounter();
setInterval(updateCountdown, 1000);
setInterval(updateLoveCounter, 1000);
initNavigation();
initReveal();
initRsvp();
initGalleryCarousel();
initGiftStore();
