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

updateCountdown();
updateLoveCounter();
setInterval(updateCountdown, 1000);
setInterval(updateLoveCounter, 1000);
initNavigation();
initReveal();
initRsvp();
initGalleryCarousel();
