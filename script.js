const weddingDate = new Date("2027-08-21T16:30:00-03:00");
const pad = (value, size = 2) => String(value).padStart(size, "0");

function updateCountdown() {
  const difference = Math.max(0, weddingDate.getTime() - Date.now());
  const days = Math.floor(difference / 86400000);
  const hours = Math.floor((difference % 86400000) / 3600000);
  const minutes = Math.floor((difference % 3600000) / 60000);
  const seconds = Math.floor((difference % 60000) / 1000);

  document.querySelector("#days").textContent = pad(days, 3);
  document.querySelector("#hours").textContent = pad(hours);
  document.querySelector("#minutes").textContent = pad(minutes);
  document.querySelector("#seconds").textContent = pad(seconds);
}

updateCountdown();
setInterval(updateCountdown, 1000);

const topbar = document.querySelector("#topbar");
window.addEventListener("scroll", () => topbar.classList.toggle("scrolled", window.scrollY > 40), { passive: true });

const menuButton = document.querySelector("#menuButton");
const navigation = document.querySelector("#navigation");
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

const observer = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      entry.target.classList.add("visible");
      observer.unobserve(entry.target);
    }
  });
}, { threshold: 0.14 });
document.querySelectorAll(".reveal").forEach((element) => observer.observe(element));

const rsvpForm = document.querySelector("#rsvpForm");
const formNote = document.querySelector("#formNote");
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
