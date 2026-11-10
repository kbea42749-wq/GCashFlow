const TRANSACTIONS_KEY = "gcash-business-ledger";
const OPENING_BALANCES_KEY = "gcash-business-ledger-opening-balances";
const DEFAULT_CASH = 5000;
const DEFAULT_GCASH = 5000;

function formatCurrency(value) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP"
  }).format(Number(value || 0));
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

function getStoredObject(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "null");
    return value && typeof value === "object" ? value : fallback;
  } catch (error) {
    return fallback;
  }
}

function calculateFee(amount) {
  if (amount <= 0) return 0;
  if (amount <= 500) return 5;
  if (amount <= 1000) return 10;
  return Math.ceil(amount / 1000) * 10;
}

function renderHome() {
  const storedTransactions = getStoredObject(TRANSACTIONS_KEY, []);
  const transactions = Array.isArray(storedTransactions) ? storedTransactions : [];
  const opening = getStoredObject(OPENING_BALANCES_KEY, {});
  let cashOnHand = Number(opening.cashOnHand ?? DEFAULT_CASH);
  let gcashAvailable = Number(opening.gcashAvailable ?? DEFAULT_GCASH);
  let earnings = 0;

  const chronological = [...transactions].sort((a, b) => new Date(a.date) - new Date(b.date));
  for (const item of chronological) {
    const amount = Math.max(0, Number(item.amount || 0));
    earnings += Number(item.fee) > 0 ? Number(item.fee) : calculateFee(amount);

    if (item.type === "cashout") {
      cashOnHand -= amount;
      gcashAvailable += amount;
    } else {
      cashOnHand += amount;
      gcashAvailable -= amount;
    }
  }

  document.getElementById("homeCashOnHand").textContent = formatCurrency(cashOnHand);
  document.getElementById("homeGcashAvailable").textContent = formatCurrency(gcashAvailable);
  document.getElementById("homeEarnings").textContent = formatCurrency(earnings);
  document.getElementById("homeReceiptCount").textContent = String(transactions.length);

  const recentList = document.getElementById("homeRecentList");
  const recent = [...transactions]
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 5);

  if (!recent.length) {
    recentList.innerHTML = `
      <div class="home-empty">
        <span class="home-empty-mark" aria-hidden="true">♡</span>
        <p>No receipts saved just yet.</p>
        <a href="index.html#uploadReceipt">Add your first receipt</a>
      </div>
    `;
    return;
  }

  recentList.innerHTML = recent.map((item) => {
    const isCashOut = item.type === "cashout";
    const displayName = item.name || (isCashOut ? "Cash Out" : "Cash In");
    const transactionType = isCashOut ? "Cash Out" : "Cash In";
    const date = new Date(`${item.date}T00:00:00`).toLocaleDateString("en-PH", {
      month: "short",
      day: "numeric",
      year: "numeric"
    });

    return `
      <article class="home-receipt-row">
        <span class="home-receipt-mark ${isCashOut ? "cashout" : "cashin"}" aria-hidden="true">${isCashOut ? "↗" : "↙"}</span>
        <span class="home-receipt-copy">
          <strong>${escapeHtml(displayName)}</strong>
          <span>${transactionType} · ${escapeHtml(date)}</span>
        </span>
        <span class="home-receipt-amount">${formatCurrency(item.amount)}</span>
      </article>
    `;
  }).join("");
}

function initializeSplash() {
  const splash = document.getElementById("homeSplash");
  const home = document.querySelector(".home-shell");
  const continueButton = document.getElementById("skipSplash");
  let dismissed = false;

  home.setAttribute("inert", "");
  home.setAttribute("aria-hidden", "true");

  const dismiss = () => {
    if (dismissed) return;
    dismissed = true;
    home.removeAttribute("inert");
    home.removeAttribute("aria-hidden");
    splash.classList.add("is-leaving");
    window.setTimeout(() => splash.remove(), 500);
  };

  continueButton.addEventListener("click", dismiss);
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  window.setTimeout(dismiss, reduceMotion ? 1400 : 2400);
}

renderHome();
initializeSplash();
